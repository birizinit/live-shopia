import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ler } from "@/lib/armazenamento";
import { contarCaracteres } from "@/lib/caracteres";
import { bd } from "@/lib/db";
import { env } from "@/lib/env";
import { comDemo, comoJson, configuracao, numeroDe } from "./comum";
import { comTraducao, ErroDominio } from "./erros";
import { ipDoPedido } from "@/lib/rede";

/**
 * Extensão de navegador — o lado web que a extensão consome.
 *
 * O pacote MV3 ainda não existe. O que existe é o contrato: licença por token,
 * mapa de seletores servido pela API, telemetria de quebra e resolução de
 * versão com canário e kill switch (db/migrations/0007_extensao.sql).
 *
 * Duas regras atravessam o arquivo inteiro:
 *
 *  1. o token cru NUNCA é gravado. O banco guarda o SHA-256 e os quatro
 *     últimos caracteres — o suficiente para a tela dizer de qual token ela
 *     fala, longe de reconstruir qualquer coisa;
 *  2. toda função de leitura do usuário recebe `perfilId` como primeiro
 *     argumento e usa no `where`. As funções que a extensão chama não recebem
 *     perfil nenhum: elas DERIVAM o perfil do token, que é a única identidade
 *     que a extensão tem.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type CanalExtensao = "estavel" | "canario";
export type ModuloExtensao = "nucleo" | "mixer" | "chat" | "painel";
export type EstadoLicenca = "sem_licenca" | "ativa" | "expirada" | "revogada";

/**
 * Retrato do que o plano liberava na emissão.
 *
 * É retrato e não leitura de `planos.recursos` porque editar o catálogo não
 * pode mudar em silêncio o que a extensão já instalada faz no meio do mês.
 */
export type RecursosExtensao = {
  mixer: boolean;
  chat: boolean;
  camera_virtual: boolean;
  sons_naturais: boolean;
  analise_live: boolean;
  contas_tiktok: number;
  plano: string | null;
};

export type Licenca = {
  id: string;
  estado: EstadoLicenca;
  /** Últimos 4 caracteres do token. Quatro de quarenta e oito não reconstroem nada. */
  dica: string | null;
  canal: CanalExtensao;
  mixer: boolean;
  chat: boolean;
  recursos: RecursosExtensao;
  emitidaEm: string;
  rotacionadaEm: string | null;
  /** Fim da janela de graça offline, não fim da assinatura. */
  expiraEm: string;
  revogadaMotivo: string | null;
};

export type VersaoExtensao = {
  versao: string;
  canal: CanalExtensao;
  notas: string | null;
  obrigatoria: boolean;
  publicadaEm: string | null;
  /** false quando a versão aponta para um arquivo que não está pronto. */
  temPacote: boolean;
};

export type Instalacao = {
  id: string;
  chave: string;
  versao: string;
  mapaVersao: number | null;
  sistema: string | null;
  navegador: string | null;
  primeiroContato: string;
  ultimoContato: string;
  /** Falou com a gente nas últimas 24h. */
  viva: boolean;
  /** A versão que ela roda existe no catálogo. false = instalada em modo desenvolvedor. */
  conhecida: boolean;
  /** Kill switch ligado na versão que ela roda. */
  desligada: boolean;
  desligadaMotivo: string | null;
};

export type EstadoExtensao = {
  licenca: Licenca | null;
  versao: VersaoExtensao | null;
  instalacoes: Instalacao[];
  /** Versão do mapa de seletores no ar. Conserta quebra de DOM sem republicar. */
  mapaVersao: number | null;
  /** Freio global do PLANO.md §6: mata o chat na base inteira sem tocar no mixer. */
  chatDesligadoNaBase: boolean;
  /** Sem assinatura ativa a janela de graça não é renovada no heartbeat. */
  assinaturaAtiva: boolean;
  heartbeatSegundos: number;
  gracaDias: number;
};

/** O que a extensão recebe depois de apresentar o token. */
export type LicencaAutenticada = {
  licencaId: string;
  perfilId: string;
  estado: Exclude<EstadoLicenca, "sem_licenca">;
  canal: CanalExtensao;
  mixer: boolean;
  chat: boolean;
  recursos: RecursosExtensao;
  expiraEm: string;
  revogadaMotivo: string | null;
};

export type FalhaTelemetria = {
  alvo: string;
  modulo: ModuloExtensao;
  seletor: string;
  /** Posição do candidato da cascata que ainda resolveu. null = a cascata inteira falhou. */
  candidato: number | null;
  versao: string;
  mapaVersao: number | null;
  ocorrencias: number;
  contexto: Record<string, string | number | boolean | null>;
};

