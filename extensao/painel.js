// Painel lateral: a casa do motor de áudio.
//
// Fica aqui e não no service worker porque em MV3 o worker morre ocioso, e
// áudio que para no meio da live é o produto quebrado. Enquanto este painel
// estiver aberto, a apresentadora fala.
//
// O painel é organizado como a lista do que falta para entrar no ar — áudio,
// cabo, chat — e cada pendência traz o botão que a resolve. Quem abre a
// extensão pela primeira vez não deveria precisar de manual para saber o que
// fazer em seguida.

import * as api from "./api.js";
import { Reprodutor, listarSaidas, pareceCabo } from "./audio.js";

const $ = (id) => document.getElementById(id);

const tela = { entrar: $("tela-entrar"), operar: $("tela-operar") };
let estadoLicenca = null;
let montagem = null;
let protecao = null;
let sessaoId = null;
let comentariosLidos = 0;
let respostasDadas = 0;

/** "ok" | "manual" | "sem_rotulo" | "nao_achado" | "procurando" */
let estadoCabo = "procurando";

let inicioNoAr = null;
let relogioCronometro = null;
let limiteMinutos = 0;

const reprodutor = new Reprodutor({
  aoMudar: pintarReproducao,
  aoErro: (mensagem) => mostrarErro($("erro-operar"), mensagem),
  buscarBlob: (arquivoId) => api.baixarBloco(arquivoId),
});

function mostrarErro(elemento, mensagem) {
  elemento.textContent = mensagem ?? "";
  elemento.hidden = !mensagem;
}

function mostrar(qual) {
  tela.entrar.hidden = qual !== "entrar";
  tela.operar.hidden = qual !== "operar";
}

function pintarPonto(id, cor) {
  $(id).dataset.cor = cor ?? "";
}

// ---------------------------------------------------------------- licença

function pintarLicenca(estado) {
  estadoLicenca = estado;
  const texto = $("texto-licenca");

  if (estado.pararAgora) {
    pintarPonto("ponto-licenca", "ruim");
    texto.textContent = "Operação suspensa";
    mostrarErro($("aviso-parar"), estado.pararMotivo || "O painel pediu para parar agora.");
    if (reprodutor.tocando) void encerrar("suspensa pelo painel");
  } else {
    $("aviso-parar").hidden = true;
  }

  if (estado.licenciada && !estado.pararAgora) {
    pintarPonto("ponto-licenca", "ok");
    const partes = ["Licença ativa"];
    if (!estado.recursos?.mixer) partes.push("sem áudio no plano");
    if (!estado.recursos?.chat) partes.push("chat desligado");
    texto.textContent = partes.join(" · ");
  } else if (estado.motivo === "offline") {
    pintarPonto("ponto-licenca", "alerta");
    texto.textContent = "Sem conexão — seguindo com a licença anterior";
  } else if (!estado.licenciada) {
    pintarPonto("ponto-licenca", "ruim");
    texto.textContent = rotuloDoMotivo(estado.motivo);
  }

  pintarVersao(estado);
  pintarProtecao();
  atualizarBotao();
}

function pintarVersao(estado) {
  const atual = chrome.runtime.getManifest().version;
  const aviso = $("aviso-versao");
  if (estado.versaoPublicada && estado.versaoPublicada !== atual) {
    aviso.hidden = false;
    aviso.textContent = estado.atualizacaoObrigatoria
      ? `Atualização obrigatória: a versão ${estado.versaoPublicada} saiu. Baixe no painel e recarregue a extensão.`
      : `Versão ${estado.versaoPublicada} disponível. A sua é a ${atual}.`;
  } else {
    aviso.hidden = true;
  }
}

function rotuloDoMotivo(motivo) {
  switch (motivo) {
    case "sem_token": return "Nenhuma licença conectada";
    case "token_invalido": return "Código de licença inválido";
    case "expirada": return "Licença vencida — confira a assinatura";
    case "revogada": return "Licença revogada";
    case "limite_excedido": return "Muitas tentativas — aguarde um minuto";
    default: return "Licença indisponível";
  }
}

