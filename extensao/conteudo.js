// Content script: lê o chat do TikTok e reporta.
//
// Roda na aba do tiktok.com. NÃO toca áudio (isso é do painel lateral) e NÃO
// fala com o nosso servidor direto — passa tudo pelo service worker, que é
// quem tem o token. Content script vive numa página de terceiro; token de
// licença não entra aqui.
//
// Ele também não conhece nenhum seletor: pede o mapa ao service worker e
// resolve por nome de âncora. Quando o TikTok muda o DOM, o conserto é um
// mapa novo publicado no servidor, não uma versão nova da extensão.

(async () => {
  "use strict";

  // Só a página da live interessa. A conferência é a cada volta, e não uma vez
  // na carga: o TikTok é aplicação de página única, e quem sai do feed para a
  // própria live não recarrega a página — o script já estava aqui, dormindo.
  const ehPaginaDaLive = () => /\/(live|studio|live_studio)(\/|$)/i.test(location.pathname);

  const { Mapa } = await import(chrome.runtime.getURL("seletores.js"));

  let mapa = new Mapa({}, null);
  let observador = null;
  let listaObservada = null;
  let ligado = false;
  let suspenso = false;
  const vistos = new Set();
  let pendentes = [];

  // Estado do chat, contado ao painel: é o que responde "a extensão está
  // lendo a minha live?" sem ninguém precisar abrir o console.
  let tentativasSemChat = 0;
  let ultimoEstado = null;

  function contarEstado(estado) {
    if (estado === ultimoEstado) return;
    ultimoEstado = estado;
    void pedir({ tipo: "chat_status", estado, caminho: location.pathname.slice(0, 80) });
  }

  async function pedir(mensagem) {
    try {
      return await chrome.runtime.sendMessage(mensagem);
    } catch {
      // Service worker dormindo ou extensão recarregada. A próxima tentativa
      // acorda ele; perder uma mensagem de chat não justifica quebrar o laço.
      return null;
    }
  }

  async function carregarMapa() {
    const r = await pedir({ tipo: "mapa" });
    if (r?.mapa) mapa = new Mapa(r.mapa, r.versao);
    return Boolean(r?.mapa);
  }

  /** Chave estável do comentário, para não reportar o mesmo duas vezes. */
  function identidade(no, apelido, texto) {
    const id = no.getAttribute?.("data-id") || no.id;
    return id ? `id:${id}` : `t:${apelido}|${texto}`;
  }

  function lerComentario(no) {
    const autor = mapa.um("chat.item_autor", no);
    const corpo = mapa.um("chat.item_texto", no);

    const apelido = (autor?.textContent || "").trim().slice(0, 80);
    const texto = (corpo?.textContent || "").trim().slice(0, 500);

    if (!texto) return null;
    return { apelido: apelido || null, texto };
  }

  /**
   * Escreve no chat do LIVE Studio.
   *
   * Digitar caractere a caractere seria teatro: o TikTok lê o valor do campo,
   * não a jornada até ele. O que importa de verdade é a CADÊNCIA entre
   * respostas, e essa quem decide é o servidor.
   *
   * Dispara os eventos que um framework de UI espera — sem eles, o React do
   * LIVE Studio não vê o texto e o botão continua desabilitado.
   */
  async function escreverNoChat(texto) {
    const campo = mapa.um("chat.campo");
    if (!campo) return false;

    campo.focus();

    if (campo.isContentEditable) {
      // O campo do chat do TikTok é um editor próprio (contenteditable
      // "plaintext-only"). Trocar textContent não passa pelo estado dele, e o
      // Enter mandaria vazio; insertText entra pelo mesmo caminho da digitação.
      const selecao = window.getSelection();
      selecao?.selectAllChildren(campo);
      if (!document.execCommand("insertText", false, texto)) campo.textContent = texto;
    } else {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype === Object.getPrototypeOf(campo)
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (setter) setter.call(campo, texto);
      else campo.value = texto;
    }

    campo.dispatchEvent(new Event("input", { bubbles: true }));
    campo.dispatchEvent(new Event("change", { bubbles: true }));

    const botao = mapa.um("chat.enviar");
    if (botao && !botao.disabled) {
      botao.click();
      return true;
    }

    // Sem botão utilizável, Enter é o caminho que o próprio usuário usaria.
    campo.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }),
    );
    return true;
  }

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Pergunta ao servidor e cumpre o que ele mandar. */
  async function consultarEResponder(evento) {
    const r = await pedir({ tipo: "decidir", evento });
    if (!r?.ok || r.acao === "ignorar" || r.acao === "falando") return;

    if (r.acao === "escrever" && r.texto) {
      // A espera vem do servidor, sorteada dentro da janela do cliente. É ela
      // que separa "responde como gente" de "responde como robô".
      await dormir(Math.min(Math.max(r.esperarMs ?? 0, 0), 120000));
      const enviou = await escreverNoChat(r.texto);
      if (enviou) {
        void pedir({ tipo: "respondeu", texto: r.texto, tema: r.tema ?? null });
      }
    }
  }

  function processar(nos) {
    const novos = [];

    for (const no of nos) {
      // Entrada de espectador vem antes: o mesmo nó também casaria com o
      // leitor de comentário e viraria um comentário vazio.
      const entrada = mapa.um("chat.entrada", no) ?? (no.matches?.("[data-e2e='chat-member-enter']") ? no : null);
      if (entrada) {
        const autor = mapa.um("chat.entrada_autor", no);
        const apelido = (autor?.textContent || "").trim().slice(0, 80);
        const chave = `e:${apelido}`;
        if (apelido && !vistos.has(chave)) {
          vistos.add(chave);
          novos.push({ tipo: "entrada", apelido, texto: null });
          void consultarEResponder({ tipo: "entrada", apelido, texto: null });
        }
        continue;
      }

      const lido = lerComentario(no);
      if (!lido) continue;

      const chave = identidade(no, lido.apelido, lido.texto);
      if (vistos.has(chave)) continue;
      vistos.add(chave);

      novos.push({ tipo: "comentario", apelido: lido.apelido, texto: lido.texto });
      void consultarEResponder({
        tipo: "comentario",
        apelido: lido.apelido,
        texto: lido.texto,
      });
    }

    // O conjunto de vistos cresce para sempre numa live de 24 horas. Podar
    // pelos mais antigos é o que impede a aba inchar até travar.
    if (vistos.size > 5000) {
      const sobra = [...vistos].slice(-2500);
      vistos.clear();
      for (const v of sobra) vistos.add(v);
    }

    if (novos.length) {
      pendentes.push(...novos);
      // Só a contagem vai ao painel — o texto dos comentários segue pelo
      // caminho de sempre, em lote, para o servidor.
      void pedir({ tipo: "chat", quantidade: novos.length });
    }
  }

  function observarChat() {
    const lista = mapa.um("chat.lista");
    if (!lista) return false;

    listaObservada = lista;
    observador?.disconnect();
    observador = new MutationObserver((mutacoes) => {
      const candidatos = [];
      for (const m of mutacoes) {
        for (const no of m.addedNodes) {
          if (no.nodeType !== Node.ELEMENT_NODE) continue;
          candidatos.push(no);
        }
      }
      if (candidatos.length) processar(candidatos);
    });

    observador.observe(lista, { childList: true, subtree: true });

    // Os comentários que já estavam na tela quando a extensão subiu.
    processar(mapa.todos("chat.item"));
    return true;
  }

  async function despejar() {
    const falhas = mapa.drenarFalhas();
    if (falhas.length) void pedir({ tipo: "quebras", falhas });

    if (!pendentes.length) return;
    const lote = pendentes.splice(0, 200);
    await pedir({ tipo: "eventos", eventos: lote });
  }

  /** Três voltas de 5s sem achar o chat numa página de live é sinal real. */
  const VOLTAS_ATE_AVISAR = 3;

  async function ligar() {
    // Freio do servidor (kill switch) vale até ele mesmo soltar: sem isto, a
    // volta de 5s religava a leitura segundos depois de mandarem parar.
    if (suspenso) return;

    if (!ehPaginaDaLive()) {
      // Saiu da live dentro da mesma aba: para de ler o que não é chat.
      if (ligado) {
        observador?.disconnect();
        observador = null;
        ligado = false;
      }
      tentativasSemChat = 0;
      contarEstado("fora_da_live");
      return;
    }

    // A lista do chat é trocada quando a live recarrega o player: observador
    // preso num nó que saiu do DOM não recebe mais nada.
    if (ligado && !listaObservada?.isConnected) ligado = false;
    if (ligado) return;

    if (!(await carregarMapa())) return;
    if (!observarChat()) {
      tentativasSemChat += 1;
      if (tentativasSemChat >= VOLTAS_ATE_AVISAR) contarEstado("sem_chat");
      return;
    }
    tentativasSemChat = 0;
    ligado = true;
    contarEstado("lendo");
  }

  chrome.runtime.onMessage.addListener((mensagem) => {
    if (mensagem?.tipo === "mapa" && mensagem.mapa) {
      mapa = new Mapa(mensagem.mapa, mensagem.versao);
      // Mapa novo costuma chegar justamente porque o antigo quebrou: reatar o
      // observador é o que faz o conserto valer sem recarregar a página.
      ligado = ehPaginaDaLive() && observarChat();
      if (ligado) contarEstado("lendo");
    }
    if (mensagem?.tipo === "status_chat?") {
      // O painel acabou de abrir e quer saber: responde sem esperar a volta.
      ultimoEstado = null;
      contarEstado(ehPaginaDaLive() ? (ligado ? "lendo" : "procurando") : "fora_da_live");
    }
    if (mensagem?.tipo === "parar") {
      suspenso = true;
      observador?.disconnect();
      observador = null;
      ligado = false;
      contarEstado("suspenso");
    }
    if (mensagem?.tipo === "estado" && mensagem.estado && !mensagem.estado.pararAgora) {
      suspenso = false;
    }
  });

  // O LIVE Studio é uma aplicação de página única: a lista do chat aparece,
  // some e volta conforme o usuário navega. Tentar de novo periodicamente é
  // mais confiável do que apostar num único momento de carga.
  setInterval(() => void ligar(), 5000);
  setInterval(() => void despejar(), 10000);

  await ligar();
})();