export const ALVO_PADRAO = "tiktok_live_studio";

/** Mesma lista do CHECK `telemetria_sem_pessoal`. Nada fora dela entra. */
export const CHAVES_CONTEXTO = [
  "rota",
  "idioma",
  "ms",
  "tentativas",
  "motivo",
  "candidatos",
] as const;

export const MAX_FALHAS_POR_ENVIO = 20;

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

/**
 * Prefixo reconhecível. Serve para o cliente saber que colou a coisa certa e
 * para varredura de segredo achar um token vazado num repositório público.
 */
const PREFIXO_TOKEN = "shpx_";
const TAMANHO_MINIMO_TOKEN = PREFIXO_TOKEN.length + 40;
const TAMANHO_MAXIMO_TOKEN = 200;

function hashDoToken(token: string) {
  return createHash("sha256").update(token).digest();
}

/** 32 bytes aleatórios. Mesmo contrato de `sessoes.token_hash`. */
function novoToken() {
  return `${PREFIXO_TOKEN}${randomBytes(32).toString("base64url")}`;
}

/**
 * Formato antes de ir ao banco. Barra lixo sem gastar uma consulta por
 * requisição malformada — que é o grosso do que bate numa rota pública.
 */
export function pareceToken(valor: string | null | undefined): valor is string {
  return (
    typeof valor === "string" &&
    valor.startsWith(PREFIXO_TOKEN) &&
    valor.length >= TAMANHO_MINIMO_TOKEN &&
    valor.length <= TAMANHO_MAXIMO_TOKEN &&
    /^[A-Za-z0-9_-]+$/.test(valor.slice(PREFIXO_TOKEN.length))
  );
}

/** Lê o token do cabeçalho. `Authorization: Bearer …` ou `X-Shopia-Licenca`. */
export function tokenDoCabecalho(cabecalhos: Headers): string | null {
  const autorizacao = cabecalhos.get("authorization");
  if (autorizacao && autorizacao.slice(0, 7).toLowerCase() === "bearer ") {
    return autorizacao.slice(7).trim();
  }
  return cabecalhos.get("x-shopia-licenca")?.trim() || null;
}

// ---------------------------------------------------------------------------
// Recursos do plano
// ---------------------------------------------------------------------------

/** Sem acento e em minúscula: "Câmera virtual" e "camera virtual" são a mesma coisa. */
function normalizar(texto: string) {
  // Descarta as marcas combinantes (U+0300 a U+036F) por código, e não por
  // classe de regex: a classe literal some do arquivo na primeira normalização
  // do editor e vira um intervalo vazio sem ninguém notar.
  const semMarcas = [...texto.normalize("NFD")].filter((c) => {
    const ponto = c.codePointAt(0) ?? 0;
    return ponto < 0x0300 || ponto > 0x036f;
  });
  return semMarcas.join("").toLowerCase();
}

type PlanoDoPerfil = {
  id: string;
  slug: string;
  recursos: unknown;
  contas_tiktok: number;
};

/**
 * Traduz a lista de marketing de `planos.recursos` para os interruptores que a
 * extensão entende. A lista é texto livre que o dono do negócio edita; o que a
 * extensão consome não pode ser.
 */
export function recursosDoPlano(plano: PlanoDoPerfil | null): RecursosExtensao {
  const lista = Array.isArray(plano?.recursos)
    ? plano.recursos.filter((item): item is string => typeof item === "string")
    : [];
  const texto = lista.map(normalizar).join(" | ");
  const tem = (agulha: string) => texto.includes(normalizar(agulha));

  return {
    // O mixer é o produto. Ele só cai por revogação da licença, nunca por plano.
    mixer: true,
    chat: tem("respostas no chat"),
    camera_virtual: tem("camera virtual"),
    sons_naturais: tem("sons naturais"),
    analise_live: tem("analise da live"),
    contas_tiktok: plano?.contas_tiktok ?? 1,
    plano: plano?.slug ?? null,
  };
}

function lerRecursos(bruto: unknown): RecursosExtensao {
  const fonte = (bruto ?? {}) as Partial<Record<keyof RecursosExtensao, unknown>>;
  return {
    mixer: fonte.mixer !== false,
    chat: fonte.chat === true,
    camera_virtual: fonte.camera_virtual === true,
    sons_naturais: fonte.sons_naturais === true,
    analise_live: fonte.analise_live === true,
    contas_tiktok: numeroDe(fonte.contas_tiktok, 1),
    plano: typeof fonte.plano === "string" ? fonte.plano : null,
  };
}

