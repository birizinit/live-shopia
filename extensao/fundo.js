// Service worker: o único que tem o token.
//
// Em MV3 este processo MORRE depois de ~30 segundos ocioso e volta quando algo
// o acorda. Por isso o que precisa sobreviver mora no storage, e o relógio do
// ciclo é um INSTANTE (fimEm), não um contador: renascer no meio da live não
// pode zerar o timer nem esquecer que a live tem hora para acabar.
//
// O que este arquivo faz:
//   - licença: login, batimento, kill switch, mapa de seletores
//   - o CICLO (o "Ligar a extensão"): timer de encerramento, scans de
//     violação, checagem da live, relatório e histórico
//   - sessão no servidor e as respostas do chat (quem decide é o servidor)
//   - aviso de venda no celular

import * as api from "./api.js";

const ALARME_LICENCA = "shopia:licenca";
const ALARME_EVENTOS = "shopia:eventos";
const ALARME_SESSAO = "shopia:sessao";
const ALARME_PROGRAMADO = "shopia:programado";
const ALARME_PULSO = "shopia:pulso";
const CHAVE_CHAT = "shopia_chat";
const CHAVE_LOG = "shopia_log";

/** Piso entre varreduras: ler o DOM de uma live grande a cada 3s trava o navegador. */
const SCAN_MINIMO_S = 8;
const LIVE_CHECK_MS = 10000;

export const CFG_PADRAO = {
  threshold: 50,
  intervalo: SCAN_MINIMO_S,
  duracaoMinutos: 60,
  modoViolacao: "encerrar",
  minutosViolacao: 20,
};

const CICLO_PADRAO = {
  ativo: false,
  inicio: null,
  /** Epoch ms em que a live encerra sozinha. null = sem timer. */
  fimEm: null,
  /** Com o timer pausado, quanto faltava. */
  pausadoRestanteMs: null,
  scanN: 0,
  alertas: 0,
  liveAtiva: false,
  abaConectada: false,
  acao: null,
  violacao: { ativa: false, fimEm: null, encerrando: false },
  viewers: null,
  vendas: null,
  gmv: null,
  ultimoValor: null,
};

// ---------------------------------------------------------------------------
// Estado da licença
// ---------------------------------------------------------------------------

let estado = {
  licenciada: false,
  motivo: null,
  recursos: { chat: false },
  versaoPublicada: null,
  atualizacaoObrigatoria: false,
  pararAgora: false,
  pararMotivo: null,
  heartbeatSegundos: 120,
  ultimoContato: null,
};

let fila = [];

const restaurado = (chrome.storage.session?.get("shopia_estado") ?? Promise.resolve({}))
  .then((r) => {
    if (r?.shopia_estado) estado = { ...estado, ...r.shopia_estado };
  })
  .catch(() => {});

const versaoDaExtensao = () => chrome.runtime.getManifest().version;

async function avisarTodos(mensagem) {
  chrome.runtime.sendMessage(mensagem).catch(() => {});
  try {
    const abas = await chrome.tabs.query({ url: "*://*.tiktok.com/*" });
    for (const aba of abas) chrome.tabs.sendMessage(aba.id, mensagem).catch(() => {});
  } catch {
    /* sem abas do TikTok */
  }
}

/** Só o painel lateral. */
function avisarPainel(mensagem) {
  chrome.runtime.sendMessage(mensagem).catch(() => {});
}

async function guardarEstado() {
  await chrome.storage.session?.set({ shopia_estado: estado }).catch(() => {});
}

