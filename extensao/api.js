// Cliente da API da Shopia.
//
// Toda chamada daqui autentica por TOKEN DE LICENÇA no cabeçalho, nunca por
// cookie: a extensão roda numa aba do TikTok e não deve ter — nem precisa —
// o cookie do painel.
//
// O endereço do servidor mora numa constante só. Se um dia ele mudar, muda
// aqui e em host_permissions do manifest, e em mais lugar nenhum.

export const SERVIDOR = "https://liveshopia.up.railway.app";

/** Chaves do chrome.storage.local. Nome em um lugar só evita erro de digitação. */
export const CHAVES = {
  token: "shopia_token",
  instalacao: "shopia_instalacao",
  mapa: "shopia_mapa",
  mapaVersao: "shopia_mapa_versao",
  sessao: "shopia_sessao",
  cabo: "shopia_cabo",
};

export class ErroApi extends Error {
  constructor(codigo, status, detalhe) {
    super(detalhe || codigo);
    this.codigo = codigo;
    this.status = status;
  }
}

export async function lerLocal(chave, padrao = null) {
  const r = await chrome.storage.local.get(chave);
  return r[chave] ?? padrao;
}

export async function gravarLocal(valores) {
  await chrome.storage.local.set(valores);
}

/**
 * Identificador desta instalação.
 *
 * Não é identidade de pessoa: serve para o painel mostrar "três máquinas
 * usando esta conta" e para a telemetria de quebra ter denominador — sem ele,
 * "dez falhas" pode ser dez clientes ou um cliente dez vezes.
 */
export async function chaveDaInstalacao() {
  let chave = await lerLocal(CHAVES.instalacao);
  if (!chave) {
    chave = crypto.randomUUID();
    await gravarLocal({ [CHAVES.instalacao]: chave });
  }
  return chave;
}

export async function token() {
  return lerLocal(CHAVES.token);
}

export async function guardarToken(valor) {
  await gravarLocal({ [CHAVES.token]: valor.trim() });
}

export async function esquecerToken() {
  await chrome.storage.local.remove([CHAVES.token, CHAVES.sessao]);
}

function sistema() {
  const p = navigator.platform || "";
  if (/win/i.test(p)) return "windows";
  if (/mac/i.test(p)) return "macos";
  if (/linux/i.test(p)) return "linux";
  return "outro";
}

async function chamar(caminho, { metodo = "GET", corpo = null, query = null } = {}) {
  const chave = await token();
  if (!chave) throw new ErroApi("sem_token", 401, "Entre com o código do painel.");

  const url = new URL(SERVIDOR + caminho);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
  }

  let resposta;
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers: {
        authorization: `Bearer ${chave}`,
        ...(corpo ? { "content-type": "application/json" } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      // A extensão nunca manda cookie: a credencial é o token, e só.
      credentials: "omit",
      cache: "no-store",
    });
  } catch (erro) {
    // Rede caiu, servidor fora, DNS. Não é erro de licença e a extensão não
    // pode tratar como se fosse: quem está offline continua com a licença.
    throw new ErroApi("rede", 0, erro?.message || "sem conexão");
  }

  const tipo = resposta.headers.get("content-type") || "";
  if (!tipo.includes("application/json")) {
    if (resposta.ok) return { ok: true, resposta };
    throw new ErroApi("resposta_invalida", resposta.status, "resposta não é JSON");
  }

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok || dados?.ok === false) {
    throw new ErroApi(dados?.erro || "falhou", resposta.status, dados?.detalhe);
  }

  return dados;
}

/**
 * O batimento. É a única chamada que responde tudo de uma vez: se ainda pode
 * operar, o que o plano libera, qual versão deveria rodar, se precisa PARAR
 * agora e se o mapa de seletores mudou.
 */
export async function licenca({ versao, mapaVersao }) {
  return chamar("/api/ext/licenca", {
    query: {
      instalacao: await chaveDaInstalacao(),
      versao,
      mapa: mapaVersao,
      sistema: sistema(),
      navegador: "chrome",
    },
  });
}

/** O mapa de seletores. `mudou: false` significa "você já tem esta versão". */
export async function seletores(versaoConhecida) {
  return chamar("/api/ext/seletores", { query: { versao: versaoConhecida } });
}

export async function montagem() {
  return chamar("/api/ext/montagem");
}

/** URL de um bloco. Não passa por `chamar` porque o corpo é áudio, não JSON. */
export async function urlDoBloco(arquivoId) {
  return `${SERVIDOR}/api/ext/bloco?id=${encodeURIComponent(arquivoId)}`;
}

export async function baixarBloco(arquivoId) {
  const chave = await token();
  const resposta = await fetch(await urlDoBloco(arquivoId), {
    headers: { authorization: `Bearer ${chave}` },
    credentials: "omit",
  });
  if (!resposta.ok) throw new ErroApi("bloco", resposta.status, "bloco não veio");
  return resposta.blob();
}

export async function abrirSessao({ montagemId, contaTikTokId }) {
  return chamar("/api/ext/sessao", {
    metodo: "POST",
    corpo: { acao: "abrir", montagemId, contaTikTokId },
  });
}

export async function baterSessao(sessaoId, espectadores) {
  return chamar("/api/ext/sessao", {
    metodo: "POST",
    corpo: { acao: "batimento", sessaoId, espectadores },
  });
}

export async function fecharSessao(sessaoId, erro = null) {
  return chamar("/api/ext/sessao", {
    metodo: "POST",
    corpo: { acao: "fechar", sessaoId, erro },
  });
}

export async function enviarEventos(sessaoId, eventos) {
  if (!eventos.length) return { ok: true, gravados: 0 };
  return chamar("/api/ext/eventos", {
    metodo: "POST",
    corpo: { sessaoId, eventos },
  });
}

/**
 * Pergunta ao servidor o que fazer com um comentário ou uma entrada.
 *
 * A extensão NUNCA decide sozinha se responde, o que responde ou quando: as
 * três decisões protegem a conta do cliente contra bloqueio, e regra que
 * protege alguém não pode morar na máquina dessa pessoa.
 */
export async function decidirResposta({ sessaoId, tipo, apelido, texto, produtoId }) {
  return chamar("/api/ext/responder", {
    metodo: "POST",
    corpo: { sessaoId, tipo, apelido, texto, produtoId },
  });
}

/** Confirma que a resposta saiu. É o que faz a cadência contar. */
export async function confirmarResposta(sessaoId, texto, tema) {
  return chamar("/api/ext/responder", {
    metodo: "POST",
    corpo: { acao: "registrar", sessaoId, texto, tema },
  });
}

/**
 * Telemetria de quebra.
 *
 * Não lança: se a telemetria falhar, a live continua. Ela existe para nós
 * descobrirmos a quebra pelo painel em vez de pelo WhatsApp do cliente — não
 * é um recurso do produto e não pode derrubar nada.
 */
export async function relatarQuebra(falhas) {
  try {
    await chamar("/api/ext/telemetria", {
      metodo: "POST",
      corpo: { instalacao: await chaveDaInstalacao(), falhas },
    });
  } catch {
    /* silêncio proposital */
  }
}
