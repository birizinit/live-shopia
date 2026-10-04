// Painel lateral: o controle da moderação.
//
// O painel é organizado como a lista do que falta para entrar no ar, e cada
// pendência traz o botão que a resolve. Quem abre a extensão pela primeira vez
// não deveria precisar de manual para saber o que fazer em seguida.
//
// Quem lê o chat é o content script, na aba da live; quem guarda o token é o
// service worker. Este painel só manda e mostra — por isso fechá-lo NÃO
// derruba a live, e o batimento da sessão mora num `chrome.alarms` do worker,
// que sobrevive à morte dele.

import * as api from "./api.js";
import { ANCORAS } from "./produtos.js";

const $ = (id) => document.getElementById(id);

const tela = { entrar: $("tela-entrar"), operar: $("tela-operar") };
let estadoLicenca = null;
let protecao = null;
let sessaoId = null;
let comentariosLidos = 0;
let respostasDadas = 0;
let carrinhos = 0;
let vendas = 0;

/** O que o servidor diz das automações. A extensão não guarda cópia. */
let auto = null;

/** Âncoras de produto que esta instalação já aprendeu. */
let ancorasLocais = {};
let rodizioMinutos = 0;
let relogioRodizio = null;
let produtoAtual = 1;
let totalProdutos = 0;

let inicioNoAr = null;
let relogioCronometro = null;
let limiteMinutos = 0;

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
    if (sessaoId) void encerrar("suspensa pelo painel");
  } else {
    $("aviso-parar").hidden = true;
  }

  if (estado.licenciada && !estado.pararAgora) {
    pintarPonto("ponto-licenca", "ok");
    const partes = ["Licença ativa"];
    if (!estado.recursos?.chat) partes.push("chat desligado");
    texto.textContent = partes.join(" · ");
  } else if (estado.motivo === "offline") {
    pintarPonto("ponto-licenca", "alerta");
    texto.textContent = "Sem conexão — seguindo com a licença anterior";
  } else if (!estado.licenciada) {
    pintarPonto("ponto-licenca", "ruim");
    texto.textContent = rotuloDoMotivo(estado.motivo);
  }

  protecao = estado?.protecao ?? null;
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
 *
 * O alvo é o MANUAL, porque é de lá que sai, palavra por palavra, tudo o que a
 * Shopia escreve no chat. Revisar na hora do envio seria tarde: a frase já
 * estaria escolhida, e recusá-la ao vivo deixaria a pessoa sem resposta sem
 * saber por quê.
 */
