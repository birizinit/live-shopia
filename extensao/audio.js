// Motor de áudio: toca a montagem no cabo virtual, em laço, por horas.
//
// COMO O ÁUDIO CHEGA NO LIVE STUDIO
// O cabo virtual (VB-Cable no Windows, BlackHole no macOS) cria um par: uma
// SAÍDA de áudio e uma ENTRADA ligadas entre si. A extensão toca o áudio na
// saída do cabo com setSinkId; o LIVE Studio escolhe a entrada do cabo como
// microfone. Não existe microfone falso nem stream forjado — são duas APIs
// padrão do navegador, enumerateDevices e setSinkId.
//
// POR QUE ISTO RODA NO PAINEL LATERAL, E NÃO NO SERVICE WORKER
// Em MV3 o service worker morre depois de ~30 segundos ocioso, e áudio que
// para no meio da live é o produto quebrado. O painel lateral é uma página de
// verdade: enquanto ele está aberto, o áudio toca. É por isso que o painel é
// a casa do motor, e o service worker só coordena.

const NOMES_DE_CABO = [
  "cable",
  "vb-audio",
  "vb audio",
  "blackhole",
  "voicemeeter",
  "soundflower",
  "cabo",
];

/**
 * O navegador esconde os RÓTULOS dos dispositivos até a origem ter recebido
 * permissão de áudio uma vez. Sem rótulo não dá para reconhecer o cabo.
 *
 * O painel lateral NÃO consegue pedir essa permissão: o Chrome não mostra o
 * balão ali, e o pedido falha em silêncio. Por isso existe permissao.html —
 * uma aba normal onde o balão aparece. Nada é gravado e nada é enviado.
 *
 * Saídas de áudio. `semRotulo` é o sintoma de permissão faltando: sem ela o
 * Chrome devolve UMA saída genérica, sem nome e sem id — que é o alto-falante
 * padrão, e não o cabo.
 */
export async function listarSaidas() {
  try {
    const todos = await navigator.mediaDevices.enumerateDevices();
    return todos
      .filter((d) => d.kind === "audiooutput")
      .map((d) => ({ id: d.deviceId, rotulo: d.label, semRotulo: !d.label }));
  } catch {
    return [];
  }
}

export function pareceCabo(rotulo) {
  const r = (rotulo || "").toLowerCase();
  return NOMES_DE_CABO.some((n) => r.includes(n));
}

/** Acha o cabo virtual entre as saídas. `null` quando não há nenhum instalado. */
export async function procurarCabo() {
  const saidas = await listarSaidas();
  return saidas.find((s) => pareceCabo(s.rotulo)) ?? null;
}