// ---------------------------------------------------------------------------
// Leitura da tela
// ---------------------------------------------------------------------------

type LinhaLicenca = {
  id: string;
  token_dica: string | null;
  canal: CanalExtensao;
  mixer: boolean;
  chat: boolean;
  recursos: unknown;
  emitida_em: Date;
  rotacionada_em: Date | null;
  expira_em: Date;
  revogada_em: Date | null;
  revogada_motivo: string | null;
};

function montarLicenca(linha: LinhaLicenca): Licenca {
  const estado: EstadoLicenca = linha.revogada_em
    ? "revogada"
    : linha.expira_em.getTime() <= Date.now()
      ? "expirada"
      : "ativa";

  return {
    id: linha.id,
    estado,
    dica: linha.token_dica,
    canal: linha.canal,
    mixer: linha.mixer,
    chat: linha.chat,
    recursos: lerRecursos(linha.recursos),
    emitidaEm: linha.emitida_em.toISOString(),
    rotacionadaEm: linha.rotacionada_em?.toISOString() ?? null,
    expiraEm: linha.expira_em.toISOString(),
    revogadaMotivo: linha.revogada_motivo,
  };
}

/**
 * Tudo que a tela precisa, numa função só.
 *
 * Consultas curtas em paralelo em vez de um join de seis tabelas: cada uma
 * responde por um índice próprio e nenhuma multiplica linha da outra.
 */
export async function estadoExtensao(perfilId: string): Promise<EstadoExtensao> {
  return comDemo(exemploEstado, async () => {
    const sql = bd();

    const licencas = await sql<LinhaLicenca[]>`
      select id, token_dica, canal, mixer, chat, recursos,
             emitida_em, rotacionada_em, expira_em, revogada_em, revogada_motivo
        from ext_licencas
       where perfil_id = ${perfilId}
    `;
    const licenca = licencas[0] ? montarLicenca(licencas[0]) : null;

    const [versao, instalacoes, mapaVersao, extras, heartbeat, graca] = await Promise.all([
      versaoPara(licenca?.id ?? null, null),
      instalacoesDoPerfil(perfilId),
      versaoDoMapa(ALVO_PADRAO),
      sql<{ chat_desligado: boolean; assinatura: boolean }[]>`
        select coalesce(
                 (select (valor #>> '{}') = 'true'
                    from configuracoes where chave = 'ext.chat_desligado'),
                 false
               ) as chat_desligado,
               exists (
                 select 1 from assinaturas
                  where perfil_id = ${perfilId} and status = 'ativa'
               ) as assinatura
      `,
      configuracao("ext.heartbeat_segundos", 120),
      configuracao("ext.licenca_graca_dias", 7),
    ]);

    return {
      licenca,
      versao,
      instalacoes,
      mapaVersao,
      chatDesligadoNaBase: extras[0]?.chat_desligado === true,
      assinaturaAtiva: extras[0]?.assinatura === true,
      heartbeatSegundos: Math.round(heartbeat),
      gracaDias: Math.round(graca),
    };
  });
}

export async function instalacoesDoPerfil(
  perfilId: string,
  limite = 20,
): Promise<Instalacao[]> {
  const linhas = await bd()<
    {
      id: string;
      instalacao_chave: string;
      versao: string;
      mapa_versao: number | null;
      sistema: string | null;
      navegador: string | null;
      primeiro_contato: Date;
      ultimo_contato: Date;
      viva: boolean;
      conhecida: boolean;
      kill_switch: boolean | null;
      kill_motivo: string | null;
    }[]
  >`
    select i.id, i.instalacao_chave, i.versao, i.mapa_versao, i.sistema, i.navegador,
           i.primeiro_contato, i.ultimo_contato,
           (i.ultimo_contato >= now() - interval '24 hours') as viva,
           (v.id is not null) as conhecida,
           v.kill_switch, v.kill_motivo
      from ext_instalacoes i
      -- Sem chave estrangeira, de propósito (ver 0007): instalação em modo
      -- desenvolvedor roda build que nunca publicamos, e é esse caso que
      -- precisa APARECER na tela em vez de sumir.
      left join ext_versoes v on v.versao = i.versao
     where i.perfil_id = ${perfilId}
     order by i.ultimo_contato desc
     limit ${limite}
  `;

  return linhas.map((l) => ({
    id: l.id,
    chave: l.instalacao_chave,
    versao: l.versao,
    mapaVersao: l.mapa_versao,
    sistema: l.sistema,
    navegador: l.navegador,
    primeiroContato: l.primeiro_contato.toISOString(),
    ultimoContato: l.ultimo_contato.toISOString(),
    viva: l.viva,
    conhecida: l.conhecida,
    desligada: l.kill_switch === true,
    desligadaMotivo: l.kill_motivo,
  }));
}

