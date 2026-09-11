import "server-only";
import { bd } from "@/lib/db";
import { modoDemo } from "@/lib/env";
import { comDemo, numeroDe } from "./comum";
import { ErroDominio, comTraducao, exigirAchado } from "./erros";

/**
 * Montagem — o áudio contínuo da live.
 *
 * A peça central do produto e a menos óbvia: o áudio de 3h NÃO é um arquivo. É
 * uma lista ordenada de áudios já gerados que a extensão toca em laço (ver
 * db/migrations/0004_estudio.sql e src/lib/armazenamento.ts).
 *
 * Consequência que vale para o módulo inteiro: **montar não gasta crédito**.
 * Gerar cobra uma vez, em caracteres (src/lib/caracteres.ts); repetir a lista
 * as 24 horas seguintes não escreve nada em `creditos_lancamentos`. É por isso
 * que aqui dentro não existe chamada a debitarEEnfileirar() — se um dia
 * aparecer uma, o desenho econômico do produto mudou junto.
 *
 * Escopo por dono em toda consulta: sem RLS, `perfil_id` no where é a única
 * barreira entre a montagem de um usuário e a de outro.
 */

/** Itens numa montagem. 20 áudios de até 3h já passam de qualquer live real. */
export const TETO_ITENS = 20;
/** Áudios oferecidos no seletor. Cada um viaja com os blocos, para a prévia. */
export const TETO_CATALOGO = 24;
/** Montagens por perfil. */
export const TETO_MONTAGENS = 12;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Id vindo da URL ou de formulário só entra em consulta depois disto: texto que
 * não é uuid estoura 22P02 no Postgres e derruba a tela inteira, em vez de
 * simplesmente não achar nada.
 */
