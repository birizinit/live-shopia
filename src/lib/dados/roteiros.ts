import "server-only";
import { bd } from "@/lib/db";
import { CHARS_POR_BLOCO, contarCaracteres, duracaoEstimadaMs } from "@/lib/caracteres";
import { comDemo, comoJson, escreverCursor, lerCursor, limitar, numeroDe } from "./comum";
import { ErroDominio, comTraducao, exigirAchado } from "./erros";
import { ROTULO_SECAO } from "./tipos";
import type {
  BlocoRoteiro,
  Consulta,
  EstadoJob,
  Estimativa,
  JobResumo,
  Pagina,
  SecaoRoteiro,
} from "./tipos";

/**
 * Roteiros — a tabela `roteiros` e o historico em `roteiro_versoes` (0004).
 *
 * Duas regras valem para o arquivo inteiro:
 *
 * 1. `perfilId` e o PRIMEIRO argumento de tudo e entra no `where` de toda
 *    consulta. Nao ha RLS: o dono e conferido aqui, nunca por um id vindo da
 *    URL. Nas escritas quem confere e a PROPRIA consulta — o insert le de
 *    `roteiros` com `perfil_id = $1`, entao id de outro dono nao insere nada
 *    em vez de inserir errado.
 * 2. Versao nunca e sobrescrita. Editar, regerar e restaurar sempre INSEREM um
 *    numero novo. O texto e o unico ativo que o usuario produziu; perder a
 *    versao anterior e perder trabalho que ele nao refaz igual.
 *
 * Geracao de TEXTO nao gasta credito. Credito e de voz, e so sai por
 * debitarEEnfileirar() quando o roteiro virar audio no estudio.
 */

// -----------------------------------------------------------------------------
// Secoes
// -----------------------------------------------------------------------------

/**
 * A ordem e narrativa, nao alfabetica: o gancho prende, a oferta apresenta, a
 * prova sustenta, as objecoes destravam e o CTA fecha. Sai de um Record para
 * que uma secao nova no tipo quebre a compilacao aqui, em vez de sumir da tela.
 */
const POSICAO: Record<SecaoRoteiro, number> = {
  gancho: 1,
  oferta: 2,
  prova: 3,
  objecoes: 4,
  cta: 5,
};

export const ORDEM_SECOES: readonly SecaoRoteiro[] = (
  Object.keys(POSICAO) as SecaoRoteiro[]
).sort((a, b) => POSICAO[a] - POSICAO[b]);

export function ehSecao(valor: unknown): valor is SecaoRoteiro {
  return typeof valor === "string" && valor in ROTULO_SECAO;
}

/**
 * Normaliza o que vem do jsonb ou do formulario.
 *
 * Para o Postgres o jsonb e texto livre: nada garante ordem, chave nem numero
 * de secoes. Secao repetida e juntada em vez de descartada — perder metade do
 * gancho seria pior que um paragrafo a mais.
 */
export function normalizarSecoes(bruto: unknown): BlocoRoteiro[] {
  const lista = Array.isArray(bruto) ? bruto : [];
  const porSecao = new Map<SecaoRoteiro, string>();

  for (const item of lista) {
    const { secao, texto } = (item ?? {}) as Partial<BlocoRoteiro>;
    if (!ehSecao(secao) || typeof texto !== "string") continue;

    const limpo = texto.trim();
    if (!limpo) continue;

    const anterior = porSecao.get(secao);
    porSecao.set(secao, anterior ? `${anterior}\n\n${limpo}` : limpo);
  }

  return ORDEM_SECOES.filter((secao) => porSecao.has(secao)).map((secao) => ({
    secao,
    texto: porSecao.get(secao)!,
  }));
}

/**
 * O texto corrido que vai para a coluna `texto` — o mesmo que a estimativa e o
 * TTS leem. A juncao e identica a do worker (worker/trabalhos/roteiro.ts): se
 * divergisse, a contagem da tela nao bateria com a que vai ser cobrada.
 */
export function textoDeSecoes(secoes: BlocoRoteiro[]): string {
  return secoes
    .map((bloco) => bloco.texto.trim())
    .filter(Boolean)
    .join("\n\n");
}

