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
 * O navegador esconde os RÓTULOS dos dispositivos até a página ter recebido
 * permissão de áudio uma vez. Sem rótulo não dá para reconhecer o cabo —
 * então pedimos permissão de microfone, e desligamos a captura no mesmo
 * instante. Nada é gravado e nada é enviado: a permissão serve só para os
 * nomes aparecerem.
 */
export async function liberarRotulos() {
  try {
    const trilha = await navigator.mediaDevices.getUserMedia({ audio: true });
    trilha.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

export async function listarSaidas() {
  try {
    const todos = await navigator.mediaDevices.enumerateDevices();
    return todos
      .filter((d) => d.kind === "audiooutput")
      .map((d) => ({ id: d.deviceId, rotulo: d.label || "(sem nome)" }));
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
        "O navegador recusou direcionar o áudio para o cabo. " +
          "Recarregue a página do LIVE Studio e permita o uso de áudio.",
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
            await this.#tocarBloco(bloco.arquivoId);
          }

          const intervalo = this.montagem.intervaloMs ?? 0;
          if (intervalo > 0 && !this.parando) await dormir(intervalo);
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