function embaralhado(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Um número entre min e max — pausa de gente não tem duração fixa. */
const entre = (min, max) => min + Math.random() * (max - min);

function sortear(lista) {
  return Array.isArray(lista) && lista.length ? lista[Math.floor(Math.random() * lista.length)] : null;
}

/**
 * Leva o volume até `alvo` aos poucos. Cortar o som de uma vez era o que
 * soava como "fita pausada": a voz some e volta num clique.
 */
function desvanecer(elemento, alvo, duracaoMs) {
  return new Promise((resolve) => {
    const inicio = elemento.volume;
    const passos = Math.max(1, Math.round(duracaoMs / 30));
    let passo = 0;
    const relogio = setInterval(() => {
      passo += 1;
      elemento.volume = Math.min(1, Math.max(0, inicio + ((alvo - inicio) * passo) / passos));
      if (passo >= passos) {
        clearInterval(relogio);
        resolve();
      }
    }, 30);
  });
}

/** Quanto voltar ao retomar o roteiro: sem isso ele recomeçava no meio da palavra. */
const VOLTA_AO_RETOMAR_S = 2;
/** Chance de uma fala de interação entre uma parte do roteiro e a seguinte. */
const CHANCE_DE_INTERACAO = 0.35;

/**
 * Toca a montagem em laço.
 *
 * A montagem é uma lista de falas, e cada fala é uma lista de blocos de ~2 MB.
 * Tocar é percorrer bloco a bloco, fala a fala, e recomeçar. Nenhuma volta do
 * laço fala com o servidor de geração: repetir não custa crédito, e é isso que
 * permite vender "live de 24 horas" com custo fixo.
 */
export class Reprodutor {
  constructor({ aoMudar, aoErro, buscarBlob }) {
    this.aoMudar = aoMudar ?? (() => {});
    this.aoErro = aoErro ?? (() => {});
    this.buscarBlob = buscarBlob;

    this.montagem = null;
    this.sinkId = null;
    this.tocando = false;
    this.parando = false;
    this.falando = false;
    this.voltas = 0;
    this.falaAtual = null;

    this.elemento = null;
    this.ambiente = null;
    this.urlAtual = null;
  }

  get estado() {
    return {
      tocando: this.tocando,
      voltas: this.voltas,
      fala: this.falaAtual,
      montagem: this.montagem ? { id: this.montagem.id, nome: this.montagem.nome } : null,
    };
  }

  definirMontagem(montagem) {
    this.montagem = montagem;
  }

  definirCabo(sinkId) {
    this.sinkId = sinkId;
  }

  async #aplicarSaida(elemento) {
    if (!this.sinkId || typeof elemento.setSinkId !== "function") return;
    try {
      await elemento.setSinkId(this.sinkId);
    } catch (erro) {
      // Sem permissão de saída, o áudio iria para o alto-falante do cliente e
      // não para a live. Silenciar isso seria entregar uma live muda com cara
      // de funcionando.
      this.aoErro(
        "O Chrome recusou mandar o áudio para o cabo. " +
          "Clique em \"Liberar acesso\" no bloco do cabo e tente de novo.",
        erro,
      );
    }
  }

  async #tocarBloco(arquivoId) {
    const blob = await this.buscarBlob(arquivoId);
    const url = URL.createObjectURL(blob);

    const elemento = new Audio();
    elemento.preload = "auto";
    elemento.src = url;
    await this.#aplicarSaida(elemento);

    this.elemento = elemento;
    this.urlAtual = url;

    try {
      await elemento.play();
    } catch (erro) {
      URL.revokeObjectURL(url);
      throw erro;
    }

    await new Promise((resolve) => {
      elemento.onended = resolve;
      elemento.onerror = resolve;
    });

    // Revogar a cada bloco importa: uma live de 24 horas percorre milhares de
    // blocos, e blob não revogado é memória que só cresce até a aba morrer.
    URL.revokeObjectURL(url);
    this.urlAtual = null;
    this.elemento = null;
  }

  async #ligarAmbiente() {
    const trilha = this.montagem?.trilha;
    if (!trilha) return;

    try {
      const blob = await this.buscarBlob(trilha.arquivoId);
      const elemento = new Audio(URL.createObjectURL(blob));
      elemento.loop = true;
      elemento.volume = Math.max(0, Math.min(1, this.montagem.volumeTrilha ?? 0.15));
      await this.#aplicarSaida(elemento);
      await elemento.play();
      this.ambiente = elemento;
    } catch {
      // Trilha é enfeite: a live sem som ambiente funciona, a live sem voz não.
    }
  }

  #desligarAmbiente() {
    if (!this.ambiente) return;
    this.ambiente.pause();
    if (this.ambiente.src.startsWith("blob:")) URL.revokeObjectURL(this.ambiente.src);
    this.ambiente = null;
  }

  async iniciar() {
    if (this.tocando) return;
    if (!this.montagem?.falas?.length) throw new Error("Nenhuma montagem para tocar.");

    this.tocando = true;
    this.parando = false;
    this.voltas = 0;
    this.aoMudar(this.estado);

    await this.#ligarAmbiente();

    try {
      while (!this.parando) {
        const falas = this.montagem.embaralhar
          ? embaralhado(this.montagem.falas)
          : this.montagem.falas;

        for (const fala of falas) {
          if (this.parando) break;

          this.falaAtual = { titulo: fala.titulo, ordem: fala.ordem };
          this.aoMudar(this.estado);

          for (const bloco of fala.blocos) {
            if (this.parando) break;
            // Resposta no meio do intervalo: espera ela terminar, senão as
            // duas vozes tocavam juntas.
            await this.#esperarResposta();
            await this.#tocarBloco(bloco.arquivoId);
          }

          await this.#respiro();
          await this.#talvezInteragir();
        }

        if (this.parando) break;
        this.voltas += 1;
        this.aoMudar(this.estado);
      }
    } catch (erro) {
      this.aoErro(erro?.message || "Falha ao tocar o áudio.", erro);
    } finally {
      this.#limpar();
    }
  }

  async #esperarResposta() {
    while (this.falando && !this.parando) await dormir(150);
  }

  /** Pausa entre as partes: o intervalo da montagem, nunca igual duas vezes. */
  async #respiro() {
    if (this.parando) return;
    const base = Math.max(this.montagem.intervaloMs ?? 0, 600);
    await dormir(entre(base * 0.7, base * 1.5));
  }

  /** De vez em quando, uma fala curta para o público entre as partes. */
  async #talvezInteragir() {
    const interacao = sortear(this.montagem?.curtas?.interacoes);
    if (!interacao || this.parando || Math.random() > CHANCE_DE_INTERACAO) return;
    await this.#esperarResposta();
    await this.#tocarAvulsos(interacao.blocos);
    await dormir(entre(400, 900));
  }

  /** Toca uma lista curta de blocos fora do laço (resposta, ponte, interação). */
  async #tocarAvulsos(blocos) {
    for (const bloco of blocos) {
      if (this.parando) break;
      const blob = await this.buscarBlob(bloco.arquivoId);
      const url = URL.createObjectURL(blob);
      const voz = new Audio(url);
      await this.#aplicarSaida(voz);
      try {
        await voz.play();
        await new Promise((resolve) => {
          voz.onended = resolve;
          voz.onerror = resolve;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  /** Som ambiente mais baixo enquanto ela conversa com alguém. */
  #abafarAmbiente(abafar) {
    if (!this.ambiente) return;
    const normal = Math.max(0, Math.min(1, this.montagem?.volumeTrilha ?? 0.15));
    void desvanecer(this.ambiente, abafar ? normal * 0.4 : normal, 400);
  }

  /**
   * Fala uma resposta por cima do laço, e devolve o laço de onde parou.
   *
   * Esperar o bloco atual terminar não serve: um bloco tem vários minutos, e
   * resposta que chega depois disso já não é resposta. Então o laço PAUSA — o
   * elemento guarda o currentTime sozinho — a resposta toca num segundo
   * elemento apontando para o mesmo cabo, e o laço volta de onde estava.
   *
   * Devolve true quando a resposta saiu inteira.
   */
  async falar(blocos) {
    if (!Array.isArray(blocos) || blocos.length === 0) return false;
    if (this.falando) return false;

    this.falando = true;
    const laco = this.elemento;
    const estavaTocando = laco && !laco.paused;

    // Como gente: a voz do roteiro vai baixando, um respiro, e só então a
    // resposta — em vez de cortar no meio da palavra.
    if (estavaTocando) {
      await desvanecer(laco, 0, 450);
      laco.pause();
    }
    this.#abafarAmbiente(true);
    await dormir(entre(250, 500));

    try {
      await this.#tocarAvulsos(blocos);
      // "Então, voltando aqui…" antes de retomar, e não a fita despausando.
      const ponte = estavaTocando ? sortear(this.montagem?.curtas?.pontes) : null;
      if (ponte && !this.parando) {
        await dormir(entre(300, 600));
        await this.#tocarAvulsos(ponte.blocos);
      }
      return true;
    } catch (erro) {
      this.aoErro("Não deu para falar a resposta.", erro);
      return false;
    } finally {
      this.#abafarAmbiente(false);
      // Só retoma se o laço ainda é o mesmo elemento: se a montagem trocou ou
      // a live parou enquanto a resposta tocava, retomar ressuscitaria áudio
      // que já devia estar morto.
      if (estavaTocando && laco === this.elemento && !this.parando) {
        laco.currentTime = Math.max(0, laco.currentTime - VOLTA_AO_RETOMAR_S);
        laco.volume = 0;
        laco.play().then(() => desvanecer(laco, 1, 700)).catch(() => {});
      }
      this.falando = false;
    }
  }

  parar() {
    this.parando = true;
    if (this.elemento) {
      this.elemento.pause();
      this.elemento.onended?.();
    }
  }

  #limpar() {
    this.tocando = false;
    this.parando = false;
    this.falaAtual = null;
    this.#desligarAmbiente();
    if (this.elemento) this.elemento.pause();
    if (this.urlAtual) URL.revokeObjectURL(this.urlAtual);
    this.elemento = null;
    this.urlAtual = null;
    this.aoMudar(this.estado);
  }
}
