import "server-only";
import { bd } from "@/lib/db";
import { CHARS_POR_BLOCO, contarCaracteres, fatiarEmBlocos } from "@/lib/caracteres";
import { comDemo, numeroDe } from "./comum";
import { comTraducao, ErroDominio } from "./erros";
import type { EstadoAudio, EstadoJob } from "./tipos";

/**
 * Áudios da apresentadora: a geração que GASTA CRÉDITO.
 *
 * Duas coisas moldam este módulo inteiro:
 *
 * 1. O áudio contínuo NÃO existe como arquivo. Um áudio é a soma ordenada dos
 *    seus blocos (db/migrations/0004_estudio.sql), cada um dentro do teto de
 *    uma chamada de TTS. Por isso toda leitura devolve `blocos`, e o player
 *    toca a lista.
 * 2. Quem cobra é `debitarEEnfileirar` (src/lib/dados/creditos.ts), nunca este
 *    arquivo. Aqui só se cria a linha do áudio e as linhas dos blocos ANTES do
 *    débito, para que o job de tts já encontre o trabalho fatiado.
 *
 * Sem RLS: `perfilId` é o primeiro argumento de tudo e entra em todo `where`.
 */

/** ~3h de fala a 600 caracteres por minuto — o teto que o produto promete. */
export const TETO_CARACTERES_AUDIO = 108_000;

/** Abaixo disto não é um roteiro, é um teste. */
export const MINIMO_CARACTERES_AUDIO = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Id vindo da URL não é uuid até provar que é.
 *
 * Sem esta checagem, `?audio=abc` chega ao Postgres como `where id = 'abc'` e
 * estoura 22P02 — a tela quebra com erro de banco onde deveria dizer
 * "não encontrado".
 */
