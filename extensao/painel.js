// Painel lateral da Shopia — no formato da LiveFox.
//
// O painel é TELA: quem guarda o estado do ciclo é o service worker (que
// sobrevive ao painel fechado) e quem age na live é o content script da aba
// escolhida. Fechar o painel não desliga nada; reabrir só repinta.

import * as api from "./api.js";

const $ = (id) => document.getElementById(id);
const enviar = (mensagem) => chrome.runtime.sendMessage(mensagem).catch(() => null);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const hms = (ms) => {
  if (ms == null) return "--:--:--";
  const s = Math.max(0, Math.round(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const minhaVersao = chrome.runtime.getManifest().version;

let ciclo = {};
let restanteMs = null;
let restanteEm = Date.now();
let cfg = {};
let auto = {};
let licenca = {};

// ===========================================================================
// AVISO FLUTUANTE
// ===========================================================================

function toast(texto) {
  let t = $("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.hidden = true), 4000);
}

// ===========================================================================
// LOG
// ===========================================================================

function linhaDeLog({ hora, texto, nivel }) {
  const box = $("logBox");
  const el = document.createElement("div");
  el.className = `le ${nivel ?? ""}`;
  el.textContent = `[${hora}] ${texto}`;
  box.appendChild(el);
  while (box.children.length > 150) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

async function carregarLog() {
  $("logBox").innerHTML = "";
  linhaDeLog({ hora: new Date().toLocaleTimeString("pt-BR"), texto: `[SHOPIA] v${minhaVersao} — Pronto para usar.`, nivel: "inf" });
  const r = await chrome.storage.session.get("shopia_log").catch(() => ({}));
  for (const l of r?.shopia_log ?? []) linhaDeLog(l);
}

// ===========================================================================
// TELA DE ACESSO (entrar / sem plano)
// ===========================================================================

function telaAcesso(qual, info = {}) {
  const tela = $("telaAcesso");
  if (!qual) {
    tela.hidden = true;
    return;
  }
  tela.hidden = false;
  $("acessoEntrar").hidden = qual !== "entrar";
  $("acessoPlano").hidden = qual !== "plano";
  if (qual === "plano") {
    $("acessoPlanoMsg").textContent = info.nuncaAssinou
      ? "Você ainda não tem um plano ativo."
      : info.status === "expirada" || info.motivo === "expirada"
        ? "Seu plano venceu."
        : info.texto || "Assine para usar a Shopia.";
    $("acessoPlanoInfo").textContent = info.nome ? `Plano: ${info.nome}` : "";
    $("acessoAssinar").textContent = info.nuncaAssinou ? "Assinar plano" : "Renovar plano";
  }
}

/** Decide se o painel abre, pede login ou pede plano. */
async function conferirAcesso() {
  const token = await api.token();
  if (!token) return telaAcesso("entrar"), false;

  const r = await enviar({ tipo: "bater" });
  licenca = r?.estado ?? {};
  pintarServidor();

  if (["sem_token", "token_invalido", "revogada"].includes(licenca.motivo)) {
    if (licenca.motivo === "revogada") $("acessoErr").textContent = "Esta conta entrou em outro dispositivo. Entre de novo.";
    return telaAcesso("entrar"), false;
  }
  if (licenca.motivo === "expirada") return telaAcesso("plano", { motivo: "expirada" }), false;

  // Offline não tranca: quem já estava no ar continua.
  if (licenca.motivo === "offline") return telaAcesso(null), true;

  try {
    const c = await api.conta();
    if (!c.plano?.ativo) return telaAcesso("plano", c.plano ?? {}), false;
  } catch (erro) {
    if (erro.codigo === "token_invalido") return telaAcesso("entrar"), false;
  }
  telaAcesso(null);
  checarVersao();
  return true;
}

async function fazerLogin() {
  const login = $("acessoLogin").value.trim();
  const senha = $("acessoSenha").value;
  $("acessoErr").textContent = "";
  $("acessoOk").textContent = "";
  if (!login || !senha) return void ($("acessoErr").textContent = "Preencha e-mail e senha.");
  const btn = $("acessoBtn");
  btn.disabled = true;
  btn.textContent = "Entrando…";
  const r = await enviar({ tipo: "entrar", login, senha });
  btn.disabled = false;
  btn.textContent = "Entrar";
  if (!r?.ok) return void ($("acessoErr").textContent = r?.erro || "Falha no login.");
  $("acessoSenha").value = "";
  $("acessoOk").textContent = `Bem-vindo${r.usuario?.nome ? `, ${r.usuario.nome.split(" ")[0]}` : ""}!`;
  await conferirAcesso();
}

// ===========================================================================
// PINTURA DO CICLO
// ===========================================================================

function restanteAgora() {
  if (restanteMs == null) return null;
  if (ciclo.pausadoRestanteMs != null || !ciclo.ativo) return restanteMs;
  return Math.max(0, restanteMs - (Date.now() - restanteEm));
}

function pintarServidor() {
  const el = $("lsServidor");
  if (licenca.licenciada && licenca.motivo !== "offline") {
    el.textContent = "Conectado";
    el.className = "ls-val pequeno on";
  } else if (licenca.motivo === "offline") {
    el.textContent = "Offline";
    el.className = "ls-val pequeno warn";
  } else {
    el.textContent = "—";
    el.className = "ls-val pequeno";
  }
}

function badge(id, texto, classe) {
  const el = $(id);
  el.textContent = texto;
  el.className = `cbadge ${classe}`;
}

function pintarCiclo() {
  const ativo = Boolean(ciclo.ativo);
  const pausado = ciclo.pausadoRestanteMs != null;

  $("sbadge").classList.toggle("on", ativo);
  $("stxt").textContent = ativo ? "ATIVO" : "INATIVO";
  $("bStatus").textContent = ativo ? "ATIVO" : "INATIVO";
  $("bStatus").classList.toggle("on", ativo);

  const btn = $("btnCiclo");
  btn.className = `btn-main ${ativo ? "btn-stop" : "btn-start"}`;
  btn.innerHTML = ativo ? "⏹ &nbsp;Desligar a extensão" : "🟢 &nbsp;Ligar a extensão";

  $("lsAba").textContent = ativo ? (ciclo.abaConectada ? "Conectada" : "Procurando…") : "—";
  $("lsAba").className = `ls-val ${ativo && ciclo.abaConectada ? "on" : ""}`;
  $("lsLive").textContent = ativo ? (ciclo.liveAtiva ? "Detectada" : "Não detectada") : "—";
  $("lsLive").className = `ls-val ${ativo && ciclo.liveAtiva ? "on" : ativo ? "warn" : ""}`;
  $("lsAcao").textContent = ativo ? (ciclo.violacao?.ativa ? "Violação!" : pausado ? "Timer pausado" : ciclo.acao || "Monitorando") : "—";
  $("lsAcao").className = `ls-val ${ativo ? (ciclo.violacao?.ativa ? "warn" : "blue") : ""}`;

  $("cardScans").textContent = ciclo.scanN ?? 0;
  $("bScan").textContent = `Scan: ${ciclo.scanN ?? 0}`;
  $("cardAlertas").textContent = ciclo.alertas ?? 0;
  $("cardAlertas").classList.toggle("warn", (ciclo.alertas ?? 0) > 0);

  const pausa = $("btnPausarTimer");
  pausa.classList.toggle("pausado", pausado);
  pausa.innerHTML = pausado ? "▶ &nbsp;Retomar Timer" : "⏸ &nbsp;Pausar Timer";
  pausa.disabled = !ativo;
  $("btnCancelarTimer").disabled = !ativo;

  badge("bTimer", ativo ? (pausado ? "Pausado" : "Ativo") : "Inativo", ativo ? (pausado ? "bwarn" : "bon") : "boff");
  $("timerIniciado").textContent = ativo && ciclo.inicio ? new Date(ciclo.inicio).toLocaleTimeString("pt-BR") : "—";

  if (ciclo.violacao?.ativa) badge("bProt", "ALERTA!", "bwarn");
  else badge("bProt", ativo ? "Ligado" : "Desligado", ativo ? "bon" : "boff");

  const vio = ciclo.violacao ?? {};
  $("violacaoStatus").hidden = !(ativo && vio.ativa && vio.fimEm);
  pintarRelogios();
}

function pintarRelogios() {
  const resta = ciclo.ativo ? restanteAgora() : null;
  const txt = hms(resta);
  $("timerDisplay").textContent = ciclo.ativo ? txt : hms((Number(cfg.duracaoMinutos) || 60) * 60000);
  $("cardTimer").textContent = txt;
  const perigo = resta != null && resta < 600000;
  $("timerDisplay").classList.toggle("danger", ciclo.ativo && perigo);
  $("cardTimer").classList.toggle("warn", ciclo.ativo && perigo);
  if (ciclo.violacao?.ativa && ciclo.violacao.fimEm) {
    $("violacaoCountdown").textContent = hms(ciclo.violacao.fimEm - Date.now());
  }
  const agora = new Date();
  $("bRelogio").textContent = agora.toLocaleTimeString("pt-BR");
}

function pintarCfg() {
  $("duracaoMinutos").value = cfg.duracaoMinutos ?? 60;
  $("threshold").value = cfg.threshold ?? 50;
  $("intervalo").value = cfg.intervalo ?? 8;
  $("minutosViolacao").value = cfg.minutosViolacao ?? 20;
  const continuar = cfg.modoViolacao === "continuar";
  $("vbtnEncerrar").classList.toggle("active", !continuar);
  $("vbtnContinuar").classList.toggle("active", continuar);
  $("violacaoOpcoes").hidden = !continuar;
  document.querySelectorAll("[data-dur]").forEach((b) => b.classList.toggle("active", Number(b.dataset.dur) === Number(cfg.duracaoMinutos)));
  document.querySelectorAll("[data-vmin]").forEach((b) => b.classList.toggle("active", Number(b.dataset.vmin) === Number(cfg.minutosViolacao)));
  if (!ciclo.ativo) pintarRelogios();
}

function interruptor(id, ligado, rotuloId) {
  const t = $(id);
  t.classList.toggle("on", Boolean(ligado));
  t.setAttribute("aria-pressed", String(Boolean(ligado)));
  if (rotuloId) $(rotuloId).textContent = ligado ? "ON" : "OFF";
}

function pintarAuto() {
  interruptor("togFixar", auto.fixar, "togFixarLbl");
  interruptor("togCupom", auto.cupom, "togCupomLbl");
  interruptor("togSom", auto.som);
  interruptor("togBloqueio", auto.bloqueio?.ativo);

  const c = auto.comentarios ?? {};
  if (document.activeElement !== $("listaComentarios")) $("listaComentarios").value = (c.mensagens ?? []).join("\n");
  $("comentarioMin").value = c.min ?? 30;
  $("comentarioMax").value = c.max ?? 90;
  $("comentarioMinVal").textContent = `${c.min ?? 30}s`;
  $("comentarioMaxVal").textContent = `${c.max ?? 90}s`;
  badge("bComentarios", c.ativo ? "Ativo" : "Inativo", c.ativo ? "bon" : "boff");
  if (!c.ativo) $("comentarioContagem").hidden = true;

  const b = auto.bloqueio ?? {};
  if (document.activeElement !== $("palavrasBloqueio")) $("palavrasBloqueio").value = (b.palavras ?? []).join("\n");
  badge("bBloqueio", b.ativo ? "Ativo" : "Inativo", b.ativo ? "bon" : "boff");
  $("bloqueioStatus").hidden = !b.ativo;
  $("bloqueadosBox").hidden = !b.ativo && !$("bloqueadosLista").dataset.tem;

  pintarIaLerTela();
}

function pintarBloqueados(lista) {
  const box = $("bloqueadosLista");
  $("bloqueadosN").textContent = lista.length;
  if (!lista.length) {
    box.innerHTML = '<span class="vazio">Nenhum bloqueio ainda...</span>';
    delete box.dataset.tem;
    return;
  }
  box.dataset.tem = "1";
  box.innerHTML = lista
    .slice()
    .reverse()
    .map((b) => `<div>🚫 <b>${esc(b.usuario)}</b> · "${esc(b.palavra)}" · ${esc(b.hora)}</div>`)
    .join("");
  $("bloqueadosBox").hidden = false;
}

function pintarHistorico(hist) {
  const box = $("historico");
  if (!hist?.length) {
    box.innerHTML = '<div class="vazio-centro">Nenhuma sessão ainda</div>';
    return;
  }
  box.innerHTML = hist
    .slice(0, 10)
    .map(
      (h) => `<div class="hitem">
        <div class="htop"><span class="hdate">${esc(h.data)} · ${esc(h.inicio)} → ${esc(h.fim)}</span><span class="hdur">${esc(h.horas)}h</span></div>
        <div class="hmeta">${esc(h.minutos)} min · ${esc(h.scans)} scans · ${esc(h.alertas)} alertas · 👀 ${esc(h.viewers)} · 🛒 ${esc(h.vendas)}</div>
      </div>`,
    )
    .join("");
}

async function recarregarTudo() {
  const r = await enviar({ tipo: "ciclo_estado" });
  if (r?.ok) {
    ciclo = r.ciclo;
    cfg = r.cfg;
    auto = r.auto;
    restanteMs = r.restanteMs;
    restanteEm = Date.now();
  }
  pintarCfg();
  pintarCiclo();
  pintarAuto();
  const local = await chrome.storage.local.get([api.CHAVES.historico, api.CHAVES.bloqueados]);
  pintarHistorico(local[api.CHAVES.historico] ?? []);
  pintarBloqueados(local[api.CHAVES.bloqueados] ?? []);
}

// ===========================================================================
// AÇÕES
// ===========================================================================

async function salvarCfg(parcial) {
  const r = await enviar({ tipo: "cfg", cfg: parcial });
  if (r?.cfg) cfg = r.cfg;
  pintarCfg();
}

async function salvarAuto(parcial) {
  const r = await enviar({ tipo: "auto", auto: parcial });
  if (r?.auto) auto = r.auto;
  pintarAuto();
  return auto;
}

const linhas = (texto) =>
  texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

async function haAbaDoTikTok() {
  const abas = await chrome.tabs.query({ url: "*://*.tiktok.com/*" }).catch(() => []);
  return abas.length > 0;
}

async function alternarCiclo() {
  const btn = $("btnCiclo");
  btn.disabled = true;
  try {
    if (ciclo.ativo) {
      await enviar({ tipo: "ciclo_parar" });
      return;
    }
    if (!(await haAbaDoTikTok())) {
      toast("Abra a página da sua live no TikTok neste Chrome — a extensão lê a tela dela.");
    }
    await enviar({
      tipo: "ciclo_iniciar",
      cfg: {
        duracaoMinutos: Math.min(Math.max(Number($("duracaoMinutos").value) || 60, 1), 1440),
        threshold: Number($("threshold").value) || 50,
        intervalo: Math.max(Number($("intervalo").value) || 8, 8),
        minutosViolacao: Number($("minutosViolacao").value) || 20,
      },
    });
  } finally {
    btn.disabled = false;
    await recarregarTudo();
  }
}

function tocarConfirmacao() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    [[1318, 0, 0.15], [1047, 0.18, 0.15], [1318, 0.36, 0.25]].forEach(([f, d, dur]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.value = 0.3;
      o.connect(g).connect(ctx.destination);
      o.start(t + d);
      o.stop(t + d + dur);
    });
  } catch { /* sem áudio */ }
}

let contagemComentario = null;
function mostrarContagemComentario(emMs) {
  clearInterval(contagemComentario);
  const fim = Date.now() + emMs;
  $("comentarioContagem").hidden = false;
  const barra = $("comentarioBarra");
  const pintar = () => {
    const resta = Math.max(0, fim - Date.now());
    $("comentarioContagemTxt").textContent = `Próximo comentário em ${Math.ceil(resta / 1000)}s`;
    barra.style.width = `${emMs ? (resta / emMs) * 100 : 0}%`;
    if (resta <= 0) clearInterval(contagemComentario);
  };
  pintar();
  contagemComentario = setInterval(pintar, 1000);
}

// ===========================================================================
// OVERLAY "IA de vendas"
// ===========================================================================

let iaAba = "config";
let lidos = 0;
let ultimoLido = "";

function iaMsg(texto, ruim = false) {
  const m = $("ia-msg");
  m.textContent = texto || "";
  m.classList.toggle("ruim", ruim);
}

function abrirIa() {
  $("iaPainel").hidden = false;
  void iaMostrar(iaAba);
}

async function iaMostrar(nome) {
  iaAba = nome;
  document.querySelectorAll("[data-iaaba]").forEach((b) => b.classList.toggle("active", b.dataset.iaaba === nome));
  for (const t of ["config", "contas", "planos"]) $(`ia-${t}`).hidden = t !== nome;
  iaMsg("");
  let dados;
  try {
    dados = await api.conta();
  } catch (erro) {
    return iaMsg(erro.codigo === "rede" ? "Sem conexão com o servidor." : `Não carregou: ${erro.message}`, true);
  }
  if (nome === "config") pintarIaConfig(dados);
  if (nome === "contas") pintarIaContas(dados);
  if (nome === "planos") pintarIaPlanos(dados);
}

const numero = (x) => Number(x || 0).toLocaleString("pt-BR");
const reais = (c) => (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function pintarIaConfig(d) {
  const ativo = Boolean(d.plano?.ativo);
  const saldo = Number(d.creditos?.saldo || 0);
  const cota = Number(d.creditos?.cotaMes || 0);
  const pct = cota > 0 ? Math.min(100, Math.round((saldo / cota) * 100)) : saldo > 0 ? 100 : 0;
  $("ia-config").innerHTML = `
    <div class="slabel">Sua conta</div>
    <div class="card open"><div class="cb">
      <div class="frow"><span class="fdesc">Plano</span>
        <b style="color:${ativo ? "var(--ok)" : "var(--red)"}">${ativo ? esc(d.plano.nome || "ativo") : "sem plano ativo"}</b></div>
      ${ativo && d.plano.diasRestantes != null ? `<div class="frow"><span class="fdesc">Dias restantes</span><b>${d.plano.diasRestantes}</b></div>` : ""}
      <div class="frow"><span class="fdesc">⚡ Créditos de IA</span><b style="color:var(--primary)">${numero(saldo)}</b></div>
      <div class="medidor"><div style="width:${pct}%"></div></div>
      <div class="fdesc">${cota ? `${numero(saldo)} de ${numero(cota)} do mês` : `${numero(saldo)} caracteres`} · gasta só quando a IA gera algo novo</div>
      ${ativo
        ? '<button class="btn bghost" id="ia-comprar">➕ Comprar créditos / gerenciar plano</button>'
        : '<button class="btn bgreen" id="ia-assinar">Assinar / Renovar no app</button>'}
    </div></div>

    <div class="slabel">Ler comentários da live</div>
    <div class="card open"><div class="cb">
      <div class="fdesc">
        A extensão <b>lê os comentários</b> da sua live e manda pro servidor.
        <b>Quem escolhe a resposta é o servidor</b>, a partir do <b>manual</b> que você cadastrou no app — e ela sai escrita no chat.
        <br><br>1️⃣ No <b>app</b>, monte o manual e aceite o aviso de automação.
        <br>2️⃣ Aqui, clique <b>“Ler a tela”</b>.
        <br>3️⃣ Deixe a <b>aba da live aberta</b> — é dela que a extensão lê o chat.
      </div>
      <button class="btn-main btn-start" id="ia-ler">📖 Ler a tela</button>
      <div class="fdesc" id="ia-ler-status"></div>
      <button class="btn bghost" id="ia-abrir-app">⚙️ Configurar minha live no app</button>
    </div></div>`;
  $("ia-assinar")?.addEventListener("click", () => api.abrirNoSite("/planos"));
  $("ia-comprar")?.addEventListener("click", () => api.abrirNoSite("/creditos"));
  $("ia-abrir-app").addEventListener("click", () => api.abrirNoSite("/manual"));
  $("ia-ler").addEventListener("click", async () => {
    const ligar = !auto.lerTela;
    if (ligar && !licenca.recursos?.chat) {
      toast("O seu plano não libera respostas no chat, ou elas estão pausadas pelo servidor.");
    }
    await salvarAuto({ lerTela: ligar });
    if (ligar && !(await haAbaDoTikTok())) toast("Abra a página da sua live no TikTok neste Chrome.");
  });
  pintarIaLerTela();
}

const ESTADO_CHAT = {
  lendo: "🟢 Lendo o chat da live",
  procurando: "Procurando o chat na página…",
  sem_chat: "⚠️ Não achei o chat nesta página. Abra a página da live.",
  fora_da_live: "Abra a página da sua live no TikTok.",
  desligado: "Desligado — clique pra começar a ler os comentários.",
  suspenso: "⛔ Pausado pelo servidor.",
};
let estadoChat = null;

function pintarIaLerTela() {
  const btn = $("ia-ler");
  if (!btn) return;
  btn.innerHTML = auto.lerTela ? "⏹️ Parar leitura" : "📖 Ler a tela";
  btn.className = `btn-main ${auto.lerTela ? "btn-stop" : "btn-start"}`;
  const st = $("ia-ler-status");
  if (!auto.lerTela) st.textContent = ESTADO_CHAT.desligado;
  else if (lidos) st.textContent = `👂 ${lidos} lidos${ultimoLido ? ` · última resposta: ${ultimoLido}` : ""}`;
  else st.textContent = ESTADO_CHAT[estadoChat] ?? "Ligando…";
}

function pintarIaContas(d) {
  const contas = d.contas ?? [];
  const limite = d.limiteContas ?? 1;
  $("ia-contas").innerHTML = `
    <div class="slabel">Contas TikTok (${contas.length}/${limite})</div>
    <div class="card open"><div class="cb">
      ${contas.map((c) => `<div class="frow"><span class="fdesc">@${esc(c.usuario)}</span><button class="btn bdanger" data-remover="${esc(c.id)}" style="flex:unset;padding:4px 10px">Remover</button></div>`).join("") ||
        '<div class="fdesc">Nenhuma conta ainda.</div>'}
      ${contas.length < limite
        ? '<div class="brow"><input type="text" id="ia-nova-conta" placeholder="@suaconta" style="flex:1"><button class="btn bgreen" id="ia-add-conta" style="flex:unset;padding:6px 12px">Adicionar</button></div>'
        : '<div class="fdesc" style="color:var(--warn)">Limite do plano atingido. Faça upgrade pra adicionar mais contas.</div>'}
    </div></div>`;
  $("ia-add-conta")?.addEventListener("click", async () => {
    try {
      pintarIaContas(await api.alterarConta({ acao: "adicionar", usuario: $("ia-nova-conta").value }));
      iaMsg("Conta adicionada.");
    } catch (erro) {
      iaMsg(`Erro: ${erro.message}`, true);
    }
  });
  $("ia-contas").querySelectorAll("[data-remover]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        pintarIaContas(await api.alterarConta({ acao: "remover", id: b.dataset.remover }));
      } catch (erro) {
        iaMsg(`Erro: ${erro.message}`, true);
      }
    }),
  );
}

const PERIODO = { 1: "mês", 3: "trimestre", 12: "ano" };

function pintarIaPlanos(d) {
  $("ia-planos").innerHTML =
    `<div class="slabel">Escolha seu plano</div>
     <div class="fdesc">O pagamento abre no app, já logado. A liberação é automática.</div>` +
    (d.planos ?? [])
      .map(
        (p) => `<div class="card open"><div class="cb">
          <div class="plano-nome">${esc(p.nome)}</div>
          <div class="plano-preco">${reais(p.precoCentavos)} <small>/ ${PERIODO[p.meses] ?? `${p.meses} meses`}</small></div>
          ${p.meses > 1 ? `<div class="fdesc">${reais(p.precoMensalCentavos)} por mês</div>` : ""}
          <div class="recurso">📱 ${p.contasTiktok} conta(s) TikTok</div>
          ${(p.recursos ?? []).map((r) => `<div class="recurso">✓ ${esc(r)}</div>`).join("")}
          <button class="btn bgreen" data-assinar="${esc(p.slug)}">Assinar no app →</button>
        </div></div>`,
      )
      .join("");
  $("ia-planos").querySelectorAll("[data-assinar]").forEach((b) =>
    b.addEventListener("click", () => api.abrirNoSite(`/planos?plano=${encodeURIComponent(b.dataset.assinar)}`)),
  );
}

// ===========================================================================
// NOVA VERSÃO
// ===========================================================================

let versaoDispensada = "";
function vcmp(a, b) {
  const pa = String(a || "0").split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b || "0").split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

function checarVersao() {
  const v = licenca.versaoPublicada;
  if (!v || vcmp(v, minhaVersao) <= 0 || versaoDispensada === v || $("atualizacao")) return;
  const ov = document.createElement("div");
  ov.id = "atualizacao";
  ov.innerHTML = `<div class="at-fundo"></div><div class="at-card">
    <div class="at-ic">🆕</div>
    <div class="at-h">Nova versão disponível</div>
    <div class="at-v">v${esc(v)}</div>
    ${licenca.notas ? `<div class="at-n">${esc(licenca.notas)}</div>` : ""}
    <a class="at-btn" href="#" id="atBaixar">⬇️ Baixar a nova versão</a>
    <details class="at-ajuda"><summary>Como instalar</summary><ol>
      <li>Baixe e <b>extraia</b> o ZIP.</li>
      <li>Copie o conteúdo da pasta <b>shopia-extensao</b> por cima da pasta de sempre (a que o Chrome já usa).</li>
      <li>Abra <b>chrome://extensions</b> e clique em <b>↻</b> na Shopia.</li>
      <li>Pronto — você continua conectada, sem entrar de novo.</li>
    </ol></details>
    ${licenca.atualizacaoObrigatoria ? "" : '<button class="at-x" id="atX">Agora não</button>'}
  </div>`;
  document.body.appendChild(ov);
  $("atBaixar").addEventListener("click", (e) => {
    e.preventDefault();
    api.abrirNoSite("/extensao");
  });
  $("atX")?.addEventListener("click", () => {
    versaoDispensada = v;
    ov.remove();
  });
}

// ===========================================================================
// LIGAÇÕES
// ===========================================================================

function ligarEventos() {
  // Acesso
  $("acessoBtn").addEventListener("click", fazerLogin);
  $("acessoSenha").addEventListener("keydown", (e) => e.key === "Enter" && fazerLogin());
  $("acessoLogin").addEventListener("keydown", (e) => e.key === "Enter" && $("acessoSenha").focus());
  $("acessoCadastro").addEventListener("click", (e) => (e.preventDefault(), api.abrirNoSite("/cadastro")));
  $("acessoAssinar").addEventListener("click", () => api.abrirNoSite("/planos"));
  $("acessoRechecar").addEventListener("click", (e) => (e.preventDefault(), conferirAcesso()));
  $("acessoSair").addEventListener("click", async (e) => {
    e.preventDefault();
    await enviar({ tipo: "sair" });
    telaAcesso("entrar");
  });

  // Abas
  document.querySelectorAll("[data-aba]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-aba]").forEach((x) => x.classList.toggle("active", x === b));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === `pane-${b.dataset.aba}`));
      try { localStorage.setItem("shopia_aba", b.dataset.aba); } catch { /* sem storage */ }
    }),
  );

  // Cards recolhíveis (clique no cabeçalho, fora dos botões)
  document.querySelectorAll(".card > .ch").forEach((ch) =>
    ch.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      ch.parentElement.classList.toggle("open");
    }),
  );

  // Cabeçalho
  $("btnIA").addEventListener("click", abrirIa);
  $("iaFechar").addEventListener("click", () => ($("iaPainel").hidden = true));
  document.querySelectorAll("[data-iaaba]").forEach((b) => b.addEventListener("click", () => iaMostrar(b.dataset.iaaba)));
  $("btnReset").addEventListener("click", async () => {
    if (!confirm("Resetar todas as configurações para o padrão? A extensão será desligada.")) return;
    await enviar({ tipo: "reset" });
    await recarregarTudo();
    toast("Configurações resetadas.");
  });
  $("btnPowerLive").addEventListener("click", async () => {
    if (!confirm("Encerrar a LIVE agora?")) return;
    await enviar({ tipo: "encerrar_live", motivo: "botão ⏻ do painel" });
    await recarregarTudo();
  });

  // Ciclo e timer
  $("btnCiclo").addEventListener("click", alternarCiclo);
  document.querySelectorAll("[data-dur]").forEach((b) =>
    b.addEventListener("click", () => salvarCfg({ duracaoMinutos: Number(b.dataset.dur) })),
  );
  $("duracaoMinutos").addEventListener("change", (e) =>
    salvarCfg({ duracaoMinutos: Math.min(Math.max(Number(e.target.value) || 60, 1), 1440) }),
  );
  $("btnPausarTimer").addEventListener("click", async () => {
    await enviar({ tipo: ciclo.pausadoRestanteMs != null ? "timer_retomar" : "timer_pausar" });
    await recarregarTudo();
  });
  $("btnCancelarTimer").addEventListener("click", async () => {
    await enviar({ tipo: "ciclo_parar", motivo: "timer cancelado" });
    await recarregarTudo();
  });

  // Fixar e cupom
  $("btnFixar").addEventListener("click", async () => {
    const r = await enviar({ tipo: "fixar_agora" });
    if (!r?.r) toast("Abra a página da sua live no TikTok para fixar.");
  });
  $("togFixar").addEventListener("click", () => salvarAuto({ fixar: !auto.fixar }));
  $("togCupom").addEventListener("click", () => salvarAuto({ cupom: !auto.cupom }));

  // Violação
  $("vbtnEncerrar").addEventListener("click", () => salvarCfg({ modoViolacao: "encerrar" }));
  $("vbtnContinuar").addEventListener("click", () => salvarCfg({ modoViolacao: "continuar" }));
  document.querySelectorAll("[data-vmin]").forEach((b) =>
    b.addEventListener("click", () => salvarCfg({ minutosViolacao: Number(b.dataset.vmin) })),
  );
  $("minutosViolacao").addEventListener("change", (e) =>
    salvarCfg({ minutosViolacao: Math.min(Math.max(Number(e.target.value) || 20, 1), 999) }),
  );
  $("btnEncerrarViolacao").addEventListener("click", () => enviar({ tipo: "encerrar_live", motivo: "violação — encerrada no painel" }));

  // Comentários automáticos
  const salvarComentarios = (extra = {}) =>
    salvarAuto({
      comentarios: {
        mensagens: linhas($("listaComentarios").value).map((l) => l.slice(0, 150)).slice(0, 100),
        min: Number($("comentarioMin").value),
        max: Math.max(Number($("comentarioMax").value), Number($("comentarioMin").value)),
        ...extra,
      },
    });
  $("listaComentarios").addEventListener("change", () => salvarComentarios());
  for (const id of ["comentarioMin", "comentarioMax"]) {
    $(id).addEventListener("input", (e) => ($(`${id}Val`).textContent = `${e.target.value}s`));
    $(id).addEventListener("change", () => salvarComentarios());
  }
  $("btnComentarIniciar").addEventListener("click", async () => {
    if (!linhas($("listaComentarios").value).length) return toast("Escreva ao menos uma mensagem (uma por linha).");
    await salvarComentarios({ ativo: true });
    $("comentarioLog").textContent = "▶ Iniciado — o primeiro sai agora.";
    if (!(await haAbaDoTikTok())) toast("Abra a página da sua live no TikTok neste Chrome.");
  });
  $("btnComentarParar").addEventListener("click", async () => {
    await salvarComentarios({ ativo: false });
    clearInterval(contagemComentario);
    $("comentarioLog").textContent = "■ Parado.";
  });

  // Bloqueio por nome
  $("palavrasBloqueio").addEventListener("change", () =>
    salvarAuto({ bloqueio: { palavras: linhas($("palavrasBloqueio").value).slice(0, 200) } }),
  );
  $("togBloqueio").addEventListener("click", async () => {
    const palavras = linhas($("palavrasBloqueio").value).slice(0, 200);
    if (!auto.bloqueio?.ativo && !palavras.length) return toast("Escreva ao menos uma palavra (uma por linha).");
    await salvarAuto({ bloqueio: { ativo: !auto.bloqueio?.ativo, palavras } });
  });
  $("btnBaixarBloqueados").addEventListener("click", async () => {
    const lista = (await api.lerLocal(api.CHAVES.bloqueados)) ?? [];
    const texto = lista.map((b) => `${b.hora}\t${b.usuario}\t${b.palavra}`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([texto], { type: "text/plain" }));
    const d = new Date();
    a.download = `bloqueados_${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}.txt`;
    a.click();
  });

  // Log
  $("btnLimparLog").addEventListener("click", async () => {
    await chrome.storage.session.remove("shopia_log").catch(() => {});
    await carregarLog();
  });

  // Central
  $("threshold").addEventListener("change", (e) => salvarCfg({ threshold: Math.min(Math.max(Number(e.target.value) || 50, 1), 999) }));
  $("intervalo").addEventListener("change", (e) => salvarCfg({ intervalo: Math.min(Math.max(Number(e.target.value) || 8, 8), 60) }));
  $("togSom").addEventListener("click", async () => {
    const ligar = !auto.som;
    await salvarAuto({ som: ligar });
    if (ligar) tocarConfirmacao();
  });
  const INSTRUCAO = {
    "produto.lista": "Na live, clique na LISTA de produtos (a área que contém todos eles).",
    "produto.item": "Agora clique em UM produto da lista (o cartão dele, não o botão).",
    "produto.fixar": "Agora clique no botão FIXAR de um produto.",
  };
  document.querySelectorAll("[data-ensinar]").forEach((b) =>
    b.addEventListener("click", async () => {
      $("ensinarStatus").textContent = "Vá para a aba da live e clique no que foi pedido (Esc cancela).";
      await enviar({ tipo: "ensinar", ancora: b.dataset.ensinar, instrucao: INSTRUCAO[b.dataset.ensinar] });
    }),
  );
  $("btnAbrirNotificacoes").addEventListener("click", () => api.abrirNoSite("/notificacoes"));
  $("btnLimparHist").addEventListener("click", async () => {
    await chrome.storage.local.remove(api.CHAVES.historico);
    pintarHistorico([]);
  });

  // Guia
  const ov = $("guiaOverlay");
  const fecharGuia = () => {
    ov.classList.remove("on");
    try { localStorage.setItem("shopia_guia_v1", "1"); } catch { /* sem storage */ }
  };
  $("guiaBtn").addEventListener("click", () => ov.classList.add("on"));
  $("guiaX").addEventListener("click", fecharGuia);
  $("guiaOk").addEventListener("click", fecharGuia);
  ov.addEventListener("click", (e) => e.target === ov && fecharGuia());
  $("guiaApp").addEventListener("click", (e) => (e.preventDefault(), api.abrirNoSite("/inicio")));
}