/**
 * Some com a máquina da lista. Só faz sentido para máquina que realmente foi
 * embora: uma que ainda roda a extensão volta a aparecer no próximo heartbeat.
 */
export async function esquecerInstalacao(
  perfilId: string,
  instalacaoId: string,
): Promise<boolean> {
  return comTraducao(async () => {
    const linhas = await bd()<{ id: string }[]>`
      delete from ext_instalacoes
       where id = ${instalacaoId} and perfil_id = ${perfilId}
      returning id
    `;
    return linhas.length > 0;
  });
}

async function versaoDoMapa(alvo: string): Promise<number | null> {
  const linhas = await bd()<{ versao: number }[]>`
    select versao from seletores_mapas where alvo = ${alvo} and ativo
  `;
  return linhas[0]?.versao ?? null;
}

type LinhaVersao = {
  versao: string;
  canal: CanalExtensao;
  notas: string | null;
  obrigatoria: boolean;
  publicada_em: Date | null;
  tem_pacote: boolean;
};

/**
 * Qual versão esta instalação deve estar rodando.
 *
 * Com licença a escolha passa por `ext_versao_para`, que aplica canal, fatia de
 * canário (determinística por hash da licença) e kill switch. Sem licença a
 * tela ainda precisa dizer qual é a versão publicada — e aí o que vale é a
 * última estável no ar.
 *
 * `tem_pacote` confere o ARQUIVO, não só o `arquivo_id`: a versão publicada
 * sempre aponta para uma linha de `arquivos` (CHECK do 0007), mas essa linha
 * pode ter sido marcada como removida — e aí o botão baixaria nada.
 */
export async function versaoPara(
  licencaId: string | null,
  versaoAtual: string | null,
): Promise<VersaoExtensao | null> {
  const sql = bd();

  const linhas = licencaId
    ? await sql<LinhaVersao[]>`
        select r.versao, r.canal, r.notas, r.obrigatoria, v.publicada_em,
               coalesce(a.estado = 'pronto' and a.removido_em is null, false) as tem_pacote
          from ext_versao_para(${licencaId}, ${versaoAtual}) r
          join ext_versoes v on v.versao = r.versao
          left join arquivos a on a.id = r.arquivo_id
      `
    : await sql<LinhaVersao[]>`
        select v.versao, v.canal, v.notas, v.obrigatoria, v.publicada_em,
               coalesce(a.estado = 'pronto' and a.removido_em is null, false) as tem_pacote
          from ext_versoes v
          left join arquivos a on a.id = v.arquivo_id
         where v.publicada_em is not null
           and not v.kill_switch
           and v.canal = 'estavel'
         order by v.ordem desc
         limit 1
      `;

  const l = linhas[0];
  if (!l) return null;

  return {
    versao: l.versao,
    canal: l.canal,
    notas: l.notas,
    obrigatoria: l.obrigatoria,
    publicadaEm: l.publicada_em?.toISOString() ?? null,
    temPacote: l.tem_pacote,
  };
}

/**
 * O kill switch da versão que a extensão JÁ tem.
 *
 * Consulta separada porque `ext_versao_para` não devolve linha nenhuma quando
 * não há versão publicada para onde ir — e é exatamente nesse caso que mandar
 * parar mais importa.
 */
export async function paradaForcada(
  versaoAtual: string | null,
): Promise<{ parar: boolean; motivo: string | null }> {
  if (!versaoAtual) return { parar: false, motivo: null };

  const linhas = await bd()<{ kill_switch: boolean; kill_motivo: string | null }[]>`
    select kill_switch, kill_motivo from ext_versoes where versao = ${versaoAtual}
  `;
  const l = linhas[0];
  return { parar: l?.kill_switch === true, motivo: l?.kill_motivo ?? null };
}

export async function chatDesligadoNaBase(): Promise<boolean> {
  const linhas = await bd()<{ v: boolean }[]>`
    select coalesce(
             (select (valor #>> '{}') = 'true'
                from configuracoes where chave = 'ext.chat_desligado'),
             false
           ) as v
  `;
  return linhas[0]?.v === true;
}

// ---------------------------------------------------------------------------
// Emissão, rotação e revogação
// ---------------------------------------------------------------------------

export type LicencaEmitida = {
  /** O token cru. Existe nesta resposta e em nenhum outro lugar do sistema. */
  token: string;
  licenca: Licenca;
};

