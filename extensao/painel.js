// Painel lateral: a casa do motor de áudio.
//
// Fica aqui e não no service worker porque em MV3 o worker morre ocioso, e
// áudio que para no meio da live é o produto quebrado. Enquanto este painel
// estiver aberto, a apresentadora fala.
//
// O painel é organizado como a lista do que falta para entrar no ar — e cada
// pendência traz o botão que a resolve. Quem abre a extensão pela primeira vez
// não deveria precisar de manual para saber o que fazer em seguida.
//
// MODO DE OPERAÇÃO
//
// São dois, e o padrão é o SEM ÁUDIO. Responder comentário, dar boas-vindas e
// fixar produto não precisam de áudio nenhum — e exigir cabo virtual instalado
// no sistema operacional para isso barrava na porta a maioria das lives, que
// são apresentadas por gente de verdade e só querem a parte automática do
// chat. O áudio virou o que sempre foi: um recurso a mais, para quem quer.

import * as api from "./api.js";
import { Reprodutor, listarSaidas, pareceCabo } from "./audio.js";
import { ANCORAS } from "./produtos.js";

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

/** "chat" | "chat_audio" — ver o cabeçalho. */
let modo = "chat";
const comAudio = () => modo === "chat_audio";

/** Âncoras de produto que esta instalação já aprendeu. */
let ancorasLocais = {};
let rodizioMinutos = 0;
let relogioRodizio = null;
let produtoAtual = 1;
let totalProdutos = 0;

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

  // Ler o chat e PODER responder são coisas diferentes: o plano libera a
  // segunda. Sem este aviso, a extensão ficaria com a bolinha verde de "lendo"
  // e sem responder ninguém — o sintoma não apontaria para a causa.
  if (estadoLicenca?.licenciada && estadoLicenca.recursos && !estadoLicenca.recursos.chat) {
    pintarPonto("ponto-chat", "alerta");
    $("chat-texto").textContent =
      "O seu plano não inclui respostas no chat, então a Shopia não vai responder " +
      "nem dar boas-vindas. Fixar produto continua funcionando.";
    return;
  }

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

// ---------------------------------------------------------------- produtos

const INSTRUCOES = {
  [ANCORAS.lista]: "Clique na LISTA de produtos da sua live (a caixa que contém todos). Esc cancela.",
  [ANCORAS.item]: "Clique em UM produto da lista — qualquer um serve. Esc cancela.",
  [ANCORAS.fixar]: "Clique no botão de FIXAR de um produto. Ele não será fixado agora. Esc cancela.",
};

function ancoraAprendida(nome) {
  return Array.isArray(ancorasLocais[nome]) && ancorasLocais[nome].length > 0;
}

function pintarProdutos() {
  const prontas = Object.values(ANCORAS).every(ancoraAprendida);
  $("produto-ensinar").hidden = prontas;
  $("produto-pronto").hidden = !prontas;

  $("ok-produto-lista").hidden = !ancoraAprendida(ANCORAS.lista);
  $("ok-produto-item").hidden = !ancoraAprendida(ANCORAS.item);
  $("ok-produto-fixar").hidden = !ancoraAprendida(ANCORAS.fixar);

  if (prontas) {
    $("produto-total").textContent =
      totalProdutos > 0
        ? `${totalProdutos} produto(s) na lista da sua live.`
        : "Abra a sua live para a Shopia enxergar a lista de produtos.";
  }
}

/** Manda um recado para a aba da live. Devolve se alguma aba recebeu. */
async function falarComALive(mensagem) {
  const abas = await chrome.tabs.query({ url: "*://*.tiktok.com/*" }).catch(() => []);
  const daLive = abas.filter((a) => ehUrlDeLive(a.url));
  if (daLive.length === 0) return false;
  for (const aba of daLive) chrome.tabs.sendMessage(aba.id, mensagem).catch(() => {});
  return true;
}

async function ensinar(ancora) {
  const chegou = await falarComALive({ tipo: "aprender", ancora, instrucao: INSTRUCOES[ancora] });
  if (!chegou) {
    recadoDeProduto("Abra a sua live no TikTok primeiro — é lá que você vai apontar.");
    return;
  }
  recadoDeProduto("Vá até a aba da live e clique no que foi pedido.");
}