export function ehIdValido(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

export type VozOpcao = {
  id: string;
  nome: string;
  descricao: string | null;
  origem: "catalogo" | "clonada";
  genero: "feminina" | "masculina" | "neutra";
  idioma: string;
  premium: boolean;
};

export type RoteiroParaFala = {
  id: string;
  titulo: string;
  texto: string;
  caracteres: number;
};

export type BlocoTocavel = {
  /** Id do ARQUIVO, não do bloco: é o que muda quando o bloco é ressintetizado. */
  id: string;
  ordem: number;
  url: string;
  duracaoMs: number | null;
};

export type JobDoAudio = {
  estado: EstadoJob;
  progresso: number;
  erro: string | null;
} | null;

/** O que o acompanhamento ao vivo precisa saber — e nada além disso. */
export type AudioAoVivo = {
  id: string;
  estado: EstadoAudio;
  blocosTotal: number;
  blocosProntos: number;
  duracaoMs: number;
  erro: string | null;
  job: JobDoAudio;
  blocos: BlocoTocavel[];
};

export type AudioResumo = {
  id: string;
  titulo: string;
  estado: EstadoAudio;
  caracteres: number;
  blocosTotal: number;
  blocosProntos: number;
  duracaoMs: number;
  vozNome: string;
  criadoEm: string;
};

export type AudioDetalhe = AudioResumo & {
  texto: string;
  vozId: string;
  creditosGastos: number;
  aoVivo: AudioAoVivo;
};

// -----------------------------------------------------------------------------
// Exemplos do modo demo. A sessão demo não tem linha no banco, então consultar
// com o id falso estoura 22P02 — toda leitura passa por `comDemo`.
// -----------------------------------------------------------------------------

const ID_DEMO_AUDIO = "00000000-0000-4000-8000-0000000a0001";

const ARQUIVOS_DEMO = [
  "00000000-0000-4000-8000-0000000b0001",
  "00000000-0000-4000-8000-0000000b0002",
  "00000000-0000-4000-8000-0000000b0003",
];

const TEXTO_DEMO =
  "Gente, presta atenção porque isso aqui não vai durar a live inteira. " +
  "O kit que eu tô mostrando sai hoje pela metade do preço, com cupom na descrição. " +
  "Quem já comprou comigo sabe: chega em três dias e vem com garantia de trinta dias. " +
  "Corre que tem pouca peça, e quando acabar eu tiro da tela.";

function vozesExemplo(): VozOpcao[] {
  return [
    {
      id: "00000000-0000-4000-8000-0000000c0001",
      nome: "Helena",
      descricao: "Apresentadora calorosa, ritmo de live",
      origem: "catalogo",
      genero: "feminina",
      idioma: "pt-BR",
      premium: true,
    },
    {
      id: "00000000-0000-4000-8000-0000000c0002",
      nome: "Marina",
      descricao: "Voz jovem, leve sotaque paulista",
      origem: "catalogo",
      genero: "feminina",
      idioma: "pt-BR",
      premium: false,
    },
    {
      id: "00000000-0000-4000-8000-0000000c0003",
      nome: "Rafael",
      descricao: "Grave e firme, bom para a oferta",
      origem: "catalogo",
      genero: "masculina",
      idioma: "pt-BR",
      premium: false,
    },
  ];
}

function roteirosExemplo(): RoteiroParaFala[] {
  return [
    {
      id: "00000000-0000-4000-8000-0000000d0001",
      titulo: "Kit de panelas — oferta relâmpago",
      texto: TEXTO_DEMO,
      caracteres: contarCaracteres(TEXTO_DEMO),
    },
  ];
}

/**
 * O exemplo tem que bater com o da lista: se o cartão diz "Gerando" e a tela de
 * dentro diz "Pronto", a demonstração ensina errado como a tela funciona.
 */
function aoVivoExemplo(audioId: string): AudioAoVivo {
  const lista = audiosExemplo();
  const resumo = lista.find((item) => item.id === audioId) ?? lista[0]!;

  return {
    id: audioId,
    estado: resumo.estado,
    blocosTotal: resumo.blocosTotal,
    blocosProntos: resumo.blocosProntos,
    duracaoMs: resumo.duracaoMs,
    erro: null,
    job: {
      estado: resumo.estado === "pronto" ? "concluido" : "processando",
      progresso: Math.round((resumo.blocosProntos / Math.max(1, resumo.blocosTotal)) * 100),
      erro: null,
    },
    blocos: ARQUIVOS_DEMO.slice(0, resumo.blocosProntos).map((id, indice) => ({
      id,
      ordem: indice + 1,
      url: `/api/arquivos/${id}`,
      duracaoMs: 8_000,
    })),
  };
}

function audiosExemplo(): AudioResumo[] {
  return [
    {
      id: ID_DEMO_AUDIO,
      titulo: "Kit de panelas — oferta relâmpago",
      estado: "pronto",
      caracteres: contarCaracteres(TEXTO_DEMO),
      blocosTotal: 3,
      blocosProntos: 3,
      duracaoMs: 24_000,
      vozNome: "Helena",
      criadoEm: new Date().toISOString(),
    },
    {
      id: "00000000-0000-4000-8000-0000000a0002",
      titulo: "Escova alisadora — prova social",
      estado: "gerando",
      caracteres: 4_820,
      blocosTotal: 3,
      blocosProntos: 1,
      duracaoMs: 8_000,
      vozNome: "Marina",
      criadoEm: new Date(Date.now() - 3_600_000).toISOString(),
    },
  ];
}

function detalheExemplo(audioId: string): AudioDetalhe {
  const lista = audiosExemplo();
  const resumo = lista.find((item) => item.id === audioId) ?? lista[0]!;

  return {
    ...resumo,
    id: audioId,
    texto: TEXTO_DEMO,
    vozId: vozesExemplo()[0]!.id,
    creditosGastos: resumo.caracteres,
    aoVivo: aoVivoExemplo(audioId),
  };
}

// -----------------------------------------------------------------------------
// Leitura
// -----------------------------------------------------------------------------

/** Catálogo + vozes clonadas do dono. As dele primeiro: são as que ele procura. */
export async function vozesDisponiveis(perfilId: string): Promise<VozOpcao[]> {
  return comDemo(vozesExemplo, async () => {
    const linhas = await bd()<
      {
        id: string;
        nome: string;
        descricao: string | null;
        origem: VozOpcao["origem"];
        genero: VozOpcao["genero"];
        idioma: string;
        premium: boolean;
      }[]
    >`
      select id, nome, descricao, origem, genero, idioma, premium
        from vozes
       where ativa
         and estado = 'pronta'
         and (perfil_id is null or perfil_id = ${perfilId})
       order by (perfil_id is null), ordem, nome
       limit 200
    `;

    return linhas.map((l) => ({ ...l }));
  });
}

/**
 * Roteiros prontos para virar fala — só a versão atual de cada um.
 *
 * O estúdio é o passo seguinte ao /roteiro: obrigar a pessoa a copiar e colar
 * o próprio texto entre duas telas do mesmo produto seria trabalho nosso
 * empurrado para ela.
 */
export async function roteirosParaFala(
  perfilId: string,
  limite = 8,
): Promise<RoteiroParaFala[]> {
  return comDemo(roteirosExemplo, async () => {
    const linhas = await bd()<
      { id: string; titulo: string; texto: string; caracteres: number }[]
    >`
      select v.id, r.titulo, v.texto, v.caracteres
        from roteiros r
        join roteiro_versoes v
          on v.roteiro_id = r.id and v.numero = r.versao_atual
       where r.perfil_id = ${perfilId}
         and r.arquivado_em is null
       order by r.atualizado_em desc
       limit ${limite}
    `;

    return linhas.map((l) => ({
      id: l.id,
      titulo: l.titulo,
      texto: l.texto,
      caracteres: numeroDe(l.caracteres),
    }));
  });
}

export async function audiosRecentes(perfilId: string, limite = 8): Promise<AudioResumo[]> {
  return comDemo(audiosExemplo, async () => {
    const linhas = await bd()<
      {
        id: string;
        titulo: string;
        estado: EstadoAudio;
        caracteres: number;
        blocos_total: number;
        blocos_prontos: number;
        duracao_ms: number | null;
        voz_nome: string;
        criado_em: Date;
        job_estado: EstadoJob | null;
      }[]
    >`
      select a.id, a.titulo, a.estado, a.caracteres, a.blocos_total, a.blocos_prontos,
             a.duracao_ms, v.nome as voz_nome, a.criado_em, j.estado as job_estado
        from audios a
        join vozes v on v.id = a.voz_id
        left join jobs j on j.id = a.job_id and j.perfil_id = a.perfil_id
       where a.perfil_id = ${perfilId}
       order by a.criado_em desc
       limit ${limite}
    `;

    return linhas.map((l) => ({
      id: l.id,
      titulo: l.titulo,
      estado: estadoVisivel(l.estado, l.job_estado),
      caracteres: numeroDe(l.caracteres),
      blocosTotal: numeroDe(l.blocos_total),
      blocosProntos: numeroDe(l.blocos_prontos),
      duracaoMs: numeroDe(l.duracao_ms),
      vozNome: l.voz_nome,
      criadoEm: l.criado_em.toISOString(),
    }));
  });
}

/**
 * O estado que a interface mostra.
 *
 * O handler de tts marca o áudio como 'gerando' e nunca volta para marcar
 * 'falhou' — quando ele morre, quem registra isso é o job. Sem esta tradução a
 * lista mostraria "Gerando" para sempre num áudio que já morreu e já foi
 * estornado.
 */
function estadoVisivel(estado: EstadoAudio, jobEstado: EstadoJob | null): EstadoAudio {
  if (jobEstado === "falhou" || jobEstado === "cancelado") return "falhou";
  return estado;
}

async function blocosTocaveis(perfilId: string, audioId: string): Promise<BlocoTocavel[]> {
  const linhas = await bd()<
    { arquivo_id: string; ordem: number; duracao_ms: number | null }[]
  >`
    select arquivo_id, ordem, duracao_ms
      from audio_blocos
     where audio_id = ${audioId}
       and perfil_id = ${perfilId}
       and estado = 'pronto'
       and arquivo_id is not null
     order by ordem
  `;

  return linhas.map((l) => ({
    id: l.arquivo_id,
    ordem: numeroDe(l.ordem),
    url: `/api/arquivos/${l.arquivo_id}`,
    duracaoMs: l.duracao_ms === null ? null : numeroDe(l.duracao_ms),
  }));
}

type LinhaAoVivo = {
  id: string;
  estado: EstadoAudio;
  blocos_total: number;
  blocos_prontos: number;
  duracao_ms: number | null;
  erro: string | null;
  job_estado: EstadoJob | null;
  job_progresso: number | null;
  job_erro: string | null;
};

function montarAoVivo(l: LinhaAoVivo, blocos: BlocoTocavel[]): AudioAoVivo {
  return {
    id: l.id,
    estado: estadoVisivel(l.estado, l.job_estado),
    blocosTotal: numeroDe(l.blocos_total),
    blocosProntos: numeroDe(l.blocos_prontos),
    duracaoMs: numeroDe(l.duracao_ms),
    erro: l.erro,
    job: l.job_estado
      ? { estado: l.job_estado, progresso: numeroDe(l.job_progresso), erro: l.job_erro }
      : null,
    blocos,
  };
}

/** Estado para o acompanhamento ao vivo. Consulta enxuta: roda a cada poucos segundos. */
export async function estadoAoVivo(
  perfilId: string,
  audioId: string,
): Promise<AudioAoVivo | null> {
  if (!ehIdValido(audioId)) return null;

  return comDemo(
    () => aoVivoExemplo(audioId),
    async () => {
      const linhas = await bd()<LinhaAoVivo[]>`
        select a.id, a.estado, a.blocos_total, a.blocos_prontos, a.duracao_ms, a.erro,
               j.estado as job_estado, j.progresso as job_progresso, j.erro as job_erro
          from audios a
          left join jobs j on j.id = a.job_id and j.perfil_id = a.perfil_id
         where a.id = ${audioId} and a.perfil_id = ${perfilId}
      `;

      const linha = linhas[0];
      if (!linha) return null;
      return montarAoVivo(linha, await blocosTocaveis(perfilId, audioId));
    },
  );
}

export async function audioDoPerfil(
  perfilId: string,
  audioId: string,
): Promise<AudioDetalhe | null> {
  if (!ehIdValido(audioId)) return null;

  return comDemo(
    () => detalheExemplo(audioId),
    async () => {
      const linhas = await bd()<
        (LinhaAoVivo & {
          titulo: string;
          texto: string;
          caracteres: number;
          voz_id: string;
          voz_nome: string;
          criado_em: Date;
          creditos: string | null;
        })[]
      >`
        select a.id, a.estado, a.blocos_total, a.blocos_prontos, a.duracao_ms, a.erro,
               a.titulo, a.texto, a.caracteres, a.voz_id, a.criado_em,
               v.nome as voz_nome,
               j.estado as job_estado, j.progresso as job_progresso, j.erro as job_erro,
               -l.delta as creditos
          from audios a
          join vozes v on v.id = a.voz_id
          left join jobs j on j.id = a.job_id and j.perfil_id = a.perfil_id
          left join creditos_lancamentos l
            on l.id = a.lancamento_id and l.perfil_id = a.perfil_id
         where a.id = ${audioId} and a.perfil_id = ${perfilId}
      `;

      const l = linhas[0];
      if (!l) return null;

      return {
        id: l.id,
        titulo: l.titulo,
        estado: estadoVisivel(l.estado, l.job_estado),
        caracteres: numeroDe(l.caracteres),
        blocosTotal: numeroDe(l.blocos_total),
        blocosProntos: numeroDe(l.blocos_prontos),
        duracaoMs: numeroDe(l.duracao_ms),
        vozNome: l.voz_nome,
        criadoEm: l.criado_em.toISOString(),
        texto: l.texto,
        vozId: l.voz_id,
        creditosGastos: numeroDe(l.creditos),
        aoVivo: montarAoVivo(l, await blocosTocaveis(perfilId, audioId)),
      };
    },
  );
}

/**
 * Mesmo texto, mesma voz, já pronto: reaproveita em vez de cobrar de novo.
 *
 * A comparação é do texto inteiro de propósito — hash curto colidiria e
 * entregaria o áudio errado, e entregar o áudio errado é pior do que cobrar.
 */
export async function audioProntoIgual(
  perfilId: string,
  vozId: string,
  texto: string,
): Promise<{ id: string; titulo: string } | null> {
  if (!ehIdValido(vozId)) return null;

  const linhas = await bd()<{ id: string; titulo: string }[]>`
    select id, titulo
      from audios
     where perfil_id = ${perfilId}
       and voz_id = ${vozId}
       and estado = 'pronto'
       and texto = ${texto}
     order by criado_em desc
     limit 1
  `;

  return linhas[0] ?? null;
}

/**
 * O áudio que a chave de idempotência já gerou.
 *
 * É o que faz o duplo clique (e o retry de rede da action) cair no MESMO
 * áudio em vez de criar um segundo: a chave vive no formulário desde o render.
 */
export async function audioDaChave(
  perfilId: string,
  chave: string,
): Promise<{ jobId: string; audioId: string | null } | null> {
  const linhas = await bd()<{ id: string; audio_id: string | null }[]>`
    select j.id, j.entrada->>'audio_id' as audio_id
      from jobs j
     where j.tipo = 'tts'
       and j.chave_idempotencia = ${chave}
       and j.perfil_id = ${perfilId}
  `;

  const l = linhas[0];
  if (!l) return null;
  return { jobId: l.id, audioId: l.audio_id };
}

// -----------------------------------------------------------------------------
// Escrita
// -----------------------------------------------------------------------------

export type NovoAudio = {
  vozId: string;
  titulo: string;
  texto: string;
  roteiroVersaoId?: string | null;
};

/**
 * Cria o áudio e os blocos ANTES de qualquer débito.
 *
 * Os dois inserts vão na mesma transação: um áudio sem blocos deixaria o job
 * de tts sem nada para fazer, e ele concluiria "com sucesso" um áudio mudo.
 */
export async function criarAudio(
  perfilId: string,
  dados: NovoAudio,
): Promise<{ id: string; blocos: number }> {
  const pedacos = fatiarEmBlocos(dados.texto, CHARS_POR_BLOCO);
  if (pedacos.length === 0) {
    throw new ErroDominio("dado_invalido", "Não há texto para transformar em fala.");
  }

  return comTraducao(async () => {
    const id = await bd().begin(async (sql) => {
      // O vínculo com a versão do roteiro vem por SELECT filtrado pelo dono,
      // não pelo id cru do formulário. A FK de roteiro_versao_id é simples:
      // sem RLS, ela confere existência, nunca posse — e um id trocado no
      // devtools gravaria na linha do atacante um ponteiro para o roteiro de
      // outra pessoa. Sem versão informada, o insert segue sem o vínculo.
      const linhas = dados.roteiroVersaoId
        ? await sql<{ id: string }[]>`
            insert into audios (perfil_id, voz_id, roteiro_versao_id, titulo, texto, estado)
            select ${perfilId}, ${dados.vozId}, v.id, ${dados.titulo}, ${dados.texto}, 'rascunho'
              from roteiro_versoes v
             where v.id = ${dados.roteiroVersaoId} and v.perfil_id = ${perfilId}
            returning id
          `
        : await sql<{ id: string }[]>`
            insert into audios (perfil_id, voz_id, roteiro_versao_id, titulo, texto, estado)
            values (${perfilId}, ${dados.vozId}, null, ${dados.titulo}, ${dados.texto}, 'rascunho')
            returning id
          `;

      if (!linhas[0]) {
        throw new ErroDominio("nao_encontrado", "Roteiro não encontrado ou não é seu.");
      }

      const audioId = linhas[0]!.id;
      const blocos = pedacos.map((texto, indice) => ({
        audio_id: audioId,
        perfil_id: perfilId,
        ordem: indice + 1,
        texto,
      }));

      await sql`
        insert into audio_blocos ${sql(blocos, "audio_id", "perfil_id", "ordem", "texto")}
      `;

      return audioId;
    });

    return { id, blocos: pedacos.length };
  });
}

/** Liga o áudio ao job e ao lançamento que o pagou. */
export async function marcarNaFila(
  perfilId: string,
  audioId: string,
  debito: { jobId: string; lancamentoId: string },
) {
  await comTraducao(
    async () =>
      void (await bd()`
        update audios
           set estado = 'na_fila', job_id = ${debito.jobId},
               lancamento_id = ${debito.lancamentoId}, erro = null
         where id = ${audioId} and perfil_id = ${perfilId}
      `),
  );
}

/**
 * Apaga um rascunho que nunca chegou a ser cobrado.
 *
 * As condições `estado = 'rascunho'` e `job_id is null` não são zelo: sem elas
 * um erro de caminho apagaria um áudio pago. Os blocos somem em cascata.
 */
export async function removerRascunho(perfilId: string, audioId: string) {
  await bd()`
    delete from audios
     where id = ${audioId}
       and perfil_id = ${perfilId}
       and estado = 'rascunho'
       and job_id is null
  `;
}

/** Título automático quando a pessoa não deu um — o começo do próprio texto. */
export function tituloSugerido(texto: string): string {
  const limpo = texto.trim().replace(/\s+/g, " ");
  if (!limpo) return "Áudio sem título";

  const letras = [...limpo];
  if (letras.length <= 60) return limpo;
  return `${letras.slice(0, 60).join("").trimEnd()}…`;
}