// -----------------------------------------------------------------------------
// Tipos de leitura
// -----------------------------------------------------------------------------

export type OrigemVersao = "ia" | "exemplo" | "edicao" | "restauracao";

export type VersaoRoteiro = {
  id: string;
  numero: number;
  secoes: BlocoRoteiro[];
  texto: string;
  caracteres: number;
  origem: OrigemVersao;
  /** Preenchido so quando `origem` e "restauracao". */
  restauradaDe: number | null;
  modelo: string | null;
  criadoEm: string;
};

export type RoteiroResumo = {
  id: string;
  titulo: string;
  produtoId: string | null;
  produtoNome: string | null;
  versaoAtual: number;
  caracteres: number;
  origem: OrigemVersao | null;
  /** Estado do job de geracao, quando ha um em andamento. */
  jobEstado: EstadoJob | null;
  criadoEm: string;
  atualizadoEm: string;
};

export type RoteiroDetalhe = RoteiroResumo & {
  versao: VersaoRoteiro | null;
};

export type ProdutoOpcao = { id: string; nome: string };

/**
 * Marca de restauracao gravada em `roteiro_versoes.modelo`.
 *
 * A migracao 0004 nao tem coluna de procedencia e migracao nao e deste dono.
 * `modelo` ja e texto livre descritivo ("exemplo", o nome do modelo), entao o
 * prefixo cabe ali sem mentir sobre nenhum outro campo — e a leitura fica
 * nesta funcao, num lugar so.
 */
const PREFIXO_RESTAURACAO = "restaurado:";

function lerOrigem(
  geradoPorIa: boolean,
  modelo: string | null,
): { origem: OrigemVersao; restauradaDe: number | null } {
  if (modelo?.startsWith(PREFIXO_RESTAURACAO)) {
    const numero = Number(modelo.slice(PREFIXO_RESTAURACAO.length));
    return {
      origem: "restauracao",
      restauradaDe: Number.isInteger(numero) ? numero : null,
    };
  }
  // O worker grava "exemplo" quando nao ha ANTHROPIC_API_KEY. E por este campo
  // que a tela sabe rotular que a IA nao escreveu aquilo.
  if (modelo === "exemplo") return { origem: "exemplo", restauradaDe: null };
  if (geradoPorIa) return { origem: "ia", restauradaDe: null };
  return { origem: "edicao", restauradaDe: null };
}

/**
 * Id vindo da URL nao e uuid ate prova em contrario.
 *
 * Sem esta guarda `/roteiro/abc` vira 22P02 no Postgres e a tela quebra com
 * "Identificador invalido" em vez do 404 que o caso merece.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(valor: string | null | undefined): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

// -----------------------------------------------------------------------------
// Exemplos do modo demo
// -----------------------------------------------------------------------------

/**
 * A sessao demo nao tem linha no banco (src/lib/demo.ts), entao consulta com o
 * perfil falso estoura. Toda leitura daqui passa por comDemo() antes do banco.
 */
export const ID_EXEMPLO = "7a1e0000-0000-4000-8000-000000000001";
const ID_EXEMPLO_2 = "7a1e0000-0000-4000-8000-000000000002";

const SECOES_EXEMPLO_V2: BlocoRoteiro[] = [
  {
    secao: "gancho",
    texto:
      "Para tudo. Se a sua pele fica oleosa antes do meio-dia, fica comigo nos próximos trinta segundos.",
  },
  {
    secao: "oferta",
    texto:
      "O sérum de vitamina C está com condição de live, e o cupom fica fixado aqui na tela. Um frasco dá para noventa dias de uso diário.",
  },
  {
    secao: "prova",
    texto:
      "Olha a caixinha de comentários: quem já levou volta para contar. A avaliação da loja está à vista, é só tocar no carrinho.",
  },
  {
    secao: "objecoes",
    texto:
      "Ficou na dúvida se serve para pele sensível? Comenta aqui que eu leio. E a devolução é pelo próprio aplicativo, sem conversa.",
  },
  {
    secao: "cta",
    texto: "Toca no carrinho, aplica o cupom e garante o seu enquanto tem.",
  },
];