function pintarProtecao() {
  const lista = $("protecao");
  lista.innerHTML = "";
  const revisar = $("btn-revisar");
  revisar.hidden = true;

  if (!protecao) {
    lista.append(itemProtecao("A revisão do manual aparece no próximo contato com o servidor."));
  } else if (protecao.alertas === 0) {
    lista.append(
      itemProtecao(
        "Manual revisado: nada de contato fora do TikTok, Pix por fora ou promessa de resultado.",
      ),
    );
  } else {
    const exemplos = protecao.itens.flatMap((i) => i.exemplos).slice(0, 3);
    lista.append(
      itemProtecao(
        `${protecao.alertas} trecho(s) do seu manual costumam restringir a live: ` +
          exemplos.map((e) => `“${e}”`).join(", ") + ".",
        "alerta",
      ),
    );
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

// ---------------------------------------------------------------- automações
//
// O texto de cada aviso se escreve no painel do site: lá dá para ler a frase
// inteira e lá a revisão anti-restrição aponta o trecho que costuma restringir
// a live. Aqui ficam o interruptor, o ritmo e o "disparar agora" — porque é
// aqui que a mão da pessoa está com a live no ar.
//
// Nada é guardado localmente. A mesma conta pode ter o painel do site aberto
// noutra janela, e dois lugares guardando o mesmo interruptor é a receita de um
// desligar o que o outro acabou de ligar.

function recadoAuto(texto) {
  $("auto-recado").textContent = texto ?? "";
}

async function carregarAutomacoes() {
  try {
    const r = await api.automacoes({ acao: "ler" });
    auto = r;
    pintarAutomacoes();
    recadoAuto("");
  } catch (erro) {
    auto = null;
    recadoAuto(`Não deu para ler as automações: ${erro.message}`);
  }
}

/** Aplica no servidor e repinta com o que ELE devolveu, não com o que eu pedi. */
async function mandarAuto(corpo, aviso = "Salvo.") {
  recadoAuto("Salvando…");
  try {
    const r = await api.automacoes(corpo);
    if (r.config) auto = { ...auto, config: r.config };
    if (r.avisos) auto = { ...auto, avisos: r.avisos };
    pintarAutomacoes();
    recadoAuto(aviso);
  } catch (erro) {
    // Repinta a partir do servidor: o interruptor tem de voltar sozinho ao
    // estado real, senão a tela mente sobre o que está ligado.
    recadoAuto(erro.detalhe || erro.message || "Não deu para salvar.");
    void carregarAutomacoes();
  }
}

function pintarAutomacoes() {
  const temAlgo = Boolean(auto?.config);
  $("auto-vazio").hidden = temAlgo;
  $("auto-refixar").hidden = !temAlgo;
  $("auto-loja").hidden = !temAlgo;
  if (!temAlgo) {
    $("auto-relampago").hidden = true;
    $("auto-aviso").hidden = true;
    return;
  }

  const c = auto.config;
  $("sw-refixar").checked = c.refixarAtivo;
  $("auto-refixar-s").value = String(c.refixarIntervaloS);
  $("auto-refixar-pos").value = String(c.refixarPosicao);
  $("auto-refixar-s").min = String(auto.limites?.intervaloMinS ?? 30);
  $("auto-refixar-s").max = String(auto.limites?.intervaloMaxS ?? 3600);

  $("sw-carrinho").checked = c.carrinhoAtivo;
  $("sw-venda").checked = c.vendaAtivo;
  $("sw-sino").checked = c.sinoAtivo;

  // Mostrar o texto configurado ao lado do interruptor é o que evita a pessoa
  // ligar sem lembrar o que ela escreveu — e descobrir ao vivo.
  $("txt-carrinho").textContent = c.carrinhoTexto
    ? `“${c.carrinhoTexto}”`
    : "Sem texto escrito. Ligue no painel do site, onde dá para escrever.";
  $("txt-venda").textContent = c.vendaTexto
    ? `“${c.vendaTexto}”`
    : "Sem texto escrito. Ligue no painel do site, onde dá para escrever.";

  // Um interruptor que não tem o que dizer fica desabilitado em vez de
  // enganar: ligado sem texto, a Shopia detectaria a venda e ficaria calada.
  $("sw-carrinho").disabled = !c.carrinhoTexto;
  $("sw-venda").disabled = !c.vendaTexto;

  pintarListaDeAvisos("relampago", $("lista-relampago"), $("auto-relampago"));
  pintarListaDeAvisos("aviso", $("lista-aviso"), $("auto-aviso"));
}

function pintarListaDeAvisos(tipo, lista, caixa) {
  const itens = (auto?.avisos ?? []).filter((a) => a.tipo === tipo);
  caixa.hidden = itens.length === 0;
  lista.innerHTML = "";

  for (const aviso of itens) {
    const li = document.createElement("li");

    const linha = document.createElement("label");
    linha.className = "interruptor";
    const marca = document.createElement("input");
    marca.type = "checkbox";
    marca.checked = aviso.ativo;
    marca.addEventListener("change", () =>
      void mandarAuto(
        { acao: "aviso", avisoId: aviso.id, ativo: marca.checked },
        marca.checked ? "Ligado." : "Desligado.",
      ),
    );
    const rotulo = document.createElement("span");
    const forte = document.createElement("strong");
    forte.textContent = tipo === "relampago" ? "Oferta relâmpago" : "Aviso";
    rotulo.append(forte);
    linha.append(marca, rotulo);

    const texto = document.createElement("span");
    texto.className = "texto-aviso";
    texto.textContent = `“${aviso.texto}”`;

    const controles = document.createElement("div");
    controles.className = "controles";

    const campo = document.createElement("input");
    campo.type = "number";
    campo.min = String(auto.limites?.intervaloMinS ?? 30);
    campo.max = String(auto.limites?.intervaloMaxS ?? 3600);
    campo.step = "10";
    campo.value = String(aviso.intervaloS);
    campo.setAttribute("aria-label", "Intervalo em segundos");
    campo.addEventListener("change", () =>
      void mandarAuto(
        { acao: "aviso_intervalo", avisoId: aviso.id, segundos: Number(campo.value) || 300 },
        "Ritmo salvo.",
      ),
    );

    const seg = document.createElement("span");
    seg.className = "ajuda";
    seg.textContent = "segundos";

    const disparar = document.createElement("button");
    disparar.className = "botao pequeno empurra";
    disparar.textContent = "Disparar agora";
    disparar.addEventListener("click", () => void dispararAgora(aviso));

    controles.append(campo, seg, disparar);
    li.append(linha, texto, controles);
    lista.append(li);
  }
}

const MOTIVO_DISPARO = {
  sem_aviso: "Esse aviso não existe mais.",
  desligado: "Ligue o aviso antes de disparar.",
  teto_por_minuto:
    "O chat já recebeu o máximo de mensagens deste minuto. Espere um pouco — esse limite é o que protege a sua conta.",
};

/**
 * Dispara pulando o intervalo, que é o ponto da oferta relâmpago.
 *
 * O que não se pula é o teto por minuto: ele vale até para o que o vendedor
 * pediu de propósito, porque não protege contra a vontade dele — protege a
 * conta dele.
 */
async function dispararAgora(aviso) {
  if (!sessaoId) {
    recadoAuto("Entre no ar primeiro: sem live aberta não há chat para escrever.");
    return;
  }

  recadoAuto("Disparando…");
  let r;
  try {
    r = await api.automacoes({ acao: "disparar", avisoId: aviso.id, sessaoId });
  } catch (erro) {
    recadoAuto(erro.detalhe || erro.message || "Não deu para disparar.");
    return;
  }

  if (!r.enviar) {
    recadoAuto(MOTIVO_DISPARO[r.motivo] ?? "Não deu para disparar agora.");
    return;
  }

  const chegou = await falarComALive({
    tipo: "programado_escrever",
    texto: r.texto,
    tema: r.tema,
    avisoId: r.avisoId,
  });
  recadoAuto(chegou ? "Mandado para a live." : "A página da sua live não está aberta.");
}

// ---------------------------------------------------------------- sininho
//
// Som gerado, e não arquivo: um .mp3 de sino no pacote seria mais um binário
// para baixar, mais um caminho para o Chrome recusar por CSP, e mais uma coisa
// para versionar. Dois tons curtos de oscilador fazem o mesmo trabalho em vinte
// linhas e sem nenhum arquivo.
//
// Toca AQUI e não no service worker porque o worker não tem contexto de áudio —
// ele nem é uma página. Com o painel fechado o sino não toca, e isso é honesto:
// quem fechou a janela não está olhando para ela.

let audio = null;

function tocarSino() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();

    const agora = audio.currentTime;
    // Duas notas, a segunda uma quinta acima: é o que faz soar "caixa
    // registradora" em vez de "alerta de erro".
    for (const [atraso, hz] of [
      [0, 880],
      [0.12, 1320],
    ]) {
      const osc = audio.createOscillator();
      const ganho = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      ganho.gain.setValueAtTime(0, agora + atraso);
      ganho.gain.linearRampToValueAtTime(0.18, agora + atraso + 0.01);
      ganho.gain.exponentialRampToValueAtTime(0.0001, agora + atraso + 0.35);
      osc.connect(ganho).connect(audio.destination);
      osc.start(agora + atraso);
      osc.stop(agora + atraso + 0.4);
    }
  } catch {
    // Sem áudio o contador continua subindo. Sino é enfeite; contador não.
  }
}

