import "server-only";
import { bd } from "@/lib/db";
import { comDemo, numeroDe } from "./comum";
import { comTraducao, ErroDominio } from "./erros";

/**
 * Aulas em video — catalogo, liberacao por plano e progresso de quem assiste.
 *
 * Tres decisoes moram aqui e nao na tela:
 *
 * 1. Quem decide se a aula esta liberada e a funcao `aula_liberada()` do banco
 *    (0009), nao um `if` em TypeScript. A escada de planos e `planos.ordem`, e
 *    repetir essa comparacao aqui garantiria que um dia as duas discordassem —
 *    com a tela liberando o que o banco nega, ou o contrario.
 * 2. Aula bloqueada continua na lista, mas sem o id do video. O embed e o unico
 *    conteudo pago de verdade desta tela: mandar o id para o navegador de quem
 *    nao tem o plano e entregar a aula junto com o cadeado.
 * 3. `perfilId` e o primeiro argumento de tudo e entra no `where`. O slug vem da
 *    URL e nunca identifica dono de nada — so o catalogo, que e comum a todos.
 */

/**
 * Fracao da duracao que conta como assistida.
 *
 * Quem CONCLUI a aula e `registrar_progresso_aula()` no banco; esta constante
 * so existe para a tela conseguir dizer de antemao onde fica a linha de
 * chegada. Se o corte mudar no banco, o numero daqui vira um rotulo errado —
 * nunca uma conclusao errada.
 */
export const FRACAO_CONCLUSAO = 0.9;

export type AulaResumo = {
  id: string;
  slug: string;
  titulo: string;
  descricao: string | null;
  /** Id de 11 caracteres do YouTube. `null` quando a aula esta bloqueada. */
  videoYoutube: string | null;
  duracaoS: number | null;
  liberada: boolean;
  /** Slug do plano minimo. `null` = aula aberta, inclusive para quem nao assinou. */
  exigePlano: string | null;
  /** Nome do plano minimo, para a tela dizer QUAL plano destrava. */
  exigePlanoNome: string | null;
  segundosVistos: number;
  concluida: boolean;
};

export type ModuloAulas = {
  id: string;
  slug: string;
  titulo: string;
  descricao: string | null;
  aulas: AulaResumo[];
};

export type VizinhaAula = { slug: string; titulo: string };

export type AulaDetalhe = AulaResumo & {
  moduloSlug: string;
  moduloTitulo: string;
  anterior: VizinhaAula | null;
  proxima: VizinhaAula | null;
};

type LinhaAula = {
  aula_id: string | null;
  aula_slug: string | null;
  aula_titulo: string | null;
  aula_descricao: string | null;
  video_youtube: string | null;
  duracao_s: number | null;
  exige_plano: string | null;
  plano_nome: string | null;
  liberada: boolean | null;
  segundos_vistos: number | null;
  concluida_em: Date | null;
};

type LinhaModulo = LinhaAula & {
  modulo_id: string;
  modulo_slug: string;
  modulo_titulo: string;
  modulo_descricao: string | null;
};

function montarAula(linha: LinhaAula): AulaResumo {
  const liberada = linha.liberada === true;

  return {
    id: linha.aula_id!,
    slug: linha.aula_slug!,
    titulo: linha.aula_titulo!,
    descricao: linha.aula_descricao,
    // O id do video so viaja para quem pode assistir (ver o cabecalho do modulo).
    videoYoutube: liberada ? linha.video_youtube : null,
    duracaoS: linha.duracao_s === null ? null : numeroDe(linha.duracao_s),
    liberada,
    exigePlano: linha.exige_plano,
    exigePlanoNome: linha.plano_nome,
    segundosVistos: numeroDe(linha.segundos_vistos),
    concluida: linha.concluida_em !== null,
  };
}

/**
 * Modulos ativos com as aulas ativas de cada um, ja com liberacao e progresso.
 *
 * Modo demo devolve lista vazia de proposito: a sessao demo nao tem linha no
 * banco, e inventar aula aqui significaria inventar id de YouTube. Id de 11
 * caracteres que nao existe passa no CHECK da migracao e vira embed preto — a
 * tela estaria prometendo um conteudo que nao toca. Vazia, ela diz a verdade.
 */