const SECOES_EXEMPLO_V1: BlocoRoteiro[] = SECOES_EXEMPLO_V2.map((bloco) =>
  bloco.secao === "gancho"
    ? {
        secao: "gancho" as const,
        texto: "Chegou gente nova, então eu vou começar do começo de novo.",
      }
    : bloco,
);

function versaoExemplo(
  numero: number,
  secoes: BlocoRoteiro[],
  origem: OrigemVersao,
): VersaoRoteiro {
  const texto = textoDeSecoes(secoes);
  return {
    id: `${ID_EXEMPLO}-v${numero}`,
    numero,
    secoes,
    texto,
    caracteres: contarCaracteres(texto),
    origem,
    restauradaDe: null,
    modelo: origem === "exemplo" ? "exemplo" : null,
    criadoEm: new Date(Date.UTC(2026, 1, 10 + numero, 13, 40)).toISOString(),
  };
}

const VERSOES_EXEMPLO: VersaoRoteiro[] = [
  versaoExemplo(2, SECOES_EXEMPLO_V2, "edicao"),
  versaoExemplo(1, SECOES_EXEMPLO_V1, "exemplo"),
];

/**
 * A lista e o detalhe do exemplo são separados de propósito, como no banco: a
 * lista não carrega o texto de cada roteiro, senão a primeira tela mandaria
 * todos os roteiros inteiros para o navegador só para mostrar seis colunas.
 */
const RESUMOS_EXEMPLO: RoteiroResumo[] = [
  {
    id: ID_EXEMPLO,
    titulo: "Sérum de vitamina C — live da noite",
    produtoId: "7a1e0000-0000-4000-8000-0000000000a1",
    produtoNome: "Sérum facial vitamina C 30ml",
    versaoAtual: 2,
    caracteres: VERSOES_EXEMPLO[0]!.caracteres,
    origem: "edicao",
    jobEstado: null,
    criadoEm: new Date(Date.UTC(2026, 1, 11, 13, 40)).toISOString(),
    atualizadoEm: new Date(Date.UTC(2026, 1, 12, 9, 5)).toISOString(),
  },
  {
    id: ID_EXEMPLO_2,
    titulo: "Escova secadora 3 em 1",
    produtoId: null,
    produtoNome: null,
    versaoAtual: 1,
    caracteres: VERSOES_EXEMPLO[1]!.caracteres,
    origem: "exemplo",
    jobEstado: null,
    criadoEm: new Date(Date.UTC(2026, 1, 8, 20, 12)).toISOString(),
    atualizadoEm: new Date(Date.UTC(2026, 1, 8, 20, 12)).toISOString(),
  },
];

const VERSAO_EM_USO_EXEMPLO: Record<string, VersaoRoteiro> = {
  [ID_EXEMPLO]: VERSOES_EXEMPLO[0]!,
  [ID_EXEMPLO_2]: VERSOES_EXEMPLO[1]!,
};

const PRODUTOS_EXEMPLO: ProdutoOpcao[] = [
  { id: "7a1e0000-0000-4000-8000-0000000000a1", nome: "Sérum facial vitamina C 30ml" },
  { id: "7a1e0000-0000-4000-8000-0000000000a2", nome: "Escova secadora 3 em 1" },
];

// -----------------------------------------------------------------------------
// Leitura
// -----------------------------------------------------------------------------

type LinhaResumo = {
  id: string;
  titulo: string;
  produto_id: string | null;
  produto_nome: string | null;
  versao_atual: number;
  caracteres: number | null;
  gerado_por_ia: boolean | null;
  modelo: string | null;
  criado_em: Date;
  atualizado_em: Date;
  total: string | number;
};

function montarResumo(linha: LinhaResumo, jobEstado: EstadoJob | null): RoteiroResumo {
  return {
    id: linha.id,
    titulo: linha.titulo,
    produtoId: linha.produto_id,
    produtoNome: linha.produto_nome,
    versaoAtual: linha.versao_atual,
    caracteres: numeroDe(linha.caracteres),
    origem:
      linha.gerado_por_ia === null
        ? null
        : lerOrigem(linha.gerado_por_ia, linha.modelo).origem,
    jobEstado,
    criadoEm: linha.criado_em.toISOString(),
    atualizadoEm: linha.atualizado_em.toISOString(),
  };
}