// ------------------------------------------------------- diagnóstico do chat
//
// "Ela não respondeu" tem quatro causas que ninguém distingue olhando a live:
// o campo do chat não foi achado, o botão de enviar não foi achado, a cadência
// segurou, ou a pergunta não está no manual. Este bloco separa as duas
// primeiras — as únicas que a extensão pode conferir sozinha.

function recadoDoChat(texto) {
  $("recado-chat").textContent = texto ?? "";
}

function itemDeEnsaio(texto, tom = "ok") {
  const li = document.createElement("li");
  li.textContent = texto;
  li.dataset.tom = tom;
  return li;
}

function pintarEnsaio(r) {
  const lista = $("resultado-ensaio");
  lista.innerHTML = "";
  lista.hidden = false;
  $("ensinar-envio").hidden = true;
  $("envio-de-verdade").hidden = true;

  if (!r.campo) {
    lista.append(itemDeEnsaio("Não achei o campo de escrever do chat nesta página.", "ruim"));
    lista.append(
      itemDeEnsaio("Confira se a página da sua live está aberta e o chat visível.", "alerta"),
    );
    return;
  }

  lista.append(itemDeEnsaio(`Campo do chat achado (${r.editavel}).`));
  if (r.teto) {
    lista.append(itemDeEnsaio(`O TikTok limita a mensagem a ${r.teto} caracteres.`));
  }

  if (!r.tecnica) {
    lista.append(itemDeEnsaio("Não consegui pôr texto nele por nenhum caminho.", "ruim"));
    return;
  }

  lista.append(itemDeEnsaio(`Texto entrou por ${TECNICA[r.tecnica] ?? r.tecnica}.`));

  // Este é o item que importa: o botão acender é a prova de que o editor do
  // TikTok REGISTROU o texto, e não só que o texto está na árvore do DOM.
  const BOTAO = {
    pronto: ["ok", "O botão de enviar acendeu — o editor reconheceu o texto."],
    escondido: [
      "ruim",
      "O botão de enviar continua apagado: o editor NÃO reconheceu o texto. " +
        "É exatamente a falha da sua primeira live.",
    ],
    desabilitado: ["ruim", "O botão de enviar está desabilitado mesmo com texto no campo."],
    nao_achado: ["alerta", "Não achei o botão de enviar nesta página."],
  };
  const [tom, texto] = BOTAO[r.botao] ?? BOTAO.nao_achado;
  lista.append(itemDeEnsaio(texto, tom));

  if (r.dentroDeFormulario) {
    lista.append(itemDeEnsaio("O campo está dentro de um formulário — há um caminho extra de envio."));
  }

  // Ensinar o botão só é oferecido quando ele é o que falta. Oferecer sempre
  // faria a pessoa apontar coisa que já funcionava.
  $("ensinar-envio").hidden = r.botao !== "nao_achado";
  $("envio-de-verdade").hidden = false;

  recadoDoChat(
    r.aceito
      ? "Tudo que dá para conferir sem enviar está certo. Se ela ainda não responde, " +
          "o motivo é a cadência ou a pergunta não estar no manual."
      : "O teste sem enviar já mostrou o problema. Vale tentar o envio de verdade: " +
          "às vezes o botão só acende depois de o editor processar, e o Enter ainda passa.",
  );
}