function recadoDeProduto(texto) {
  $("produto-recado").textContent = texto ?? "";
}

const MOTIVO_FIXAR = {
  sem_ancora: "Falta ensinar onde fica o botão de fixar.",
  lista_fechada: "A lista de produtos não está à vista na live. Abra ela e tente de novo.",
  lista_vazia: "Não achei produto nenhum na lista. A sua live está com produtos?",
  sem_botao: "Achei o produto, mas não o botão de fixar dentro dele. Ensine de novo o passo 3.",
  botao_desligado: "O botão de fixar está desabilitado nesse produto.",
};

async function fixar(posicao) {
  const chegou = await falarComALive({ tipo: "fixar", posicao });
  if (!chegou) recadoDeProduto("A live não está aberta nesta janela.");
}

// ------------------------------------------------------------------ rodízio

/**
 * Roda entre os produtos sozinho.
 *
 * O ponteiro anda mesmo quando um produto falha ao fixar: parar no que falhou
 * deixaria o rodízio travado para sempre naquele item, e a live inteira
 * mostrando o produto errado.
 */
function iniciarRodizio() {
  pararRodizio();
  if (rodizioMinutos <= 0) return;
  relogioRodizio = setInterval(() => {
    if (totalProdutos <= 0) {
      void falarComALive({ tipo: "contar_produtos" });
      return;
    }
    produtoAtual = (produtoAtual % totalProdutos) + 1;
    $("produto-posicao").value = String(produtoAtual);
    void fixar(produtoAtual);
  }, rodizioMinutos * 60_000);
}

function pararRodizio() {
  clearInterval(relogioRodizio);
  relogioRodizio = null;
}

// ---------------------------------------------------------------- controle

/**
 * Um motivo só, o primeiro que impede: é o que a pessoa resolve em seguida.
 *
 * Cada modo cobra só o que ele usa. Antes, áudio e cabo eram cobrados sempre —
 * e era isso que impedia de responder comentário quem nunca quis áudio.
 */
function motivoDeBloqueio() {
  if (!estadoLicenca?.licenciada) return "A licença não está ativa.";
  if (estadoLicenca.pararAgora) return "A operação foi suspensa pelo painel.";

  if (comAudio()) {
    if (!estadoLicenca.recursos?.mixer) return "O seu plano não inclui o áudio da live.";
    if (!montagem) return "Falta o áudio da live (item 1 acima).";
    if (estadoCabo !== "ok" && estadoCabo !== "manual") {
      return "Falta achar o cabo de áudio (item 2 acima).";
    }
  }

  return null;
}

function atualizarBotao() {
  const noAr = comAudio() ? reprodutor.tocando : sessaoId !== null;
  const motivo = noAr ? null : motivoDeBloqueio();
  $("btn-tocar").disabled = Boolean(motivo);
  $("motivo-bloqueio").textContent = motivo ?? "";
  $("motivo-bloqueio").hidden = !motivo;
}

/**
 * "Estar no ar" quer dizer coisas diferentes em cada modo, e o botão tem que
 * dizer a verdade do modo em que a pessoa está.
 *
 * Com áudio, é o reprodutor: se a voz parou, a live está muda, e o botão
 * precisa oferecer entrar de novo — não "encerrar" algo que já se calou.
 * Só chat, é a sessão: não há nada tocando para consultar, e amarrar a tela ao
 * áudio deixaria o botão em "Entrar no ar" com a live já respondendo, um
 * segundo clique abrindo outra sessão, e nenhum jeito de encerrar.
 */