async function baterLicenca() {
  await restaurado;
  const token = await api.token();
  if (!token) {
    estado = { ...estado, licenciada: false, motivo: "sem_token" };
    await guardarEstado();
    avisarPainel({ tipo: "estado", estado });
    return estado;
  }

  const mapaVersao = await api.lerLocal(api.CHAVES.mapaVersao);

  try {
    const r = await api.licenca({ versao: versaoDaExtensao(), mapaVersao });

    estado = {
      licenciada: true,
      motivo: null,
      recursos: {
        chat: Boolean(r.recursos?.chat),
        chatDesligadoNaBase: Boolean(r.recursos?.chatDesligadoNaBase),
      },
      protecao: r.protecao ?? null,
      versaoPublicada: r.versao?.publicada ?? null,
      atualizacaoObrigatoria: Boolean(r.versao?.obrigatoria),
      notas: r.versao?.notas ?? null,
      expiraEm: r.licenca?.expiraEm ?? null,
      pararAgora: Boolean(r.pararAgora),
      pararMotivo: r.pararMotivo ?? null,
      heartbeatSegundos: Number(r.heartbeatSegundos) || 120,
      ultimoContato: new Date().toISOString(),
    };

    await sincronizarMapa(mapaVersao);

    estado.planoAtivo = r.plano?.ativo !== false;
    if (!estado.planoAtivo) {
      // Sem plano vigente a extensão tranca: o painel mostra "Assinar/Renovar"
      // e nada roda sozinho na live.
      await desligarTudo("plano sem assinatura vigente");
    }

    if (estado.pararAgora) {
      // Kill switch: vale para a versão que está rodando agora.
      await avisarTodos({ tipo: "parar", motivo: estado.pararMotivo });
      await pararCiclo("O servidor mandou parar a extensão.");
      await gravarAuto({ lerTela: false, comentarios: { ativo: false }, bloqueio: { ativo: false } });
    }
  } catch (erro) {
    if (erro.codigo === "rede") {
      // Offline não é perda de licença: a live não cai porque o Wi-Fi oscilou.
      estado = { ...estado, motivo: "offline" };
    } else {
      estado = {
        ...estado,
        licenciada: false,
        motivo: erro.codigo,
        pararAgora: erro.codigo === "expirada" || erro.codigo === "revogada",
        pararMotivo: erro.message,
      };
      if (estado.pararAgora) await avisarTodos({ tipo: "parar", motivo: erro.message });
    }
  }

  await guardarEstado();
  avisarPainel({ tipo: "estado", estado });
  return estado;
}

async function sincronizarMapa(versaoConhecida) {
  try {
    const r = await api.seletores(versaoConhecida);
    if (r.mudou && r.mapa) {
      await api.gravarLocal({
        [api.CHAVES.mapa]: r.mapa,
        [api.CHAVES.mapaVersao]: r.versao,
      });
      await avisarTodos({ tipo: "mapa", mapa: r.mapa, versao: r.versao });
    }
  } catch {
    /* segue com o mapa em cache */
  }
}

// ---------------------------------------------------------------------------
// Log (o "Log de Eventos" do painel)
// ---------------------------------------------------------------------------

async function log(texto, nivel = "") {
  const hora = new Date().toLocaleTimeString("pt-BR");
  const linha = { hora, texto: String(texto).slice(0, 300), nivel };
  avisarPainel({ tipo: "log", linha });
  try {
    const r = await chrome.storage.session.get(CHAVE_LOG);
    const linhas = [...(r?.[CHAVE_LOG] ?? []), linha].slice(-150);
    await chrome.storage.session.set({ [CHAVE_LOG]: linhas });
  } catch {
    /* log é conveniência */
  }
}

// ---------------------------------------------------------------------------
// Interruptores que o content script obedece
// ---------------------------------------------------------------------------

export const AUTO_PADRAO = {
  fixar: false,
  cupom: false,
  som: true,
  lerTela: false,
  comentarios: { ativo: false, mensagens: [], min: 30, max: 90 },
  bloqueio: { ativo: false, palavras: [] },
};

async function lerAuto() {
  const a = (await api.lerLocal(api.CHAVES.auto)) ?? {};
  return {
    ...AUTO_PADRAO,
    ...a,
    comentarios: { ...AUTO_PADRAO.comentarios, ...(a.comentarios ?? {}) },
    bloqueio: { ...AUTO_PADRAO.bloqueio, ...(a.bloqueio ?? {}) },
  };
}

let filaAuto = Promise.resolve();
function gravarAuto(parcial) {
  const vez = filaAuto.then(() => gravarAutoAgora(parcial));
  filaAuto = vez.catch(() => {});
  return vez;
}

async function gravarAutoAgora(parcial) {
  const atual = await lerAuto();
  const novo = {
    ...atual,
    ...parcial,
    comentarios: { ...atual.comentarios, ...(parcial.comentarios ?? {}) },
    bloqueio: { ...atual.bloqueio, ...(parcial.bloqueio ?? {}) },
  };
  await api.gravarLocal({ [api.CHAVES.auto]: novo });
  await escolherAbaAlvo();
  await ajustarSessao();
  return novo;
}

// ---------------------------------------------------------------------------
// A aba que age
// ---------------------------------------------------------------------------

const ehUrlDeLive = (url) => /streamer|console|\/live|live_studio|\/studio/i.test(url ?? "");

/**
 * Escolhe UMA aba do TikTok para agir. Comentário automático e bloqueio em
 * duas abas sairiam em dobro — e mensagem duplicada é o sinal de automação
 * mais visível que existe.
 */
