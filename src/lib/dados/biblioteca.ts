import "server-only";
import { bd } from "@/lib/db";
import { comDemo, lerCursor, limitar, montarPagina, numeroDe } from "./comum";
import { comTraducao } from "./erros";
import type { BlocoRoteiro, EstadoAudio, Pagina, Periodo } from "./tipos";

/**
 * Biblioteca — a visao unificada do que o usuario ja produziu.
 *
 * SO LEITURA. Audio e roteiro sao donos de si mesmos em outros modulos; aqui as
 * tabelas sao consultadas direto e nada e escrito. Toda funcao recebe
 * `perfilId` como primeiro argumento e usa no `where`: sem RLS, e essa clausula
 * que impede um id adivinhado na URL devolver o roteiro de outra pessoa.
 *
 * A lista e uma uniao de duas origens (`audios` e `roteiros`) com um campo
 * discriminador, ordenada por data e paginada por CURSOR — nao por offset.
 * Item novo entra no topo da biblioteca o tempo todo, e offset relistaria o que
 * ja passou a cada "carregar mais".
 *
 * A metrica que esta tela existe para ensinar: o audio custa caractere UMA vez.
 * Toda vez que ele entra numa montagem ou vai ao ar numa live, a fala se repete
 * de graca. `caracteresPoupados` e o tamanho dessa economia — e o numero que
 * separa quem queima credito de quem reaproveita.
 */

export type TipoItem = "audio" | "roteiro";
export type FiltroTipo = TipoItem | "todos";

export type ItemBiblioteca = {
  id: string;
  tipo: TipoItem;
  titulo: string;
  /** Comeco do texto, para reconhecer o item sem precisar abrir. */
  trecho: string;
  /** O custo em caracteres: o que foi (ou seria) debitado para gerar. */
  caracteres: number;
  criadoEm: string;
  produtoId: string | null;
  produto: string | null;
  vozId: string | null;
  voz: string | null;
  /** Somente audio. */
  estado: EstadoAudio | null;
  duracaoMs: number | null;
  blocosTotal: number;
  blocosProntos: number;
  /** Audio: montagens em que ele entra. */
  montagens: number;
  /** Audio: transmissoes que ja foram ao ar com ele. */
  lives: number;
  /** Audio: usos que NAO custaram geracao nova (montagens + lives). */
  reusos: number;
  caracteresPoupados: number;
  /** Roteiro: versoes guardadas. */
  versoes: number;
  /** Roteiro: audios que nasceram dele. */
  audiosGerados: number;
  /** A tela dona do item — a biblioteca so aponta para la, nunca edita. */
  href: string;
};

export type ResumoBiblioteca = {
  itens: number;
  audios: number;
  roteiros: number;
  /** Caracteres que os audios do recorte custaram, somados. */
  caracteresGerados: number;
  reusos: number;
  /** O que NAO foi cobrado de novo porque o audio ja existia. */
  caracteresPoupados: number;
  duracaoMs: number;
};

export type OpcaoFiltro = { id: string; nome: string };
export type OpcoesFiltro = { produtos: OpcaoFiltro[]; vozes: OpcaoFiltro[] };

export type FiltrosBiblioteca = {
  tipo: FiltroTipo;
  produtoId: string | null;
  vozId: string | null;
  periodo: Periodo;
  busca: string;
};

export type DetalheBiblioteca = {
  item: ItemBiblioteca;
  texto: string;
  /** Texto longo viaja cortado: o detalhe e para conferir, nao para editar. */
  truncado: boolean;
  /** Roteiro: as secoes da versao mais recente. */
  secoes: BlocoRoteiro[] | null;
  versao: number | null;
  geradoPorIa: boolean;
};

export const FILTROS_PADRAO: FiltrosBiblioteca = {
  tipo: "todos",
  produtoId: null,
  vozId: null,
  periodo: "total",
  busca: "",
};

/**
 * O instante em texto, com os microssegundos que o Postgres guarda.
 *
 * O cursor NAO pode sair do `Date` que o driver monta: `Date` do JavaScript so
 * tem milissegundo, entao 12:00:00.060381 volta como 12:00:00.060 — 381µs
 * ANTES da linha que o cursor deveria marcar. Com `<` estrito, a pagina
 * seguinte perde em silencio todo item criado naquele mesmo milissegundo, e uma
 * insercao em lote (um roteiro que vira varios audios de uma vez) cai inteira
 * nessa fresta. Medido: tres audios inseridos juntos, a segunda pagina voltava
 * vazia.
 *
 * A volta tem a MESMA armadilha e por isso o cursor entra como
 * `::text::timestamptz`: quando o parametro e comparado direto com
 * `::timestamptz`, o servidor informa o tipo 1184 na descricao do statement e o
 * postgres.js reserializa o valor com `new Date(x).toISOString()`
 * (node_modules/postgres/src/types.js), truncando de novo. Com o `::text` no
 * meio o tipo inferido e texto, o valor viaja intacto e quem converte e o
 * Postgres.
 */