function pintarReproducao(estado) {
  const noAr = comAudio() ? Boolean(estado?.tocando) : sessaoId !== null;
  $("m-fala").textContent = estado?.fala?.titulo ?? (comAudio() ? "—" : "sem áudio");
  $("m-voltas").textContent = String(estado?.voltas ?? 0);
  $("btn-tocar").hidden = noAr;
  $("btn-parar").hidden = !noAr;
  $("no-ar").hidden = !noAr;
  if (!noAr) pararCronometro();
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

function iniciarCronometro(desde = null) {
  inicioNoAr = desde ?? Date.now();
  void api.gravarLocal({ [api.CHAVES.inicioNoAr]: inicioNoAr });
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
    // No modo só chat não existe montagem, e o servidor já aceita sessão sem
    // ela (`montagemId` é opcional na rota). Ler `montagem.id` direto estourava
    // aqui e derrubava o clique inteiro.
    const r = await api.abrirSessao({
      montagemId: comAudio() ? (montagem?.id ?? null) : null,
      contaTikTokId: null,
    });
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
  // iniciado fora de interação do usuário, e a falha seria silenciosa. Por
  // isso ele vem antes de abrir aba: `chrome.tabs.create` é await, e o gesto
  // já teria expirado do outro lado dele.
  if (comAudio()) void reprodutor.iniciar();

  iniciarCronometro();
  void baterSessao();
  void garantirAbaDaLive();
  iniciarRodizio();

  // Sem áudio não existe `aoMudar` do reprodutor para repintar a tela, e o
  // botão ficaria em "Entrar no ar" com a sessão já aberta.
  if (!comAudio()) pintarReproducao({ tocando: true, voltas: 0, fala: null });
}

/**
 * Garante que a live está aberta nesta janela.
 *
 * A Shopia lê o chat pela página da live no tiktok.com — sem a aba, não há o
 * que ler. Pedir para a pessoa abrir na mão era um passo que ela esquecia, e
 * o sintoma ("não responde ninguém") não aponta para a causa.
 *
 * Só ATIVA uma aba que já exista; abrir uma segunda live da mesma pessoa
 * confunde o TikTok e a própria pessoa.
 */
async function garantirAbaDaLive() {
  const abas = await chrome.tabs.query({ url: "*://*.tiktok.com/*" }).catch(() => []);
  const daLive = abas.filter((a) => ehUrlDeLive(a.url));
  if (daLive.length > 0) {
    await chrome.tabs.update(daLive[0].id, { active: true }).catch(() => {});
    return;
  }

  const usuario = usuarioTikTokValido($("usuario-tiktok").value);
  await chrome.tabs
    .create({
      url: usuario ? `https://www.tiktok.com/@${usuario}/live` : "https://www.tiktok.com/live",
      active: true,
    })
    .catch(() => {});
}

function ehUrlDeLive(url) {
  try {
    return /\/(live|studio|live_studio)(\/|$)/i.test(new URL(url ?? "", "https://x").pathname);
  } catch {
    return false;
  }
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
  pararRodizio();
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

  // Depois de zerar a sessão, nunca antes: é ela que a tela lê para saber se
  // ainda está no ar.
  pintarReproducao({ tocando: false, voltas: 0, fala: null });
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

  modo = (await api.lerLocal(api.CHAVES.modo, "chat")) === "chat_audio" ? "chat_audio" : "chat";
  const escolhido = document.querySelector(`input[name="modo"][value="${modo}"]`);
  if (escolhido) escolhido.checked = true;

  rodizioMinutos = Number(await api.lerLocal(api.CHAVES.rodizioMinutos, 0)) || 0;
  $("rodizio").value = String(rodizioMinutos);

  ancorasLocais = (await api.lerLocal(api.CHAVES.ancorasLocais)) ?? {};

  aplicarModo();
  pintarProdutos();
}

/** O modo decide o que a tela mostra e o que o portão cobra. */
function aplicarModo() {
  $("bloco-audio").hidden = !comAudio();
  $("bloco-cabo").hidden = !comAudio();
  atualizarBotao();
}

async function abrirOperacao() {
  mostrar("operar");
  await carregarPreferencias();
  await retomarSessao();
  const estado = await atualizarEstado();
  await Promise.all([carregarSaidas(), conferirChat()]);
  if (estado?.licenciada) await carregarMontagem();
  else pintarProtecao();
}

/**
 * Reassume a sessão que ficou aberta com o painel fechado.
 *
 * Sem isto, reabrir o painel no modo só chat mostraria "Entrar no ar" com a
 * live já respondendo — e, pior, escondendo o "Encerrar": a pessoa não teria
 * como desligar pelo lugar de onde ligou. É o preço de deixar a sessão
 * sobreviver ao painel, e tem que ser pago aqui.
 */
async function retomarSessao() {
  const guardada = await api.lerLocal(api.CHAVES.sessao);
  if (!guardada) return;

  // No modo com áudio, retomar seria mentira: o motor de som mora neste painel
  // e não estava tocando nada enquanto ele esteve fechado. Mostrar "no ar"
  // com a live muda é pior do que fechar e deixar a pessoa entrar de novo.
  if (comAudio()) {
    sessaoId = guardada;
    await encerrar("painel reaberto sem áudio tocando");
    return;
  }

  try {
    await api.baterSessao(guardada, null);
  } catch {
    // Servidor fechou (409) ou está fora do ar. Nos dois casos, não assumimos
    // uma sessão que talvez não exista: o próximo "Entrar no ar" abre outra, e
    // abrir sessão já é idempotente do lado de lá.
    await chrome.storage.local.remove(api.CHAVES.sessao);
    return;
  }

  sessaoId = guardada;
  const desde = Number(await api.lerLocal(api.CHAVES.inicioNoAr, 0)) || Date.now();
  iniciarCronometro(desde);
  void baterSessao();
  iniciarRodizio();
  pintarReproducao({ tocando: false, voltas: 0, fala: null });
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

// --- modo ---

for (const radio of document.querySelectorAll('input[name="modo"]')) {
  radio.addEventListener("change", async (evento) => {
    if (!evento.target.checked) return;
    modo = evento.target.value === "chat_audio" ? "chat_audio" : "chat";
    await api.gravarLocal({ [api.CHAVES.modo]: modo });
    aplicarModo();
    // Trocar para o modo com áudio exige o cabo, que pode nunca ter sido
    // procurado — quem começou sem áudio nunca passou por essa tela.
    if (comAudio()) {
      await carregarSaidas();
      if (!montagem) await carregarMontagem();
    }
  });
}

// --- produtos ---

for (const id of ["btn-ensinar-lista", "btn-ensinar-item", "btn-ensinar-fixar"]) {
  $(id).addEventListener("click", (evento) => void ensinar(evento.currentTarget.dataset.ancora));
}

$("btn-reensinar").addEventListener("click", async () => {
  ancorasLocais = {};
  await api.gravarLocal({ [api.CHAVES.ancorasLocais]: {} });
  totalProdutos = 0;
  pintarProdutos();
  recadoDeProduto("");
});

$("btn-fixar").addEventListener("click", () => {
  produtoAtual = Math.max(1, Number($("produto-posicao").value) || 1);
  recadoDeProduto("Fixando…");
  void fixar(produtoAtual);
});

$("rodizio").addEventListener("change", async (evento) => {
  rodizioMinutos = Number(evento.target.value) || 0;
  await api.gravarLocal({ [api.CHAVES.rodizioMinutos]: rodizioMinutos });
  if (sessaoId) iniciarRodizio();
  else pararRodizio();
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

  // --- produtos ---
  if (mensagem?.tipo === "aprendeu") {
    if (mensagem.cancelado) {
      recadoDeProduto("Cancelado.");
    } else if (Array.isArray(mensagem.cascata) && mensagem.cascata.length > 0) {
      ancorasLocais = { ...ancorasLocais, [mensagem.ancora]: mensagem.cascata };
      recadoDeProduto("Anotado.");
      void falarComALive({ tipo: "contar_produtos" });
    } else {
      recadoDeProduto("Não consegui descrever o que você clicou. Tente clicar no botão em si.");
    }
    pintarProdutos();
  }
  if (mensagem?.tipo === "produtos") {
    totalProdutos = mensagem.total ?? 0;
    pintarProdutos();
  }
  if (mensagem?.tipo === "fixou") {
    recadoDeProduto(
      mensagem.ok
        ? `Produto ${mensagem.posicao} fixado.`
        : mensagem.motivo === "posicao_inexistente"
          ? `A sua live tem ${mensagem.total} produto(s); não existe o número ${$("produto-posicao").value}.`
          : (MOTIVO_FIXAR[mensagem.motivo] ?? "Não deu para fixar."),
    );
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

// Com áudio, fechar o painel é sair do ar: o motor de som mora aqui, e sem ele
// não há quem toque. No modo só chat não é: quem lê o chat é o content script
// e quem bate a sessão é o service worker, então a live continua respondendo
// com o painel fechado — que é o comportamento que a pessoa espera de algo que
// ela deixou ligado.
window.addEventListener("pagehide", () => {
  if (comAudio() && reprodutor.tocando) void encerrar("painel fechado");
});

void iniciar();