/**
 * Emite ou rotaciona a licença do perfil.
 *
 * Rotacionar é o mesmo caminho de emitir (`emitir_licenca_ext` faz upsert por
 * perfil): o token anterior morre no mesmo UPDATE, que é o que se quer quando
 * alguém diz "perdi o notebook".
 *
 * Não passa por `debitarEEnfileirar` porque não há gasto de crédito aqui —
 * licença é direito do plano, não geração paga.
 */
export async function emitirLicenca(perfilId: string): Promise<LicencaEmitida> {
  return comTraducao(async () => {
    const sql = bd();

    const planos = await sql<PlanoDoPerfil[]>`
      select pl.id, pl.slug, pl.recursos, pl.contas_tiktok
        from assinaturas a
        join planos pl on pl.id = a.plano_id
       where a.perfil_id = ${perfilId} and a.status = 'ativa'
       order by a.criado_em desc
       limit 1
    `;

    const recursos = recursosDoPlano(planos[0] ?? null);
    const dias = Math.round(await configuracao("ext.licenca_graca_dias", 7));
    const token = novoToken();

    const linhas = await sql<LinhaLicenca[]>`
      select id, token_dica, canal, mixer, chat, recursos,
             emitida_em, rotacionada_em, expira_em, revogada_em, revogada_motivo
        from emitir_licenca_ext(
          ${perfilId},
          ${hashDoToken(token)},
          ${token.slice(-4)},
          ${planos[0]?.id ?? null},
          ${recursos.chat},
          ${comoJson(recursos)},
          ${dias}
        )
    `;

    const linha = linhas[0];
    if (!linha) throw new ErroDominio("desconhecido", "A licença não foi emitida.");

    return { token, licenca: montarLicenca(linha) };
  });
}

/** Desliga a licença. O token para de valer no próximo contato da extensão. */
export async function revogarLicenca(perfilId: string, motivo: string): Promise<boolean> {
  return comTraducao(async () => {
    const linhas = await bd()<{ id: string }[]>`
      update ext_licencas
         set revogada_em = now(), revogada_motivo = ${motivo}
       where perfil_id = ${perfilId} and revogada_em is null
      returning id
    `;
    return linhas.length > 0;
  });
}

// ---------------------------------------------------------------------------
// O que a extensão chama. Sem sessão de navegador: o token é a identidade.
// ---------------------------------------------------------------------------

/**
 * Troca o token pela licença.
 *
 * Busca por SHA-256 num índice único: comparação de tempo constante não
 * acrescenta nada aqui, porque o que se compara é o digest de 32 bytes
 * aleatórios, não um segredo adivinhável.
 */
export async function autenticarLicenca(
  token: string | null | undefined,
): Promise<LicencaAutenticada | null> {
  if (!pareceToken(token)) return null;

  const linhas = await bd()<(LinhaLicenca & { perfil_id: string })[]>`
    select id, perfil_id, token_dica, canal, mixer, chat, recursos,
           emitida_em, rotacionada_em, expira_em, revogada_em, revogada_motivo
      from ext_licencas
     where token_hash = ${hashDoToken(token)}
  `;

  const linha = linhas[0];
  if (!linha) return null;

  const licenca = montarLicenca(linha);
  return {
    licencaId: licenca.id,
    perfilId: linha.perfil_id,
    estado: licenca.estado as Exclude<EstadoLicenca, "sem_licenca">,
    canal: licenca.canal,
    mixer: licenca.mixer,
    chat: licenca.chat,
    recursos: licenca.recursos,
    expiraEm: licenca.expiraEm,
    revogadaMotivo: licenca.revogadaMotivo,
  };
}

/**
 * Empurra a janela de graça offline — e SÓ quando a assinatura está em dia.
 *
 * A função do banco não sabe disso de propósito (0007): quem sabe se a
 * assinatura está paga é a aplicação. Sem assinatura ativa a janela corre até
 * o fim e a extensão para, que é o comportamento certo.
 */
export async function renovarSeAssinaturaAtiva(
  perfilId: string,
  dias: number,
): Promise<string | null> {
  // A chamada sai da LISTA de um select sobre `assinaturas`, e não de um
  // `where exists`: assim a função — que faz UPDATE — só é avaliada se houver
  // linha de assinatura ativa, sem depender de o planejador respeitar a ordem.
  const linhas = await bd()<{ expira_em: Date | null }[]>`
    select renovar_licenca_ext(a.perfil_id, ${Math.round(dias)}) as expira_em
      from assinaturas a
     where a.perfil_id = ${perfilId} and a.status = 'ativa'
     limit 1
  `;
  return linhas[0]?.expira_em?.toISOString() ?? null;
}

