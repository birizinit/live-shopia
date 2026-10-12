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
  const regras = await import(chrome.runtime.getURL("fluxos.js"));

  const CH = {
    auto: "shopia_auto",
    ciclo: "shopia_ciclo",
    abaAlvo: "shopia_aba_alvo",
    fluxos: "shopia_fluxos",
  };

  let mapa = new Mapa({}, null);
  let ancorasLocais = {};
  let minhaAba = null;
  let alvo = null;
  let auto = {};
  let ciclo = {};
  /** Fluxos de resposta do app: { lista, tetoPorMinuto, em }. */
  let fluxosDoApp = { lista: [], tetoPorMinuto: 3 };
  /**
   * A extensão foi desativada, removida ou recarregada no Chrome.
   *
   * O script desta aba NÃO morre junto: ele continua com os timers que já
   * tinha — e escrever no chat não depende da extensão. Sem esta trava, o
   * comentário automático seguia saindo depois de a pessoa desligar tudo.
   */
  let morto = false;
  const extensaoViva = () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  };
  /** Comentar, bloquear e fixar sozinho só com "Ligar a extensão" ativo. */
  const podeAgir = () => !morto && Boolean(ciclo?.ativo) && souAlvo();

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

  // Ícones de traço (24×24), os mesmos do painel. Texto fixo nosso — nada
  // vindo da página entra aqui.
  const ICONE = {
    "check": '<path d="M20 6 9 17l-5-5"/>',
    "alert": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    "info": '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    "eye": '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    "cart": '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    "shield": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    "refresh": '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>',
    "x": '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    "timer": '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>',
    "shield-alert": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  };
  const svg = (nome, px = 14) =>
    `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;display:block">${ICONE[nome] ?? ""}</svg>`;
  const ICONE_DO_TOM = { ok: "check", warn: "alert", err: "shield-alert", info: "info" };
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
    const cor = COR[tom] ?? COR.ok;
    el.innerHTML = `<span style="color:${cor};margin-top:1px">${svg(ICONE_DO_TOM[tom] ?? "check")}</span><span></span>`;
    el.lastElementChild.textContent = texto;
    el.style.cssText = `display:flex;gap:8px;align-items:flex-start;background:rgba(10,16,13,.96);color:#F6FAF7;border-radius:10px;padding:9px 12px;font:${FONTE};font-size:11.5px;box-shadow:0 6px 24px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.08);border-left:3px solid ${cor};min-width:180px;max-width:320px;`;
    caixa.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // --- barra de status no topo e o aviso flutuante da live ------------------
  //
  // Os mesmos auxílios visuais da extensão de referência: uma barra fina no
  // topo (estado, aba, live, timer, scans, proteção) e um aviso arrastável com
  // espectadores e vendas. Estilo numa <style> com id próprio e prefixo
  // "shopia-": a folha do TikTok é território deles.

  function injetarEstilo() {
    if (document.getElementById("shopia-estilo")) return;
    const st = document.createElement("style");
    st.id = "shopia-estilo";
    st.textContent = `
      @keyframes shopiaPisca{0%,100%{opacity:1}50%{opacity:.3}}
      #shopia-sb{position:fixed;top:0;left:0;right:0;height:28px;z-index:2147483646;display:flex;align-items:center;gap:12px;padding:0 14px;background:rgba(10,16,13,.94);border-bottom:1px solid rgba(50,213,131,.3);font:600 10px/1 system-ui,-apple-system,'Segoe UI',sans-serif;color:#90A699;letter-spacing:.2px;pointer-events:none;backdrop-filter:blur(8px)}
      #shopia-sb .sep{width:1px;height:14px;background:rgba(255,255,255,.12)}
      #shopia-sb .rot{color:rgba(255,255,255,.4)}
      #shopia-sb .ponto{width:6px;height:6px;border-radius:50%;background:#32D583;animation:shopiaPisca .8s infinite}
      #shopia-sb .mono{font-family:ui-monospace,Menlo,monospace;letter-spacing:1px}
      #shopia-pop{position:fixed;z-index:2147483646;display:flex;align-items:center;gap:8px;padding:8px 10px 8px 12px;border-radius:999px;background:rgba(10,16,13,.95);border:1px solid rgba(50,213,131,.35);box-shadow:0 8px 28px rgba(0,0,0,.45);font:600 11px/1 system-ui,-apple-system,'Segoe UI',sans-serif;color:#F6FAF7;cursor:grab;user-select:none;backdrop-filter:blur(8px)}
      #shopia-pop.arrastando{cursor:grabbing}
      #shopia-pop .ponto{width:8px;height:8px;border-radius:50%;background:#32D583;box-shadow:0 0 8px #32D583;animation:shopiaPisca .8s infinite}
      #shopia-pop .ponto.off{background:#90A699;box-shadow:none;animation:none}
      #shopia-pop .sep{width:1px;height:14px;background:rgba(255,255,255,.14)}
      #shopia-pop .ico{color:#90A699;display:flex}
      #shopia-sb .rot svg{display:inline-block;vertical-align:middle}
      #shopia-pop .num{font-size:12px;font-weight:800;font-family:ui-monospace,Menlo,monospace;color:#6CE9A6}
      #shopia-pop button{width:24px;height:24px;border-radius:50%;border:1px solid rgba(50,213,131,.35);background:rgba(50,213,131,.12);color:#F6FAF7;cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center}
      #shopia-pop button.cinza{border-color:rgba(255,255,255,.15);background:rgba(255,255,255,.06)}
      #shopia-pop button.alerta{border-color:#F04438;background:rgba(240,68,56,.2)}
    `;
    document.documentElement.appendChild(st);
  }

  function relogio() {
    const resta = ciclo.pausadoRestanteMs ?? (ciclo.fimEm ? Math.max(0, ciclo.fimEm - Date.now()) : null);
    if (resta === null) return "--:--:--";
    const s = Math.round(resta / 1000);
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
  }

  let barra = null;
  function pintarBarraTopo() {
    if (!barra?.isConnected) {
      barra = document.createElement("div");
      barra.id = "shopia-sb";
      barra.innerHTML = `
        <div style="display:flex;align-items:center;gap:5px"><div class="ponto"></div><span data-c="st" style="color:#32D583;letter-spacing:.5px">MONITORANDO</span></div>
        <div class="sep"></div><span class="rot">ABA TIKTOK</span><span data-c="aba"></span>
        <div class="sep"></div><span class="rot">LIVE</span><span data-c="live"></span>
        <div class="sep"></div><span class="rot">${svg("timer", 12)}</span><span data-c="timer" class="mono" style="color:#6CE9A6"></span>
        <div class="sep"></div><span data-c="scan" class="rot"></span>
        <div class="sep"></div><span style="display:flex;align-items:center;gap:5px"><span data-c="prot-ico">${svg("shield", 12)}</span><span data-c="prot"></span></span>`;
      document.documentElement.appendChild(barra);
    }
    const c = (k) => barra.querySelector(`[data-c="${k}"]`);
    const pausado = ciclo.pausadoRestanteMs != null;
    c("st").textContent = ciclo.violacao?.ativa ? "VIOLAÇÃO" : pausado ? "TIMER PAUSADO" : "MONITORANDO";
    c("st").style.color = ciclo.violacao?.ativa ? COR.err : pausado ? COR.warn : COR.ok;
    c("aba").textContent = "Conectada";
    c("aba").style.color = "#6CE9A6";
    c("live").textContent = ciclo.liveAtiva ? "Detectada" : "—";
    c("live").style.color = ciclo.liveAtiva ? COR.ok : "#888";
    c("timer").textContent = relogio();
    c("scan").textContent = `Scan: ${ciclo.scanN ?? 0}`;
    c("prot").textContent = ciclo.violacao?.ativa ? "ALERTA DE VIOLAÇÃO" : "Proteção ativa";
    c("prot").style.color = c("prot-ico").style.color = ciclo.violacao?.ativa ? COR.err : COR.ok;
  }

  let pop = null;
  let posPop = null;
  void chrome.storage.local.get("shopia_pos_aviso").then((r) => (posPop = r?.shopia_pos_aviso ?? null)).catch(() => {});

  function posicionar(el, pos) {
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      const x = Math.min(Math.max(pos.x, 0), innerWidth - 60);
      const y = Math.min(Math.max(pos.y, 30), innerHeight - 40);
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, bottom: "auto" });
    } else {
      Object.assign(el.style, { left: "12px", bottom: "16px", top: "auto" });
    }
  }

  function tornarArrastavel(el) {
    let ini = null;
    el.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const r = el.getBoundingClientRect();
      ini = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      el.classList.add("arrastando");
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!ini) return;
      posPop = { x: e.clientX - ini.dx, y: e.clientY - ini.dy };
      posicionar(el, posPop);
    });
    const soltar = () => {
      if (!ini) return;
      ini = null;
      el.classList.remove("arrastando");
      void chrome.storage.local.set({ shopia_pos_aviso: posPop }).catch(() => {});
    };
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", soltar);
  }

  function pintarAvisoLive() {
    if (!pop?.isConnected) {
      pop = document.createElement("div");
      pop.id = "shopia-pop";
      pop.innerHTML = `
        <div class="ponto" data-c="ponto"></div>
        <div data-c="txt"></div>
        <div class="sep"></div>
        <span class="ico" title="Espectadores">${svg("eye")}</span><span class="num" data-c="viewers">—</span>
        <div class="sep"></div>
        <span class="ico" title="Vendas">${svg("cart")}</span><span class="num" data-c="vendas">—</span>
        <div class="sep"></div>
        <button data-c="prot" title="Proteção ativa">${svg("shield", 13)}</button>
        <button data-c="ref" class="cinza" title="Atualizar">${svg("refresh", 13)}</button>`;
      document.documentElement.appendChild(pop);
      posicionar(pop, posPop);
      tornarArrastavel(pop);
      pop.querySelector('[data-c="ref"]').addEventListener("click", () => {
        lerMetricas();
        avisoNaTela("Números atualizados", "info", 2000);
      });
      pop.querySelector('[data-c="prot"]').addEventListener("click", () => {
        avisoNaTela(
          ciclo.violacao?.ativa ? "Aviso de violação detectado" : "Proteção ativa — vigiando avisos do TikTok",
          ciclo.violacao?.ativa ? "err" : "ok",
          3000,
        );
      });
    }
    const c = (k) => pop.querySelector(`[data-c="${k}"]`);
    c("ponto").classList.toggle("off", !ciclo.liveAtiva);
    c("txt").textContent = ciclo.liveAtiva ? "LIVE ativa · LIVE detectada" : "Procurando a live…";
    c("viewers").textContent = ciclo.viewers || "—";
    c("vendas").textContent = ciclo.vendas || "—";
    c("prot").classList.toggle("alerta", Boolean(ciclo.violacao?.ativa));
    c("prot").title = ciclo.violacao?.ativa ? "Violação detectada" : "Proteção ativa";
  }

  function pintarBarra() {
    const ligado = ciclo?.ativo && souAlvo() && !morto;
    if (!ligado) {
      barra?.remove();
      pop?.remove();
      barra = pop = null;
      return;
    }
    injetarEstilo();
    pintarBarraTopo();
    pintarAvisoLive();
  }
  const lacoBarra = setInterval(pintarBarra, 1000);

  let pilula = null;
  let pilulaTimer = null;
  function mostrarPilulaViolacao(fimEm, encerrando) {
    pilula?.remove();
    clearInterval(pilulaTimer);
    pilula = document.createElement("div");
    pilula.style.cssText = `position:fixed;left:16px;bottom:155px;z-index:2147483647;background:#1a0a0d;border:1px solid #F04438;color:#FDA29B;border-radius:999px;padding:8px 14px;font:${FONTE};display:flex;gap:10px;align-items:center;box-shadow:0 6px 24px rgba(0,0,0,.5);`;
    const ico = document.createElement("span");
    ico.innerHTML = svg("shield-alert", 14);
    ico.style.cssText = "color:#F04438;display:flex";
    const txt = document.createElement("span");
    const x = document.createElement("button");
    x.innerHTML = svg("x", 12);
    x.title = "Encerrar a live agora";
    x.style.cssText = "background:#F04438;color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;";
    x.onclick = () => {
      void pedir({ tipo: "encerrar_live", motivo: "encerrada pela pílula de violação" });
      pilula?.remove();
    };
    pilula.append(ico, txt, x);
    document.documentElement.appendChild(pilula);
    const pintar = () => {
      if (encerrando || !fimEm) {
        txt.textContent = "Violação · encerrando a live";
        return;
      }
      const s = Math.max(0, Math.round((fimEm - Date.now()) / 1000));
      txt.textContent = `Violação · encerra em ${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
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

  // Pistas de que a live está no ar, em português, inglês e espanhol: o painel
  // de produtos da live (shop.tiktok.com/streamer/live/...) abre no idioma da
  // região da loja, e não tem o botão "Encerrar" — esse fica no LIVE Studio.
  const BOTAO_ENCERRAR = /^(encerrar|finalizar|end|stop|parar|terminar)\b.{0,20}(live|transmiss|stream|en vivo)|^(end|encerrar) ?live$/i;
  const TEXTO_AO_VIVO =
    /\b(ao vivo|live agora|transmitindo|você está ao vivo|live now|you'?re live|on air|streaming now|en vivo|en directo|live duration|duração da live|tempo de live|live time)\b/i;
  const SELO_AO_VIVO = /^(live|ao vivo|en vivo|on air)$/i;
  const METRICA_DA_LIVE = /\b(espectadores|viewers|watching|assistindo|gmv|visualiza|espectadores atuais|current viewers)\b/i;
  const ehPainelDaLive = () => /\/streamer\/live|live_studio|\/live\b/i.test(location.pathname);

  let ultimoMotivoLive = null;

  /**
   * A live está no ar? Qualquer uma destas basta:
   *   1. botão de encerrar a live na tela;
   *   2. produto FIXADO (botão "Desafixar/Unpin"): só existe produto fixado
   *      durante a live — é a pista mais firme do painel de produtos;
   *   3. selo/texto "ao vivo" junto de um número da live (espectadores, GMV);
   *   4. no painel da live, números da live junto dos botões de fixar.
   */
  function verificarLiveAtiva() {
    const botoes = [...document.querySelectorAll('button,[role="button"]')].filter(visivel);
    const textos = botoes.map((b) => textoDe(b).toLowerCase()).filter((t) => t && t.length < 40);

    const temEncerrar = textos.some((t) => BOTAO_ENCERRAR.test(t));
    const temDesafixar = textos.some(ehDesafixar);
    const temFixar = textos.some(ehFixar);

    const corpo = document.body?.innerText || "";
    const temTextoAoVivo = TEXTO_AO_VIVO.test(corpo);
    const temSelo = [...document.querySelectorAll("span,div,p")].some(
      (el) => el.children.length === 0 && SELO_AO_VIVO.test((el.textContent || "").trim()) && visivel(el),
    );
    const temMetrica =
      METRICA_DA_LIVE.test(corpo) ||
      Boolean(document.querySelector('[data-e2e="person-count"],[class*="viewer" i],[class*="audience" i]'));

    let motivo = null;
    if (temEncerrar) motivo = "botão de encerrar";
    else if (temDesafixar) motivo = "produto fixado";
    else if ((temTextoAoVivo || temSelo) && temMetrica) motivo = "selo ao vivo + números da live";
    else if (ehPainelDaLive() && temMetrica && temFixar) motivo = "painel da live com números e produtos";

    if (motivo !== ultimoMotivoLive) {
      ultimoMotivoLive = motivo;
      registrar(motivo ? `LIVE detectada (${motivo})` : "LIVE não detectada nesta página", motivo ? "ok" : "warn");
    }
    return { liveAtiva: Boolean(motivo), abaConectada: true, motivo };
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
    avisoNaTela("Botão encerrar não encontrado", "warn");
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
      avisoNaTela("Produto fixado", "ok");
      registrar(`Produto fixado (${origem})`, "ok");
    } else {
      avisoNaTela("Não consegui fixar", "warn");
      registrar(`Fixar falhou: ${MOTIVO_FIXAR[r.motivo] ?? r.motivo}`, "warn");
    }
    return r;
  }

  let lacoFixar = null;
  function agendarFixar(primeira = false) {
    clearTimeout(lacoFixar);
    lacoFixar = null;
    if (!auto.fixar || !podeAgir()) return;
    const espera = primeira ? acaso(5000, 8000) : acaso(18000, 30000);
    lacoFixar = setTimeout(async () => {
      if (auto.fixar && podeAgir()) await fixarEContar("automático");
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
  // Uma escrita por vez: comentário automático, fluxo, aviso da moderação e
  // resposta do manual disputam o MESMO campo. Duas ao mesmo tempo misturam
  // as letras ou uma apaga a outra antes do Enter.
  let filaDeEscrita = Promise.resolve();
  function escreverNoChat(texto) {
    const vez = filaDeEscrita.then(() => escreverNoChatAgora(texto));
    filaDeEscrita = vez.catch(() => {});
    return vez;
  }

  async function escreverNoChatAgora(texto) {
    if (morto) return { ok: false, motivo: "extensao_desligada" };
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
        escritosPorMim.push({ texto, em: Date.now() });
        if (escritosPorMim.length > 30) escritosPorMim.shift();
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
    if (!c.ativo || !podeAgir() || !(c.mensagens ?? []).length) return;
    const min = Math.max(10, Number(c.min) || 30);
    const max = Math.max(min, Number(c.max) || 90);
    const espera = imediato ? 500 : Math.floor(Math.random() * (max - min + 1) + min) * 1000;
    void pedir({ tipo: "comentario_feito", agendado: true, emMs: espera, ok: true });
    lacoComentar = setTimeout(async () => {
      if (!auto.comentarios?.ativo || !podeAgir()) return;
      await comentarAgora();
      agendarComentario();
    }, espera);
  }

  function sincronizarComentarios() {
    const c = auto.comentarios ?? {};
    const chave = JSON.stringify([c.ativo, c.mensagens, c.min, c.max, podeAgir()]);
    if (chave === chaveComentarios) return;
    const antes = JSON.parse(chaveComentarios || "[false,null,null,null,false]");
    const ligou = c.ativo && podeAgir() && !(antes[0] && antes[4]);
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
    avisoNaTela(`Bloqueado: ${usuario}`, "warn");
    return true;
  }

  async function voltaDoBloqueio() {
    if (bloqueando || !auto.bloqueio?.ativo || !podeAgir()) return;
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
    const ligado = auto.bloqueio?.ativo && podeAgir();
    if (ligado && !lacoBloqueio) lacoBloqueio = setInterval(() => void voltaDoBloqueio(), 3500);
    if (!ligado && lacoBloqueio) {
      clearInterval(lacoBloqueio);
      lacoBloqueio = null;
    }
  }

  // =========================================================================
  // CARRINHO E CLIQUES
  //
  // Duas fontes no painel da live (shop.tiktok.com/streamer/live/...):
  //   1. o painel "Atividade", que lista QUEM fez o quê — "Fulano adicionou
  //      ao carrinho" — cada item um div[type] com avatar e o nome;
  //   2. os contadores de cada cartão de produto — "Cliques 9 |
  //      Adicionado ao carrinho 1" — que dizem EM QUAL produto, mas não quem.
  // A atividade dá o nome; o contador garante que nada passa batido quando o
  // filtro da atividade não mostra aquele tipo de evento.
  // =========================================================================

  // O tipo vem marcado no próprio item (div[type="add_to_cart_filter"]); o
  // texto é a reserva. Na página real: "1 pessoa adicionou o produto nº 1 ao
  // carrinho" e "1 pessoa está vendo o produto nº 1" — sem o nome de quem foi.
  const TIPO_POR_ATRIBUTO = [
    { tipo: "carrinho", re: /cart|carrinho/i },
    { tipo: "compra", re: /order|purchase|pay|pedido|compra/i },
    { tipo: "clique", re: /product_detail|open_product|click|view_product/i },
  ];
  const ACOES_DA_ATIVIDADE = [
    { tipo: "carrinho", re: /adicion(ou|aram)\b.{0,50}\bcarrinho|colocou .{0,50}carrinho|added .{0,50}to (the )?cart|add(ed)? to cart|agreg[óo] .{0,50}al carrito/i },
    { tipo: "compra", re: /comprou|compraram|fez (um )?pedido|fizeram .{0,20}pedido|purchased|bought|placed an order|realiz[óo] un pedido/i },
    { tipo: "clique", re: /clicou|tocou no produto|est[áa]o? (vendo|olhando)|viu o produto|visualizou o produto|is viewing|are viewing|viewed the product|clicked|tapped|est[áa]n? viendo/i },
  ];
  const ROTULO_CLIQUES = /^(cliques|clicks|clics)$/i;
  const ROTULO_CARRINHO = /^(adicionado ao carrinho|adicionados ao carrinho|added to cart|add to cart|agregado al carrito)$/i;

  const vistosAtividade = new Map();
  let atividadePronta = false;
  const contadoresProduto = new Map();
  let contadoresProntos = false;
  let lacoCarrinho = null;
  let ultimoComentarioCarrinho = 0;
  let ultimoComentarioClique = 0;
  const totais = { carrinho: 0, clique: 0, compra: 0 };
  /** Eventos com nome dos últimos segundos: o contador que sobe depois não repete o aviso. */
  let recentesComNome = [];

  function itensDaAtividade() {
    return [...document.querySelectorAll("div[type]")].filter(
      (el) => el.querySelector('[data-tid="m4b_avatar"],img') && (el.textContent || "").length < 160,
    );
  }

  function lerItemDaAtividade(el) {
    const nomeEl = el.querySelector('[data-tid="m4b_overflow_text_signle"]');
    const nome = textoDe(nomeEl);
    const tudo = textoDe(el);
    const acao = (nome ? tudo.replace(nome, "") : tudo).trim();
    const atributo = el.getAttribute("type") || "";
    const porTexto = ACOES_DA_ATIVIDADE.find((a) => a.re.test(acao))?.tipo;
    // Entrada ("acabou de entrar") e outros filtros que não interessam aqui.
    const porAtributo = /view_filter|enter|join/i.test(atributo)
      ? null
      : TIPO_POR_ATRIBUTO.find((a) => a.re.test(atributo))?.tipo;
    const tipo = porAtributo ?? porTexto;
    if (!tipo) return null;
    // "3 pessoas adicionaram o produto nº 2 ao carrinho": quantos e qual.
    const quantos = Number.parseInt(acao.match(/^(\d+)\s+(pessoas?|people|person|personas?)\b/i)?.[1] ?? "1", 10) || 1;
    const numero = acao.match(/(?:produto|product|producto)\s*(?:n[º°o.]*|#)\s*(\d+)/i)?.[1] ?? null;
    return { tipo, nome: nome || null, acao, quantos, numero: numero ? Number(numero) : null };
  }

  /** Os nomes dos produtos na ordem da lista: "produto nº 2" é o segundo. */
  function nomesDosProdutos() {
    // Os botões de fixar da LISTA (o banner do produto fixado no topo tem
    // outro, que bagunçaria a ordem). Sem a marca, qualquer botão de fixar.
    let botoes = [...document.querySelectorAll('button[data-pin-performance-source="product_card"]')];
    if (!botoes.length) {
      botoes = [...document.querySelectorAll("button")].filter((b) => {
        const t = textoDe(b).toLowerCase();
        return ehFixar(t) || ehDesafixar(t);
      });
    }
    const nomes = [];
    for (const b of botoes) {
      // Sobe até o primeiro ancestral que tenha o nome do produto.
      let atual = b.parentElement;
      let nome = null;
      for (let i = 0; i < 12 && atual && !nome; i++, atual = atual.parentElement) nome = nomeDoProduto(atual);
      if (nome && !nomes.includes(nome)) nomes.push(nome);
    }
    return nomes;
  }

  /** O cartão do produto: o ancestral do contador que tem o botão de fixar. */
  function cartaoDoProduto(el) {
    let atual = el;
    for (let i = 0; i < 10 && atual; i++) {
      atual = atual.parentElement;
      if (!atual) break;
      const botoes = [...atual.querySelectorAll("button")].map((b) => textoDe(b).toLowerCase());
      if (botoes.some((t) => ehFixar(t) || ehDesafixar(t))) return atual;
    }
    return null;
  }

  function nomeDoProduto(cartao) {
    if (!cartao) return null;
    const candidato = [...cartao.querySelectorAll("span,div,a")].find((e) => {
      if (e.children.length) return false;
      const t = (e.textContent || "").trim();
      return t.length > 8 && !/^R\$|^\$|estoque|stock|cliques|clicks|carrinho|cart|vendid|sold|fixar|pin/i.test(t);
    });
    const nome = (candidato?.textContent || "").trim();
    return nome ? (nome.length > 40 ? `${nome.slice(0, 40)}…` : nome) : null;
  }

  function valorAoLado(rotulo) {
    const valor = rotulo.nextElementSibling ?? rotulo.parentElement?.lastElementChild;
    const n = Number.parseInt((valor?.textContent || "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }

  function lerContadoresDeProduto() {
    const lidos = new Map();
    for (const el of document.querySelectorAll("div,span")) {
      if (el.children.length) continue;
      const t = (el.textContent || "").trim();
      const tipo = ROTULO_CLIQUES.test(t) ? "clique" : ROTULO_CARRINHO.test(t) ? "carrinho" : null;
      if (!tipo) continue;
      const valor = valorAoLado(el);
      if (valor === null) continue;
      const cartao = cartaoDoProduto(el);
      const produto = nomeDoProduto(cartao) ?? "produto";
      lidos.set(`${produto}|${tipo}`, { produto, tipo, valor });
    }
    return lidos;
  }

  function preencher(modelo, nome, produto) {
    let texto = String(modelo || "");
    // Sem nome (o TikTok diz só "1 pessoa…"): "{nome}, vi que…" vira "Vi que…".
    texto = nome ? texto.replaceAll("{nome}", nome) : texto.replace(/\{nome\}\s*[,!.:-]?\s*/g, "");
    texto = texto.replaceAll("{produto}", produto || "o produto").replace(/\s+/g, " ").replace(/^[\s,]+/, "").trim();
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  async function reagir(evento) {
    const c = auto.carrinho ?? {};
    totais[evento.tipo] = (totais[evento.tipo] ?? 0) + (evento.quantos ?? 1);
    const n = evento.quantos ?? 1;
    const doProduto = evento.produto ? `: ${evento.produto}` : "";
    const frase =
      evento.tipo === "carrinho"
        ? `${evento.nome ? `${evento.nome} adicionou` : n > 1 ? `${n} pessoas adicionaram` : "Alguém adicionou"} ao carrinho${doProduto}`
        : evento.tipo === "compra"
          ? `${evento.nome ? `${evento.nome} comprou` : n > 1 ? `${n} compras` : "Alguém comprou"}${doProduto}`
          : `${evento.nome ? `${evento.nome} clicou no produto` : n > 1 ? `${n} cliques no produto` : "Clique no produto"}${doProduto}`;
    avisoNaTela(frase, evento.tipo === "clique" ? "info" : "ok", 3500);
    if (evento.tipo !== "clique") caixaRegistradora();
    void pedir({ tipo: "carrinho_evento", evento: { ...evento, frase }, totais: { ...totais } });

    // Comentário no chat, com intervalo mínimo entre um e outro: cada clique
    // virar comentário seria spam — e spam é o que o TikTok mais pune.
    const agora = Date.now();
    const intervalo = Math.max(15, Number(c.intervalo) || 60) * 1000;
    if (evento.tipo === "carrinho" && c.comentarCarrinho && c.textoCarrinho && agora - ultimoComentarioCarrinho > intervalo) {
      ultimoComentarioCarrinho = agora;
      const texto = preencher(c.textoCarrinho, evento.nome, evento.produto);
      const r = await escreverNoChat(texto.slice(0, 150));
      void pedir({ tipo: "comentario_feito", ok: r.ok, motivo: r.motivo ?? null, texto });
    }
    if (evento.tipo === "clique" && c.comentarClique && c.textoClique && agora - ultimoComentarioClique > intervalo) {
      ultimoComentarioClique = agora;
      const texto = preencher(c.textoClique, evento.nome, evento.produto);
      const r = await escreverNoChat(texto.slice(0, 150));
      void pedir({ tipo: "comentario_feito", ok: r.ok, motivo: r.motivo ?? null, texto });
    }
  }

  function voltaDoCarrinho() {
    if (!auto.carrinho?.ativo || !podeAgir()) return;
    const agora = Date.now();
    recentesComNome = recentesComNome.filter((e) => agora - e.em < 20000);

    // 1. A atividade. O mesmo texto pode repetir e ser OUTRO evento ("1 pessoa
    // adicionou o produto nº 1 ao carrinho" duas vezes = dois carrinhos):
    // conta quantas vezes cada texto aparece e reage só ao que aumentou.
    const contagem = new Map();
    const itens = [];
    for (const el of itensDaAtividade()) {
      const item = lerItemDaAtividade(el);
      if (!item) continue;
      const chave = `${item.tipo}|${item.nome}|${item.acao}`;
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
      itens.push([chave, item]);
    }
    const nomes = itens.length ? nomesDosProdutos() : [];
    const tratados = new Set();
    for (const [chave, item] of itens) {
      if (tratados.has(chave)) continue;
      tratados.add(chave);
      const agoraN = contagem.get(chave);
      const antesN = vistosAtividade.get(chave) ?? 0;
      vistosAtividade.set(chave, agoraN);
      // O que já estava na tela quando ligou não é novidade.
      if (!atividadePronta || agoraN <= antesN) continue;
      const vezes = agoraN - antesN;
      const produto = item.numero ? (nomes[item.numero - 1] ?? `produto nº ${item.numero}`) : null;
      for (let i = 0; i < vezes; i++) recentesComNome.push({ tipo: item.tipo, em: agora, quantos: item.quantos });
      void reagir({ ...item, produto, quantos: item.quantos * vezes });
    }
    atividadePronta = true;
    if (vistosAtividade.size > 2000) vistosAtividade.clear();

    // 2. Os contadores por produto: em qual produto, e quantos.
    const lidos = lerContadoresDeProduto();
    for (const [chave, atual] of lidos) {
      const antes = contadoresProduto.get(chave);
      contadoresProduto.set(chave, atual);
      if (!contadoresProntos || !antes || atual.valor <= antes.valor) continue;
      let quantos = atual.valor - antes.valor;
      // O que a atividade já avisou com o nome (nos últimos 20 s) não repete.
      while (quantos > 0) {
        const i = recentesComNome.findIndex((e) => e.tipo === atual.tipo);
        if (i === -1) break;
        const e = recentesComNome[i];
        const usa = Math.min(quantos, e.quantos ?? 1);
        quantos -= usa;
        e.quantos = (e.quantos ?? 1) - usa;
        if (e.quantos <= 0) recentesComNome.splice(i, 1);
      }
      if (quantos <= 0) continue;
      void reagir({ tipo: atual.tipo, nome: null, produto: atual.produto, quantos });
    }
    contadoresProntos = true;
  }

  function sincronizarCarrinho() {
    const ligado = auto.carrinho?.ativo && podeAgir();
    if (ligado && !lacoCarrinho) {
      atividadePronta = false;
      contadoresProntos = false;
      voltaDoCarrinho();
      lacoCarrinho = setInterval(voltaDoCarrinho, 2000);
    }
    if (!ligado && lacoCarrinho) {
      clearInterval(lacoCarrinho);
      lacoCarrinho = null;
    }
  }

  // =========================================================================
  // MODERAÇÃO SEGURA
  //
  // Só duas coisas, as duas reversíveis:
  //   1. reclamação no chat ("não chegou", "golpe"…) → ALERTA para você
  //      responder. Nada é feito com a pessoa.
  //   2. link, telefone ou palavra proibida → UM aviso educado no chat,
  //      no máximo uma vez por pessoa na live.
  // Ninguém é silenciado nem bloqueado pelo texto: um "me chama no zap pra
  // comprar mais" é cliente, e errar ali custa a venda.
  //
  // Lê o chat do painel da live (shop.tiktok.com/streamer — cada mensagem é
  // avatar + nome + tag "Host" opcional e o texto embaixo) e o do tiktok.com
  // (pelo mapa de seletores). Não depende do "Ler a tela".
  // =========================================================================

  const RE_LINK = /(https?:\/\/|www\.|\bwa\.me\b|\bbit\.ly\b|\b[a-z0-9-]{2,}\.(com|net|org|br|io|ly|me|site|shop|store|link|app)\b)/i;
  // 8+ dígitos seguidos (com espaço, ponto, traço ou parênteses no meio).
  const RE_TELEFONE = /(?:\+?\d[\s().-]{0,2}){8,}/;
  // Quem fala pela loja não é moderado.
  const RE_TAG_DA_LOJA = /^(host|anfitri[ãa]o|apresentador|moderador(a)?|moderator|mod|admin)$/i;
  const INTERVALO_AVISO_MS = 20000;

  const vistosChat = new Map();
  let chatPronto = false;
  let lacoModeracao = null;
  let ultimoAvisoChat = 0;
  const avisados = new Set();
  const totaisModeracao = { reclamacao: 0, aviso: 0 };
  /** O que a própria extensão escreveu: o eco no chat não é moderado. */
  const escritosPorMim = [];

  const normalizar = (t) =>
    String(t ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9@]+/g, " ")
      .trim();

  /** A primeira expressão da lista que aparece inteira no texto. */
  function expressaoNoTexto(texto, lista) {
    const t = ` ${normalizar(texto)} `;
    for (const p of lista ?? []) {
      const n = normalizar(p);
      if (n && t.includes(` ${n} `)) return String(p).trim();
    }
    return null;
  }

  /** Mensagens do chat do painel da live: avatar, nome, tag e texto. */
  function mensagensDoPainel() {
    const lidas = [];
    for (const avatar of document.querySelectorAll('[data-tid="m4b_avatar"]')) {
      const topo = avatar.parentElement;
      const corpo = topo?.nextElementSibling;
      // Os itens da Atividade ("1 pessoa adicionou…") têm avatar mas são div[type].
      if (!topo || !corpo || avatar.closest("div[type]")) continue;
      const nome = textoDe(topo.querySelector(".truncate") ?? topo).slice(0, 80);
      const tag = textoDe(topo.querySelector('[data-tid="m4b_tag"]'));
      const texto = textoDe(corpo).slice(0, 500);
      if (nome && texto) lidas.push({ nome, tag, texto });
    }
    return lidas;
  }

  function mensagensDoTikTok() {
    const lidas = [];
    for (const no of mapa.todos("chat.item") ?? []) {
      const lido = lerComentario(no);
      if (lido?.texto) lidas.push({ nome: lido.apelido ?? "", tag: "", texto: lido.texto });
    }
    return lidas;
  }

  function ehDaLoja(msg) {
    if (msg.tag && RE_TAG_DA_LOJA.test(msg.tag.trim())) return true;
    const t = normalizar(msg.texto);
    return escritosPorMim.some((e) => normalizar(e.texto) === t);
  }

  function ehExcecao(nome, excecoes) {
    const n = normalizar(nome);
    return Boolean(n) && (excecoes ?? []).some((e) => {
      const x = normalizar(e);
      return x && (n === x || n.includes(x));
    });
  }

  function somDeAlerta() {
    if (!auto.som) return;
    try {
      audioCtx ??= new AudioContext();
      const t = audioCtx.currentTime;
      [[660, 0], [520, 0.18]].forEach(([f, d]) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.3, t + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.3);
        o.connect(g).connect(audioCtx.destination);
        o.start(t + d);
        o.stop(t + d + 0.35);
      });
    } catch { /* navegador sem áudio liberado */ }
  }

  /** O que fazer com uma mensagem nova. Puro: decide, não age. */
  function julgar(msg, m) {
    if (ehDaLoja(msg) || ehExcecao(msg.nome, m.excecoes)) return null;
    if (m.avisar) {
      let motivo = null;
      if (m.links && RE_LINK.test(msg.texto)) motivo = "link";
      else if (m.telefones && RE_TELEFONE.test(msg.texto)) motivo = "telefone";
      else {
        const p = expressaoNoTexto(msg.texto, m.proibidas);
        if (p) motivo = `"${p}"`;
      }
      if (motivo) return { tipo: "aviso", motivo };
    }
    if (m.alertar) {
      const p = expressaoNoTexto(msg.texto, m.reclamacoes);
      if (p) return { tipo: "reclamacao", motivo: `"${p}"` };
    }
    return null;
  }

  async function agirNaModeracao(msg, decisao, m) {
    totaisModeracao[decisao.tipo] += 1;
    const quem = msg.nome || "Alguém";
    const trecho = msg.texto.length > 70 ? `${msg.texto.slice(0, 70)}…` : msg.texto;
    let respondeu = false;
    let motivoFalha = null;

    if (decisao.tipo === "aviso") {
      const chave = normalizar(msg.nome) || `?${normalizar(msg.texto)}`;
      const agora = Date.now();
      // Uma vez por pessoa na live, e no máximo um aviso a cada 20 s.
      if (m.textoAviso && !avisados.has(chave) && agora - ultimoAvisoChat >= INTERVALO_AVISO_MS) {
        avisados.add(chave);
        ultimoAvisoChat = agora;
        const texto = msg.nome
          ? m.textoAviso.replaceAll("{nome}", msg.nome)
          : preencher(m.textoAviso.replace(/@?\{nome\}/g, "{nome}"), null, null);
        const r = await escreverNoChat(texto.slice(0, 150));
        respondeu = r.ok;
        motivoFalha = r.ok ? null : r.motivo;
        void pedir({ tipo: "comentario_feito", ok: r.ok, motivo: r.motivo ?? null, texto });
      }
    }

    const frase =
      decisao.tipo === "reclamacao"
        ? `Reclamação de ${quem} (${decisao.motivo}): ${trecho}`
        : `${quem} mandou ${decisao.motivo} no chat${respondeu ? " — aviso enviado" : ""}: ${trecho}`;
    avisoNaTela(frase, "warn", decisao.tipo === "reclamacao" ? 8000 : 5000);
    if (decisao.tipo === "reclamacao") somDeAlerta();
    void pedir({
      tipo: "moderacao_evento",
      evento: { tipo: decisao.tipo, nome: msg.nome || null, texto: trecho, motivo: decisao.motivo, respondeu, motivoFalha, frase, em: Date.now() },
      totais: { ...totaisModeracao },
    });
  }

  // -------------------------------------------------------------------------
  // FLUXOS DE RESPOSTA e PERGUNTAS SEM RESPOSTA
  //
  // Os fluxos são montados no app (/fluxos) e chegam pelo storage. A regra do
  // casamento mora em fluxos.js, a mesma que o app usa na prévia.
  // -------------------------------------------------------------------------

  const respondidosPorFluxo = new Set();
  const ultimoEnvioDoFluxo = new Map();
  let enviosDeFluxo = [];
  const esperasDeFluxo = new Set();
  const perguntasAvisadas = new Set();

  /** Casou algum fluxo? Se casou, agenda a resposta (ou explica por que não). */
  function tentarFluxo(msg) {
    const achou = regras.fluxoQueCasa(fluxosDoApp.lista ?? [], msg.texto);
    if (!achou) return false;
    const f = achou.fluxo;
    const quem = regras.normalizar(msg.nome);
    const chavePessoa = `${f.id}|${quem}`;
    const agora = Date.now();
    const pular = (motivo) => {
      registrar(`Fluxo "${f.nome}" casou com ${msg.nome || "alguém"}, mas não respondeu: ${motivo}`, "inf");
      return true;
    };
    if (f.umaVezPorPessoa && quem && respondidosPorFluxo.has(chavePessoa)) return pular("já respondeu essa pessoa nesta live");
    if (agora - (ultimoEnvioDoFluxo.get(f.id) ?? 0) < (Number(f.intervaloS) || 0) * 1000) return pular("intervalo do fluxo");
    enviosDeFluxo = enviosDeFluxo.filter((t) => agora - t < 60000);
    if (enviosDeFluxo.length >= Math.max(1, Number(fluxosDoApp.tetoPorMinuto) || 3)) return pular("teto de mensagens por minuto");

    // Reserva já, antes da espera: dez "frete" no mesmo segundo são UMA resposta.
    respondidosPorFluxo.add(chavePessoa);
    ultimoEnvioDoFluxo.set(f.id, agora);
    enviosDeFluxo.push(agora);
    const espera = Math.min(Math.max(Number(f.atrasoS) || 0, 0), 300) * 1000;
    const t = setTimeout(async () => {
      esperasDeFluxo.delete(t);
      if (!auto.fluxos?.ativo || !podeAgir()) return;
      const texto = regras.montarResposta(f, msg.nome);
      if (!texto) return;
      const r = await escreverNoChat(texto);
      if (r.ok) avisoNaTela(`Fluxo "${f.nome}" respondeu ${msg.nome || ""}`.trim(), "ok", 3000);
      void pedir({
        tipo: "fluxo_respondeu",
        dados: { fluxoId: f.id, nome: f.nome, gatilho: achou.gatilho, quem: msg.nome || null, pergunta: msg.texto, texto, ok: r.ok, motivo: r.motivo ?? null },
      });
    }, espera);
    esperasDeFluxo.add(t);
    return true;
  }

  function avisarPergunta(msg) {
    const chave = `${regras.normalizar(msg.nome)}|${regras.normalizar(msg.texto)}`;
    if (perguntasAvisadas.has(chave)) return;
    perguntasAvisadas.add(chave);
    avisoNaTela(`Pergunta sem resposta de ${msg.nome || "alguém"}: ${msg.texto.slice(0, 80)}`, "info", 6000);
    void pedir({ tipo: "pergunta_sem_resposta", dados: { nome: msg.nome || null, texto: msg.texto.slice(0, 200) } });
  }

  /** Uma mensagem nova no chat: moderação, depois fluxo, depois pergunta. */
  function tratarMensagemNova(msg) {
    const m = auto.moderacao ?? {};
    if (m.alertar || m.avisar) {
      const decisao = julgar(msg, m);
      if (decisao) {
        void agirNaModeracao(msg, decisao, m);
        // Quem mandou link já recebeu o aviso; responder o frete junto seria
        // premiar o spam.
        if (decisao.tipo === "aviso") return;
      }
    }
    if (!auto.fluxos?.ativo || ehDaLoja(msg)) return;
    if (tentarFluxo(msg)) return;
    // Com "Ler a tela" o manual ainda pode responder, e a lista de perguntas
    // do app já recebe o comentário por lá.
    if (auto.fluxos.perguntas !== false && !auto.lerTela && regras.parecePergunta(msg.texto)) avisarPergunta(msg);
  }

  function voltaDaModeracao() {
    const m = auto.moderacao ?? {};
    if (!(m.alertar || m.avisar || auto.fluxos?.ativo) || !podeAgir()) return;
    const msgs = [...mensagensDoPainel(), ...mensagensDoTikTok()];
    // Igual à Atividade: a mesma frase pode repetir e ser OUTRA mensagem.
    const contagem = new Map();
    for (const msg of msgs) {
      const chave = `${msg.nome}|${msg.texto}`;
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    }
    const tratados = new Set();
    for (const msg of msgs) {
      const chave = `${msg.nome}|${msg.texto}`;
      if (tratados.has(chave)) continue;
      tratados.add(chave);
      const agoraN = contagem.get(chave);
      const antesN = vistosChat.get(chave) ?? 0;
      vistosChat.set(chave, agoraN);
      // O que já estava no chat quando ligou não é novidade.
      if (!chatPronto || agoraN <= antesN) continue;
      tratarMensagemNova(msg);
    }
    chatPronto = true;
    if (vistosChat.size > 3000) vistosChat.clear();
  }

  function sincronizarModeracao() {
    const m = auto.moderacao ?? {};
    const ligado = (m.alertar || m.avisar || auto.fluxos?.ativo) && podeAgir();
    if (ligado && !lacoModeracao) {
      chatPronto = false;
      voltaDaModeracao();
      lacoModeracao = setInterval(voltaDaModeracao, 2000);
    }
    if (!ligado && lacoModeracao) {
      clearInterval(lacoModeracao);
      lacoModeracao = null;
    }
    // Nova live, nova chance: quem foi avisado ou respondido numa não fica
    // marcado na outra.
    if (!ciclo?.ativo) {
      avisados.clear();
      respondidosPorFluxo.clear();
      perguntasAvisadas.clear();
    }
    if (!ligado) {
      for (const t of esperasDeFluxo) clearTimeout(t);
      esperasDeFluxo.clear();
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

  /**
   * O cartão de métrica do painel da live: um rótulo ("Espectadores atuais")
   * e, logo ao lado, o valor. Mais firme que procurar número perto do texto.
   */
  function metricaDoCartao(rotulo, todas) {
    const label = todas.find((el) => rotulo.test((el.textContent || "").trim()));
    const valor = label?.nextElementSibling ?? null;
    const texto = (valor?.textContent || "").replace(/\s+/g, " ").trim();
    return texto && texto.length < 24 ? texto : null;
  }

  function lerMetricas() {
    const todas = folhas();
    const viewers =
      textoDe(document.querySelector('[data-e2e="person-count"]')) ||
      metricaDoCartao(/^(espectadores atuais|espectadores|current viewers|viewers|espectadores actuales)$/i, todas) ||
      valorPerto(/espectadores|viewers/i, /^\d[\d.,]*[kKmM]?$/, todas);
    const vendasEl = [...document.querySelectorAll('div[style*="line-clamp"]')].find(
      (el) => el.children.length === 0 && /^\d+$/.test((el.textContent || "").trim()),
    );
    const vendas =
      metricaDoCartao(/^(itens atribu[íi]dos vendidos|itens vendidos|items sold|attributed items sold|art[íi]culos vendidos)$/i, todas) ??
      (vendasEl ? vendasEl.textContent.trim() : null);
    const gmv =
      metricaDoCartao(/^(gmv atribu[íi]do|attributed gmv|gmv)$/i, todas) ?? valorPerto(/gmv/i, /R\$[\s\d.,]+/, todas);

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
      avisoNaTela(`+${nova - antes} venda(s)!`, "ok");
    } else if (novaVendaAtividade) {
      caixaRegistradora();
      avisoNaTela(`Nova venda!${ultimoValor ? ` ${ultimoValor}` : ""}`, "ok");
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
      // Um fluxo casou? Ele responde (pelo leitor do chat); o manual cala.
      // Ninguém recebe duas respostas para o mesmo comentário.
      if (auto.fluxos?.ativo && regras.fluxoQueCasa(fluxosDoApp.lista ?? [], lido.texto)) continue;
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
    if (suspenso || morto) return;
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

  /**
   * "Testar antes da live": o que esta aba consegue fazer, sem publicar nada.
   * O envio é ensaiado (digita e apaga), nunca enviado.
   */
  async function diagnosticar() {
    const live = verificarLiveAtiva();
    // Na fila de escrita: ensaiar com outra mensagem saindo apagaria a dela.
    const vez = filaDeEscrita.then(ensaiarEnvio);
    filaDeEscrita = vez.catch(() => {});
    const ensaio = await vez.catch(() => ({ campo: false }));
    const fixar = [...document.querySelectorAll("button")].filter((b) => {
      const t = textoDe(b).toLowerCase();
      return ehFixar(t) || ehDesafixar(t);
    }).length;
    return {
      pagina: ehPaginaDaLive(),
      endereco: location.host + location.pathname.slice(0, 60),
      live: live.liveAtiva,
      motivoLive: live.motivo,
      campo: Boolean(ensaio.campo),
      // O campo aceitou o texto. Botão de enviar é opcional: no painel de
      // produtos não existe, e a mensagem sai pelo Enter.
      digita: Boolean(ensaio.campo && ensaio.tecnica),
      botao: ensaio.botao ?? null,
      fixar,
      mensagens: mensagensDoPainel().length + mensagensDoTikTok().length,
      souAlvo: souAlvo(),
    };
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
    sincronizarCarrinho();
    sincronizarModeracao();
    if (morto) return;
    if (auto.fixar && podeAgir() && !lacoFixar) agendarFixar(true);
    if ((!auto.fixar || !podeAgir()) && lacoFixar) {
      clearTimeout(lacoFixar);
      lacoFixar = null;
    }
    void voltaDaLeitura();
  }

  chrome.storage.onChanged.addListener((mudancas, area) => {
    if (area !== "local" || morto) return;
    if (mudancas[CH.auto]) auto = mudancas[CH.auto].newValue ?? {};
    if (mudancas[CH.ciclo]) ciclo = mudancas[CH.ciclo].newValue ?? {};
    if (mudancas[CH.abaAlvo]) alvo = mudancas[CH.abaAlvo].newValue ?? null;
    if (mudancas[CH.fluxos]) fluxosDoApp = mudancas[CH.fluxos].newValue ?? { lista: [] };
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
        avisoNaTela("Violação detectada!", "err", 6000);
        return;
      case "ciclo_on":
        avisoNaTela("Shopia ligada — monitorando a live", "ok");
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
        if (mensagem.texto && podeAgir() && auto.comentarios?.ativo) {
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
      case "diagnostico":
        void diagnosticar().then(responder);
        return true;
      case "ensaiar_envio":
        void ensaiarEnvio().then(responder);
        return true;
      default:
        return;
    }
  });

  // --- partida ---
  const inicial = await chrome.storage.local.get([CH.auto, CH.ciclo, CH.abaAlvo, CH.fluxos, "shopia_ancoras_locais"]);
  fluxosDoApp = inicial[CH.fluxos] ?? { lista: [] };
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

  const lacoLeitura = setInterval(() => void voltaDaLeitura(), 5000);
  const lacoDespejo = setInterval(() => void despejar(), 10000);

  /** Desmonta tudo desta aba: timers, observador e o que foi posto na tela. */
  function desmontar() {
    if (morto) return;
    morto = true;
    for (const t of [lacoBarra, lacoLeitura, lacoDespejo, lacoBloqueio, lacoMetricas, lacoCarrinho, lacoModeracao, pilulaTimer, lacoVida]) {
      clearInterval(t);
    }
    clearTimeout(lacoFixar);
    clearTimeout(lacoComentar);
    for (const t of esperasDeFluxo) clearTimeout(t);
    observador?.disconnect();
    for (const id of ["shopia-sb", "shopia-pop", "shopia-hud", "shopia-estilo"]) {
      document.getElementById(id)?.remove();
    }
    pilula?.remove();
    avisoAprender?.remove();
  }

  // A cada 2 s: a extensão ainda existe? Se não, para tudo nesta aba.
  const lacoVida = setInterval(() => {
    if (!extensaoViva()) desmontar();
  }, 2000);
})();