export async function listarRoteiros(
  perfilId: string,
  consulta: Consulta = {},
): Promise<Pagina<RoteiroResumo>> {
  return comDemo(
    () => ({
      itens: RESUMOS_EXEMPLO,
      proximo: null,
      total: RESUMOS_EXEMPLO.length,
    }),
    () =>
      comTraducao(async () => {
        const sql = bd();
        const limite = limitar(consulta.limite);
        const busca = consulta.busca?.trim().slice(0, 120) || null;
        const cursor = lerCursor(consulta.cursor);
        // Cursor forjado com id que nao e uuid derrubaria o `::uuid`. Ignorar e
        // o certo: o pior caso e voltar para a primeira pagina.
        const de = cursor && ehUuid(cursor.id) ? cursor : null;

        const linhas = await sql<LinhaResumo[]>`
          select r.id,
                 r.titulo,
                 r.produto_id,
                 p.nome as produto_nome,
                 r.versao_atual,
                 v.caracteres,
                 v.gerado_por_ia,
                 v.modelo,
                 r.criado_em,
                 r.atualizado_em,
                 count(*) over () as total
            from roteiros r
            left join produtos p
              on p.id = r.produto_id and p.perfil_id = r.perfil_id
            left join roteiro_versoes v
              on v.roteiro_id = r.id and v.perfil_id = r.perfil_id
             and v.numero = r.versao_atual
           where r.perfil_id = ${perfilId}
             and r.arquivado_em is null
             ${busca ? sql`and r.titulo ilike ${`%${busca}%`}` : sql``}
             ${
               de
                 ? sql`and (r.atualizado_em, r.id) < (${de.instante}::timestamptz, ${de.id}::uuid)`
                 : sql``
             }
           order by r.atualizado_em desc, r.id desc
           limit ${limite + 1}
        `;

        const temMais = linhas.length > limite;
        const janela = temMais ? linhas.slice(0, limite) : linhas;

        // Uma consulta para todos os jobs ativos, e nao um LATERAL por linha:
        // `jobs` nao tem indice por perfil_id, entao uma varredura custa menos
        // que vinte e quatro.
        const ativos = janela.length
          ? await jobsAtivosDoPerfil(perfilId)
          : new Map<string, EstadoJob>();

        const ultimo = janela.at(-1);

        return {
          itens: janela.map((linha) => montarResumo(linha, ativos.get(linha.id) ?? null)),
          proximo:
            temMais && ultimo ? escreverCursor(ultimo.atualizado_em, ultimo.id) : null,
          // `count(*) over ()` conta o que o WHERE achou, antes do LIMIT. Com
          // cursor isso e so o que sobrou da lista, e nao o total — por isso o
          // numero so vale na primeira pagina.
          total: de ? undefined : numeroDe(janela[0]?.total),
        };
      }),
  );
}

async function jobsAtivosDoPerfil(perfilId: string): Promise<Map<string, EstadoJob>> {
  const linhas = await bd()<{ roteiro_id: string | null; estado: EstadoJob }[]>`
    select entrada->>'roteiro_id' as roteiro_id, estado
      from jobs
     where perfil_id = ${perfilId}
       and tipo = 'roteiro'
       and estado in ('pendente', 'processando')
     order by criado_em desc
     limit 50
  `;

  const mapa = new Map<string, EstadoJob>();
  for (const linha of linhas) {
    if (linha.roteiro_id && !mapa.has(linha.roteiro_id)) {
      mapa.set(linha.roteiro_id, linha.estado);
    }
  }
  return mapa;
}

type LinhaDetalhe = LinhaResumo & {
  versao_id: string | null;
  versao_numero: number | null;
  secoes: unknown;
  texto: string | null;
  versao_criado_em: Date | null;
};