// ---------------------------------------------------------------- cabo

/**
 * Acha a saída do cabo virtual.
 *
 * Sem permissão de áudio o Chrome devolve uma saída só, sem nome: é o
 * alto-falante padrão. Escolher essa saída era o que fazia a live ir ao ar
 * muda — a voz tocava no computador e o LIVE Studio não ouvia nada. Agora ela
 * nunca é escolhida sozinha: o painel pede a liberação.
 */
async function carregarSaidas() {
  const saidas = await listarSaidas();
  const semRotulo = saidas.length === 0 || saidas.every((s) => s.semRotulo);
  const guardado = await api.lerLocal(api.CHAVES.cabo);

  const select = $("saidas");
  select.innerHTML = "";
  for (const s of saidas) {
    const opcao = document.createElement("option");
    opcao.value = s.id;
    opcao.textContent = s.semRotulo
      ? "Saída sem nome (acesso não liberado)"
      : pareceCabo(s.rotulo) ? `${s.rotulo}  ✓ cabo` : s.rotulo;
    select.append(opcao);
  }

  const cabo = saidas.find((s) => pareceCabo(s.rotulo));
  const guardadoValido = saidas.find((s) => s.id === guardado && !s.semRotulo) ?? null;
  const escolhida = semRotulo ? null : guardadoValido ?? cabo ?? null;

  estadoCabo = semRotulo
    ? "sem_rotulo"
    : !escolhida ? "nao_achado" : pareceCabo(escolhida.rotulo) ? "ok" : "manual";

  if (escolhida) select.value = escolhida.id;
  reprodutor.definirCabo(escolhida?.id ?? null);
  pintarCabo(escolhida);
  atualizarBotao();
}

function pintarCabo(escolhida) {
  const cor = { ok: "ok", manual: "alerta", sem_rotulo: "ruim", nao_achado: "ruim" }[estadoCabo];
  pintarPonto("ponto-cabo", cor);

  $("cabo-escolhido").textContent =
    estadoCabo === "ok"
      ? `Tocando em: ${escolhida.rotulo}`
      : estadoCabo === "manual"
        ? `Saída escolhida à mão: ${escolhida.rotulo}. Confira se é o cabo que o LIVE Studio usa como microfone.`
        : estadoCabo === "sem_rotulo"
          ? "Não dá para ver o nome das saídas de áudio."
          : "Nenhuma saída com cara de cabo virtual.";

  $("cabo-sem-rotulo").hidden = estadoCabo !== "sem_rotulo";
  $("cabo-nao-achado").hidden = estadoCabo !== "nao_achado";
  $("outra-saida").hidden = estadoCabo === "sem_rotulo";
  if (estadoCabo === "nao_achado") $("outra-saida").open = true;
}

// ---------------------------------------------------------------- áudio

async function carregarMontagem() {
  try {
    const r = await api.montagem();
    montagem = r.montagem;
    protecao = r.protecao ?? null;
    reprodutor.definirMontagem(montagem);
    pintarMontagem();
    mostrarErro($("erro-operar"), null);
  } catch (erro) {
    montagem = null;
    protecao = null;
    pintarFaltaAudio(erro);
  }
  pintarProtecao();
  atualizarBotao();
}

function pintarMontagem() {
  const blocos = montagem.falas.reduce((t, f) => t + f.blocos.length, 0);
  const minutos = Math.max(
    1,
    Math.round(montagem.falas.reduce((t, f) => t + (f.duracaoMs || 0), 0) / 60000),
  );
  pintarPonto("ponto-audio", "ok");
  $("montagem-nome").textContent = montagem.nome;
  $("montagem-resumo").textContent =
    `${montagem.falas.length} áudio(s) · ${blocos} blocos · ~${minutos} min por volta, em laço` +
    (montagem.trilha ? ` · trilha "${montagem.trilha.nome}"` : "");
  $("falta-audio").hidden = true;
}