export function ehId(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

/**
 * Array vazio em `= any($1::uuid[])` deixa o driver sem tipo para inferir. O
 * uuid nulo nunca corresponde a linha nenhuma e resolve sem caso especial.
 */
const SEM_ID = "00000000-0000-0000-0000-000000000000";

function comSentinela(ids: string[]) {
  const limpos = ids.filter(ehId);
  return limpos.length > 0 ? limpos : [SEM_ID];
}

/** Corta por code point: `slice` cru parte emoji no meio e grava lixo. */
function limitarTexto(valor: string, teto: number) {
  const limpo = valor.trim();
  const pontos = [...limpo];
  return pontos.length > teto ? pontos.slice(0, teto).join("") : limpo;
}

function entre(valor: number, minimo: number, maximo: number, padrao: number) {
  if (!Number.isFinite(valor)) return padrao;
  return Math.min(Math.max(Math.trunc(valor), minimo), maximo);
}

/** Escrita no modo demo não existe: a sessão demo não tem linha no banco. */
function exigirPersistencia() {
  if (modoDemo) {
    throw new ErroDominio(
      "servico_indisponivel",
      "Modo demonstração: a montagem existe só nesta tela e não é salva.",
    );
  }
}

// -----------------------------------------------------------------------------
// Tipos
// -----------------------------------------------------------------------------

/** Um bloco tocável. `url` aponta para a rota que serve o binário com dono checado. */
export type BlocoDoAudio = {
  id: string;
  url: string;
  duracaoMs: number | null;
};

export type AudioPronto = {
  id: string;
  titulo: string;
  vozNome: string;
  duracaoMs: number;
  /** Caracteres que a geração custou. É a moeda do produto. */
  caracteres: number;
  blocos: BlocoDoAudio[];
  /** Blocos sintetizados sem chave de voz: tom de exemplo, não fala. */
  exemplo: boolean;
  criadoEm: string;
};

export type Trilha = {
  id: string;
  nome: string;
  descricao: string | null;
};

export type Montagem = {
  id: string;
  nome: string;
  trilhaId: string | null;
  volumeTrilha: number;
  intervaloMs: number;
  embaralhar: boolean;
  ativa: boolean;
  /** Soma dos áudios, sem os intervalos. O laço é calculado na tela. */
  duracaoMs: number;
  atualizadoEm: string;
  /** Ids dos áudios na ordem em que a extensão toca. */
  audios: string[];
};

export type MontagemResumo = Omit<Montagem, "audios"> & { itens: number };

export type AjustesMontagem = {
  nome: string;
  trilhaId: string | null;
  volumeTrilha: number;
  intervaloMs: number;
  embaralhar: boolean;
  audios: string[];
};

type LinhaMontagem = {
  id: string;
  nome: string;
  trilha_id: string | null;
  volume_trilha: number;
  intervalo_ms: number;
  embaralhar: boolean;
  duracao_ms: number;
  ativa: boolean;
  atualizado_em: Date;
};

function montagemDe(linha: LinhaMontagem, audios: string[]): Montagem {
  return {
    id: linha.id,
    nome: linha.nome,
    trilhaId: linha.trilha_id,
    volumeTrilha: numeroDe(linha.volume_trilha, 15),
    intervaloMs: numeroDe(linha.intervalo_ms, 800),
    embaralhar: linha.embaralhar,
    ativa: linha.ativa,
    duracaoMs: numeroDe(linha.duracao_ms),
    atualizadoEm: linha.atualizado_em.toISOString(),
    audios,
  };
}

// -----------------------------------------------------------------------------
// Exemplos do modo demo
//
// A sessão demo não tem linha no banco: qualquer `where perfil_id = $1` com o
// id falso estoura 22P02. Estes exemplos existem para a tela poder ser vista e
// navegada inteira.
//
// Os blocos apontam para a rota de arquivo de verdade, que em modo demo devolve
// um bipe curto para qualquer id (src/app/api/arquivos/[id]/route.ts). Assim o
// encadeamento e o laço — que é o que esta tela existe para mostrar — funcionam
// de verdade, e a interface diz em letra visível que o som é exemplo.
// `duracaoMs` fica nulo de propósito: quem mede é o player, com o que tocou.
// -----------------------------------------------------------------------------

function blocosDeExemplo(sufixo: string): BlocoDoAudio[] {
  return [1, 2, 3].map((ordem) => {
    const id = `40000000-0000-4000-8000-0000000${sufixo}${ordem}0`;
    return { id, url: `/api/arquivos/${id}`, duracaoMs: null };
  });
}

const DEMO_AUDIOS: AudioPronto[] = [
  {
    id: "10000000-0000-4000-8000-0000000000a1",
    titulo: "Abertura — gancho e oferta",
    vozNome: "Amanda",
    duracaoMs: 11 * 60_000 + 20_000,
    caracteres: 6_800,
    blocos: blocosDeExemplo("0a1"),
    exemplo: true,
    criadoEm: "2026-09-08T13:40:00.000Z",
  },
  {
    id: "10000000-0000-4000-8000-0000000000a2",
    titulo: "Prova social e depoimentos",
    vozNome: "Amanda",
    duracaoMs: 23 * 60_000 + 5_000,
    caracteres: 13_850,
    blocos: blocosDeExemplo("0a2"),
    exemplo: true,
    criadoEm: "2026-09-08T15:10:00.000Z",
  },
  {
    id: "10000000-0000-4000-8000-0000000000a3",
    titulo: "Quebra de objeções",
    vozNome: "Amanda",
    duracaoMs: 31 * 60_000 + 40_000,
    caracteres: 19_000,
    blocos: blocosDeExemplo("0a3"),
    exemplo: true,
    criadoEm: "2026-09-09T09:25:00.000Z",
  },
  {
    id: "10000000-0000-4000-8000-0000000000a4",
    titulo: "Fechamento com cupom",
    vozNome: "Rafael",
    duracaoMs: 8 * 60_000 + 30_000,
    caracteres: 5_100,
    blocos: blocosDeExemplo("0a4"),
    exemplo: true,
    criadoEm: "2026-09-09T18:02:00.000Z",
  },
];

const DEMO_TRILHAS: Trilha[] = [
  {
    id: "30000000-0000-4000-8000-0000000000c1",
    nome: "Loja movimentada",
    descricao: "Conversa distante e passos — disfarça o silêncio entre as falas.",
  },
  {
    id: "30000000-0000-4000-8000-0000000000c2",
    nome: "Lo-fi suave",
    descricao: "Batida lenta e constante, sem melodia que dispute com a voz.",
  },
  {
    id: "30000000-0000-4000-8000-0000000000c3",
    nome: "Ambiente de estúdio",
    descricao: "Ruído de sala tratado, quase imperceptível.",
  },
];

const DEMO_MONTAGENS: Montagem[] = [
  {
    id: "20000000-0000-4000-8000-0000000000b1",
    nome: "Live do secador — 24h",
    trilhaId: DEMO_TRILHAS[1]!.id,
    volumeTrilha: 12,
    intervaloMs: 900,
    embaralhar: false,
    ativa: true,
    duracaoMs: DEMO_AUDIOS.slice(0, 3).reduce((soma, audio) => soma + audio.duracaoMs, 0),
    atualizadoEm: "2026-09-10T11:30:00.000Z",
    audios: DEMO_AUDIOS.slice(0, 3).map((audio) => audio.id),
  },
  {
    id: "20000000-0000-4000-8000-0000000000b2",
    nome: "Teste de fechamento",
    trilhaId: null,
    volumeTrilha: 15,
    intervaloMs: 800,
    embaralhar: true,
    ativa: false,
    duracaoMs: DEMO_AUDIOS[3]!.duracaoMs,
    atualizadoEm: "2026-09-09T20:15:00.000Z",
    audios: [DEMO_AUDIOS[3]!.id],
  },
];

function resumir(montagem: Montagem): MontagemResumo {
  const { audios, ...resto } = montagem;
  return { ...resto, itens: audios.length };
}

// -----------------------------------------------------------------------------
// Leitura
// -----------------------------------------------------------------------------

export async function listarMontagens(perfilId: string): Promise<MontagemResumo[]> {
  return comDemo(
    () => DEMO_MONTAGENS.map(resumir),
    async () => {
      const linhas = await bd()<(LinhaMontagem & { itens: number })[]>`
        select m.id, m.nome, m.trilha_id, m.volume_trilha, m.intervalo_ms, m.embaralhar,
               m.duracao_ms, m.ativa, m.atualizado_em,
               (select count(*)::int from montagem_itens i where i.montagem_id = m.id) as itens
          from montagens m
         where m.perfil_id = ${perfilId}
         order by m.ativa desc, m.atualizado_em desc
         limit ${TETO_MONTAGENS}
      `;

      return linhas.map((linha) => ({
        ...resumir(montagemDe(linha, [])),
        itens: numeroDe(linha.itens),
      }));
    },
  );
}

/** Uma montagem, sempre confrontada com o dono — id de URL não prova nada. */
export async function montagemDoPerfil(
  perfilId: string,
  montagemId: string,
): Promise<Montagem | null> {
  if (!ehId(montagemId)) return null;

  return comDemo(
    () => DEMO_MONTAGENS.find((montagem) => montagem.id === montagemId) ?? null,
    async () => {
      const sql = bd();

      const linhas = await sql<LinhaMontagem[]>`
        select id, nome, trilha_id, volume_trilha, intervalo_ms, embaralhar,
               duracao_ms, ativa, atualizado_em
          from montagens
         where id = ${montagemId} and perfil_id = ${perfilId}
      `;

      const linha = linhas[0];
      if (!linha) return null;

      const itens = await sql<{ audio_id: string }[]>`
        select audio_id
          from montagem_itens
         where montagem_id = ${montagemId} and perfil_id = ${perfilId}
         order by ordem
      `;

      return montagemDe(
        linha,
        itens.map((item) => item.audio_id),
      );
    },
  );
}

/**
 * Áudios que podem entrar numa montagem, já com os blocos tocáveis.
 *
 * `prioritarios` (os que a montagem aberta usa) sobem para o topo da ordenação
 * para nunca caírem fora do teto: áudio que está na lista e some do catálogo
 * viraria item fantasma, sem título e sem prévia.
 */
export async function audiosProntos(
  perfilId: string,
  prioritarios: string[] = [],
): Promise<AudioPronto[]> {
  return comDemo(
    () => DEMO_AUDIOS,
    async () => {
      const sql = bd();
      const marcados = comSentinela(prioritarios);

      const audios = await sql<
        {
          id: string;
          titulo: string;
          voz_nome: string;
          duracao_ms: number | null;
          caracteres: number;
          criado_em: Date;
        }[]
      >`
        select a.id, a.titulo, v.nome as voz_nome, a.duracao_ms, a.caracteres, a.criado_em
          from audios a
          join vozes v on v.id = a.voz_id
         where a.perfil_id = ${perfilId} and a.estado = 'pronto'
         order by (a.id = any(${marcados}::uuid[])) desc, a.criado_em desc
         limit ${TETO_CATALOGO}
      `;

      if (audios.length === 0) return [];

      // Um bloco só é tocável se o arquivo existe e está pronto — o player
      // recebe url que responde, não id que talvez responda.
      const blocos = await sql<
        {
          audio_id: string;
          id: string;
          arquivo_id: string;
          duracao_ms: number | null;
          exemplo: boolean;
        }[]
      >`
        select b.audio_id, b.id, b.arquivo_id, b.duracao_ms,
               coalesce((f.metadados->>'demo')::boolean, false) as exemplo
          from audio_blocos b
          join arquivos f on f.id = b.arquivo_id and f.estado = 'pronto'
         where b.perfil_id = ${perfilId}
           and b.estado = 'pronto'
           and b.audio_id = any(${audios.map((audio) => audio.id)}::uuid[])
         order by b.audio_id, b.ordem
      `;

      const porAudio = new Map<string, { blocos: BlocoDoAudio[]; exemplo: boolean }>();
      for (const bloco of blocos) {
        const atual = porAudio.get(bloco.audio_id) ?? { blocos: [], exemplo: false };
        atual.blocos.push({
          id: bloco.id,
          // Rota do estúdio (src/app/api/arquivos/[id]/route.ts): serve o
          // binário checando dono, que é o que substitui a RLS aqui.
          url: `/api/arquivos/${bloco.arquivo_id}`,
          duracaoMs: bloco.duracao_ms,
        });
        atual.exemplo = atual.exemplo || bloco.exemplo;
        porAudio.set(bloco.audio_id, atual);
      }

      return audios.map((audio) => {
        const dados = porAudio.get(audio.id);
        return {
          id: audio.id,
          titulo: audio.titulo,
          vozNome: audio.voz_nome,
          duracaoMs: numeroDe(audio.duracao_ms),
          caracteres: numeroDe(audio.caracteres),
          blocos: dados?.blocos ?? [],
          exemplo: dados?.exemplo ?? false,
          criadoEm: audio.criado_em.toISOString(),
        };
      });
    },
  );
}

/**
 * Catálogo de trilhas de ambiente.
 *
 * Única função sem `perfilId`: `trilhas_ambiente` não tem coluna de dono — é
 * catálogo global e somente leitura, então não há escopo a aplicar.
 */
export async function listarTrilhas(): Promise<Trilha[]> {
  return comDemo(
    () => DEMO_TRILHAS,
    async () => {
      const linhas = await bd()<{ id: string; nome: string; descricao: string | null }[]>`
        select id, nome, descricao
          from trilhas_ambiente
         where ativa
         order by ordem, nome
      `;
      return linhas.map((linha) => ({
        id: linha.id,
        nome: linha.nome,
        descricao: linha.descricao,
      }));
    },
  );
}

// -----------------------------------------------------------------------------
// Escrita
// -----------------------------------------------------------------------------

export async function criarMontagem(perfilId: string, nome: string): Promise<string> {
  exigirPersistencia();

  return comTraducao(async () => {
    const sql = bd();

    const existentes = await sql<{ n: number }[]>`
      select count(*)::int as n from montagens where perfil_id = ${perfilId}
    `;
    if (numeroDe(existentes[0]?.n) >= TETO_MONTAGENS) {
      throw new ErroDominio(
        "dado_invalido",
        `Você já tem ${TETO_MONTAGENS} montagens. Apague uma antes de criar outra.`,
      );
    }

    const linhas = await sql<{ id: string }[]>`
      insert into montagens (perfil_id, nome)
      values (${perfilId}, ${limitarTexto(nome, 80) || "Montagem da live"})
      returning id
    `;
    return linhas[0]!.id;
  });
}

/**
 * Salva ajustes e lista de uma vez.
 *
 * A lista é trocada inteira (apaga e reinsere) em vez de comparada item a item.
 * Motivo concreto: `unique (montagem_id, ordem)` não é deferrable, então
 * qualquer troca de posição no lugar precisaria de valor temporário e de uma
 * ordem de escrita que não colida — três statements a mais para chegar ao mesmo
 * resultado. Nada referencia `montagem_itens.id`, então recriar não custa nada.
 */
export async function salvarMontagem(
  perfilId: string,
  montagemId: string,
  ajustes: AjustesMontagem,
): Promise<{ itens: number; duracaoMs: number }> {
  exigirPersistencia();
  if (!ehId(montagemId)) throw new ErroDominio("nao_encontrado", "Montagem não encontrada.");

  const nome = limitarTexto(ajustes.nome, 80) || "Montagem da live";
  const trilhaId = ehId(ajustes.trilhaId) ? ajustes.trilhaId : null;
  const volume = entre(ajustes.volumeTrilha, 0, 100, 15);
  const intervalo = entre(ajustes.intervaloMs, 0, 10_000, 800);

  return comTraducao(() =>
    bd().begin(async (sql) => {
      const dono = await sql<{ id: string }[]>`
        select id from montagens
         where id = ${montagemId} and perfil_id = ${perfilId}
         for update
      `;
      exigirAchado(dono[0], "Montagem");

      // Id de áudio vindo do formulário não prova posse nem que a geração
      // terminou: quem decide o que entra é esta consulta.
      const pedidos = ajustes.audios.filter(ehId).slice(0, TETO_ITENS);
      const permitidos = new Set<string>();

      if (pedidos.length > 0) {
        const validos = await sql<{ id: string }[]>`
          select id from audios
           where perfil_id = ${perfilId}
             and estado = 'pronto'
             and id = any(${pedidos}::uuid[])
        `;
        for (const linha of validos) permitidos.add(linha.id);
      }

      const ordenados = pedidos.filter(
        (id, indice) => permitidos.has(id) && pedidos.indexOf(id) === indice,
      );

      await sql`
        update montagens
           set nome = ${nome},
               trilha_id = ${trilhaId},
               volume_trilha = ${volume},
               intervalo_ms = ${intervalo},
               embaralhar = ${ajustes.embaralhar}
         where id = ${montagemId} and perfil_id = ${perfilId}
      `;

      await sql`
        delete from montagem_itens
         where montagem_id = ${montagemId} and perfil_id = ${perfilId}
      `;

      if (ordenados.length > 0) {
        // `with ordinality` numera na ordem do array: a posição na lista vira a
        // coluna `ordem` sem laço na aplicação e sem ida extra ao banco.
        await sql`
          insert into montagem_itens (montagem_id, perfil_id, audio_id, ordem)
          select ${montagemId}::uuid, ${perfilId}::uuid, entrada.audio_id, entrada.posicao::smallint
            from unnest(${ordenados}::uuid[]) with ordinality as entrada(audio_id, posicao)
        `;
      }

      const total = await sql<{ duracao_ms: number }[]>`
        update montagens m
           set duracao_ms = coalesce((
                 select sum(coalesce(a.duracao_ms, 0))
                   from montagem_itens i
                   join audios a on a.id = i.audio_id
                  where i.montagem_id = m.id
               ), 0)
         where m.id = ${montagemId} and m.perfil_id = ${perfilId}
         returning m.duracao_ms
      `;

      return { itens: ordenados.length, duracaoMs: numeroDe(total[0]?.duracao_ms) };
    }),
  );
}

/**
 * Coloca uma montagem no ar.
 *
 * `montagens_ativa_idx` é um índice único parcial: no máximo uma linha com
 * `ativa` por perfil. Por isso a anterior sai no MESMO commit — duas escritas
 * separadas deixariam uma janela em que o índice barra a segunda. Se duas abas
 * ativarem ao mesmo tempo, o banco recusa uma e traduzirErro devolve
 * "conflito", que a tela mostra em vez de engolir.
 */
export async function ativarMontagem(perfilId: string, montagemId: string): Promise<void> {
  exigirPersistencia();
  if (!ehId(montagemId)) throw new ErroDominio("nao_encontrado", "Montagem não encontrada.");

  await comTraducao(() =>
    bd().begin(async (sql) => {
      const alvo = await sql<{ id: string }[]>`
        select id from montagens
         where id = ${montagemId} and perfil_id = ${perfilId}
         for update
      `;
      exigirAchado(alvo[0], "Montagem");

      const itens = await sql<{ n: number }[]>`
        select count(*)::int as n
          from montagem_itens
         where montagem_id = ${montagemId} and perfil_id = ${perfilId}
      `;

      if (numeroDe(itens[0]?.n) === 0) {
        throw new ErroDominio(
          "dado_invalido",
          "Montagem vazia não tem o que tocar. Adicione ao menos um áudio antes.",
        );
      }

      await sql`
        update montagens
           set ativa = false
         where perfil_id = ${perfilId} and ativa and id <> ${montagemId}
      `;

      await sql`
        update montagens set ativa = true where id = ${montagemId} and perfil_id = ${perfilId}
      `;
    }),
  );
}

export async function desativarMontagem(perfilId: string, montagemId: string): Promise<void> {
  exigirPersistencia();
  if (!ehId(montagemId)) throw new ErroDominio("nao_encontrado", "Montagem não encontrada.");

  await comTraducao(async () => {
    await bd()`
      update montagens set ativa = false where id = ${montagemId} and perfil_id = ${perfilId}
    `;
  });
}

export async function excluirMontagem(perfilId: string, montagemId: string): Promise<void> {
  exigirPersistencia();
  if (!ehId(montagemId)) throw new ErroDominio("nao_encontrado", "Montagem não encontrada.");

  await comTraducao(async () => {
    const linhas = await bd()<{ id: string }[]>`
      delete from montagens
       where id = ${montagemId} and perfil_id = ${perfilId}
       returning id
    `;
    exigirAchado(linhas[0], "Montagem");
  });
}