export async function obterRoteiro(
  perfilId: string,
  roteiroId: string,
): Promise<RoteiroDetalhe | null> {
  if (!ehUuid(roteiroId)) return null;

  return comDemo(
    () => {
      const resumo = RESUMOS_EXEMPLO.find((roteiro) => roteiro.id === roteiroId);
      return resumo
        ? { ...resumo, versao: VERSAO_EM_USO_EXEMPLO[resumo.id] ?? null }
        : null;
    },
    () =>
      comTraducao(async () => {
        const sql = bd();

        const linha = (
          await sql<LinhaDetalhe[]>`
            select r.id,
                   r.titulo,
                   r.produto_id,
                   p.nome as produto_nome,
                   r.versao_atual,
                   r.criado_em,
                   r.atualizado_em,
                   0 as total,
                   v.id as versao_id,
                   v.numero as versao_numero,
                   v.secoes,
                   v.texto,
                   v.caracteres,
                   v.gerado_por_ia,
                   v.modelo,
                   v.criado_em as versao_criado_em
              from roteiros r
              left join produtos p
                on p.id = r.produto_id and p.perfil_id = r.perfil_id
              left join roteiro_versoes v
                on v.roteiro_id = r.id and v.perfil_id = r.perfil_id
               and v.numero = r.versao_atual
             where r.id = ${roteiroId}
               and r.perfil_id = ${perfilId}
               and r.arquivado_em is null
          `
        )[0];

        if (!linha) return null;

        const job = await geracaoDoRoteiro(perfilId, roteiroId);
        const emAndamento =
          job && (job.estado === "pendente" || job.estado === "processando")
            ? job.estado
            : null;

        return {
          ...montarResumo(linha, emAndamento),
          versao:
            linha.versao_id !== null && linha.versao_numero !== null && linha.texto !== null
              ? {
                  id: linha.versao_id,
                  numero: linha.versao_numero,
                  secoes: normalizarSecoes(linha.secoes),
                  texto: linha.texto,
                  caracteres: numeroDe(linha.caracteres),
                  ...lerOrigem(linha.gerado_por_ia ?? false, linha.modelo),
                  modelo: linha.modelo,
                  criadoEm: (linha.versao_criado_em ?? linha.criado_em).toISOString(),
                }
              : null,
        };
      }),
  );
}

type LinhaVersao = {
  id: string;
  numero: number;
  secoes: unknown;
  texto: string;
  caracteres: number;
  gerado_por_ia: boolean;
  modelo: string | null;
  criado_em: Date;
};

function montarVersao(linha: LinhaVersao): VersaoRoteiro {
  return {
    id: linha.id,
    numero: linha.numero,
    secoes: normalizarSecoes(linha.secoes),
    texto: linha.texto,
    caracteres: numeroDe(linha.caracteres),
    ...lerOrigem(linha.gerado_por_ia, linha.modelo),
    modelo: linha.modelo,
    criadoEm: linha.criado_em.toISOString(),
  };
}

export async function listarVersoes(
  perfilId: string,
  roteiroId: string,
  limite = 30,
): Promise<VersaoRoteiro[]> {
  if (!ehUuid(roteiroId)) return [];

  return comDemo(
    () => (roteiroId === ID_EXEMPLO ? VERSOES_EXEMPLO : VERSOES_EXEMPLO.slice(1)),
    () =>
      comTraducao(async () => {
        const linhas = await bd()<LinhaVersao[]>`
          select id, numero, secoes, texto, caracteres, gerado_por_ia, modelo, criado_em
            from roteiro_versoes
           where roteiro_id = ${roteiroId}
             and perfil_id = ${perfilId}
           order by numero desc
           limit ${Math.min(Math.max(limite, 1), 100)}
        `;
        return linhas.map(montarVersao);
      }),
  );
}

export async function obterVersao(
  perfilId: string,
  roteiroId: string,
  numero: number,
): Promise<VersaoRoteiro | null> {
  if (!ehUuid(roteiroId) || !Number.isInteger(numero) || numero < 1) return null;

  return comDemo(
    () => VERSOES_EXEMPLO.find((versao) => versao.numero === numero) ?? null,
    () =>
      comTraducao(async () => {
        const linha = (
          await bd()<LinhaVersao[]>`
            select id, numero, secoes, texto, caracteres, gerado_por_ia, modelo, criado_em
              from roteiro_versoes
             where roteiro_id = ${roteiroId}
               and perfil_id = ${perfilId}
               and numero = ${numero}
          `
        )[0];
        return linha ? montarVersao(linha) : null;
      }),
  );
}