function pintarFaltaAudio(erro) {
  pintarPonto("ponto-audio", "ruim");
  $("montagem-nome").textContent = "—";
  $("montagem-resumo").textContent = "";

  const textos = {
    sem_montagem:
      "Você ainda não tem o áudio da live. Leva uns 5 minutos no painel: produto, roteiro escrito pela IA e voz.",
    montagem_vazia:
      "O áudio da sua live ainda está sendo gerado, ou os áudios foram removidos. Confira no painel.",
    sem_mixer: "O seu plano não inclui o áudio da live.",
  };
  $("falta-audio-texto").textContent = textos[erro?.codigo] ?? `Não deu para carregar o áudio: ${erro?.message}`;
  $("btn-criar-audio").textContent = erro?.codigo === "sem_mixer" ? "Ver os planos" : "Criar o áudio agora";
  $("btn-criar-audio").dataset.destino = erro?.codigo === "sem_mixer" ? "/planos" : "/criar";
  $("falta-audio").hidden = false;
}

// ---------------------------------------------------------------- proteção

function itemProtecao(texto, tom = "ok") {
  const li = document.createElement("li");
  li.textContent = texto;
  li.dataset.tom = tom;
  return li;
}

/**
 * Proteção anti-restrição: o que a live evita para não ser restringida pelo
 * TikTok. É revisão de CONTEÚDO — as mesmas regras que um vendedor humano
 * segue — e não disfarce de automação.
 */
function pintarProtecao() {
  const lista = $("protecao");
  lista.innerHTML = "";
  const revisar = $("btn-revisar");
  revisar.hidden = true;

  if (!montagem) {
    lista.append(itemProtecao("A revisão do texto aparece quando o áudio da live existir.", "alerta"));
  } else if (!protecao || protecao.alertas === 0) {
    lista.append(
      itemProtecao(
        "Texto do áudio revisado: nada de contato fora do TikTok, Pix ou promessa de resultado.",
      ),
    );
  } else {
    const exemplos = protecao.falas.flatMap((f) => f.exemplos).slice(0, 3);
    lista.append(
      itemProtecao(
        `${protecao.alertas} trecho(s) do áudio costumam restringir a live: ` +
          exemplos.map((e) => `“${e}”`).join(", ") + ".",
        "alerta",
      ),
    );
    revisar.dataset.audio = protecao.falas[0]?.audioId ?? "";
    revisar.hidden = false;
  }

  if (estadoLicenca?.recursos?.chat) {
    lista.append(itemProtecao("Respostas no chat com pausa de gente e limite por minuto — sem rajada."));
  }
}

// ---------------------------------------------------------------- chat

const TEXTO_CHAT = {
  lendo: ["ok", "Lendo o chat da sua live."],
  procurando: ["alerta", "Página da live aberta — procurando o chat…"],
  sem_chat: [
    "alerta",
    "A página da live está aberta, mas o chat não apareceu. Deixe o chat visível na página; se continuar assim, avise o suporte.",
  ],
  suspenso: ["ruim", "Leitura do chat suspensa pelo painel."],
  fora_da_live: [null, "Abra a página da sua live no tiktok.com, nesta janela do Chrome."],
  sem_aba: [null, "Abra a página da sua live no tiktok.com, nesta janela do Chrome."],
};

function pintarChat(estado) {
  const [cor, texto] = TEXTO_CHAT[estado] ?? TEXTO_CHAT.sem_aba;
  pintarPonto("ponto-chat", cor);
  $("chat-texto").textContent = texto;
}