export type ContatoRegistrado = {
  id: string;
  primeiroContato: string;
  ultimoContato: string;
};

/** Heartbeat. É o denominador do alerta de quebra. */
export async function registrarContato(
  licencaId: string,
  dados: {
    instalacaoChave: string;
    versao: string;
    userAgent?: string | null;
    sistema?: string | null;
    navegador?: string | null;
    mapaVersao?: number | null;
  },
): Promise<ContatoRegistrado> {
  try {
    const linhas = await bd()<
      { id: string; primeiro_contato: Date; ultimo_contato: Date }[]
    >`
      select id, primeiro_contato, ultimo_contato from registrar_contato_ext(
        ${licencaId},
        ${dados.instalacaoChave},
        ${dados.versao},
        ${dados.userAgent ?? null},
        ${dados.sistema ?? null},
        ${dados.navegador ?? null},
        ${dados.mapaVersao ?? null}
      )
    `;

    const l = linhas[0];
    if (!l) throw new ErroDominio("desconhecido", "O contato não foi registrado.");

    return {
      id: l.id,
      primeiroContato: l.primeiro_contato.toISOString(),
      ultimoContato: l.ultimo_contato.toISOString(),
    };
  } catch (erro) {
    // 28000 é o `raise` da própria função: licença inválida ou revogada.
    if ((erro as { code?: string })?.code === "28000") {
      throw new ErroDominio("sem_permissao", "Licença inválida ou revogada.", erro);
    }
    throw erro;
  }
}

export type RespostaMapa =
  | { existe: false }
  | { existe: true; versao: number; mapa: unknown | null };

/**
 * O mapa de seletores ativo.
 *
 * `mapa: null` significa "não mudou desde a versão que você já tem" — o
 * heartbeat é de minuto em minuto e trafegar o JSON inteiro toda vez é banda
 * paga por nós, à toa. Uma consulta só: `seletores_ativos` sozinha não
 * distingue "não mudou" de "não existe mapa", e as duas respostas pedem
 * comportamentos opostos da extensão.
 */
export async function mapaAtivo(
  alvo: string,
  versaoConhecida: number | null,
): Promise<RespostaMapa> {
  const linhas = await bd()<{ atual: number; nova: number | null; mapa: unknown }[]>`
    select m.versao as atual, s.versao as nova, s.mapa
      from seletores_mapas m
      left join lateral seletores_ativos(${alvo}, ${versaoConhecida}) s on true
     where m.alvo = ${alvo} and m.ativo
  `;

  const l = linhas[0];
  if (!l) return { existe: false };
  return { existe: true, versao: l.atual, mapa: l.nova === null ? null : l.mapa };
}

/**
 * Espelha o CHECK `telemetria_sem_pessoal` do banco.
 *
 * Existe para a extensão receber 422 com o motivo em vez de um 23514 opaco — e
 * para o dado de espectador morrer antes de virar linha. Ver o comentário de
 * `ext_telemetria` em 0007: o espectador do cliente não é usuário nosso, nunca
 * consentiu com nada e não tem a quem pedir exclusão.
 */
export function contextoSemPessoal(
  contexto: unknown,
): { ok: true } | { ok: false; erro: string } {
  if (contexto === null || contexto === undefined) return { ok: true };
  if (typeof contexto !== "object" || Array.isArray(contexto)) {
    return { ok: false, erro: "contexto precisa ser um objeto" };
  }

  for (const [chave, valor] of Object.entries(contexto as Record<string, unknown>)) {
    if (!(CHAVES_CONTEXTO as readonly string[]).includes(chave)) {
      return { ok: false, erro: `chave de contexto não permitida: ${chave}` };
    }
    if (valor !== null && typeof valor === "object") {
      return { ok: false, erro: `contexto.${chave} não pode ser objeto nem lista` };
    }
    if (typeof valor === "string") {
      // Code points, como o `length()` do Postgres conta: o CHECK do banco e
      // este limite precisam recusar exatamente o mesmo texto.
      if (contarCaracteres(valor) > 120) {
        return { ok: false, erro: `contexto.${chave} passa de 120 caracteres` };
      }
      // '@' pega e-mail e @usuário de uma vez.
      if (valor.includes("@")) {
        return {
          ok: false,
          erro: `contexto.${chave} parece conter identificação de pessoa`,
        };
      }
    }
  }

  return { ok: true };
}

/**
 * Junta falhas repetidas do mesmo ponto antes de inserir.
 *
 * Duas linhas do mesmo (alvo, seletor, versão) no mesmo envio contariam a mesma
 * instalação duas vezes no agregado, e o alerta de quebra passaria a mentir
 * para cima justamente no dia em que ele precisa estar certo.
 */