/** O ultimo job de roteiro deste roteiro, em qualquer estado. */
export async function geracaoDoRoteiro(
  perfilId: string,
  roteiroId: string,
): Promise<JobResumo | null> {
  if (!ehUuid(roteiroId)) return null;

  return comDemo(
    () => null,
    () =>
      comTraducao(async () => {
        const linha = (
          await bd()<
            {
              id: string;
              estado: EstadoJob;
              progresso: number;
              erro: string | null;
              criado_em: Date;
            }[]
          >`
            select id, estado, progresso, erro, criado_em
              from jobs
             where perfil_id = ${perfilId}
               and tipo = 'roteiro'
               and entrada->>'roteiro_id' = ${roteiroId}
             order by criado_em desc
             limit 1
          `
        )[0];

        if (!linha) return null;

        return {
          id: linha.id,
          tipo: "roteiro" as const,
          estado: linha.estado,
          progresso: linha.progresso,
          erro: linha.erro,
          criadoEm: linha.criado_em.toISOString(),
        };
      }),
  );
}

export type EstadoGeracao = {
  estado: EstadoJob | null;
  progresso: number;
  erro: string | null;
  versaoAtual: number;
  /** true enquanto o worker ainda pode mexer neste roteiro. */
  ativo: boolean;
};

/**
 * Resposta enxuta para o acompanhamento do job — e o que a tela pergunta de
 * dois em dois segundos enquanto a IA escreve. Nao carrega texto nem secoes:
 * so o suficiente para decidir entre continuar esperando e recarregar.
 */
export async function estadoDaGeracao(
  perfilId: string,
  roteiroId: string,
): Promise<EstadoGeracao | null> {
  if (!ehUuid(roteiroId)) return null;

  return comDemo(
    () => {
      const exemplo = RESUMOS_EXEMPLO.find((roteiro) => roteiro.id === roteiroId);
      if (!exemplo) return null;
      return {
        estado: null,
        progresso: 0,
        erro: null,
        versaoAtual: exemplo.versaoAtual,
        ativo: false,
      };
    },
    () =>
      comTraducao(async () => {
        const linha = (
          await bd()<
            {
              versao_atual: number;
              estado: EstadoJob | null;
              progresso: number | null;
              erro: string | null;
            }[]
          >`
            select r.versao_atual, j.estado, j.progresso, j.erro
              from roteiros r
              left join lateral (
                select estado, progresso, erro
                  from jobs
                 where perfil_id = r.perfil_id
                   and tipo = 'roteiro'
                   and entrada->>'roteiro_id' = r.id::text
                 order by criado_em desc
                 limit 1
              ) j on true
             where r.id = ${roteiroId}
               and r.perfil_id = ${perfilId}
               and r.arquivado_em is null
          `
        )[0];

        if (!linha) return null;

        return {
          estado: linha.estado,
          progresso: numeroDe(linha.progresso),
          erro: linha.erro,
          versaoAtual: linha.versao_atual,
          ativo: linha.estado === "pendente" || linha.estado === "processando",
        };
      }),
  );
}

/**
 * Qual roteiro esta chave de formulario ja criou.
 *
 * A chave de idempotencia protege o JOB (indice unico em tipo +
 * chave_idempotencia), mas nao protegeria a linha em `roteiros`: o segundo
 * clique criaria um roteiro orfao antes de reencontrar o mesmo job. Consultar
 * a chave antes de criar fecha essa porta.
 */
export async function roteiroDaChave(
  perfilId: string,
  referencia: string,
): Promise<string | null> {
  return comDemo(
    () => null,
    () =>
      comTraducao(async () => {
        const linha = (
          await bd()<{ roteiro_id: string | null }[]>`
            select entrada->>'roteiro_id' as roteiro_id
              from jobs
             where tipo = 'roteiro'
               and chave_idempotencia = ${referencia}
               and perfil_id = ${perfilId}
          `
        )[0];
        return linha?.roteiro_id ?? null;
      }),
  );
}

