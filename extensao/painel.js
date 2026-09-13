// Painel lateral: a casa do motor de áudio.
//
// Fica aqui e não no service worker porque em MV3 o worker morre ocioso, e
// áudio que para no meio da live é o produto quebrado. Enquanto este painel
// estiver aberto, a apresentadora fala.

import * as api from "./api.js";
import { Reprodutor, procurarCabo, listarSaidas, liberarRotulos, pareceCabo } from "./audio.js";

const $ = (id) => document.getElementById(id);

const tela = { entrar: $("tela-entrar"), operar: $("tela-operar") };
let montagem = null;
let sessaoId = null;
let comentariosLidos = 0;

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

// ---------------------------------------------------------------- licença

function pintarLicenca(estado) {
  const ponto = $("ponto-licenca");
  const texto = $("texto-licenca");

  if (estado.pararAgora) {
    ponto.dataset.cor = "ruim";
    texto.textContent = "Operação suspensa";
    mostrarErro($("aviso-parar"), estado.pararMotivo || "O painel pediu para parar agora.");
    $("aviso-parar").hidden = false;
    if (reprodutor.tocando) void encerrar("suspensa pelo painel");
  } else {
    $("aviso-parar").hidden = true;
  }

  if (estado.licenciada && !estado.pararAgora) {
    ponto.dataset.cor = "ok";
    const partes = ["Licença ativa"];
    if (!estado.recursos?.mixer) partes.push("sem áudio no plano");
    if (!estado.recursos?.chat) partes.push("chat desligado");
    texto.textContent = partes.join(" · ");
  } else if (estado.motivo === "offline") {
    ponto.dataset.cor = "alerta";
    texto.textContent = "Sem conexão — seguindo com a licença anterior";
  } else if (!estado.licenciada) {
    ponto.dataset.cor = "ruim";
    texto.textContent = rotuloDoMotivo(estado.motivo);
  }

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

  // Sem mixer não há o que tocar, e o botão precisa dizer por quê em vez de
  // simplesmente não funcionar.
  $("btn-tocar").disabled = !estado.licenciada || estado.pararAgora || !estado.recursos?.mixer;
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

async function carregarSaidas() {
  await liberarRotulos();
  const saidas = await listarSaidas();
  const select = $("saidas");
  const guardado = await api.lerLocal(api.CHAVES.cabo);

  select.innerHTML = "";
  for (const s of saidas) {
    const opcao = document.createElement("option");
    opcao.value = s.id;
    opcao.textContent = pareceCabo(s.rotulo) ? `${s.rotulo}  ✓ cabo` : s.rotulo;
    select.append(opcao);
  }

  const cabo = await procurarCabo();
  const escolhido = guardado || cabo?.id || saidas[0]?.id || null;
  if (escolhido) select.value = escolhido;

  $("cabo-nao-achado").hidden = Boolean(cabo);
  reprodutor.definirCabo(escolhido);
  return escolhido;
}

// ---------------------------------------------------------------- montagem

async function carregarMontagem() {
  const resumo = $("montagem-resumo");
  try {
    const r = await api.montagem();
    montagem = r.montagem;
    reprodutor.definirMontagem(montagem);

    const blocos = montagem.falas.reduce((t, f) => t + f.blocos.length, 0);
    const minutos = Math.round(
      montagem.falas.reduce((t, f) => t + (f.duracaoMs || 0), 0) / 60000,
    );

    $("montagem-nome").textContent = montagem.nome;
    resumo.textContent =
      `${montagem.falas.length} áudio(s) · ${blocos} blocos · ~${minutos} min por volta` +
      (montagem.trilha ? ` · trilha "${montagem.trilha.nome}"` : "");
    mostrarErro($("erro-operar"), null);
  } catch (erro) {
    montagem = null;
    $("montagem-nome").textContent = "—";
    resumo.textContent = "";
    mostrarErro(
      $("erro-operar"),
      erro.codigo === "sem_montagem"
        ? "Nenhuma montagem ativa. Monte o áudio da live no painel da Shopia."
        : erro.codigo === "montagem_vazia"
          ? "A montagem ativa não tem nenhum bloco pronto."
          : erro.message,
    );
  }
  $("btn-tocar").disabled = !montagem;
}

// ---------------------------------------------------------------- operar

function pintarReproducao(estado) {
  $("m-fala").textContent = estado.fala?.titulo ?? "—";
  $("m-voltas").textContent = String(estado.voltas);
  $("btn-tocar").hidden = estado.tocando;
  $("btn-parar").hidden = !estado.tocando;
}

async function entrarNoAr() {
  mostrarErro($("erro-operar"), null);
  if (!montagem) return;

  try {
    const r = await api.abrirSessao({ montagemId: montagem.id, contaTikTokId: null });
    sessaoId = r.sessaoId;
    await chrome.runtime.sendMessage({ tipo: "sessao", sessaoId }).catch(() => {});
  } catch (erro) {
    mostrarErro($("erro-operar"), `Não deu para abrir a sessão: ${erro.message}`);
    return;
  }

  // O play tem que sair do mesmo gesto do clique: navegador recusa áudio
  // iniciado fora de interação do usuário, e a falha seria silenciosa.
  void reprodutor.iniciar();
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

async function iniciar() {
  $("versao").textContent = "v" + chrome.runtime.getManifest().version;

  if (!(await api.token())) {
    mostrar("entrar");
    return;
  }

  mostrar("operar");
  const estado = await atualizarEstado();
  await carregarSaidas();
  if (estado?.licenciada) await carregarMontagem();
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
  mostrar("operar");
  await carregarSaidas();
  await carregarMontagem();
});

$("btn-procurar").addEventListener("click", () => void carregarSaidas());
$("btn-recarregar").addEventListener("click", () => void carregarMontagem());
$("btn-tocar").addEventListener("click", () => void entrarNoAr());
$("btn-parar").addEventListener("click", () => void encerrar("encerrada pelo usuário"));

$("saidas").addEventListener("change", async (evento) => {
  const id = evento.target.value;
  reprodutor.definirCabo(id);
  await api.gravarLocal({ [api.CHAVES.cabo]: id });
});

$("btn-sair").addEventListener("click", async () => {
  await encerrar("desconectado");
  await api.esquecerToken();
  mostrar("entrar");
});

chrome.runtime.onMessage.addListener((mensagem) => {
  if (mensagem?.tipo === "estado") pintarLicenca(mensagem.estado);
  if (mensagem?.tipo === "parar") void encerrar(mensagem.motivo ?? "suspensa");
  if (mensagem?.tipo === "chat") {
    comentariosLidos += mensagem.quantidade ?? 0;
    $("m-chat").textContent = String(comentariosLidos);
  }
});

// Fechar o painel é o mesmo que sair do ar: sem ele, não há quem toque.
window.addEventListener("pagehide", () => {
  if (reprodutor.tocando) void encerrar("painel fechado");
});

void iniciar();
