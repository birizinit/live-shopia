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

  // Só o LIVE Studio interessa. A extensão não tem o que fazer no feed.
  const ehEstudio = /\/(live|studio|live_studio)/i.test(location.pathname);
  if (!ehEstudio) return;

  const { Mapa } = await import(chrome.runtime.getURL("seletores.js"));

  let mapa = new Mapa({}, null);
  let observador = null;
  let ligado = false;
  const vistos = new Set();
  let pendentes = [];

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

  function processar(nos) {
    const novos = [];

    for (const no of nos) {
      const lido = lerComentario(no);
      if (!lido) continue;

      const chave = identidade(no, lido.apelido, lido.texto);
      if (vistos.has(chave)) continue;
      vistos.add(chave);

      novos.push({ tipo: "comentario", apelido: lido.apelido, texto: lido.texto });
    }

    // O conjunto de vistos cresce para sempre numa live de 24 horas. Podar
    // pelos mais antigos é o que impede a aba inchar até travar.
    if (vistos.size > 5000) {
      const sobra = [...vistos].slice(-2500);
      vistos.clear();
      for (const v of sobra) vistos.add(v);
    }

    if (novos.length) pendentes.push(...novos);
  }

  function observarChat() {
    const lista = mapa.um("chat.lista");
    if (!lista) return false;

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

  async function ligar() {
    if (ligado) return;
    if (!(await carregarMapa())) return;
    if (!observarChat()) return;
    ligado = true;
  }

  chrome.runtime.onMessage.addListener((mensagem) => {
    if (mensagem?.tipo === "mapa" && mensagem.mapa) {
      mapa = new Mapa(mensagem.mapa, mensagem.versao);
      // Mapa novo costuma chegar justamente porque o antigo quebrou: reatar o
      // observador é o que faz o conserto valer sem recarregar a página.
      ligado = observarChat();
    }
    if (mensagem?.tipo === "parar") {
      observador?.disconnect();
      observador = null;
      ligado = false;
    }
  });

  // O LIVE Studio é uma aplicação de página única: a lista do chat aparece,
  // some e volta conforme o usuário navega. Tentar de novo periodicamente é
  // mais confiável do que apostar num único momento de carga.
  setInterval(() => void ligar(), 5000);
  setInterval(() => void despejar(), 10000);

  await ligar();
})();