export async function produtosParaRoteiro(perfilId: string): Promise<ProdutoOpcao[]> {
  return comDemo(
    () => PRODUTOS_EXEMPLO,
    () =>
      comTraducao(async () => {
        const linhas = await bd()<ProdutoOpcao[]>`
          select id, nome
            from produtos
           where perfil_id = ${perfilId}
             and arquivado_em is null
           order by fixado desc, criado_em desc
           limit 50
        `;
        return [...linhas];
      }),
  );
}

/**
 * O que este texto vai custar QUANDO virar audio — nunca agora.
 *
 * `creditosDisponiveis` vem da sessao, que ja leu `perfis.creditos` nesta mesma
 * requisicao (src/lib/auth/sessoes.ts): repetir a consulta so para reler o
 * saldo seria uma ida ao banco a toa e, no modo demo, uma ida que quebra.
 */
export function estimativaDeFala(texto: string, creditosDisponiveis: number): Estimativa {
  const caracteres = contarCaracteres(texto);

  return {
    caracteres,
    // Roteiro vazio nao tem bloco. `estimar()` de creditos.ts devolve 1 porque
    // la ja existe texto a cobrar; aqui o zero e um estado real da tela.
    blocos: caracteres === 0 ? 0 : Math.ceil(caracteres / CHARS_POR_BLOCO),
    duracaoMs: duracaoEstimadaMs(caracteres),
    creditosDisponiveis,
    suficiente: creditosDisponiveis >= caracteres,
    faltam: Math.max(0, caracteres - creditosDisponiveis),
  };
}

// -----------------------------------------------------------------------------
// Escrita
// -----------------------------------------------------------------------------

/**
 * Insere a proxima versao. O numero sai de `max(numero) + 1` calculado DENTRO
 * do insert, e a unicidade (roteiro_id, numero) da 0004 decide o empate: duas
 * gravacoes simultaneas dao conflito, nunca versao perdida em silencio.
 *
 * O `from roteiros r where perfil_id = $1` nao e enfeite — e ele que impede
 * gravar versao no roteiro de outro dono, ja que a FK de roteiro_versoes olha
 * so a existencia do roteiro, nao de quem ele e.
 */
async function inserirVersao(
  perfilId: string,
  roteiroId: string,
  secoes: BlocoRoteiro[],
  texto: string,
  meta: { geradoPorIa: boolean; modelo: string | null },
): Promise<{ id: string; numero: number }> {
  const sql = bd();

  const linhas = await sql<{ id: string; numero: number }[]>`
    insert into roteiro_versoes
      (roteiro_id, perfil_id, numero, secoes, texto, gerado_por_ia, modelo)
    select r.id,
           r.perfil_id,
           coalesce((select max(v.numero) from roteiro_versoes v where v.roteiro_id = r.id), 0) + 1,
           ${comoJson(secoes)},
           ${texto},
           ${meta.geradoPorIa},
           ${meta.modelo}
      from roteiros r
     where r.id = ${roteiroId}
       and r.perfil_id = ${perfilId}
       and r.arquivado_em is null
    returning id, numero
  `;

  const versao = exigirAchado(linhas[0], "Roteiro");

  await sql`
    update roteiros
       set versao_atual = ${versao.numero}
     where id = ${roteiroId} and perfil_id = ${perfilId}
  `;

  return versao;
}

export async function criarRoteiro(
  perfilId: string,
  dados: { titulo?: string | null; produtoId?: string | null },
): Promise<{ id: string; titulo: string }> {
  return comTraducao(async () => {
    const sql = bd();
    const produtoId = ehUuid(dados.produtoId) ? dados.produtoId : null;
    const titulo = (dados.titulo ?? "").trim().slice(0, 140) || null;

    const linhas = produtoId
      ? // O produto entra pelo `select`, e nao como parametro solto: assim o
        // vinculo so acontece se o produto for mesmo deste perfil.
        await sql<{ id: string; titulo: string }[]>`
          insert into roteiros (perfil_id, produto_id, titulo)
          select ${perfilId}, p.id, coalesce(${titulo}::text, 'Roteiro de ' || p.nome)
            from produtos p
           where p.id = ${produtoId}
             and p.perfil_id = ${perfilId}
             and p.arquivado_em is null
          returning id, titulo
        `
      : await sql<{ id: string; titulo: string }[]>`
          insert into roteiros (perfil_id, titulo)
          values (${perfilId}, coalesce(${titulo}::text, 'Roteiro sem título'))
          returning id, titulo
        `;

    return exigirAchado(linhas[0], "Produto");
  });
}