export async function listarModulos(perfilId: string): Promise<ModuloAulas[]> {
  return comDemo(
    () => [],
    async () => {
      const linhas = await bd()<LinhaModulo[]>`
        select m.id        as modulo_id,
               m.slug      as modulo_slug,
               m.titulo    as modulo_titulo,
               m.descricao as modulo_descricao,
               a.id        as aula_id,
               a.slug      as aula_slug,
               a.titulo    as aula_titulo,
               a.descricao as aula_descricao,
               a.video_youtube,
               a.duracao_s,
               a.exige_plano,
               pl.nome     as plano_nome,
               aula_liberada(a.id, ${perfilId})                as liberada,
               coalesce(g.segundos_vistos, 0)                  as segundos_vistos,
               g.concluida_em
          from aulas_modulos m
          left join aulas a
            on a.modulo_id = m.id and a.ativa
          left join planos pl
            on pl.slug = a.exige_plano
          left join aulas_progresso g
            on g.aula_id = a.id and g.perfil_id = ${perfilId}
         where m.ativo
         order by m.ordem, m.titulo, a.ordem, a.titulo
      `;

      const modulos: ModuloAulas[] = [];
      const porId = new Map<string, ModuloAulas>();

      for (const linha of linhas) {
        let modulo = porId.get(linha.modulo_id);

        if (!modulo) {
          modulo = {
            id: linha.modulo_id,
            slug: linha.modulo_slug,
            titulo: linha.modulo_titulo,
            descricao: linha.modulo_descricao,
            aulas: [],
          };
          porId.set(linha.modulo_id, modulo);
          modulos.push(modulo);
        }

        // Modulo ainda sem aula chega do left join com a metade da aula nula.
        if (linha.aula_id) modulo.aulas.push(montarAula(linha));
      }

      return modulos;
    },
  );
}

export type ResumoAulas = {
  total: number;
  concluidas: number;
  bloqueadas: number;
  /** Nome do primeiro plano que aparece bloqueando alguma aula. */
  planoQueDestrava: string | null;
};

/**
 * Contagens do cabecalho. Funcao pura sobre o que `listarModulos` ja trouxe:
 * repetir as mesmas somas em `count(*)` criaria uma segunda fonte da verdade
 * para o mesmo numero, e um dia as duas discordariam na mesma tela.
 */
export function resumir(modulos: ModuloAulas[]): ResumoAulas {
  const aulas = modulos.flatMap((modulo) => modulo.aulas);
  const primeiraBloqueada = aulas.find((aula) => !aula.liberada && aula.exigePlanoNome);

  return {
    total: aulas.length,
    concluidas: aulas.filter((aula) => aula.concluida).length,
    bloqueadas: aulas.filter((aula) => !aula.liberada).length,
    planoQueDestrava: primeiraBloqueada?.exigePlanoNome ?? null,
  };
}

/** Onde o video conclui sozinho, em segundos. `null` quando falta a duracao. */
export function segundosParaConcluir(duracaoS: number | null): number | null {
  if (!duracaoS || duracaoS <= 0) return null;
  return Math.ceil(duracaoS * FRACAO_CONCLUSAO);
}

/**
 * Uma aula pelo slug, com a vizinhanca para o "proxima aula".
 *
 * As vizinhas saem de uma janela sobre o catalogo INTEIRO, e nao so sobre o
 * modulo: quem termina a ultima aula de um modulo quer a primeira do proximo,
 * e nao um beco sem saida.
 */
