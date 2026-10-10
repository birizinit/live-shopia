// Content script: a mão da Shopia dentro da aba do TikTok.
//
// Roda em toda página do tiktok.com, mas só AGE na aba escolhida pelo service
// worker (`shopia_aba_alvo`): comentário automático e bloqueio em duas abas
// sairiam em dobro.
//
// Não tem token e não fala com o nosso servidor: tudo que precisa de
// credencial passa pelo service worker. Os interruptores (fixar, cupom, som,
// comentários, bloqueio, ler a tela) moram no chrome.storage e chegam aqui por
// `storage.onChanged` — recarregar a aba não desliga nada.

(async () => {
  "use strict";

  const ehPaginaDaLive = () => /\/(live|studio|live_studio|streamer)(\/|$)|console/i.test(location.pathname + location.search);

  const { Mapa, descrever, alvoClicavel } = await import(chrome.runtime.getURL("seletores.js"));
  const produtos = await import(chrome.runtime.getURL("produtos.js"));

  const CH = {
    auto: "shopia_auto",
    ciclo: "shopia_ciclo",
    abaAlvo: "shopia_aba_alvo",
  };

  let mapa = new Mapa({}, null);
  let ancorasLocais = {};
  let minhaAba = null;
  let alvo = null;
  let auto = {};
  let ciclo = {};

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const acaso = (min, max) => min + Math.random() * (max - min);
  const souAlvo = () => minhaAba !== null && minhaAba === alvo;

  async function pedir(mensagem) {
    try {
      return await chrome.runtime.sendMessage(mensagem);
    } catch {
      return null;
    }
  }

  const registrar = (texto, nivel = "") => void pedir({ tipo: "log_aba", texto, nivel });

  function visivel(el) {
    if (!el) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
    return el.getClientRects().length > 0;
  }

  const textoDe = (el) =>
    (el?.textContent || el?.innerText || el?.getAttribute?.("aria-label") || "").replace(/\s+/g, " ").trim();

  async function carregarMapa() {
    const r = await pedir({ tipo: "mapa" });
    if (r?.locais) ancorasLocais = r.locais;
    if (r?.mapa) mapa = new Mapa(r.mapa, r.versao, ancorasLocais);
    return Boolean(r?.mapa);
  }

  // =========================================================================
  // INTERFACE NA PÁGINA: barra de status, avisos e a pílula da violação
  // =========================================================================

  const COR = { ok: "#32D583", warn: "#FDB022", err: "#F04438", info: "#84CAFF" };
  const FONTE = "600 12px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif";

  let hud = null;
  function caixaDeAvisos() {
    if (hud?.isConnected) return hud;
    hud = document.createElement("div");
    hud.id = "shopia-hud";
    hud.style.cssText =
      "position:fixed;bottom:16px;right:16px;z-index:2147483647;display:flex;flex-direction:column;gap:6px;pointer-events:none;";
    document.documentElement.appendChild(hud);
    return hud;
  }

  function avisoNaTela(texto, tom = "ok", ms = 4000) {
    const caixa = caixaDeAvisos();
    const el = document.createElement("div");
    el.textContent = texto;
    el.style.cssText = `background:#0A100D;color:#F6FAF7;border-radius:8px;padding:8px 12px;font:${FONTE};font-size:11px;box-shadow:0 4px 20px rgba(0,0,0,.5);border-left:3px solid ${COR[tom] ?? COR.ok};min-width:160px;max-width:300px;`;
    caixa.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  let barra = null;
  function pintarBarra() {
    const ligado = ciclo?.ativo && souAlvo();
    if (!ligado) {
      barra?.remove();
      barra = null;
      return;
    }
    if (!barra?.isConnected) {
      barra = document.createElement("div");
      barra.id = "shopia-barra";
      barra.style.cssText = `position:fixed;top:0;left:50%;transform:translateX(-50%);height:24px;padding:0 12px;border-radius:0 0 10px 10px;background:#0A100D;border:1px solid rgba(50,213,131,.35);border-top:none;z-index:2147483646;display:flex;align-items:center;gap:12px;font:${FONTE};font-size:10px;color:#90A699;pointer-events:none;`;
      document.documentElement.appendChild(barra);
    }
    const resta = ciclo.pausadoRestanteMs ?? (ciclo.fimEm ? Math.max(0, ciclo.fimEm - Date.now()) : null);
    const s = resta === null ? null : Math.round(resta / 1000);
    const hms = s === null ? "--:--:--" : [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
    barra.innerHTML = "";
    const item = (txt, cor) => {
      const sp = document.createElement("span");
      sp.textContent = txt;
      if (cor) sp.style.color = cor;
      barra.appendChild(sp);
    };
    item("● SHOPIA", COR.ok);
    item(ciclo.liveAtiva ? "LIVE detectada" : "procurando live", ciclo.liveAtiva ? COR.ok : undefined);
    item(`⏱ ${hms}`, "#F6FAF7");
    item(`Scan ${ciclo.scanN ?? 0}`);
    item(ciclo.violacao?.ativa ? "🛡 ALERTA" : "🛡 ok", ciclo.violacao?.ativa ? COR.err : COR.ok);
  }
  setInterval(pintarBarra, 1000);

  let pilula = null;
  let pilulaTimer = null;
  function mostrarPilulaViolacao(fimEm, encerrando) {
    pilula?.remove();
    clearInterval(pilulaTimer);
    pilula = document.createElement("div");
    pilula.style.cssText = `position:fixed;left:16px;bottom:155px;z-index:2147483647;background:#1a0a0d;border:1px solid #F04438;color:#FDA29B;border-radius:999px;padding:8px 14px;font:${FONTE};display:flex;gap:10px;align-items:center;box-shadow:0 6px 24px rgba(0,0,0,.5);`;
    const txt = document.createElement("span");
    const x = document.createElement("button");
    x.textContent = "✕";
    x.title = "Encerrar a live agora";
    x.style.cssText = "background:#F04438;color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;";
    x.onclick = () => {
      void pedir({ tipo: "encerrar_live", motivo: "encerrada pela pílula de violação" });
      pilula?.remove();
    };
    pilula.append(txt, x);
    document.documentElement.appendChild(pilula);
    const pintar = () => {
      if (encerrando || !fimEm) {
        txt.textContent = "🔴 Violação · encerrando a live";
        return;
      }
      const s = Math.max(0, Math.round((fimEm - Date.now()) / 1000));
      txt.textContent = `🔴 Violação · encerra em ${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      if (s <= 0) clearInterval(pilulaTimer);
    };
    pintar();
    pilulaTimer = setInterval(pintar, 1000);
  }

  // =========================================================================
  // SOM DE VENDA (sintetizado: nenhum arquivo de áudio de terceiro)
  // =========================================================================

  let audioCtx = null;
  document.addEventListener("click", () => {
    try {
      audioCtx ??= new AudioContext();
      void audioCtx.resume();
    } catch { /* sem áudio */ }
  }, { capture: true, passive: true });

  function caixaRegistradora() {
    if (!auto.som) return;
    try {
      audioCtx ??= new AudioContext();
      const t = audioCtx.currentTime;
      [[1318, 0], [1568, 0.12], [2093, 0.24]].forEach(([f, d]) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "triangle";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.35, t + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.35);
        o.connect(g).connect(audioCtx.destination);
        o.start(t + d);
        o.stop(t + d + 0.4);
      });
    } catch { /* navegador sem áudio liberado */ }
  }

  // =========================================================================
  // LIVE ATIVA? e VIOLAÇÃO
  // =========================================================================

  function verificarLiveAtiva() {
    const botoes = [...document.querySelectorAll("button")];
    const temEncerrar = botoes.some((b) => /encerrar|end live|parar live/i.test(textoDe(b)));
    const temEspectadores = Boolean(
      document.querySelector('[data-e2e="person-count"],[class*="viewer" i],[class*="spectator" i],[class*="audience" i]'),
    );
    let temAoVivo = false;
    if (!temEncerrar) {
      const corpo = (document.body?.innerText || "").toLowerCase();
      temAoVivo = /ao vivo|live agora|transmitindo/.test(corpo);
    }
    return { liveAtiva: temEncerrar || (temAoVivo && temEspectadores), abaConectada: true };
  }

  /**
   * O aviso de violação do TikTok no LIVE Studio web: o ícone de erro da
   * biblioteca de UI deles (arco) visível, ou uma faixa curta de aviso com
   * "violação" no texto.
   */
  function verificarViolacao() {
    const icone = document.querySelector(".arco-icon-info_error");
    if (icone && icone.getClientRects().length > 0) return { detectado: true, motivo: "ícone de erro visível" };

    for (const el of document.querySelectorAll('div[class*="violat" i],div[class*="viola" i],div[class*="warning" i]')) {
      const t = (el.textContent || "").toLowerCase();
      if (t.length > 200) continue;
      if (!t.includes("violação") && !t.includes("violation")) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top >= 0 && r.top <= innerHeight) {
        return { detectado: true, motivo: "aviso de violação na tela" };
      }
    }
    return { detectado: false };
  }

  // =========================================================================
  // ENCERRAR A LIVE
  // =========================================================================

  function clicarConfirmacao(padrao) {
    const botao = [...document.querySelectorAll("button")].find((b) => visivel(b) && padrao.test(textoDe(b)));
    if (botao) botao.click();
    return Boolean(botao);
  }

  function ancestralClicavel(el, niveis = 5) {
    let atual = el;
    for (let i = 0; i < niveis && atual; i++) {
      atual = atual.parentElement;
      if (!atual) break;
      const cls = String(atual.className?.baseVal ?? atual.className ?? "");
      if (atual.tagName === "BUTTON" || atual.getAttribute("role") === "button" || /btn|button|icon-btn/i.test(cls)) {
        return atual;
      }
    }
    return null;
  }

  async function encerrarLive() {
    // 1. O ícone de "desligar" do LIVE Studio web.
    const icone = document.querySelector(".arco-icon-im_close_chat");
    if (icone) {
      const alvoClique = ancestralClicavel(icone) ?? icone.parentElement;
      alvoClique?.click();
      await dormir(1500);
      clicarConfirmacao(/encerrar agora|confirmar|end now|sim/i);
      return { ok: true, por: "icone" };
    }
    // 2. Qualquer variação do mesmo ícone.
    const variacao = document.querySelector('[class*="close_chat"],[class*="im_close"]');
    if (variacao) {
      (variacao.closest("button") ?? variacao.parentElement)?.click();
      await dormir(1500);
      clicarConfirmacao(/encerrar agora|confirmar/i);
      return { ok: true, por: "variacao" };
    }
    // 3. Botão com o texto.
    const botao = [...document.querySelectorAll("button")].find((b) => visivel(b) && /encerrar|end live/i.test(textoDe(b)));
    if (botao) {
      botao.click();
      await dormir(1500);
      clicarConfirmacao(/confirmar|sim|encerrar agora/i);
      return { ok: true, por: "texto" };
    }
    avisoNaTela("⚠️ Botão encerrar não encontrado", "warn");
    return { ok: false };
  }

  // =========================================================================
  // FIXAR PRODUTO (com modo cupom)
  // =========================================================================

  const ehDesafixar = (t) => /^(desafixar|unpin|desfixar)$/.test(t) || t.includes("desafix") || t.includes("unpin") || t.includes("desfixar");
  const ehFixar = (t) => !ehDesafixar(t) && (/^(fixar|pin|fix)$/.test(t) || t.includes("fixar"));

  function botoesVisiveis() {
    return [...document.querySelectorAll('button,[role="button"],[class*="btn"],[class*="Btn"]')].filter(visivel);
  }

  /**
   * Fixa o produto. Se a pessoa ensinou o botão (Central → Configurações), a
   * âncora aprendida vence: é observação da tela dela. Senão, procura pelo
   * texto dos botões, como o LIVE Studio escreve ("Fixar"/"Desafixar").
   *
   * Modo cupom: o 1º item da lista é o card do cupom, então fixa o 2º.
   */
  async function fixarProduto() {
    if (mapa.ancoras.includes(produtos.ANCORAS.fixar)) {
      const r = produtos.fixarProduto(mapa, auto.cupom ? 2 : 1);
      return r.ok ? { ok: true, por: "ancora" } : { ok: false, motivo: r.motivo };
    }

    const desafixar = botoesVisiveis().find((b) => ehDesafixar(textoDe(b).toLowerCase()));
    if (desafixar) {
      desafixar.click();
      await dormir(acaso(1500, auto.cupom ? 3000 : 4000));
    }

    const fixar = [...document.querySelectorAll("button")]
      .filter((b) => visivel(b) && ehFixar(textoDe(b).toLowerCase()))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

    if (fixar.length === 0) {
      // O botão pode ser um div com classe de botão.
      const outro = botoesVisiveis().find((b) => ehFixar(textoDe(b).toLowerCase()));
      if (!outro) return { ok: false, motivo: "sem_botao" };
      outro.click();
      return { ok: true, por: "texto" };
    }

    const escolhido = auto.cupom && fixar.length >= 2 ? fixar[1] : fixar[0];
    escolhido.click();
    return { ok: true, por: auto.cupom && fixar.length >= 2 ? "cupom" : "texto" };
  }

  const MOTIVO_FIXAR = {
    sem_botao: "botão de fixar não encontrado — abra a lista de produtos da live",
    sem_ancora: "ensine o botão de fixar na aba Central",
    lista_fechada: "a lista de produtos está fechada",
    lista_vazia: "a lista de produtos está vazia",
    posicao_inexistente: "não há produto nessa posição",
  };

  async function fixarEContar(origem) {
    const r = await fixarProduto();
    if (r.ok) {
      avisoNaTela("📌 Produto fixado!", "ok");
      registrar(`📌 Produto fixado (${origem})`, "ok");
    } else {
      avisoNaTela("⚠️ Não consegui fixar", "warn");
      registrar(`Fixar falhou: ${MOTIVO_FIXAR[r.motivo] ?? r.motivo}`, "warn");
    }
    return r;
  }

  let lacoFixar = null;
  function agendarFixar(primeira = false) {
    clearTimeout(lacoFixar);
    lacoFixar = null;
    if (!auto.fixar || !souAlvo()) return;
    const espera = primeira ? acaso(5000, 8000) : acaso(18000, 30000);
    lacoFixar = setTimeout(async () => {
      if (auto.fixar && souAlvo()) await fixarEContar("automático");
      agendarFixar();
    }, espera);
  }

  // =========================================================================
  // ESCREVER NO CHAT (validado contra a página salva de uma live real)
  // =========================================================================

  /** Quanto esperar o editor reagir antes de dizer que não enviou. */
  const ESPERA_ENVIO_MS = 1200;

  /** O campo do chat: mapa publicado primeiro, depois os campos clássicos. */
  function campoDoChat() {
    return (
      (mapa.ancoras.includes("chat.campo") ? mapa.um("chat.campo") : null) ??
      document.querySelector('[data-e2e="room-chat-input-field"]') ??
      document.querySelector(
        'textarea[placeholder*="algo"],textarea[placeholder*="omment"],textarea[placeholder*="Digite"],.chat-input textarea,[class*="chat"] textarea,textarea.arco-textarea',
      )
    );
  }

  function textoDoCampo(campo) {
    return (campo.isContentEditable ? campo.textContent : campo.value) ?? "";
  }

  /**
   * Põe o cursor DENTRO do campo.
   *
   * `selectAllChildren` num campo vazio não cria seleção editável válida, e aí
   * `execCommand("insertText")` devolve false e cai no fallback que escreve no
   * DOM sem avisar o editor. Um Range sobre o próprio nó funciona nos dois
   * casos, vazio ou com texto.
   */
  function porCursorNoCampo(campo) {
    campo.focus();
    try {
      const faixa = document.createRange();
      faixa.selectNodeContents(campo);
      const selecao = window.getSelection();
      selecao?.removeAllRanges();
      selecao?.addRange(faixa);
      return true;
    } catch {
      return false;
    }
  }

  /** O limite que a própria página declara, quando declara. */
  function tetoDoCampo(campo) {
    const bruto = Number(campo.getAttribute("maxlength"));
    return Number.isFinite(bruto) && bruto > 0 ? bruto : null;
  }

  function limparCampo(campo) {
    if (porCursorNoCampo(campo) && document.execCommand("insertText", false, "")) {
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (campo.isContentEditable) campo.textContent = "";
    else campo.value = "";
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // --- as técnicas de digitação, da mais fiel à menos ---------------------

  function porExecCommand(campo, texto) {
    if (!porCursorNoCampo(campo)) return false;
    return document.execCommand("insertText", false, texto);
  }

  /**
   * `beforeinput` + `input` como InputEvent de verdade.
   *
   * Editor moderno (Lexical, Draft, ProseMirror) escuta `beforeinput` e usa
   * `inputType`/`data` para montar o estado dele. É o caminho que mais se
   * parece com digitar sem ser digitar.
   */
  function porInputEvent(campo, texto) {
    if (!porCursorNoCampo(campo)) return false;
    const antes = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: texto,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    const seguiu = campo.dispatchEvent(antes);
    if (!seguiu) return true; // o editor preveniu o padrão: ele assumiu.

    if (campo.isContentEditable) campo.textContent = texto;
    else campo.value = texto;

    campo.dispatchEvent(
      new InputEvent("input", {
        inputType: "insertText",
        data: texto,
        bubbles: true,
        composed: true,
      }),
    );
    return true;
  }

  /**
   * Colar.
   *
   * Editor que ignora input sintético costuma tratar `paste`, porque colar é
   * caminho de usuário legítimo que ele é obrigado a suportar.
   */
  function porColagem(campo, texto) {
    if (!porCursorNoCampo(campo)) return false;
    try {
      const dados = new DataTransfer();
      dados.setData("text/plain", texto);
      return campo.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dados, bubbles: true, cancelable: true }),
      );
    } catch {
      return false;
    }
  }

  function porAtribuicaoDireta(campo, texto) {
    if (campo.isContentEditable) {
      campo.textContent = texto;
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
    return true;
  }

  const TECNICAS = [
    { nome: "digitacao", aplicar: porExecCommand },
    { nome: "input", aplicar: porInputEvent },
    { nome: "colagem", aplicar: porColagem },
    { nome: "atribuicao", aplicar: porAtribuicaoDireta },
  ];

  /**
   * O botão de enviar está usável?
   *
   * Para o div do TikTok, `.disabled` não existe e `invisible` é uma classe do
   * Tailwind deles. Então a pergunta é respondida pelo estilo COMPUTADO, que
   * cobre `visibility`, `display`, `opacity` e qualquer outro jeito de
   * esconder que eles inventem depois.
   */
  function botaoDeEnviar() {
    const botao = (mapa.ancoras.includes("chat.enviar") ? mapa.um("chat.enviar") : null) ?? document.querySelector('[data-e2e="room-chat-send-btn"]');
    if (!botao) return { botao: null, estado: "nao_achado" };

    if (botao.disabled === true || botao.getAttribute("aria-disabled") === "true") {
      return { botao, estado: "desabilitado" };
    }

    const estilo = window.getComputedStyle(botao);
    const escondido =
      estilo.visibility === "hidden" ||
      estilo.display === "none" ||
      Number(estilo.opacity) === 0 ||
      botao.getClientRects().length === 0;

    return { botao, estado: escondido ? "escondido" : "pronto" };
  }

  /**
   * Digita e devolve QUAL técnica o editor aceitou.
   *
   * Aceitar é o botão de enviar acender — não o texto estar na árvore. Era
   * essa a diferença que faltava: a primeira live teve texto na árvore e nada
   * enviado, e o código chamou isso de sucesso.
   *
   * Se nenhuma técnica acender o botão, vale a que ao menos deixou o texto
   * visível: pode ser que a página não tenha botão para acender, e aí o Enter
   * ainda tem chance.
   */
  async function digitarNoCampo(campo, texto) {
    const teto = tetoDoCampo(campo);
    const cortado = teto ? texto.slice(0, teto) : texto;
    let comTexto = null;

    for (const tecnica of TECNICAS) {
      limparCampo(campo);
      if (!tecnica.aplicar(campo, cortado)) continue;
      await dormir(60);

      if (textoDoCampo(campo).trim().length === 0) continue;
      if (!comTexto) comTexto = tecnica.nome;

      if (botaoDeEnviar().estado === "pronto") {
        return { tecnica: tecnica.nome, aceito: true, cortado: cortado !== texto };
      }
    }

    return comTexto
      ? { tecnica: comTexto, aceito: false, cortado: cortado !== texto }
      : { tecnica: null, aceito: false, cortado: false };
  }

  /** O campo esvaziou? É a prova de que a mensagem saiu. */
  async function esvaziou(campo) {
    const limite = Date.now() + ESPERA_ENVIO_MS;
    while (Date.now() < limite) {
      await dormir(100);
      if (!campo.isConnected) return true; // o editor foi recriado: enviou.
      if (textoDoCampo(campo).trim().length === 0) return true;
    }
    return false;
  }

  /**
   * Enter como o navegador de verdade entrega.
   *
   * O `keydown` solto que havia antes é ignorado por editor que escuta
   * `keypress` ou que confere `which`/`charCode`. Mandar a sequência inteira
   * se aproxima de uma tecla real — e mesmo assim pode não bastar, porque
   * `isTrusted` continua falso e nada feito por script muda isso. É por isso
   * que o resultado é VERIFICADO em vez de presumido.
   */
  function teclarEnter(campo) {
    const comum = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      charCode: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    campo.dispatchEvent(new KeyboardEvent("keydown", comum));
    campo.dispatchEvent(new KeyboardEvent("keypress", comum));
    campo.dispatchEvent(new KeyboardEvent("keyup", comum));
    return true;
  }

  function enviarPeloFormulario(campo) {
    const form = campo.closest("form");
    if (!form) return false;
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
    return true;
  }

  /**
   * Escreve e envia. Devolve o que ACONTECEU, não "deu certo".
   *
   * `{ ok: true, por }` — saiu, e por qual caminho.
   * `{ ok: false, motivo }` — não saiu, e o motivo serve para a tela explicar.
   */
  async function escreverNoChat(texto) {
    const campo = campoDoChat();
    if (!campo) return { ok: false, motivo: "sem_campo" };

    const digitou = await digitarNoCampo(campo, texto);
    if (!digitou.tecnica) {
      limparCampo(campo);
      return { ok: false, motivo: "nao_digitou" };
    }

    const { botao, estado } = botaoDeEnviar();

    // O clique só entra na fila quando o botão está REALMENTE usável. Clicar
    // num div invisível é o que a versão anterior fazia, achando que tinha
    // enviado.
    const caminhos = [
      estado === "pronto" ? { nome: "botao", agir: () => (botao.click(), true) } : null,
      { nome: "enter", agir: () => teclarEnter(campo) },
      { nome: "formulario", agir: () => enviarPeloFormulario(campo) },
    ].filter(Boolean);

    for (const caminho of caminhos) {
      if (!caminho.agir()) continue;
      if (await esvaziou(campo)) {
        return { ok: true, por: caminho.nome, tecnica: digitou.tecnica, cortado: digitou.cortado };
      }
    }

    // Deixar o nosso texto parado no campo da pessoa é pior que não escrever:
    // ela digita em cima, manda sem ver, ou acha que a extensão travou a caixa.
    limparCampo(campo);
    return {
      ok: false,
      motivo: digitou.aceito ? "nao_enviou" : "editor_nao_registrou",
      botao: estado,
      tecnica: digitou.tecnica,
    };
  }

  /**
   * Diagnóstico do envio, sem publicar nada na live.
   *
   * Digita, confere o que achou, e APAGA sem enviar. Dá 90% da resposta com
   * zero exposição — porque a alternativa, mandar mensagem de teste numa live
   * de verdade, a audiência lê.
   */
  async function ensaiarEnvio() {
    const campo = campoDoChat();
    if (!campo) return { campo: false };

    const digitou = await digitarNoCampo(campo, "teste");
    const { estado } = botaoDeEnviar();
    limparCampo(campo);

    return {
      campo: true,
      editavel: campo.isContentEditable ? "contenteditable" : campo.tagName.toLowerCase(),
      teto: tetoDoCampo(campo),
      tecnica: digitou.tecnica,
      aceito: digitou.aceito,
      botao: estado,
      dentroDeFormulario: Boolean(campo.closest("form")),
    };
  }


  // =========================================================================
  // COMENTÁRIOS AUTOMÁTICOS
  // =========================================================================

  let lacoComentar = null;
  let indiceComentario = 0;
  let chaveComentarios = "";

  function pararComentarios() {
    clearTimeout(lacoComentar);
    lacoComentar = null;
  }

  async function comentarAgora() {
    const lista = (auto.comentarios?.mensagens ?? []).filter(Boolean);
    if (!lista.length) return;
    const texto = lista[indiceComentario % lista.length];
    indiceComentario++;
    const r = await escreverNoChat(String(texto).slice(0, 150));
    void pedir({ tipo: "comentario_feito", ok: r.ok, motivo: r.motivo ?? null, texto });
  }

  function agendarComentario(imediato = false) {
    pararComentarios();
    const c = auto.comentarios ?? {};
    if (!c.ativo || !souAlvo() || !(c.mensagens ?? []).length) return;
    const min = Math.max(10, Number(c.min) || 30);
    const max = Math.max(min, Number(c.max) || 90);
    const espera = imediato ? 500 : Math.floor(Math.random() * (max - min + 1) + min) * 1000;
    void pedir({ tipo: "comentario_feito", agendado: true, emMs: espera, ok: true });
    lacoComentar = setTimeout(async () => {
      if (!auto.comentarios?.ativo || !souAlvo()) return;
      await comentarAgora();
      agendarComentario();
    }, espera);
  }

  function sincronizarComentarios() {
    const c = auto.comentarios ?? {};
    const chave = JSON.stringify([c.ativo, c.mensagens, c.min, c.max, souAlvo()]);
    if (chave === chaveComentarios) return;
    const ligou = c.ativo && !JSON.parse(chaveComentarios || "[false]")[0];
    chaveComentarios = chave;
    if (ligou) indiceComentario = 0;
    agendarComentario(ligou);
  }

  // =========================================================================
  // BLOQUEIO POR NOME
  // =========================================================================

  const ENTROU = /acabou de entrar|just joined|entrou na live|entrou|joined/i;
  const bloqueadosAqui = [];
  let lacoBloqueio = null;
  let bloqueando = false;

  function palavraQueCasa(nome, palavras) {
    const partes = nome.toLowerCase().split(/[\s_.\-@0-9]+/).filter(Boolean);
    return palavras.find((p) => partes.includes(p.toLowerCase().trim())) ?? null;
  }

  function entradasNaTela() {
    const porMapa = mapa.ancoras.includes("chat.entrada") ? mapa.todos("chat.entrada") : [];
    const porTexto = [...document.querySelectorAll("div,li")].filter((el) => {
      if (!el.children.length) return false;
      const t = el.textContent || "";
      return t.length < 150 && ENTROU.test(t);
    });
    // Só o item MAIS INTERNO: o contêiner do chat também "contém" o texto da
    // entrada, e clicar no último botão dele seria clicar em qualquer coisa
    // da página — inclusive em encerrar a live.
    const candidatos = [...new Set([...porMapa.map((e) => e.parentElement ?? e), ...porTexto])];
    return candidatos.filter((el) => !candidatos.some((outro) => outro !== el && el.contains(outro)));
  }

  function nomeDaEntrada(el) {
    const autor = el.querySelector?.('[data-e2e="message-owner-name"]');
    if (autor) return textoDe(autor);
    const m = (el.textContent || "").replace(/\s+/g, " ").trim().match(/^(.+?)\s*(acabou de entrar|just joined|entrou na live|entrou|joined)/i);
    return m ? m[1].trim() : "";
  }

  async function bloquear(item, usuario, palavra) {
    item.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    item.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await dormir(400);
    const botoes = item.querySelectorAll("button");
    const menu = botoes[botoes.length - 1];
    if (!menu) return false;
    menu.click();
    await dormir(700);
    const opcao = [...document.querySelectorAll('span.ml-4,span[class*="truncate"],li span,[role="menuitem"]')].find((el) => {
      const t = textoDe(el).toLowerCase();
      return t.length < 80 && (t.startsWith("bloquear") || t.startsWith("block"));
    });
    if (!opcao) {
      document.body.click();
      return false;
    }
    opcao.click();
    await dormir(600);
    const confirmar = [...document.querySelectorAll("button")].find((b) => /^(confirmar|confirm|ok|bloquear|block)$/i.test(textoDe(b)));
    confirmar?.click();
    bloqueadosAqui.push(usuario.toLowerCase());
    if (bloqueadosAqui.length > 100) bloqueadosAqui.shift();
    void pedir({ tipo: "bloqueou", dados: { usuario, palavra, hora: new Date().toLocaleTimeString("pt-BR") } });
    avisoNaTela(`🚫 Bloqueado: ${usuario}`, "warn");
    return true;
  }

  async function voltaDoBloqueio() {
    if (bloqueando || !auto.bloqueio?.ativo || !souAlvo()) return;
    const palavras = (auto.bloqueio.palavras ?? []).map((p) => p.trim()).filter(Boolean);
    if (!palavras.length) return;
    bloqueando = true;
    try {
      for (const item of entradasNaTela()) {
        const usuario = nomeDaEntrada(item);
        if (!usuario || usuario.length > 40 || bloqueadosAqui.includes(usuario.toLowerCase())) continue;
        const palavra = palavraQueCasa(usuario, palavras);
        if (!palavra) continue;
        await bloquear(item, usuario, palavra);
        break; // um por volta, como uma pessoa faria
      }
    } finally {
      bloqueando = false;
    }
  }

  function sincronizarBloqueio() {
    const ligado = auto.bloqueio?.ativo && souAlvo();
    if (ligado && !lacoBloqueio) lacoBloqueio = setInterval(() => void voltaDoBloqueio(), 3500);
    if (!ligado && lacoBloqueio) {
      clearInterval(lacoBloqueio);
      lacoBloqueio = null;
    }
  }

  // =========================================================================
  // VENDAS E MÉTRICAS DA TELA
  // =========================================================================

  const vendasVistas = new Set();
  let ultimasVendas = null;
  let lacoMetricas = null;

  function folhas() {
    return [...document.querySelectorAll("body *")].filter((el) => el.children.length === 0);
  }

  function valorPerto(rotulo, padrao, todas) {
    const label = todas.find((el) => rotulo.test(el.textContent || "") && (el.textContent || "").length < 30);
    if (!label) return null;
    for (const raiz of [label.closest("div,td,li"), label.closest("div,td,li")?.parentElement]) {
      if (!raiz) continue;
      const achado = [...raiz.querySelectorAll("*")].find(
        (el) => el !== label && el.children.length === 0 && padrao.test((el.textContent || "").trim()),
      );
      if (achado) return (achado.textContent || "").trim();
    }
    return null;
  }

  function lerMetricas() {
    const todas = folhas();
    const viewers =
      textoDe(document.querySelector('[data-e2e="person-count"]')) || valorPerto(/espectadores|viewers/i, /^\d[\d.,]*[kKmM]?$/, todas);
    const vendasEl = [...document.querySelectorAll('div[style*="line-clamp"]')].find(
      (el) => el.children.length === 0 && /^\d+$/.test((el.textContent || "").trim()),
    );
    const vendas = vendasEl ? vendasEl.textContent.trim() : null;
    const gmv = valorPerto(/gmv/i, /R\$[\s\d.,]+/, todas);

    let ultimoValor = null;
    let novaVendaAtividade = false;
    for (const el of todas) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      const m = t.match(/comprou.*?R\$\s*([\d.,]+)/i);
      if (m && !ultimoValor) ultimoValor = `R$ ${m[1]}`;
      if (/comprou o produto|purchased|bought/i.test(t)) {
        const chave = t.slice(0, 60);
        if (!vendasVistas.has(chave)) {
          // Na primeira leitura, o que já estava na tela não é venda nova.
          if (ultimasVendas !== null) novaVendaAtividade = true;
          vendasVistas.add(chave);
          if (vendasVistas.size > 50) vendasVistas.clear();
        }
      }
    }

    const nova = Number.parseInt(vendas ?? "", 10);
    const antes = Number.parseInt(ultimasVendas ?? "", 10);
    if (Number.isFinite(nova) && Number.isFinite(antes) && nova > antes && antes > 0) {
      const diff = Math.min(nova - antes, 3);
      for (let i = 0; i < diff; i++) setTimeout(caixaRegistradora, i * 700);
      avisoNaTela(`🛒 +${nova - antes} venda(s)!`, "ok");
    } else if (novaVendaAtividade) {
      caixaRegistradora();
      avisoNaTela(`🛒 Nova venda!${ultimoValor ? ` ${ultimoValor}` : ""}`, "ok");
    }
    if (vendas !== null) ultimasVendas = vendas;
    else if (ultimasVendas === null) ultimasVendas = "";

    void pedir({ tipo: "metricas", dados: { viewers, vendas, gmv, ultimoValor, novaVendaAtividade } });
  }

  function sincronizarMetricas() {
    const ligado = ciclo?.ativo && souAlvo();
    if (ligado && !lacoMetricas) {
      lerMetricas();
      lacoMetricas = setInterval(lerMetricas, 8000);
    }
    if (!ligado && lacoMetricas) {
      clearInterval(lacoMetricas);
      lacoMetricas = null;
      ultimasVendas = null;
    }
  }

  // =========================================================================
  // LER A TELA: comentários e entradas vão ao servidor, que decide a resposta
  // =========================================================================

  let observador = null;
  let listaObservada = null;
  let lendo = false;
  let suspenso = false;
  const vistos = new Set();
  let pendentes = [];
  let tentativasSemChat = 0;
  let ultimoEstado = null;

  function contarEstado(e) {
    if (e === ultimoEstado) return;
    ultimoEstado = e;
    void pedir({ tipo: "chat_status", estado: e, caminho: location.pathname.slice(0, 80) });
  }

  function identidade(no, apelido, texto) {
    const id = no.getAttribute?.("data-id") || no.id;
    return id ? `id:${id}` : `t:${apelido}|${texto}`;
  }

  function lerComentario(no) {
    const autor = mapa.um("chat.item_autor", no);
    const corpo = mapa.um("chat.item_texto", no);
    const apelido = (autor?.textContent || "").trim().slice(0, 80);
    const texto = (corpo?.textContent || "").trim().slice(0, 500);
    if (texto) return { apelido: apelido || null, texto };
    // Sem o mapa casar, o formato "nome: texto".
    const m = (no.textContent || "").replace(/\s+/g, " ").trim().match(/^(.{1,40}?)\s*[:：]\s*(.+)$/);
    return m && m[2].length <= 300 ? { apelido: m[1], texto: m[2] } : null;
  }

  async function consultarEResponder(evento) {
    const r = await pedir({ tipo: "decidir", evento });
    if (!r?.ok || r.acao === "ignorar") return;
    if (r.acao === "escrever" && r.texto) {
      await dormir(Math.min(Math.max(r.esperarMs ?? 0, 0), 120000));
      const envio = await escreverNoChat(r.texto);
      if (envio.ok) void pedir({ tipo: "respondeu", texto: r.texto, tema: r.tema ?? null, apelido: evento.apelido });
      else void pedir({ tipo: "envio_falhou", motivo: envio.motivo, botao: envio.botao ?? null });
    }
  }

  function processar(nos) {
    const novos = [];
    for (const no of nos) {
      const entrada = mapa.um("chat.entrada", no) ?? (no.matches?.("[data-e2e='enter-message']") ? no : null);
      if (entrada) {
        const apelido = textoDe(mapa.um("chat.entrada_autor", no)).slice(0, 80);
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
      void consultarEResponder({ tipo: "comentario", apelido: lido.apelido, texto: lido.texto });
    }
    if (vistos.size > 5000) {
      const sobra = [...vistos].slice(-2500);
      vistos.clear();
      for (const v of sobra) vistos.add(v);
    }
    if (novos.length) {
      pendentes.push(...novos);
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
      for (const m of mutacoes) for (const no of m.addedNodes) if (no.nodeType === Node.ELEMENT_NODE) candidatos.push(no);
      if (candidatos.length) processar(candidatos);
    });
    observador.observe(lista, { childList: true, subtree: true });
    // O que já estava na tela fica marcado como visto, sem resposta: responder
    // comentário de cinco minutos atrás denuncia o robô.
    for (const no of mapa.todos("chat.item") ?? []) {
      const lido = lerComentario(no);
      if (lido) vistos.add(identidade(no, lido.apelido, lido.texto));
    }
    return true;
  }

  function desligarLeitura(estadoFinal) {
    observador?.disconnect();
    observador = null;
    lendo = false;
    contarEstado(estadoFinal);
  }

  async function voltaDaLeitura() {
    if (suspenso) return;
    if (!auto.lerTela || !souAlvo()) {
      if (lendo) desligarLeitura("desligado");
      return;
    }
    if (!ehPaginaDaLive()) {
      if (lendo) desligarLeitura("fora_da_live");
      tentativasSemChat = 0;
      contarEstado("fora_da_live");
      return;
    }
    if (lendo && !listaObservada?.isConnected) lendo = false;
    if (lendo) return;
    if (!(await carregarMapa())) return;
    if (!observarChat()) {
      tentativasSemChat += 1;
      if (tentativasSemChat >= 3) contarEstado("sem_chat");
      return;
    }
    tentativasSemChat = 0;
    lendo = true;
    contarEstado("lendo");
  }

  async function despejar() {
    const falhas = mapa.drenarFalhas();
    if (falhas.length) void pedir({ tipo: "quebras", falhas });
    if (!pendentes.length) return;
    const lote = pendentes.splice(0, 200);
    await pedir({ tipo: "eventos", eventos: lote });
  }

  // =========================================================================
  // APRENDER APONTANDO (âncoras do painel de produtos)
  // =========================================================================

  let aprendendo = null;
  let avisoAprender = null;

  function mostrarAviso(texto, tom = "info") {
    avisoAprender?.remove();
    avisoAprender = document.createElement("div");
    avisoAprender.textContent = texto;
    avisoAprender.style.cssText = [
      "position:fixed", "z-index:2147483647", "left:50%", "top:30px", "transform:translateX(-50%)",
      "max-width:min(90vw,460px)", "padding:12px 16px", "border-radius:10px", `font:${FONTE}`, "font-size:14px",
      "color:#fff", "box-shadow:0 8px 24px rgba(0,0,0,.35)", "text-align:center",
      `background:${tom === "ok" ? "#027A48" : tom === "erro" ? "#B42318" : "#0A100D"}`,
    ].join(";");
    document.documentElement.appendChild(avisoAprender);
  }

  function pararDeAprender() {
    aprendendo = null;
    document.removeEventListener("click", capturarClique, true);
    document.removeEventListener("keydown", cancelarComEsc, true);
    avisoAprender?.remove();
    avisoAprender = null;
  }

  function cancelarComEsc(evento) {
    if (evento.key !== "Escape") return;
    const qual = aprendendo;
    pararDeAprender();
    void pedir({ tipo: "aprendeu", ancora: qual, cancelado: true });
  }

  function capturarClique(evento) {
    evento.preventDefault();
    evento.stopPropagation();
    const cascata = descrever(alvoClicavel(evento.target));
    const qual = aprendendo;
    pararDeAprender();
    if (cascata.length === 0) {
      mostrarAviso("Não consegui descrever esse elemento. Tente clicar no botão em si.", "erro");
      setTimeout(() => avisoAprender?.remove(), 4000);
      void pedir({ tipo: "aprendeu", ancora: qual, cascata: [] });
      return;
    }
    ancorasLocais = { ...ancorasLocais, [qual]: cascata };
    mapa = new Mapa(mapa.mapa, mapa.versao, ancorasLocais);
    mostrarAviso("Anotado. Pode voltar ao painel da Shopia.", "ok");
    setTimeout(() => avisoAprender?.remove(), 3000);
    void pedir({ tipo: "aprendeu", ancora: qual, cascata });
  }

  function comecarAAprender(ancora, instrucao) {
    pararDeAprender();
    aprendendo = ancora;
    mostrarAviso(instrucao);
    document.addEventListener("click", capturarClique, true);
    document.addEventListener("keydown", cancelarComEsc, true);
  }

  // =========================================================================
  // ESTADO E MENSAGENS
  // =========================================================================

  function aplicarEstado() {
    pintarBarra();
    sincronizarMetricas();
    sincronizarComentarios();
    sincronizarBloqueio();
    if (auto.fixar && souAlvo() && !lacoFixar) agendarFixar(true);
    if ((!auto.fixar || !souAlvo()) && lacoFixar) {
      clearTimeout(lacoFixar);
      lacoFixar = null;
    }
    void voltaDaLeitura();
  }

  chrome.storage.onChanged.addListener((mudancas, area) => {
    if (area !== "local") return;
    if (mudancas[CH.auto]) auto = mudancas[CH.auto].newValue ?? {};
    if (mudancas[CH.ciclo]) ciclo = mudancas[CH.ciclo].newValue ?? {};
    if (mudancas[CH.abaAlvo]) alvo = mudancas[CH.abaAlvo].newValue ?? null;
    if (mudancas.shopia_ancoras_locais) {
      ancorasLocais = mudancas.shopia_ancoras_locais.newValue ?? {};
      mapa = new Mapa(mapa.mapa, mapa.versao, ancorasLocais);
    }
    aplicarEstado();
  });

  chrome.runtime.onMessage.addListener((mensagem, _remetente, responder) => {
    switch (mensagem?.tipo) {
      case "calibrar": {
        const v = verificarViolacao();
        responder({ pixels: v.detectado ? 999 : 0, detectado: v.detectado, motivo: v.motivo ?? null });
        return;
      }
      case "checar_live":
        responder(verificarLiveAtiva());
        return;
      case "encerrar_live":
        void encerrarLive().then(responder);
        return true;
      case "fixar_agora":
        void fixarEContar("manual").then(responder);
        return true;
      case "violacao":
        mostrarPilulaViolacao(mensagem.fimEm ?? null, Boolean(mensagem.encerrando));
        avisoNaTela("🔴 Violação detectada!", "err", 6000);
        return;
      case "ciclo_on":
        avisoNaTela("🟢 Shopia ligada — monitorando a live", "ok");
        return;
      case "ciclo_off":
        pilula?.remove();
        clearInterval(pilulaTimer);
        return;
      case "mapa":
        if (mensagem.mapa) {
          mapa = new Mapa(mensagem.mapa, mensagem.versao, ancorasLocais);
          lendo = false;
          void voltaDaLeitura();
        }
        return;
      case "parar":
        suspenso = true;
        desligarLeitura("suspenso");
        pararComentarios();
        return;
      case "estado":
        if (mensagem.estado && !mensagem.estado.pararAgora) suspenso = false;
        return;
      case "aprender":
        if (mensagem.ancora) comecarAAprender(mensagem.ancora, mensagem.instrucao ?? "Clique no botão que você quer ensinar.");
        return;
      case "programado_escrever":
        if (mensagem.texto) {
          void escreverNoChat(String(mensagem.texto).slice(0, 150)).then((r) =>
            pedir({
              tipo: "programado_feito",
              ok: r.ok,
              motivo: r.motivo ?? null,
              texto: mensagem.texto,
              tema: mensagem.tema ?? "aviso",
              avisoId: mensagem.avisoId ?? null,
            }),
          );
        }
        return;
      case "programado_fixar":
        void fixarProduto().then((r) => pedir({ tipo: "programado_fixou", ...r }));
        return;
      case "ensaiar_envio":
        void ensaiarEnvio().then(responder);
        return true;
      default:
        return;
    }
  });

  // --- partida ---
  const inicial = await chrome.storage.local.get([CH.auto, CH.ciclo, CH.abaAlvo, "shopia_ancoras_locais"]);
  auto = inicial[CH.auto] ?? {};
  ciclo = inicial[CH.ciclo] ?? {};
  alvo = inicial[CH.abaAlvo] ?? null;
  ancorasLocais = inicial.shopia_ancoras_locais ?? {};
  const quem = await pedir({ tipo: ehPaginaDaLive() ? "registrar_aba" : "quem_sou" });
  const eu = await pedir({ tipo: "quem_sou" });
  minhaAba = eu?.abaId ?? null;
  alvo = eu?.alvo ?? quem?.alvo ?? alvo;
  await carregarMapa();
  aplicarEstado();

  setInterval(() => void voltaDaLeitura(), 5000);
  setInterval(() => void despejar(), 10000);
})();