export function juntarFalhas(falhas: FalhaTelemetria[]): FalhaTelemetria[] {
  const porChave = new Map<string, FalhaTelemetria>();

  for (const falha of falhas) {
    const chave = `${falha.alvo}|${falha.modulo}|${falha.seletor}|${falha.versao}`;
    const existente = porChave.get(chave);
    if (!existente) {
      porChave.set(chave, { ...falha });
      continue;
    }
    existente.ocorrencias += falha.ocorrencias;
    // O pior caso manda: a cascata inteira falhando cobre o candidato parcial.
    if (falha.candidato === null) existente.candidato = null;
  }

  return [...porChave.values()];
}

/** Grava as falhas. O gatilho do banco agrega por (alvo, seletor, versão, dia). */
export async function registrarTelemetria(
  perfilId: string,
  instalacaoId: string,
  falhas: FalhaTelemetria[],
): Promise<number> {
  if (falhas.length === 0) return 0;

  return comTraducao(async () => {
    const carga = falhas.map((f) => ({
      alvo: f.alvo,
      modulo: f.modulo,
      seletor: f.seletor,
      candidato: f.candidato,
      versao: f.versao,
      mapa_versao: f.mapaVersao,
      ocorrencias: f.ocorrencias,
      contexto: f.contexto,
    }));

    // Uma instrução só: telemetria chega em rajada no dia da quebra, e uma
    // ida ao banco por falha derruba a nossa API na pior hora possível.
    const linhas = await bd()<{ id: string }[]>`
      insert into ext_telemetria
        (perfil_id, instalacao_id, alvo, modulo, seletor, candidato,
         versao, mapa_versao, ocorrencias, contexto)
      select ${perfilId}, ${instalacaoId}, f.alvo, f.modulo::modulo_extensao, f.seletor,
             f.candidato, f.versao, f.mapa_versao, f.ocorrencias, f.contexto
        from jsonb_to_recordset(${comoJson(carga)}) as f(
          alvo text, modulo text, seletor text, candidato smallint,
          versao text, mapa_versao integer, ocorrencias integer, contexto jsonb
        )
      returning id
    `;

    return linhas.length;
  });
}

// ---------------------------------------------------------------------------
// Rate limit — a rota da extensão é pública, então ela precisa de teto
// ---------------------------------------------------------------------------

/** `true` = pode seguir. Conta antes de decidir, então o teto é exato. */
export async function dentroDoLimite(
  chave: string,
  teto: number,
  janelaSegundos: number,
): Promise<boolean> {
  const linhas = await bd()<{ ok: boolean }[]>`
    select consumir_limite(${chave}, ${teto}, ${janelaSegundos}) as ok
  `;
  return linhas[0]?.ok === true;
}

/**
 * Identidade da requisição antes de haver licença.
 *
 * Sem isto o teto por licença só entra depois de uma consulta ao banco, e quem
 * manda token inválido em rajada nunca chega a ter licença — ou seja, nunca
 * seria barrado.
 */
export function origemDaRequisicao(cabecalhos: Headers): string {
  const encaminhado = ipDoPedido(cabecalhos);
  return encaminhado || cabecalhos.get("x-real-ip")?.trim() || "desconhecido";
}

// ---------------------------------------------------------------------------
// Download do pacote
// ---------------------------------------------------------------------------

/** Sem segredo não há como assinar ticket, e sem ticket não há download pelo navegador. */
export const downloadPeloNavegadorLigado = Boolean(env.extensaoSegredo);

const VALIDADE_TICKET_MS = 15 * 60 * 1000;

function assinar(carga: string) {
  return createHmac("sha256", env.extensaoSegredo).update(carga).digest("base64url");
}

/**
 * Ticket curto para o clique no navegador.
 *
 * A rota de download não tem sessão de navegador (o contrato dela é o da
 * extensão), e um `<a href>` não manda cabeçalho — então o token da licença
 * teria que viajar na URL, onde ele entra no histórico, no log do proxy e no
 * Referer. O ticket dura 15 minutos, só serve para baixar, e nasce no RENDER
 * da página já amarrado a quem pediu.
 */
export function ticketDeDownload(perfilId: string, versao: string): string | null {
  if (!downloadPeloNavegadorLigado) return null;

  const carga = Buffer.from(
    JSON.stringify({ p: perfilId, v: versao, e: Date.now() + VALIDADE_TICKET_MS }),
  ).toString("base64url");

  return `${carga}.${assinar(carga)}`;
}