// ---------------------------------------------------------------- produtos

const INSTRUCOES = {
  "chat.enviar": "Clique no botão de ENVIAR do chat da live (o de mandar a mensagem). Esc cancela.",
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

/** Como o envio saiu, para a tela dizer em português. */
const CAMINHO_ENVIO = {
  botao: "botão de enviar",
  enter: "tecla Enter",
  formulario: "envio do formulário",
};

const MOTIVO_ENVIO = {
  sem_campo: "não achei o campo de escrever do chat na página.",
  nao_digitou: "achei o campo, mas não consegui pôr texto nele de jeito nenhum.",
  editor_nao_registrou:
    "o texto entrou no campo, mas o editor do TikTok não o reconheceu — o botão de " +
    "enviar não acendeu. Foi isto que aconteceu na sua primeira live.",
  nao_enviou:
    "o editor reconheceu o texto, o botão acendeu, e ainda assim nada saiu. " +
    "Apaguei o texto para não deixar lixo na sua caixa.",
};

/** As técnicas de digitação, na ordem em que são tentadas. */
const TECNICA = {
  digitacao: "digitação",
  input: "evento de entrada",
  colagem: "colagem",
  atribuicao: "escrita direta",
};

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
 * A licença é a única coisa que IMPEDE. Manual vazio não impede: a Shopia
 * entra no ar, lê o chat e cala — e o aviso de manual vazio aparece como
 * pendência, não como tranca. Quem está com a live já rodando não pode ser
 * barrado por causa de cadastro.
 */
function motivoDeBloqueio() {
  if (!estadoLicenca?.licenciada) return "A licença não está ativa.";
  if (estadoLicenca.pararAgora) return "A operação foi suspensa pelo painel.";
  return null;
}

function atualizarBotao() {
  const noAr = sessaoId !== null;
  const motivo = noAr ? null : motivoDeBloqueio();
  $("btn-tocar").disabled = Boolean(motivo);
  $("motivo-bloqueio").textContent = motivo ?? "";
  $("motivo-bloqueio").hidden = !motivo;
}

/** Quem manda no "está no ar" é a SESSÃO: é ela que o servidor conhece. */
function pintarEstadoDoAr() {
  const noAr = sessaoId !== null;
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
    const r = await api.abrirSessao({ contaTikTokId: null });
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

  iniciarCronometro();
  void baterSessao();
  void garantirAbaDaLive();
  iniciarRodizio();
  pintarEstadoDoAr();
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
    if (!sessaoId) return;
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
  pintarEstadoDoAr();
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

  rodizioMinutos = Number(await api.lerLocal(api.CHAVES.rodizioMinutos, 0)) || 0;
  $("rodizio").value = String(rodizioMinutos);

  ancorasLocais = (await api.lerLocal(api.CHAVES.ancorasLocais)) ?? {};

  atualizarBotao();
  pintarProdutos();
}

async function abrirOperacao() {
  mostrar("operar");
  await carregarPreferencias();
  await retomarSessao();
  await atualizarEstado();
  await Promise.all([conferirChat(), carregarAutomacoes()]);
}

/**
 * Reassume a sessão que ficou aberta com o painel fechado.
 *
 * Sem isto, reabrir o painel mostraria "Entrar no ar" com a live já
 * respondendo — e, pior, escondendo o "Encerrar": a pessoa não teria como
 * desligar pelo lugar de onde ligou. É o preço de deixar a sessão sobreviver
 * ao painel, e tem que ser pago aqui.
 */
async function retomarSessao() {
  const guardada = await api.lerLocal(api.CHAVES.sessao);
  if (!guardada) return;

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
  pintarEstadoDoAr();
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
$("btn-tocar").addEventListener("click", () => void entrarNoAr());
$("btn-parar").addEventListener("click", () => void encerrar("encerrada pelo usuário"));
$("btn-revisar").addEventListener("click", () => void api.abrirNoSite("/manual"));

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

// --- automações ---

$("btn-recarregar-auto").addEventListener("click", () => void carregarAutomacoes());
$("btn-editar-textos").addEventListener("click", () => void api.abrirNoSite("/automacoes"));

for (const [id, chave] of [
  ["sw-refixar", "refixarAtivo"],
  ["sw-carrinho", "carrinhoAtivo"],
  ["sw-venda", "vendaAtivo"],
  ["sw-sino", "sinoAtivo"],
]) {
  $(id).addEventListener("change", (evento) =>
    void mandarAuto(
      { acao: "alternar", chave, valor: evento.target.checked },
      evento.target.checked ? "Ligado." : "Desligado.",
    ),
  );
}

$("auto-refixar-s").addEventListener("change", (evento) =>
  void mandarAuto({ acao: "intervalo", segundos: Number(evento.target.value) || 180 }, "Ritmo salvo."),
);

$("auto-refixar-pos").addEventListener("change", (evento) =>
  void mandarAuto({ acao: "posicao", posicao: Number(evento.target.value) || 1 }, "Produto salvo."),
);

// --- diagnóstico do chat ---

$("btn-ensaiar").addEventListener("click", async () => {
  recadoDoChat("Testando na aba da live…");
  const chegou = await falarComALive({ tipo: "ensaiar_envio" });
  if (!chegou) recadoDoChat("A página da sua live não está aberta nesta janela do Chrome.");
});

$("btn-ensinar-enviar").addEventListener("click", (evento) =>
  void ensinar(evento.currentTarget.dataset.ancora),
);

$("btn-enviar-teste").addEventListener("click", async () => {
  recadoDoChat("Enviando…");
  const chegou = await falarComALive({
    tipo: "enviar_teste",
    texto: $("texto-teste").value,
  });
  if (!chegou) recadoDoChat("A página da sua live não está aberta nesta janela do Chrome.");
});

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

$("btn-sair").addEventListener("click", async () => {
  await encerrar("desconectado");
  await api.esquecerToken();
  mostrar("entrar");
});

chrome.runtime.onMessage.addListener((mensagem) => {
  if (mensagem?.tipo === "estado") pintarLicenca(mensagem.estado);
  if (mensagem?.tipo === "parar") void encerrar(mensagem.motivo ?? "suspensa");
  if (mensagem?.tipo === "chat_status") pintarChat(mensagem.estado);
  if (mensagem?.tipo === "chat") {
    comentariosLidos += mensagem.quantidade ?? 0;
    $("m-chat").textContent = String(comentariosLidos);
  }
  if (mensagem?.tipo === "respondeu") {
    respostasDadas += 1;
    $("m-resposta").textContent = String(respostasDadas);
  }

  // --- produtos ---
  if (mensagem?.tipo === "aprendeu") {
    if (mensagem.cancelado) {
      recadoDeProduto("Cancelado.");
    } else if (Array.isArray(mensagem.cascata) && mensagem.cascata.length > 0) {
      ancorasLocais = { ...ancorasLocais, [mensagem.ancora]: mensagem.cascata };
      if (mensagem.ancora === "chat.enviar") {
        recadoDoChat("Anotado. Testando de novo com o botão que você apontou…");
        void falarComALive({ tipo: "ensaiar_envio" });
      } else {
        recadoDeProduto("Anotado.");
        void falarComALive({ tipo: "contar_produtos" });
      }
    } else {
      recadoDeProduto("Não consegui descrever o que você clicou. Tente clicar no botão em si.");
    }
    pintarProdutos();
  }
  if (mensagem?.tipo === "produtos") {
    totalProdutos = mensagem.total ?? 0;
    pintarProdutos();
  }
  if (mensagem?.tipo === "loja") {
    if (mensagem.qual === "venda") {
      vendas += 1;
      $("m-venda").textContent = String(vendas);
      if (estadoLicenca?.sinoAtivo !== false) tocarSino();
    } else if (mensagem.qual === "carrinho") {
      carrinhos += 1;
      $("m-carrinho").textContent = String(carrinhos);
    }
  }

  if (mensagem?.tipo === "ensaio") pintarEnsaio(mensagem);

  if (mensagem?.tipo === "teste_enviado") {
    recadoDoChat(
      mensagem.ok
        ? `Enviou pela ${CAMINHO_ENVIO[mensagem.por] ?? mensagem.por}` +
            `, com o texto entrando por ${TECNICA[mensagem.tecnica] ?? mensagem.tecnica}. ` +
            "A mensagem está na sua live."
        : (MOTIVO_ENVIO[mensagem.motivo] ?? "Não deu para enviar."),
    );
    if (!mensagem.ok) $("ensinar-envio").hidden = false;
  }

  if (mensagem?.tipo === "envio_falhou") {
    recadoDoChat(
      `Uma resposta não saiu: ${MOTIVO_ENVIO[mensagem.motivo] ?? mensagem.motivo}. ` +
        "Abra “Ela não está respondendo?” acima.",
    );
    $("diagnostico").open = true;
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

// A aba da live abriu, fechou ou trocou de página: o estado do chat muda junto.
chrome.tabs.onUpdated.addListener((_id, mudanca) => {
  if (mudanca.status === "complete" || mudanca.url) void conferirChat();
});
chrome.tabs.onRemoved.addListener(() => void conferirChat());

// Fechar o painel NÃO derruba a live, de propósito: quem lê o chat é o content
// script e quem bate a sessão é o service worker. É o comportamento que a
// pessoa espera de algo que ela deixou ligado — e é por isso que "Encerrar"
// existe como botão.

void iniciar();