const FORMATO_INSTANTE = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/** Quanto de texto viaja na lista. O resto so no detalhe, sob demanda. */
const TAMANHO_TRECHO = 320;
/** Teto do texto no detalhe. Um roteiro de 3h tem ~108 mil caracteres. */
const TAMANHO_DETALHE = 12_000;

const PERIODOS_VALIDOS: readonly Periodo[] = ["hoje", "ontem", "7d", "30d", "total"];
const TIPOS_VALIDOS: readonly FiltroTipo[] = ["todos", "audio", "roteiro"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function primeiro(valor: unknown): string {
  if (Array.isArray(valor)) return typeof valor[0] === "string" ? valor[0] : "";
  return typeof valor === "string" ? valor : "";
}

function comoUuid(valor: unknown): string | null {
  const texto = primeiro(valor).trim();
  // Sem esta checagem um "?produto=abc" na URL viraria 22P02 e derrubaria a
  // tela inteira, em vez de simplesmente nao filtrar nada.
  return UUID.test(texto) ? texto : null;
}

/**
 * Le os filtros do que veio de fora — searchParams da tela ou a consulta que a
 * lista devolve na acao de servidor. Nada aqui e confiado: valor desconhecido
 * cai no padrao.
 */
export function normalizarFiltros(
  entrada: Record<string, string | string[] | undefined> | undefined,
): FiltrosBiblioteca {
  const bruto = entrada ?? {};
  const tipo = primeiro(bruto.tipo) as FiltroTipo;
  const periodo = primeiro(bruto.periodo) as Periodo;

  return {
    tipo: TIPOS_VALIDOS.includes(tipo) ? tipo : "todos",
    produtoId: comoUuid(bruto.produto),
    vozId: comoUuid(bruto.voz),
    periodo: PERIODOS_VALIDOS.includes(periodo) ? periodo : "total",
    busca: primeiro(bruto.q).trim().slice(0, 120),
  };
}

/** Endereco da tela dona do item. A biblioteca aponta para la, nunca edita. */
function enderecoDe(tipo: TipoItem, id: string) {
  return tipo === "audio" ? `/estudio?audio=${id}` : `/roteiro/${id}`;
}

/**
 * Escapa os curingas do LIKE. Sem isto, um "_" digitado na busca casa com
 * qualquer letra e o usuario conclui que a biblioteca esta mentindo.
 */
function curinga(texto: string) {
  return `%${texto.replace(/[!%_]/g, (caractere) => `!${caractere}`)}%`;
}

/**
 * Meia-noite de um dia em America/Sao_Paulo, como timestamptz.
 *
 * O recorte precisa ser o MESMO dia que `vendas.dia` congela (migracao 0006):
 * calculado em UTC, tudo que foi gerado das 21h a meia-noite cairia no dia
 * seguinte, e o "hoje" da biblioteca discordaria do "hoje" do dashboard todo
 * fim de noite.
 */
function inicioDoDia(diasAtras: number) {
  return bd()`
    ((date_trunc('day', now() at time zone 'America/Sao_Paulo')
      - make_interval(days => ${diasAtras}::int)) at time zone 'America/Sao_Paulo')
  `;
}

function recorte(periodo: Periodo) {
  const sql = bd();
  switch (periodo) {
    case "hoje":
      return sql`and b.criado_em >= ${inicioDoDia(0)}`;
    case "ontem":
      return sql`and b.criado_em >= ${inicioDoDia(1)} and b.criado_em < ${inicioDoDia(0)}`;
    case "7d":
      return sql`and b.criado_em >= ${inicioDoDia(6)}`;
    case "30d":
      return sql`and b.criado_em >= ${inicioDoDia(29)}`;
    default:
      return sql``;
  }
}

/**
 * A uniao das duas origens, com o campo discriminador `tipo`.
 *
 * Produto, periodo e cursor ficam FORA, no seletor de cima: sao colunas que as
 * duas metades tem, e repeti-las aqui so duplicaria a condicao. Voz e busca
 * ficam dentro, porque `voz_id` so existe em audio e o texto completo nao sobe
 * para a uniao — sobe o trecho.
 */
function uniaoDaBiblioteca(perfilId: string, filtros: FiltrosBiblioteca) {
  const sql = bd();
  const alvo = filtros.busca ? curinga(filtros.busca) : null;

  const comAudios = filtros.tipo !== "roteiro";
  // Filtrar por voz e, por definicao, pedir so audio: roteiro nao tem voz.
  const comRoteiros = filtros.tipo !== "audio" && !filtros.vozId;

  const audios = sql`
    select
      a.id,
      'audio'::text          as tipo,
      a.titulo,
      a.criado_em,
      to_char(a.criado_em at time zone 'UTC', ${FORMATO_INSTANTE}) as criado_em_iso,
      a.caracteres,
      left(a.texto, ${TAMANHO_TRECHO}) as trecho,
      a.estado::text         as estado,
      a.duracao_ms,
      a.blocos_total::int    as blocos_total,
      a.blocos_prontos::int  as blocos_prontos,
      a.produto_id,
      pr.nome                as produto,
      a.voz_id,
      v.nome                 as voz
    from audios a
    left join produtos pr on pr.id = a.produto_id and pr.perfil_id = a.perfil_id
    left join vozes v on v.id = a.voz_id
    where a.perfil_id = ${perfilId}
      ${filtros.vozId ? sql`and a.voz_id = ${filtros.vozId}` : sql``}
      ${
        alvo
          ? sql`and (a.titulo ilike ${alvo} escape '!' or a.texto ilike ${alvo} escape '!')`
          : sql``
      }
  `;

  // A versao mais recente manda no que a biblioteca mostra. Lateral em vez de
  // `numero = r.versao_atual` porque o contador pode ficar para tras e roteiro
  // recem-criado ainda nao tem versao nenhuma.
  const roteiros = sql`
    select
      r.id,
      'roteiro'::text        as tipo,
      r.titulo,
      r.criado_em,
      to_char(r.criado_em at time zone 'UTC', ${FORMATO_INSTANTE}) as criado_em_iso,
      coalesce(rv.caracteres, 0)                      as caracteres,
      left(coalesce(rv.texto, ''), ${TAMANHO_TRECHO}) as trecho,
      null::text             as estado,
      null::int              as duracao_ms,
      0::int                 as blocos_total,
      0::int                 as blocos_prontos,
      r.produto_id,
      pr.nome                as produto,
      null::uuid             as voz_id,
      null::text             as voz
    from roteiros r
    left join lateral (
      select rv1.texto, rv1.caracteres
        from roteiro_versoes rv1
       where rv1.roteiro_id = r.id and rv1.perfil_id = r.perfil_id
       order by rv1.numero desc
       limit 1
    ) rv on true
    left join produtos pr on pr.id = r.produto_id and pr.perfil_id = r.perfil_id
    where r.perfil_id = ${perfilId}
      and r.arquivado_em is null
      ${
        alvo
          ? sql`and (r.titulo ilike ${alvo} escape '!' or rv.texto ilike ${alvo} escape '!')`
          : sql``
      }
  `;

  if (comAudios && comRoteiros) return sql`${audios} union all ${roteiros}`;
  if (comAudios) return audios;
  return roteiros;
}

type LinhaBiblioteca = {
  id: string;
  tipo: TipoItem;
  titulo: string;
  /** Usado so para ordenar e recortar no banco; o cursor vem do texto. */
  criado_em: Date;
  criado_em_iso: string;
  caracteres: number;
  trecho: string | null;
  estado: EstadoAudio | null;
  duracao_ms: number | null;
  blocos_total: number;
  blocos_prontos: number;
  produto_id: string | null;
  produto: string | null;
  voz_id: string | null;
  voz: string | null;
  montagens: number;
  lives: number;
  versoes: number;
  audios: number;
};

function mapear(linha: LinhaBiblioteca): ItemBiblioteca {
  const caracteres = numeroDe(linha.caracteres);
  // Reaproveitamento e uso sem geracao nova: cada montagem em que o audio entra
  // e cada live que foi ao ar com ele custariam outra sintese, se ele nao
  // existisse. Roteiro nao entra nesta conta — quem consome credito e o audio.
  const reusos = linha.tipo === "audio" ? linha.montagens + linha.lives : 0;

  return {
    id: linha.id,
    tipo: linha.tipo,
    titulo: linha.titulo,
    trecho: (linha.trecho ?? "").replace(/\s+/g, " ").trim(),
    caracteres,
    criadoEm: linha.criado_em_iso,
    produtoId: linha.produto_id,
    produto: linha.produto,
    vozId: linha.voz_id,
    voz: linha.voz,
    estado: linha.estado,
    duracaoMs: linha.duracao_ms,
    blocosTotal: linha.blocos_total,
    blocosProntos: linha.blocos_prontos,
    montagens: linha.montagens,
    lives: linha.lives,
    reusos,
    caracteresPoupados: caracteres * reusos,
    versoes: linha.versoes,
    audiosGerados: linha.audios,
    href: enderecoDe(linha.tipo, linha.id),
  };
}

/**
 * As contagens de reaproveitamento, presas a PAGINA e nunca a lista inteira.
 *
 * Se estas subconsultas morassem dentro da uniao, o Postgres as calcularia para
 * cada audio do perfil antes de ordenar e cortar — 24 linhas na tela custariam
 * mil subconsultas.
 */
function contagens(perfilId: string) {
  return bd()`
    left join lateral (
      select count(distinct mi.montagem_id)::int as montagens,
             count(distinct s.id)::int           as lives
        from montagem_itens mi
        left join live_sessoes s
          on s.montagem_id = mi.montagem_id and s.perfil_id = ${perfilId}
       where mi.perfil_id = ${perfilId} and mi.audio_id = p.id and p.tipo = 'audio'
    ) m on true
    left join lateral (
      select count(*)::int             as versoes,
             count(distinct a.id)::int as audios
        from roteiro_versoes rv2
        left join audios a on a.roteiro_versao_id = rv2.id and a.perfil_id = ${perfilId}
       where rv2.perfil_id = ${perfilId} and rv2.roteiro_id = p.id and p.tipo = 'roteiro'
    ) r on true
  `;
}

export async function listarBiblioteca(
  perfilId: string,
  filtros: FiltrosBiblioteca = FILTROS_PADRAO,
  cursor?: string | null,
  limiteBruto?: number,
): Promise<Pagina<ItemBiblioteca>> {
  const limite = limitar(limiteBruto);

  return comDemo(
    () => paginaExemplo(filtros, cursor, limite),
    () =>
      comTraducao(async () => {
        const sql = bd();
        const marca = lerCursor(cursor);

        const linhas = await sql<LinhaBiblioteca[]>`
          with base as (
            ${uniaoDaBiblioteca(perfilId, filtros)}
          ),
          pagina as (
            select b.*
              from base b
             where true
               ${filtros.produtoId ? sql`and b.produto_id = ${filtros.produtoId}` : sql``}
               ${recorte(filtros.periodo)}
               ${
                 marca
                   ? sql`and (b.criado_em, b.id) < (${marca.instante}::text::timestamptz, ${marca.id}::uuid)`
                   : sql``
               }
             order by b.criado_em desc, b.id desc
             limit ${limite + 1}
          )
          select p.*,
                 coalesce(m.montagens, 0) as montagens,
                 coalesce(m.lives, 0)     as lives,
                 coalesce(r.versoes, 0)   as versoes,
                 coalesce(r.audios, 0)    as audios
            from pagina p
            ${contagens(perfilId)}
           order by p.criado_em desc, p.id desc
        `;

        return montarPagina(linhas.map(mapear), limite);
      }),
  );
}

export async function resumoBiblioteca(
  perfilId: string,
  filtros: FiltrosBiblioteca = FILTROS_PADRAO,
): Promise<ResumoBiblioteca> {
  return comDemo(
    () => resumoExemplo(filtros),
    () =>
      comTraducao(async () => {
        const sql = bd();

        const linhas = await sql<
          {
            itens: number;
            audios: number;
            roteiros: number;
            caracteres_gerados: string;
            reusos: string;
            caracteres_poupados: string;
            duracao_ms: string;
          }[]
        >`
          with base as (
            ${uniaoDaBiblioteca(perfilId, filtros)}
          ),
          recortada as (
            select b.*
              from base b
             where true
               ${filtros.produtoId ? sql`and b.produto_id = ${filtros.produtoId}` : sql``}
               ${recorte(filtros.periodo)}
          ),
          usos as (
            select mi.audio_id,
                   count(distinct mi.montagem_id) as montagens,
                   count(distinct s.id)           as lives
              from montagem_itens mi
              left join live_sessoes s
                on s.montagem_id = mi.montagem_id and s.perfil_id = ${perfilId}
             where mi.perfil_id = ${perfilId}
             group by mi.audio_id
          )
          select
            count(*)::int                                   as itens,
            count(*) filter (where f.tipo = 'audio')::int   as audios,
            count(*) filter (where f.tipo = 'roteiro')::int as roteiros,
            coalesce(sum(f.caracteres) filter (where f.tipo = 'audio'), 0)
              as caracteres_gerados,
            coalesce(sum(coalesce(u.montagens, 0) + coalesce(u.lives, 0))
                     filter (where f.tipo = 'audio'), 0)
              as reusos,
            coalesce(sum(f.caracteres::bigint * (coalesce(u.montagens, 0) + coalesce(u.lives, 0)))
                     filter (where f.tipo = 'audio'), 0)
              as caracteres_poupados,
            coalesce(sum(f.duracao_ms) filter (where f.tipo = 'audio'), 0)
              as duracao_ms
          from recortada f
          left join usos u on u.audio_id = f.id
        `;

        const l = linhas[0];
        return {
          itens: numeroDe(l?.itens),
          audios: numeroDe(l?.audios),
          roteiros: numeroDe(l?.roteiros),
          caracteresGerados: numeroDe(l?.caracteres_gerados),
          reusos: numeroDe(l?.reusos),
          caracteresPoupados: numeroDe(l?.caracteres_poupados),
          duracaoMs: numeroDe(l?.duracao_ms),
        };
      }),
  );
}

/**
 * O que existe para filtrar — so o que o proprio usuario ja usou. A voz vem
 * pelos audios dele, e nao da tabela de vozes: o catalogo inteiro numa lista de
 * filtro nao ajuda ninguem a achar o que gravou.
 */
export async function opcoesDeFiltro(perfilId: string): Promise<OpcoesFiltro> {
  return comDemo(
    () => OPCOES_EXEMPLO,
    () =>
      comTraducao(async () => {
        const sql = bd();

        const [produtos, vozes] = await Promise.all([
          sql<OpcaoFiltro[]>`
            select p.id, p.nome
              from produtos p
             where p.perfil_id = ${perfilId}
               and (
                 exists (select 1 from audios a
                          where a.produto_id = p.id and a.perfil_id = ${perfilId})
                 or exists (select 1 from roteiros r
                             where r.produto_id = p.id and r.perfil_id = ${perfilId})
               )
             order by p.nome
             limit 100
          `,
          sql<OpcaoFiltro[]>`
            select v.id, v.nome
              from vozes v
             where exists (select 1 from audios a
                            where a.voz_id = v.id and a.perfil_id = ${perfilId})
             order by v.nome
             limit 100
          `,
        ]);

        return { produtos: [...produtos], vozes: [...vozes] };
      }),
  );
}

/**
 * O item aberto. `perfilId` no `where` de novo, e nao so na listagem: e daqui
 * que um id copiado de outra conta sairia com o texto inteiro.
 */
export async function detalheBiblioteca(
  perfilId: string,
  tipo: TipoItem,
  id: string,
): Promise<DetalheBiblioteca | null> {
  if (tipo !== "audio" && tipo !== "roteiro") return null;
  if (!UUID.test(id)) return null;

  return comDemo(
    () => detalheExemplo(tipo, id),
    () =>
      comTraducao(() =>
        tipo === "audio" ? detalheDoAudio(perfilId, id) : detalheDoRoteiro(perfilId, id),
      ),
  );
}

async function detalheDoAudio(
  perfilId: string,
  id: string,
): Promise<DetalheBiblioteca | null> {
  const linhas = await bd()<(LinhaBiblioteca & { texto: string; total: number })[]>`
    select
      a.id,
      'audio'::text as tipo,
      a.titulo,
      a.criado_em,
      to_char(a.criado_em at time zone 'UTC', ${FORMATO_INSTANTE}) as criado_em_iso,
      a.caracteres,
      left(a.texto, ${TAMANHO_TRECHO})  as trecho,
      left(a.texto, ${TAMANHO_DETALHE}) as texto,
      length(a.texto)                   as total,
      a.estado::text        as estado,
      a.duracao_ms,
      a.blocos_total::int   as blocos_total,
      a.blocos_prontos::int as blocos_prontos,
      a.produto_id,
      pr.nome               as produto,
      a.voz_id,
      v.nome                as voz,
      (select count(distinct mi.montagem_id)::int
         from montagem_itens mi
        where mi.audio_id = a.id and mi.perfil_id = ${perfilId}) as montagens,
      (select count(distinct s.id)::int
         from montagem_itens mi
         join live_sessoes s on s.montagem_id = mi.montagem_id and s.perfil_id = ${perfilId}
        where mi.audio_id = a.id and mi.perfil_id = ${perfilId}) as lives,
      0 as versoes,
      0 as audios
    from audios a
    left join produtos pr on pr.id = a.produto_id and pr.perfil_id = a.perfil_id
    left join vozes v on v.id = a.voz_id
    where a.id = ${id} and a.perfil_id = ${perfilId}
  `;

  const l = linhas[0];
  if (!l) return null;

  return {
    item: mapear(l),
    texto: l.texto,
    truncado: numeroDe(l.total) > TAMANHO_DETALHE,
    secoes: null,
    versao: null,
    geradoPorIa: false,
  };
}

async function detalheDoRoteiro(
  perfilId: string,
  id: string,
): Promise<DetalheBiblioteca | null> {
  const linhas = await bd()<
    (LinhaBiblioteca & {
      texto: string;
      total: number;
      secoes: BlocoRoteiro[] | null;
      numero: number | null;
      gerado_por_ia: boolean | null;
    })[]
  >`
    select
      r.id,
      'roteiro'::text as tipo,
      r.titulo,
      r.criado_em,
      to_char(r.criado_em at time zone 'UTC', ${FORMATO_INSTANTE}) as criado_em_iso,
      coalesce(rv.caracteres, 0)                       as caracteres,
      left(coalesce(rv.texto, ''), ${TAMANHO_TRECHO})  as trecho,
      left(coalesce(rv.texto, ''), ${TAMANHO_DETALHE}) as texto,
      length(coalesce(rv.texto, ''))                   as total,
      rv.secoes,
      rv.numero,
      rv.gerado_por_ia,
      null::text as estado,
      null::int  as duracao_ms,
      0::int     as blocos_total,
      0::int     as blocos_prontos,
      r.produto_id,
      pr.nome    as produto,
      null::uuid as voz_id,
      null::text as voz,
      0 as montagens,
      0 as lives,
      (select count(*)::int from roteiro_versoes rv2
        where rv2.roteiro_id = r.id and rv2.perfil_id = ${perfilId}) as versoes,
      (select count(*)::int from audios a
         join roteiro_versoes rv3 on rv3.id = a.roteiro_versao_id
        where rv3.roteiro_id = r.id and a.perfil_id = ${perfilId}) as audios
    from roteiros r
    left join lateral (
      select rv1.texto, rv1.caracteres, rv1.secoes, rv1.numero, rv1.gerado_por_ia
        from roteiro_versoes rv1
       where rv1.roteiro_id = r.id and rv1.perfil_id = r.perfil_id
       order by rv1.numero desc
       limit 1
    ) rv on true
    left join produtos pr on pr.id = r.produto_id and pr.perfil_id = r.perfil_id
    where r.id = ${id} and r.perfil_id = ${perfilId} and r.arquivado_em is null
  `;

  const l = linhas[0];
  if (!l) return null;

  return {
    item: mapear(l),
    texto: l.texto,
    truncado: numeroDe(l.total) > TAMANHO_DETALHE,
    secoes: Array.isArray(l.secoes) ? l.secoes : null,
    versao: l.numero,
    geradoPorIa: Boolean(l.gerado_por_ia),
  };
}

/* -------------------------------------------------------------------------
   Modo demo
   -------------------------------------------------------------------------
   A sessao demo nao tem linha no banco: qualquer `where perfil_id = $1` com o
   uuid falso devolveria vazio e a tela pareceria quebrada. Os exemplos abaixo
   passam pelos MESMOS filtros da consulta real, entao o filtro, a busca e o
   "carregar mais" continuam funcionando em modo demo — e o que a tela ensina
   sobre reaproveitamento aparece com numero, nao com placeholder.
   ------------------------------------------------------------------------- */

const HORA = 3_600_000;

const PRODUTOS_EXEMPLO = [
  { id: "00000000-0000-4000-9000-0000000000a1", nome: "Kit Skincare Glow" },
  { id: "00000000-0000-4000-9000-0000000000a2", nome: "Secador Íon Pro" },
];

const VOZES_EXEMPLO = [
  { id: "00000000-0000-4000-9000-0000000000b1", nome: "Amanda — apresentadora" },
  { id: "00000000-0000-4000-9000-0000000000b2", nome: "Beatriz — jovem" },
];

const OPCOES_EXEMPLO: OpcoesFiltro = {
  produtos: PRODUTOS_EXEMPLO,
  vozes: VOZES_EXEMPLO,
};

type Semente = {
  id: string;
  tipo: TipoItem;
  titulo: string;
  texto: string;
  horasAtras: number;
  produto: 0 | 1 | null;
  voz: 0 | 1 | null;
  estado?: EstadoAudio;
  duracaoMs?: number;
  blocosTotal?: number;
  blocosProntos?: number;
  montagens?: number;
  lives?: number;
  versoes?: number;
  audiosGerados?: number;
};

const SEMENTES: Semente[] = [
  {
    id: "00000000-0000-4000-9000-0000000000c1",
    tipo: "audio",
    titulo: "Abertura da live — Kit Skincare Glow",
    texto:
      "Gente, chegou o Kit Skincare Glow com quarenta por cento de desconto só " +
      "durante esta live. Quem entrou agora, corre, porque a caixinha laranja " +
      "some rápido. Eu vou mostrar o antes e o depois de quem usou por trinta dias.",
    horasAtras: 3,
    produto: 0,
    voz: 0,
    estado: "pronto",
    duracaoMs: 21 * 60_000,
    blocosTotal: 6,
    blocosProntos: 6,
    montagens: 3,
    lives: 9,
  },
  {
    id: "00000000-0000-4000-9000-0000000000c2",
    tipo: "roteiro",
    titulo: "Kit Skincare Glow — roteiro completo",
    texto:
      "Gancho: a pele que você vê no espelho às sete da manhã é a que conta. " +
      "Oferta: kit com sérum, hidratante e protetor por menos da metade. " +
      "Prova: trinta dias de uso, foto sem filtro. Objeções: serve para pele " +
      "oleosa. Chamada: cupom GLOW40 na sacolinha.",
    horasAtras: 5,
    produto: 0,
    voz: null,
    versoes: 4,
    audiosGerados: 2,
  },
  {
    id: "00000000-0000-4000-9000-0000000000c3",
    tipo: "audio",
    titulo: "Bloco de objeções — Secador Íon Pro",
    texto:
      "Se você está achando caro, faz a conta comigo: quanto custa uma escova " +
      "no salão? Este secador se paga em três usos, e a garantia é de um ano.",
    horasAtras: 27,
    produto: 1,
    voz: 1,
    estado: "gerando",
    duracaoMs: 4 * 60_000,
    blocosTotal: 11,
    blocosProntos: 4,
    montagens: 0,
    lives: 0,
  },
  {
    id: "00000000-0000-4000-9000-0000000000c4",
    tipo: "audio",
    titulo: "Chamada final — Secador Íon Pro",
    texto:
      "Última chamada: restam sete unidades no estoque da live. Quem clicar " +
      "agora na sacolinha ainda pega o frete grátis para todo o Brasil.",
    horasAtras: 50,
    produto: 1,
    voz: 1,
    estado: "pronto",
    duracaoMs: 9 * 60_000,
    blocosTotal: 3,
    blocosProntos: 3,
    montagens: 1,
    lives: 0,
  },
  {
    id: "00000000-0000-4000-9000-0000000000c5",
    tipo: "roteiro",
    titulo: "Secador Íon Pro — versão curta",
    texto:
      "Gancho: cabelo seco em oito minutos sem frizz. Oferta: secador com " +
      "tecnologia de íons e três temperaturas. Chamada: cupom SECA20.",
    horasAtras: 96,
    produto: 1,
    voz: null,
    versoes: 2,
    audiosGerados: 1,
  },
  {
    id: "00000000-0000-4000-9000-0000000000c6",
    tipo: "audio",
    titulo: "Saudação de entrada — genérica",
    texto:
      "Oi, seja muito bem-vinda! Fica comigo que daqui a pouco eu mostro o " +
      "combo que ninguém esperava e o cupom que só vale hoje.",
    horasAtras: 30 * 24,
    produto: null,
    voz: 0,
    estado: "pronto",
    duracaoMs: 2 * 60_000,
    blocosTotal: 1,
    blocosProntos: 1,
    montagens: 4,
    lives: 22,
  },
];

function itemExemplo(semente: Semente): ItemBiblioteca {
  const caracteres = [...semente.texto].length;
  const montagens = semente.montagens ?? 0;
  const lives = semente.lives ?? 0;
  const reusos = semente.tipo === "audio" ? montagens + lives : 0;
  const produto = semente.produto === null ? null : PRODUTOS_EXEMPLO[semente.produto]!;
  const voz = semente.voz === null ? null : VOZES_EXEMPLO[semente.voz]!;

  return {
    id: semente.id,
    tipo: semente.tipo,
    titulo: semente.titulo,
    trecho: semente.texto.replace(/\s+/g, " ").trim().slice(0, TAMANHO_TRECHO),
    caracteres,
    criadoEm: new Date(Date.now() - semente.horasAtras * HORA).toISOString(),
    produtoId: produto?.id ?? null,
    produto: produto?.nome ?? null,
    vozId: voz?.id ?? null,
    voz: voz?.nome ?? null,
    estado: semente.estado ?? null,
    duracaoMs: semente.duracaoMs ?? null,
    blocosTotal: semente.blocosTotal ?? 0,
    blocosProntos: semente.blocosProntos ?? 0,
    montagens,
    lives,
    reusos,
    caracteresPoupados: caracteres * reusos,
    versoes: semente.versoes ?? 0,
    audiosGerados: semente.audiosGerados ?? 0,
    href: enderecoDe(semente.tipo, semente.id),
  };
}

/** O mesmo recorte da consulta real, em memoria. */
function filtrarExemplo(filtros: FiltrosBiblioteca): ItemBiblioteca[] {
  const agora = Date.now();
  const busca = filtros.busca.toLowerCase();

  const limites: Record<Periodo, { de: number; ate: number }> = {
    hoje: { de: agora - 24 * HORA, ate: agora },
    ontem: { de: agora - 48 * HORA, ate: agora - 24 * HORA },
    "7d": { de: agora - 7 * 24 * HORA, ate: agora },
    "30d": { de: agora - 30 * 24 * HORA, ate: agora },
    total: { de: 0, ate: Number.MAX_SAFE_INTEGER },
  };
  const janela = limites[filtros.periodo];

  return SEMENTES.map(itemExemplo)
    .filter((item) => filtros.tipo === "todos" || item.tipo === filtros.tipo)
    .filter((item) => !filtros.produtoId || item.produtoId === filtros.produtoId)
    .filter((item) => !filtros.vozId || item.vozId === filtros.vozId)
    .filter((item) => {
      const instante = Date.parse(item.criadoEm);
      return instante >= janela.de && instante <= janela.ate;
    })
    .filter(
      (item) =>
        !busca ||
        item.titulo.toLowerCase().includes(busca) ||
        item.trecho.toLowerCase().includes(busca),
    )
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

function paginaExemplo(
  filtros: FiltrosBiblioteca,
  cursor: string | null | undefined,
  limite: number,
): Pagina<ItemBiblioteca> {
  const todos = filtrarExemplo(filtros);
  const marca = lerCursor(cursor);
  const restantes = marca
    ? todos.filter((item) => item.criadoEm < marca.instante)
    : todos;

  return montarPagina(restantes.slice(0, limite + 1), limite);
}

function resumoExemplo(filtros: FiltrosBiblioteca): ResumoBiblioteca {
  const itens = filtrarExemplo(filtros);
  const audios = itens.filter((item) => item.tipo === "audio");

  return {
    itens: itens.length,
    audios: audios.length,
    roteiros: itens.length - audios.length,
    caracteresGerados: audios.reduce((soma, item) => soma + item.caracteres, 0),
    reusos: audios.reduce((soma, item) => soma + item.reusos, 0),
    caracteresPoupados: audios.reduce((soma, item) => soma + item.caracteresPoupados, 0),
    duracaoMs: audios.reduce((soma, item) => soma + (item.duracaoMs ?? 0), 0),
  };
}

const SECOES_EXEMPLO: BlocoRoteiro[] = [
  {
    secao: "gancho",
    texto:
      "A pele que você vê no espelho às sete da manhã é a que conta — e é ela " +
      "que muda em trinta dias.",
  },
  {
    secao: "oferta",
    texto: "Kit com sérum, hidratante e protetor por menos da metade do preço da farmácia.",
  },
  { secao: "prova", texto: "Trinta dias de uso, foto sem filtro, antes e depois lado a lado." },
  { secao: "objecoes", texto: "Serve para pele oleosa: o sérum é livre de óleo e não entope poro." },
  { secao: "cta", texto: "Cupom GLOW40 na sacolinha, válido só enquanto a live estiver no ar." },
];

function detalheExemplo(tipo: TipoItem, id: string): DetalheBiblioteca | null {
  const semente = SEMENTES.find((s) => s.id === id && s.tipo === tipo);
  if (!semente) return null;

  return {
    item: itemExemplo(semente),
    texto: semente.texto,
    truncado: false,
    secoes: tipo === "roteiro" ? SECOES_EXEMPLO : null,
    versao: tipo === "roteiro" ? (semente.versoes ?? 1) : null,
    geradoPorIa: tipo === "roteiro",
  };
}