async function conferirChat() {
  const guardado = await chrome.storage.session?.get("shopia_chat").catch(() => null);
  if (guardado?.shopia_chat?.estado) pintarChat(guardado.shopia_chat.estado);

  const abas = await chrome.tabs.query({ url: "*://*.tiktok.com/*" }).catch(() => []);
  const daLive = abas.filter((a) => /\/(live|studio|live_studio)(\/|$|\?)/i.test(new URL(a.url ?? "", "https://x").pathname));
  if (daLive.length === 0) {
    pintarChat("sem_aba");
    return;
  }
  for (const aba of daLive) chrome.tabs.sendMessage(aba.id, { tipo: "status_chat?" }).catch(() => {});
}

function usuarioTikTokValido(bruto) {
  const usuario = String(bruto ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9._]{2,24}$/.test(usuario) ? usuario : null;
}

// ---------------------------------------------------------------- controle

/** Um motivo só, o primeiro que impede: é o que a pessoa resolve em seguida. */
function motivoDeBloqueio() {
  if (!estadoLicenca?.licenciada) return "A licença não está ativa.";
  if (estadoLicenca.pararAgora) return "A operação foi suspensa pelo painel.";
  if (!estadoLicenca.recursos?.mixer) return "O seu plano não inclui o áudio da live.";
  if (!montagem) return "Falta o áudio da live (item 1 acima).";
  if (estadoCabo !== "ok" && estadoCabo !== "manual") return "Falta achar o cabo de áudio (item 2 acima).";
  return null;
}

function atualizarBotao() {
  const motivo = reprodutor.tocando ? null : motivoDeBloqueio();
  $("btn-tocar").disabled = Boolean(motivo);
  $("motivo-bloqueio").textContent = motivo ?? "";
  $("motivo-bloqueio").hidden = !motivo;
}

function pintarReproducao(estado) {
  $("m-fala").textContent = estado.fala?.titulo ?? "—";
  $("m-voltas").textContent = String(estado.voltas);
  $("btn-tocar").hidden = estado.tocando;
  $("btn-parar").hidden = !estado.tocando;
  $("no-ar").hidden = !estado.tocando;
  if (!estado.tocando) pararCronometro();
  atualizarBotao();
}

function formatarDuracao(ms) {
  const s = Math.floor(ms / 1000);
  const partes = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  return partes.map((n) => String(n).padStart(2, "0")).join(":");
}

function pintarFimProgramado() {
  const aviso = $("fim-programado");
  if (!inicioNoAr || limiteMinutos <= 0) {
    aviso.hidden = true;
    return;
  }
  const fim = new Date(inicioNoAr + limiteMinutos * 60000);
  aviso.textContent = `Encerra sozinho às ${fim.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`;
  aviso.hidden = false;
}

function iniciarCronometro() {
  inicioNoAr = Date.now();
  clearInterval(relogioCronometro);
  const tique = () => {
    const decorrido = Date.now() - inicioNoAr;
    $("cronometro").textContent = formatarDuracao(decorrido);
    if (limiteMinutos > 0 && decorrido >= limiteMinutos * 60000) {
      void encerrar("tempo programado encerrado");
    }
  };
  tique();
  relogioCronometro = setInterval(tique, 1000);
  pintarFimProgramado();
}

function pararCronometro() {
  clearInterval(relogioCronometro);
  relogioCronometro = null;
  inicioNoAr = null;
  pintarFimProgramado();
}

async function entrarNoAr() {
  mostrarErro($("erro-operar"), null);
  if (motivoDeBloqueio()) return;

  try {
    const r = await api.abrirSessao({ montagemId: montagem.id, contaTikTokId: null });
    sessaoId = r.sessaoId;
    await chrome.runtime.sendMessage({ tipo: "sessao", sessaoId }).catch(() => {});
  } catch (erro) {
    if (erro.codigo === "risco_pendente") {
      mostrarErro($("erro-operar"), "Antes de entrar no ar, leia e aceite o aviso de automação no painel da Shopia.");
      void api.abrirNoSite("/bem-vindo");
      return;
    }
    mostrarErro($("erro-operar"), `Não deu para abrir a sessão: ${erro.message}`);
    return;
  }

  // O play tem que sair do mesmo gesto do clique: navegador recusa áudio
  // iniciado fora de interação do usuário, e a falha seria silenciosa.
  void reprodutor.iniciar();
  iniciarCronometro();
  void baterSessao();
}