/**
 * Salva o que esta no editor.
 *
 * Titulo e texto seguem caminhos diferentes de proposito: renomear nao e uma
 * versao nova do roteiro, e gravar uma versao identica so para trocar o nome
 * encheria o historico de ruido — que e o que faz ninguem mais olhar historico.
 */
export async function salvarRoteiro(
  perfilId: string,
  roteiroId: string,
  dados: { titulo: string; secoes: BlocoRoteiro[] },
): Promise<{ numero: number; criouVersao: boolean }> {
  if (!ehUuid(roteiroId)) {
    throw new ErroDominio("nao_encontrado", "Roteiro não encontrado.");
  }

  const secoes = normalizarSecoes(dados.secoes);
  const texto = textoDeSecoes(secoes);
  if (!texto) {
    throw new ErroDominio("dado_invalido", "Escreva pelo menos uma seção antes de salvar.");
  }

  const titulo = dados.titulo.trim().slice(0, 140) || "Roteiro sem título";

  return comTraducao(async () => {
    const sql = bd();

    const atual = (
      await sql<{ versao_atual: number; texto: string | null }[]>`
        select r.versao_atual, v.texto
          from roteiros r
          left join roteiro_versoes v
            on v.roteiro_id = r.id and v.perfil_id = r.perfil_id
           and v.numero = r.versao_atual
         where r.id = ${roteiroId}
           and r.perfil_id = ${perfilId}
           and r.arquivado_em is null
      `
    )[0];

    const linha = exigirAchado(atual, "Roteiro");

    await sql`
      update roteiros
         set titulo = ${titulo}
       where id = ${roteiroId} and perfil_id = ${perfilId}
    `;

    if (linha.texto === texto) {
      return { numero: linha.versao_atual, criouVersao: false };
    }

    const versao = await inserirVersao(perfilId, roteiroId, secoes, texto, {
      geradoPorIa: false,
      modelo: null,
    });

    return { numero: versao.numero, criouVersao: true };
  });
}

/**
 * Restaurar NAO volta o ponteiro: copia o conteudo antigo para uma versao nova.
 * Assim o texto que estava no ar antes da restauracao continua existindo —
 * desfazer o "desfazer" vira um clique, e nao um chamado no suporte.
 */
export async function restaurarVersao(
  perfilId: string,
  roteiroId: string,
  numero: number,
): Promise<{ numero: number; de: number }> {
  const origem = await obterVersao(perfilId, roteiroId, numero);
  const versao = exigirAchado(origem, "Versão");

  return comTraducao(async () => {
    const nova = await inserirVersao(perfilId, roteiroId, versao.secoes, versao.texto, {
      // O texto veio mesmo da IA; o que muda e a marca de procedencia.
      geradoPorIa: versao.origem === "ia" || versao.origem === "exemplo",
      modelo: `${PREFIXO_RESTAURACAO}${versao.numero}`,
    });

    return { numero: nova.numero, de: versao.numero };
  });
}

export async function arquivarRoteiro(perfilId: string, roteiroId: string): Promise<void> {
  if (!ehUuid(roteiroId)) {
    throw new ErroDominio("nao_encontrado", "Roteiro não encontrado.");
  }

  await comTraducao(async () => {
    const linhas = await bd()<{ id: string }[]>`
      update roteiros
         set arquivado_em = now()
       where id = ${roteiroId}
         and perfil_id = ${perfilId}
         and arquivado_em is null
      returning id
    `;
    exigirAchado(linhas[0], "Roteiro");
  });
}