export function conferirTicket(
  ticket: string | null,
): { perfilId: string; versao: string } | null {
  if (!downloadPeloNavegadorLigado || !ticket) return null;

  const [carga, assinatura] = ticket.split(".");
  if (!carga || !assinatura) return null;

  const esperada = Buffer.from(assinar(carga));
  const recebida = Buffer.from(assinatura);
  // `timingSafeEqual` estoura com tamanhos diferentes; a comparação de tamanho
  // vem antes e não vaza nada que o próprio formato já não entregue.
  if (esperada.length !== recebida.length) return null;
  if (!timingSafeEqual(esperada, recebida)) return null;

  try {
    const dados = JSON.parse(Buffer.from(carga, "base64url").toString("utf8"));
    if (typeof dados?.p !== "string" || typeof dados?.v !== "string") return null;
    if (typeof dados?.e !== "number" || dados.e < Date.now()) return null;
    return { perfilId: dados.p, versao: dados.v };
  } catch {
    return null;
  }
}

export type Pacote = {
  versao: string;
  conteudo: Buffer;
  mime: string;
  bytes: number;
};

/**
 * O ZIP da versão. `null` quando não existe pacote publicado — e aí o chamador
 * diz isso com todas as letras, em vez de servir um arquivo vazio.
 */
export async function pacoteDaVersao(
  perfilId: string,
  versao: string | null,
): Promise<Pacote | null> {
  const sql = bd();

  const linhas = versao
    ? await sql<{ versao: string; arquivo_id: string | null }[]>`
        select versao, arquivo_id
          from ext_versoes
         where versao = ${versao} and publicada_em is not null and not kill_switch
      `
    : await sql<{ versao: string; arquivo_id: string | null }[]>`
        select versao, arquivo_id
          from ext_versoes
         where publicada_em is not null and not kill_switch and canal = 'estavel'
         order by ordem desc
         limit 1
      `;

  const linha = linhas[0];
  if (!linha?.arquivo_id) return null;

  // `ler` confronta o dono do arquivo. O pacote é global (perfil_id nulo), mas
  // a checagem continua no único lugar do projeto que sabe fazê-la.
  const arquivo = await ler(perfilId, linha.arquivo_id);
  if (!arquivo) return null;

  return {
    versao: linha.versao,
    conteudo: arquivo.conteudo,
    mime: arquivo.mime,
    bytes: arquivo.bytes,
  };
}

// ---------------------------------------------------------------------------
// Modo demo — a sessão demo não tem linha no banco
// ---------------------------------------------------------------------------

function menos(dias: number) {
  return new Date(Date.now() - dias * 86_400_000).toISOString();
}

function exemploEstado(): EstadoExtensao {
  return {
    licenca: {
      id: "00000000-0000-4000-8000-0000000000e1",
      estado: "ativa",
      dica: "d3m0",
      canal: "estavel",
      mixer: true,
      chat: true,
      recursos: {
        mixer: true,
        chat: true,
        camera_virtual: true,
        sons_naturais: true,
        analise_live: false,
        contas_tiktok: 3,
        plano: "premium",
      },
      emitidaEm: menos(12),
      rotacionadaEm: menos(3),
      expiraEm: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      revogadaMotivo: null,
    },
    versao: {
      versao: "1.4.2",
      canal: "estavel",
      notas: "Exemplo do modo demonstração. Nenhuma versão foi publicada de verdade.",
      obrigatoria: false,
      publicadaEm: menos(6),
      // Sem banco não há arquivo, e dizer que há seria o botão que baixa nada.
      temPacote: false,
    },
    instalacoes: [
      {
        id: "00000000-0000-4000-8000-0000000000f1",
        chave: "exemplo-notebook",
        versao: "1.4.2",
        mapaVersao: 1,
        sistema: "Windows 11",
        navegador: "Chrome 141",
        primeiroContato: menos(12),
        ultimoContato: new Date(Date.now() - 3 * 60_000).toISOString(),
        viva: true,
        conhecida: true,
        desligada: false,
        desligadaMotivo: null,
      },
      {
        id: "00000000-0000-4000-8000-0000000000f2",
        chave: "exemplo-estudio",
        versao: "1.3.0",
        mapaVersao: 1,
        sistema: "macOS 15",
        navegador: "Chrome 139",
        primeiroContato: menos(40),
        ultimoContato: menos(9),
        viva: false,
        conhecida: false,
        desligada: false,
        desligadaMotivo: null,
      },
    ],
    mapaVersao: 1,
    chatDesligadoNaBase: false,
    assinaturaAtiva: true,
    heartbeatSegundos: 120,
    gracaDias: 7,
  };
}