let relogioBatimento = null;

async function baterSessao() {
  clearInterval(relogioBatimento);
  relogioBatimento = setInterval(async () => {
    if (!sessaoId || !reprodutor.tocando) return;
    try {
      await api.baterSessao(sessaoId, null);
    } catch (erro) {
      if (erro.codigo === "sessao_encerrada") {
        // O painel encerrou do outro lado. Parar é obedecer o dono.
        await encerrar("encerrada pelo painel");
      }
    }
  }, 45000);
}

async function encerrar(motivo = null) {
  reprodutor.parar();
  clearInterval(relogioBatimento);
  pararCronometro();

  if (sessaoId) {
    try {
      await api.fecharSessao(sessaoId, motivo);
    } catch {
      /* a faxina do servidor fecha sessão órfã pelo batimento */
    }
    sessaoId = null;
    await chrome.runtime.sendMessage({ tipo: "sessao", sessaoId: null }).catch(() => {});
  }
}

// ---------------------------------------------------------------- ligação

async function atualizarEstado() {
  const r = await chrome.runtime.sendMessage({ tipo: "bater" }).catch(() => null);
  if (r?.estado) pintarLicenca(r.estado);
  return r?.estado ?? null;
}

async function carregarPreferencias() {
  limiteMinutos = Number(await api.lerLocal(api.CHAVES.limiteMinutos, 0)) || 0;
  $("limite").value = String(limiteMinutos);
  const usuario = await api.lerLocal(api.CHAVES.usuarioTikTok, "");
  $("usuario-tiktok").value = usuario ? `@${usuario}` : "";
}

async function abrirOperacao() {
  mostrar("operar");
  await carregarPreferencias();
  const estado = await atualizarEstado();
  await Promise.all([carregarSaidas(), conferirChat()]);
  if (estado?.licenciada) await carregarMontagem();
  else pintarProtecao();
}

async function iniciar() {
  $("versao").textContent = "v" + chrome.runtime.getManifest().version;
  if (!(await api.token())) {
    mostrar("entrar");
    return;
  }
  await abrirOperacao();
}

$("btn-entrar").addEventListener("click", async () => {
  const valor = $("token").value.trim();
  mostrarErro($("erro-entrar"), null);

  if (!valor) {
    mostrarErro($("erro-entrar"), "Cole o código que aparece no painel.");
    return;
  }

  await api.guardarToken(valor);
  const estado = await atualizarEstado();

  if (!estado?.licenciada) {
    await api.esquecerToken();
    mostrarErro($("erro-entrar"), rotuloDoMotivo(estado?.motivo));
    return;
  }

  $("token").value = "";
  await abrirOperacao();
});

$("btn-pegar-codigo").addEventListener("click", () => void api.abrirNoSite("/extensao"));
$("btn-procurar").addEventListener("click", () => void carregarSaidas());
$("btn-recarregar").addEventListener("click", () => void carregarMontagem());
$("btn-tocar").addEventListener("click", () => void entrarNoAr());
$("btn-parar").addEventListener("click", () => void encerrar("encerrada pelo usuário"));
$("btn-liberar").addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("permissao.html") });
});
$("btn-guia-cabo").addEventListener("click", () => void api.abrirNoSite("/extensao#cabo-virtual"));
$("btn-criar-audio").addEventListener("click", (evento) => {
  void api.abrirNoSite(evento.currentTarget.dataset.destino || "/criar");
});
$("btn-revisar").addEventListener("click", (evento) => {
  const audio = evento.currentTarget.dataset.audio;
  void api.abrirNoSite(audio ? `/criar?audio=${encodeURIComponent(audio)}` : "/criar");
});