// Mensagens do service worker e da aba
chrome.runtime.onMessage.addListener((m) => {
  switch (m?.tipo) {
    case "ciclo":
      ciclo = m.ciclo;
      restanteMs = m.restanteMs;
      restanteEm = Date.now();
      pintarCiclo();
      break;
    case "metricas":
      ciclo = { ...ciclo, ...m.ciclo };
      break;
    case "log":
      linhaDeLog(m.linha);
      break;
    case "estado":
      licenca = m.estado;
      pintarServidor();
      if (["token_invalido", "revogada"].includes(licenca.motivo)) void conferirAcesso();
      break;
    case "relatorio":
      void chrome.storage.local.get(api.CHAVES.historico).then((r) => pintarHistorico(r[api.CHAVES.historico] ?? []));
      break;
    case "bloqueados":
      pintarBloqueados(m.lista ?? []);
      break;
    case "comentario_log":
      if (m.agendado) mostrarContagemComentario(m.emMs ?? 0);
      else $("comentarioLog").textContent = m.ok ? `✓ ${new Date().toLocaleTimeString("pt-BR")} — ${m.texto}` : `✗ Não saiu: ${m.motivo}`;
      break;
    case "aviso":
      toast(m.texto);
      break;
    case "chat_status":
      estadoChat = m.estado;
      pintarIaLerTela();
      break;
    case "chat_lidos":
      lidos += m.quantidade ?? 0;
      pintarIaLerTela();
      break;
    case "lido":
      ultimoLido = String(m.texto ?? "").slice(0, 40);
      pintarIaLerTela();
      break;
    case "aprendeu":
      $("ensinarStatus").textContent = m.cancelado
        ? "Cancelado."
        : m.cascata?.length
          ? `✓ Anotado: ${m.ancora}. ${m.ancora === "produto.fixar" ? "Pronto — o fixar usa o que você ensinou." : "Siga para o próximo."}`
          : "Não consegui descrever esse elemento. Tente de novo.";
      break;
    default:
      break;
  }
});

// Partida
ligarEventos();
$("dominioApp").textContent = new URL(api.SERVIDOR).host;
try {
  const aba = localStorage.getItem("shopia_aba");
  if (aba) document.querySelector(`[data-aba="${aba}"]`)?.click();
  if (localStorage.getItem("shopia_guia_v1") !== "1") setTimeout(() => $("guiaOverlay").classList.add("on"), 500);
} catch { /* sem storage */ }
await carregarLog();
await recarregarTudo();
await conferirAcesso();
setInterval(pintarRelogios, 1000);
setInterval(() => void conferirAcesso(), 120000);