export async function obterAula(
  perfilId: string,
  slug: string,
): Promise<AulaDetalhe | null> {
  return comDemo(
    () => null,
    async () => {
      const linhas = await bd()<
        (LinhaAula & {
          modulo_slug: string;
          modulo_titulo: string;
          anterior_slug: string | null;
          anterior_titulo: string | null;
          proxima_slug: string | null;
          proxima_titulo: string | null;
        })[]
      >`
        with catalogo as (
          select a.id, a.slug, a.titulo, a.descricao, a.video_youtube, a.duracao_s,
                 a.exige_plano,
                 m.slug   as modulo_slug,
                 m.titulo as modulo_titulo,
                 lag(a.slug)    over ordenado as anterior_slug,
                 lag(a.titulo)  over ordenado as anterior_titulo,
                 lead(a.slug)   over ordenado as proxima_slug,
                 lead(a.titulo) over ordenado as proxima_titulo
            from aulas a
            join aulas_modulos m on m.id = a.modulo_id and m.ativo
           where a.ativa
          window ordenado as (order by m.ordem, m.titulo, a.ordem, a.titulo)
        )
        select c.id        as aula_id,
               c.slug      as aula_slug,
               c.titulo    as aula_titulo,
               c.descricao as aula_descricao,
               c.video_youtube,
               c.duracao_s,
               c.exige_plano,
               c.modulo_slug,
               c.modulo_titulo,
               c.anterior_slug,
               c.anterior_titulo,
               c.proxima_slug,
               c.proxima_titulo,
               pl.nome as plano_nome,
               aula_liberada(c.id, ${perfilId})  as liberada,
               coalesce(g.segundos_vistos, 0)    as segundos_vistos,
               g.concluida_em
          from catalogo c
          left join planos pl
            on pl.slug = c.exige_plano
          left join aulas_progresso g
            on g.aula_id = c.id and g.perfil_id = ${perfilId}
         where c.slug = ${slug}
      `;

      const linha = linhas[0];
      if (!linha) return null;

      return {
        ...montarAula(linha),
        moduloSlug: linha.modulo_slug,
        moduloTitulo: linha.modulo_titulo,
        anterior:
          linha.anterior_slug && linha.anterior_titulo
            ? { slug: linha.anterior_slug, titulo: linha.anterior_titulo }
            : null,
        proxima:
          linha.proxima_slug && linha.proxima_titulo
            ? { slug: linha.proxima_slug, titulo: linha.proxima_titulo }
            : null,
      };
    },
  );
}

export type ProgressoAula = {
  segundosVistos: number;
  concluida: boolean;
  /** true so na chamada em que a aula passou do corte. E o gatilho do aviso. */
  concluidaAgora: boolean;
};

/**
 * Grava a posicao do player.
 *
 * A liberacao e conferida AQUI, antes de chamar a funcao do banco: o id da aula
 * chega do navegador, e `registrar_progresso_aula()` grava progresso de
 * qualquer aula que exista — ela nao sabe nada de plano. Sem esta conferencia,
 * quem nao assinou nao assistiria a aula paga, mas constaria como concluinte.
 *
 * Quem CONCLUI continua sendo o banco, que e quem tem a duracao do catalogo: o
 * navegador so informa onde o video parou.
 */
export async function registrarProgresso(
  perfilId: string,
  aulaId: string,
  segundos: number,
): Promise<ProgressoAula> {
  const posicao = Math.max(0, Math.floor(Number.isFinite(segundos) ? segundos : 0));

  return comDemo(
    // A sessao demo nao tem linha em `perfis`, entao nao ha onde gravar. A tela
    // continua respondendo; o que nao sobrevive ao recarregamento e o progresso.
    () => ({ segundosVistos: posicao, concluida: false, concluidaAgora: false }),
    async () =>
      comTraducao(async () => {
        const sql = bd();

        const [estado] = await sql<{ liberada: boolean; concluida_antes: Date | null }[]>`
          select aula_liberada(${aulaId}, ${perfilId}) as liberada,
                 (select g.concluida_em
                    from aulas_progresso g
                   where g.perfil_id = ${perfilId} and g.aula_id = ${aulaId}) as concluida_antes
        `;

        if (!estado?.liberada) {
          throw new ErroDominio(
            "sem_permissao",
            "Esta aula não está liberada para o seu plano.",
          );
        }

        const [linha] = await sql<{ segundos_vistos: number; concluida_em: Date | null }[]>`
          select segundos_vistos, concluida_em
            from registrar_progresso_aula(${perfilId}, ${aulaId}, ${posicao})
        `;

        const concluida = linha?.concluida_em != null;

        return {
          segundosVistos: numeroDe(linha?.segundos_vistos, posicao),
          concluida,
          // `concluida_antes` nulo + concluida agora = foi ESTA chamada que
          // fechou a aula. E o unico momento em que vale avisar e invalidar a
          // lista; nas outras a resposta so confirma o que ja estava gravado.
          concluidaAgora: concluida && estado.concluida_antes === null,
        };
      }),
  );
}