$("btn-abrir-live").addEventListener("click", () => {
  const usuario = usuarioTikTokValido($("usuario-tiktok").value);
  void chrome.tabs.create({
    url: usuario ? `https://www.tiktok.com/@${usuario}/live` : "https://www.tiktok.com/live",
  });
});

$("usuario-tiktok").addEventListener("change", async (evento) => {
  const usuario = usuarioTikTokValido(evento.target.value);
  evento.target.value = usuario ? `@${usuario}` : "";
  await api.gravarLocal({ [api.CHAVES.usuarioTikTok]: usuario ?? "" });
});

$("limite").addEventListener("change", async (evento) => {
  limiteMinutos = Number(evento.target.value) || 0;
  await api.gravarLocal({ [api.CHAVES.limiteMinutos]: limiteMinutos });
  pintarFimProgramado();
});

$("saidas").addEventListener("change", async (evento) => {
  await api.gravarLocal({ [api.CHAVES.cabo]: evento.target.value });
  await carregarSaidas();
});

$("btn-sair").addEventListener("click", async () => {
  await encerrar("desconectado");
  await api.esquecerToken();
  mostrar("entrar");
});

/**
 * Fala uma resposta decidida pelo servidor.
 *
 * O áudio do tema foi gerado UMA vez, no estúdio, com a cota do cliente.
 * Tocá-lo aqui não escreve nada na razão de crédito — é a mesma mecânica do
 * laço, e é o que permite responder o chat sem estourar a margem.
 */
async function falarResposta(decisao) {
  if (!reprodutor.tocando) return;

  // A espera vem do servidor, sorteada dentro da janela do cliente.
  await new Promise((r) => setTimeout(r, Math.min(Math.max(decisao.esperarMs ?? 0, 0), 120000)));

  const falou = await reprodutor.falar(decisao.blocos);
  if (falou) {
    respostasDadas += 1;
    $("m-resposta").textContent = String(respostasDadas);
    chrome.runtime
      .sendMessage({ tipo: "respondeu", texto: decisao.texto, tema: decisao.tema })
      .catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((mensagem) => {
  if (mensagem?.tipo === "estado") pintarLicenca(mensagem.estado);
  if (mensagem?.tipo === "parar") void encerrar(mensagem.motivo ?? "suspensa");
  if (mensagem?.tipo === "falar") void falarResposta(mensagem.decisao);
  if (mensagem?.tipo === "chat_status") pintarChat(mensagem.estado);
  if (mensagem?.tipo === "rotulos_liberados") void carregarSaidas();
  if (mensagem?.tipo === "chat") {
    comentariosLidos += mensagem.quantidade ?? 0;
    $("m-chat").textContent = String(comentariosLidos);
  }
});

// Cabo plugado ou driver instalado com o painel aberto: a lista se refaz sozinha.
navigator.mediaDevices?.addEventListener?.("devicechange", () => void carregarSaidas());

// Liberou o acesso por outro caminho (configurações do Chrome): refaz também.
navigator.permissions
  ?.query({ name: "microphone" })
  .then((p) => p.addEventListener("change", () => void carregarSaidas()))
  .catch(() => {});

// A aba da live abriu, fechou ou trocou de página: o estado do chat muda junto.
chrome.tabs.onUpdated.addListener((_id, mudanca) => {
  if (mudanca.status === "complete" || mudanca.url) void conferirChat();
});
chrome.tabs.onRemoved.addListener(() => void conferirChat());

// Fechar o painel é o mesmo que sair do ar: sem ele, não há quem toque.
window.addEventListener("pagehide", () => {
  if (reprodutor.tocando) void encerrar("painel fechado");
});

void iniciar();