async function escolherAbaAlvo() {
  const abas = await chrome.tabs.query({ url: "*://*.tiktok.com/*" }).catch(() => []);
  const atual = await api.lerLocal(api.CHAVES.abaAlvo);
  if (atual && abas.some((a) => a.id === atual && ehUrlDeLive(a.url))) return atual;
  const escolhida = abas.find((a) => a.active && ehUrlDeLive(a.url)) ?? abas.find((a) => ehUrlDeLive(a.url)) ?? abas[0];
  const id = escolhida?.id ?? null;
  if (id !== atual) await api.gravarLocal({ [api.CHAVES.abaAlvo]: id });
  return id;
}

async function mandarParaAlvo(mensagem) {
  const id = await escolherAbaAlvo();
  if (!id) return null;
  try {
    return await chrome.tabs.sendMessage(id, mensagem);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sessão no servidor
// ---------------------------------------------------------------------------

/**
 * A sessão existe enquanto o ciclo estiver ligado OU a leitura do chat ativa:
 * é ela que dá contexto às respostas e às automações programadas no servidor.
 */
async function ajustarSessao() {
  const [ciclo, auto, sessaoId] = await Promise.all([
    lerCiclo(),
    lerAuto(),
    api.lerLocal(api.CHAVES.sessao),
  ]);
  const precisa = ciclo.ativo || auto.lerTela;

  if (precisa && !sessaoId) {
    try {
      const r = await api.abrirSessao({ contaTikTokId: null });
      await api.gravarLocal({ [api.CHAVES.sessao]: r.sessaoId });
      await log(r.jaEstavaAberta ? "Sessão retomada no servidor" : "Sessão aberta no servidor", "ok");
    } catch (erro) {
      if (erro.codigo === "sem_plano") {
        await log("Sem plano vigente — assine ou renove para usar a extensão.", "warn");
        avisarPainel({ tipo: "aviso", texto: "Seu plano não está ativo.", abrir: "/planos" });
      } else if (erro.codigo === "risco_pendente") {
        await log("Aceite o aviso de automação no app (página Ao vivo) para responder o chat.", "warn");
        avisarPainel({ tipo: "aviso", texto: "Falta aceitar o aviso de automação no app.", abrir: "/live" });
      } else if (erro.codigo !== "sem_token") {
        await log(`Sessão não abriu: ${erro.message}`, "err");
      }
    }
  } else if (!precisa && sessaoId) {
    await api.fecharSessao(sessaoId, null, ciclo.ultimoMotivo ?? "extensão desligada").catch(() => {});
    await chrome.storage.local.remove(api.CHAVES.sessao);
    await log("Sessão fechada no servidor", "inf");
  }
}

async function despejarFila() {
  if (fila.length === 0) return;
  const sessaoId = await api.lerLocal(api.CHAVES.sessao);
  if (!sessaoId) {
    fila = [];
    return;
  }
  const lote = fila.splice(0, 200);
  try {
    await api.enviarEventos(sessaoId, lote);
  } catch (erro) {
    if (erro.codigo === "nao_encontrado" || erro.status === 404) {
      await chrome.storage.local.remove(api.CHAVES.sessao);
      fila = [];
      return;
    }
    fila = [...lote, ...fila].slice(0, 1000);
  }
}

async function baterSessaoAberta() {
  const sessaoId = await api.lerLocal(api.CHAVES.sessao);
  if (!sessaoId) return;
  const ciclo = await lerCiclo();
  const espectadores = contarEspectadores(ciclo.viewers);
  try {
    await api.baterSessao(sessaoId, Number.isSafeInteger(espectadores) ? espectadores : null);
  } catch (erro) {
    if (erro?.codigo === "sessao_encerrada") await sessaoFechadaLaFora(erro);
  }
}

/**
 * O servidor fechou a sessão. Pela faxina (batimento atrasado), reabre. Pelo
 * PAINEL do app ("Encerrar a live", "Parar tudo"), obedece e desliga tudo:
 * reabrir sozinha desfaria o que a pessoa acabou de pedir.
 */
async function sessaoFechadaLaFora(erro) {
  await chrome.storage.local.remove(api.CHAVES.sessao);
  if (erro?.dados?.pelo === "painel") {
    await desligarTudo("desligada pelo app");
    avisarPainel({ tipo: "aviso", texto: "A extensão foi desligada pelo app." });
    return;
  }
  await ajustarSessao();
}

/** Para o ciclo e todas as automações locais. */
async function desligarTudo(motivo) {
  await pararCiclo(motivo);
  const auto = await lerAuto();
  if (auto.lerTela || auto.comentarios.ativo || auto.bloqueio.ativo || auto.fixar) {
    await gravarAuto({ lerTela: false, fixar: false, comentarios: { ativo: false }, bloqueio: { ativo: false } });
  }
}

/** "1.234", "1,2K", "3M" → número. */
function contarEspectadores(texto) {
  const m = String(texto ?? "").trim().match(/^([\d.,]+)\s*([kKmM]?)$/);
  if (!m) return null;
  const mult = /k/i.test(m[2]) ? 1e3 : /m/i.test(m[2]) ? 1e6 : 1;
  const base = mult > 1 ? Number(m[1].replace(",", ".")) : Number(m[1].replace(/[.,]/g, ""));
  return Number.isFinite(base) ? Math.round(base * mult) : null;
}

/** Automações programadas no app (avisos, refixar). Quem conta o tempo é o servidor. */
async function rodarProgramado() {
  const sessaoId = await api.lerLocal(api.CHAVES.sessao);
  if (!sessaoId) return;
  let tarefa;
  try {
    tarefa = await api.proximaTarefa(sessaoId);
  } catch (erro) {
    if (erro?.codigo === "sessao_encerrada") await sessaoFechadaLaFora(erro);
    return;
  }
  if (!tarefa?.ok || tarefa.acao === "nada") return;

  if (tarefa.acao === "escrever") {
    await mandarParaAlvo({ tipo: "programado_escrever", texto: tarefa.texto, tema: tarefa.tema, avisoId: tarefa.avisoId });
  } else if (tarefa.acao === "fixar") {
    await mandarParaAlvo({ tipo: "programado_fixar", posicao: tarefa.posicao });
  }
}

// ---------------------------------------------------------------------------
// O CICLO
// ---------------------------------------------------------------------------

async function lerCfg() {
  return { ...CFG_PADRAO, ...((await api.lerLocal(api.CHAVES.cfg)) ?? {}) };
}

async function lerCiclo() {
  const c = (await api.lerLocal(api.CHAVES.ciclo)) ?? {};
  return { ...CICLO_PADRAO, ...c, violacao: { ...CICLO_PADRAO.violacao, ...(c.violacao ?? {}) } };
}

/**
 * Ler-mudar-gravar em fila. O tick, o scan e as métricas chegam ao mesmo
 * tempo; sem a fila, um gravava por cima do outro com a cópia velha e a venda
 * lida sumia do estado.
 */
let filaCiclo = Promise.resolve();
function gravarCiclo(parcial) {
  const vez = filaCiclo.then(async () => {
    const atual = await lerCiclo();
    const novo = { ...atual, ...(typeof parcial === "function" ? parcial(atual) : parcial) };
    await api.gravarLocal({ [api.CHAVES.ciclo]: novo });
    return novo;
  });
  filaCiclo = vez.catch(() => {});
  return vez;
}

const pad = (n) => String(n).padStart(2, "0");
export function hms(segundos) {
  const s = Math.max(0, Math.round(segundos));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function restanteMs(ciclo) {
  if (ciclo.pausadoRestanteMs != null) return ciclo.pausadoRestanteMs;
  if (!ciclo.fimEm) return null;
  return Math.max(0, ciclo.fimEm - Date.now());
}

async function publicarCiclo(ciclo) {
  const c = ciclo ?? (await lerCiclo());
  avisarPainel({ tipo: "ciclo", ciclo: c, restanteMs: restanteMs(c), agora: Date.now() });
  return c;
}

let tickTimer = null;
let scanTimer = null;
let liveTimer = null;

function pararLacos() {
  clearInterval(tickTimer);
  clearInterval(scanTimer);
  clearInterval(liveTimer);
  tickTimer = scanTimer = liveTimer = null;
}

async function ligarLacos() {
  pararLacos();
  const cfg = await lerCfg();
  tickTimer = setInterval(() => void tick(), 1000);
  scanTimer = setInterval(() => void scan(), Math.max(Number(cfg.intervalo) || SCAN_MINIMO_S, SCAN_MINIMO_S) * 1000);
  liveTimer = setInterval(() => void checarLive(), LIVE_CHECK_MS);
  void checarLive();
}

async function iniciarCiclo(cfgNova) {
  const cfg = { ...(await lerCfg()), ...(cfgNova ?? {}) };
  await api.gravarLocal({ [api.CHAVES.cfg]: cfg });

  const minutos = Math.max(Number(cfg.duracaoMinutos) || 60, 1);
  const ciclo = await gravarCiclo({
    ...CICLO_PADRAO,
    ativo: true,
    inicio: Date.now(),
    fimEm: Date.now() + minutos * 60000,
    acao: "Monitorando",
    ultimoMotivo: null,
  });

  await escolherAbaAlvo();
  await mandarParaAlvo({ tipo: "ciclo_on" });
  await ligarLacos();
  await ajustarSessao();
  await log(`Extensão ligada — encerra em ${hms(minutos * 60)}`, "ok");
  await publicarCiclo(ciclo);
}

async function pararCiclo(motivo = null) {
  const ciclo = await lerCiclo();
  if (!ciclo.ativo) return publicarCiclo(ciclo);
  await gerarRelatorio(ciclo);
  pararLacos();
  const parado = await gravarCiclo({
    ultimoMotivo: motivo,
    ativo: false,
    fimEm: null,
    pausadoRestanteMs: null,
    acao: null,
    violacao: { ativa: false, fimEm: null, encerrando: false },
  });
  await avisarTodos({ tipo: "ciclo_off" });
  await ajustarSessao();
  await log(motivo ? `Extensão desligada — ${motivo}` : "Extensão desligada", "inf");
  return publicarCiclo(parado);
}

async function encerrarLive(motivo) {
  await log(`Encerrando a LIVE — ${motivo}`, "err");
  const r = await mandarParaAlvo({ tipo: "encerrar_live" });
  if (r && r.ok === false) await log("Botão de encerrar não encontrado na página da live", "warn");
  await pararCiclo(motivo);
}

async function tick() {
  const ciclo = await lerCiclo();
  if (!ciclo.ativo) return pararLacos();

  if (ciclo.violacao.ativa && ciclo.violacao.fimEm && Date.now() >= ciclo.violacao.fimEm) {
    await encerrarLive("tempo de tolerância da violação acabou");
    return;
  }

  const resta = restanteMs(ciclo);
  if (resta !== null && resta <= 0 && ciclo.pausadoRestanteMs == null) {
    await encerrarLive("timer de encerramento zerou");
    return;
  }
  await publicarCiclo(ciclo);
}

async function scan() {
  let ciclo = await lerCiclo();
  if (!ciclo.ativo) return;
  ciclo = await gravarCiclo((c) => ({ scanN: c.scanN + 1 }));
  const r = await mandarParaAlvo({ tipo: "calibrar" });
  if (!r) return publicarCiclo(ciclo);
  const cfg = await lerCfg();
  // Detecção é binária (999 ou 0); o threshold fica pela compatibilidade de
  // tela e por quem quiser desligar a proteção pondo um valor acima de 999.
  if (r.pixels >= (Number(cfg.threshold) || 50) && !ciclo.violacao.ativa) {
    await tratarViolacao(r.motivo);
  }
}

async function checarLive() {
  const ciclo = await lerCiclo();
  if (!ciclo.ativo) return;
  const r = await mandarParaAlvo({ tipo: "checar_live" });
  const novo = await gravarCiclo({
    liveAtiva: Boolean(r?.liveAtiva),
    abaConectada: Boolean(r?.abaConectada),
  });
  if (!ciclo.liveAtiva && novo.liveAtiva) await log("LIVE detectada na aba do TikTok", "ok");
  await publicarCiclo(novo);
}

async function tratarViolacao(motivo) {
  const ciclo = await lerCiclo();
  if (ciclo.violacao.ativa) return;
  const cfg = await lerCfg();
  const minutos = Number.parseInt(cfg.minutosViolacao, 10) || 0;
  await gravarCiclo((c) => ({ alertas: c.alertas + 1 }));
  await log(`⚠️ Aviso de violação do TikTok detectado${motivo ? ` (${motivo})` : ""}`, "err");

  if (cfg.modoViolacao !== "continuar" || minutos <= 0) {
    await gravarCiclo({ violacao: { ativa: true, fimEm: null, encerrando: true } });
    await avisarTodos({ tipo: "violacao", encerrando: true });
    await encerrarLive("violação detectada");
    return;
  }

  const fimEm = Date.now() + minutos * 60000;
  const novo = await gravarCiclo({ violacao: { ativa: true, fimEm, encerrando: false } });
  await avisarTodos({ tipo: "violacao", encerrando: false, fimEm });
  await log(`Live continua por ${minutos} min e então encerra`, "warn");
  await publicarCiclo(novo);
}

async function gerarRelatorio(ciclo) {
  if (!ciclo.inicio) return;
  const dur = Date.now() - ciclo.inicio;
  const rel = {
    horas: (dur / 3600000).toFixed(1),
    minutos: Math.round(dur / 60000),
    scans: ciclo.scanN,
    alertas: ciclo.alertas,
    inicio: new Date(ciclo.inicio).toLocaleTimeString("pt-BR"),
    fim: new Date().toLocaleTimeString("pt-BR"),
    data: new Date().toLocaleDateString("pt-BR"),
    viewers: ciclo.viewers ?? "—",
    vendas: ciclo.vendas ?? "—",
  };
  const hist = (await api.lerLocal(api.CHAVES.historico)) ?? [];
  await api.gravarLocal({ [api.CHAVES.historico]: [rel, ...hist].slice(0, 30) });
  avisarPainel({ tipo: "relatorio", rel });
}

/** O worker renasceu no meio de um ciclo: religa os laços. */
async function retomarSeAtivo() {
  const ciclo = await lerCiclo();
  if (ciclo.ativo && !tickTimer) await ligarLacos();
}

// ---------------------------------------------------------------------------
// Vendas e métricas que a aba lê
// ---------------------------------------------------------------------------

async function receberMetricas(m) {
  const ciclo = await lerCiclo();
  const parcial = {};
  if (m.viewers) parcial.viewers = m.viewers;
  if (m.gmv) parcial.gmv = m.gmv;
  if (m.ultimoValor) parcial.ultimoValor = m.ultimoValor;

  let vendeu = Boolean(m.novaVendaAtividade);
  if (m.vendas) {
    const nova = Number.parseInt(m.vendas, 10) || 0;
    const anterior = Number.parseInt(ciclo.vendas ?? "", 10) || 0;
    if (nova > anterior && ciclo.vendas != null) vendeu = true;
    parcial.vendas = m.vendas;
  }
  const novo = await gravarCiclo(parcial);
  avisarPainel({ tipo: "metricas", ciclo: novo });

  if (vendeu) {
    await log(`🛒 Nova venda${novo.ultimoValor ? ` ${novo.ultimoValor}` : ""}`, "ok");
    void api.avisarVenda({
      valor: novo.ultimoValor,
      vendas: novo.vendas,
      gmv: novo.gmv,
      espectadores: novo.viewers,
    });
  }
}

// ---------------------------------------------------------------------------
// Alarmes e mensagens
// ---------------------------------------------------------------------------

function criarAlarmes() {
  chrome.alarms.create(ALARME_LICENCA, { periodInMinutes: 2 });
  chrome.alarms.create(ALARME_EVENTOS, { periodInMinutes: 0.5 });
  chrome.alarms.create(ALARME_SESSAO, { periodInMinutes: 1 });
  chrome.alarms.create(ALARME_PROGRAMADO, { periodInMinutes: 0.5 });
  // Ressuscita o worker para o timer não depender do painel aberto.
  chrome.alarms.create(ALARME_PULSO, { periodInMinutes: 0.5 });
}

chrome.runtime.onInstalled.addListener(() => {
  criarAlarmes();
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(criarAlarmes);

chrome.alarms.onAlarm.addListener((alarme) => {
  if (alarme.name === ALARME_LICENCA) void baterLicenca();
  if (alarme.name === ALARME_EVENTOS) void despejarFila();
  if (alarme.name === ALARME_SESSAO) void baterSessaoAberta();
  if (alarme.name === ALARME_PROGRAMADO) void rodarProgramado();
  if (alarme.name === ALARME_PULSO) void retomarSeAtivo().then(tick);
});

chrome.action.onClicked.addListener((aba) => {
  chrome.sidePanel.open({ tabId: aba.id }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(async (id) => {
  if ((await api.lerLocal(api.CHAVES.abaAlvo)) === id) {
    await api.gravarLocal({ [api.CHAVES.abaAlvo]: null });
    await escolherAbaAlvo();
  }
});

void retomarSeAtivo();

chrome.runtime.onMessage.addListener((mensagem, remetente, responder) => {
  (async () => {
    await restaurado;
    switch (mensagem?.tipo) {
      // --- conta ---
      case "estado":
        responder({ ok: true, estado });
        break;

      case "bater":
        responder({ ok: true, estado: await baterLicenca() });
        break;

      case "entrar": {
        try {
          const r = await api.entrar(mensagem.login, mensagem.senha);
          await api.guardarToken(r.token);
          await api.gravarLocal({ [api.CHAVES.usuario]: r.usuario ?? null });
          const e = await baterLicenca();
          responder({ ok: true, usuario: r.usuario, estado: e });
        } catch (erro) {
          responder({ ok: false, erro: erro.message, codigo: erro.codigo });
        }
        break;
      }

      case "sair":
        await pararCiclo("saiu da conta");
        await gravarAuto({ lerTela: false, comentarios: { ativo: false }, bloqueio: { ativo: false } });
        await api.esquecerToken();
        await chrome.storage.local.remove(api.CHAVES.usuario);
        estado = { ...estado, licenciada: false, motivo: "sem_token" };
        await guardarEstado();
        responder({ ok: true });
        break;

      // --- ciclo ---
      case "ciclo_estado": {
        const ciclo = await lerCiclo();
        responder({ ok: true, ciclo, restanteMs: restanteMs(ciclo), cfg: await lerCfg(), auto: await lerAuto() });
        break;
      }

      case "ciclo_iniciar":
        await iniciarCiclo(mensagem.cfg);
        responder({ ok: true });
        break;

      case "ciclo_parar":
        await pararCiclo(mensagem.motivo ?? null);
        responder({ ok: true });
        break;

      case "cfg": {
        const cfg = { ...(await lerCfg()), ...(mensagem.cfg ?? {}) };
        await api.gravarLocal({ [api.CHAVES.cfg]: cfg });
        responder({ ok: true, cfg });
        break;
      }

      case "timer_pausar": {
        const ciclo = await lerCiclo();
        if (ciclo.ativo && ciclo.pausadoRestanteMs == null && ciclo.fimEm) {
          await gravarCiclo({ pausadoRestanteMs: Math.max(0, ciclo.fimEm - Date.now()) });
          await log("Timer pausado", "warn");
        }
        responder({ ok: true, ciclo: await publicarCiclo() });
        break;
      }

      case "timer_retomar": {
        const ciclo = await lerCiclo();
        if (ciclo.pausadoRestanteMs != null) {
          await gravarCiclo({ fimEm: Date.now() + ciclo.pausadoRestanteMs, pausadoRestanteMs: null });
          await log("Timer retomado", "ok");
        }
        responder({ ok: true, ciclo: await publicarCiclo() });
        break;
      }

      case "encerrar_live":
        await encerrarLive(mensagem.motivo ?? "pedido no painel");
        responder({ ok: true });
        break;

      case "violacao_teste":
        await mandarParaAlvo({ tipo: "violacao", encerrando: false, fimEm: Date.now() + 60000 });
        responder({ ok: true });
        break;

      case "reset":
        await pararCiclo("reset");
        await chrome.storage.local.remove([api.CHAVES.cfg, api.CHAVES.ciclo, api.CHAVES.auto]);
        await gravarAuto({});
        await log("Configurações resetadas para o padrão", "inf");
        responder({ ok: true, cfg: await lerCfg(), auto: await lerAuto() });
        break;

      // --- interruptores ---
      case "auto":
        responder({ ok: true, auto: await gravarAuto(mensagem.auto ?? {}) });
        break;

      case "fixar_agora": {
        const r = await mandarParaAlvo({ tipo: "fixar_agora" });
        if (!r) await log("Nenhuma aba do TikTok aberta para fixar o produto", "warn");
        responder({ ok: true, r });
        break;
      }

      // --- vindo da aba ---
      case "quem_sou":
        responder({ ok: true, abaId: remetente?.tab?.id ?? null, alvo: await escolherAbaAlvo() });
        break;

      case "registrar_aba": {
        const atual = await api.lerLocal(api.CHAVES.abaAlvo);
        if (!atual && remetente?.tab?.id) await api.gravarLocal({ [api.CHAVES.abaAlvo]: remetente.tab.id });
        responder({ ok: true, alvo: await escolherAbaAlvo() });
        break;
      }

      case "metricas":
        await receberMetricas(mensagem.dados ?? {});
        responder({ ok: true });
        break;

      case "log_aba":
        await log(mensagem.texto, mensagem.nivel ?? "");
        responder({ ok: true });
        break;

      case "bloqueou": {
        const lista = (await api.lerLocal(api.CHAVES.bloqueados)) ?? [];
        const novo = [...lista, mensagem.dados].slice(-500);
        await api.gravarLocal({ [api.CHAVES.bloqueados]: novo });
        avisarPainel({ tipo: "bloqueados", lista: novo });
        await log(`🚫 Bloqueado: ${mensagem.dados?.usuario} (palavra "${mensagem.dados?.palavra}")`, "warn");
        responder({ ok: true });
        break;
      }

      case "comentario_feito": {
        avisarPainel({ tipo: "comentario_log", ...mensagem });
        if (!mensagem.ok) await log(`Comentário não saiu: ${mensagem.motivo}`, "warn");
        // O comentário automático entra no teto por minuto do servidor: sem
        // isto, as respostas pelo manual e os avisos do app não enxergavam o
        // que a extensão já postou.
        const sessaoId = await api.lerLocal(api.CHAVES.sessao);
        if (mensagem.ok && !mensagem.agendado && sessaoId && mensagem.texto) {
          await api.confirmarResposta(sessaoId, mensagem.texto, "comentario_local").catch(() => {});
        }
        responder({ ok: true });
        break;
      }

      // --- mapa e aprendizado ---
      case "mapa": {
        const mapa = await api.lerLocal(api.CHAVES.mapa);
        const versao = await api.lerLocal(api.CHAVES.mapaVersao);
        const locais = await api.lerLocal(api.CHAVES.ancorasLocais);
        responder({ ok: true, mapa, versao, locais: locais ?? {} });
        break;
      }

      case "ensinar":
        await mandarParaAlvo({ tipo: "aprender", ancora: mensagem.ancora, instrucao: mensagem.instrucao });
        responder({ ok: true });
        break;

      case "aprendeu": {
        if (mensagem.ancora && Array.isArray(mensagem.cascata) && mensagem.cascata.length > 0) {
          const atuais = (await api.lerLocal(api.CHAVES.ancorasLocais)) ?? {};
          await api.gravarLocal({
            [api.CHAVES.ancorasLocais]: { ...atuais, [mensagem.ancora]: mensagem.cascata },
          });
        }
        responder({ ok: true });
        break;
      }

      // --- chat lido e respostas (o servidor decide) ---
      case "eventos":
        fila.push(...(mensagem.eventos ?? []));
        if (fila.length > 1000) fila = fila.slice(-1000);
        responder({ ok: true });
        break;

      case "quebras":
        void api.relatarQuebra(mensagem.falhas ?? []);
        responder({ ok: true });
        break;

      case "decidir": {
        const sessaoId = await api.lerLocal(api.CHAVES.sessao);
        if (!sessaoId) {
          responder({ ok: false, acao: "ignorar", motivo: "sem_sessao" });
          break;
        }
        try {
          responder({ ok: true, ...(await api.decidirResposta({ sessaoId, ...mensagem.evento })) });
        } catch (erro) {
          responder({ ok: false, acao: "ignorar", motivo: erro.codigo ?? "falhou" });
          if (erro?.codigo === "sessao_encerrada") await sessaoFechadaLaFora(erro);
        }
        break;
      }

      case "programado_feito": {
        const sessaoId = await api.lerLocal(api.CHAVES.sessao);
        if (sessaoId && mensagem.ok) {
          await api
            .confirmarResposta(sessaoId, mensagem.texto, mensagem.tema ?? "aviso", mensagem.avisoId ?? null)
            .catch(() => {});
        }
        responder({ ok: true });
        break;
      }

      case "programado_fixou": {
        const sessaoId = await api.lerLocal(api.CHAVES.sessao);
        if (sessaoId && mensagem.ok) await api.confirmarRefixada(sessaoId).catch(() => {});
        responder({ ok: true });
        break;
      }

      case "respondeu": {
        const sessaoId = await api.lerLocal(api.CHAVES.sessao);
        if (sessaoId) {
          await api.confirmarResposta(sessaoId, mensagem.texto ?? "", mensagem.tema ?? null).catch(() => {});
        }
        avisarPainel({ tipo: "lido", ...mensagem });
        await log(`💬 Respondeu: ${String(mensagem.texto ?? "").slice(0, 60)}`, "ok");
        responder({ ok: true });
        break;
      }

      case "envio_falhou":
        await log(`Resposta não saiu no chat (${mensagem.motivo})`, "warn");
        responder({ ok: true });
        break;

      case "chat_status":
        await chrome.storage.session
          ?.set({ [CHAVE_CHAT]: { estado: mensagem.estado, aba: remetente?.tab?.id ?? null, em: Date.now() } })
          .catch(() => {});
        avisarPainel({ tipo: "chat_status", estado: mensagem.estado });
        responder({ ok: true });
        break;

      case "chat":
        avisarPainel({ tipo: "chat_lidos", quantidade: mensagem.quantidade ?? 0 });
        responder({ ok: true });
        break;

      default:
        // Mensagens que só o painel escuta (o próprio worker as emitiu) caem aqui.
        responder({ ok: false, erro: "mensagem_desconhecida" });
    }
  })();
  return true;
});
