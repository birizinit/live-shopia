import "server-only";
import { bd } from "@/lib/db";
import { comoJson } from "./comum";
import { comTraducao } from "./erros";
import type { EstadoJob, JobResumo, TipoJob } from "./tipos";

/**
 * A unica porta de enfileiramento para trabalho que NAO gasta credito.
 * O que gasta passa por debitarEEnfileirar (src/lib/dados/creditos.ts), que
 * cobra e enfileira no mesmo commit.
 */
export async function enfileirar(
  perfilId: string | null,
  tipo: TipoJob,
  opcoes: { referencia?: string; entrada?: Record<string, unknown>; atrasoSegundos?: number } = {},
): Promise<string> {
  return comTraducao(async () => {
    const sql = bd();
    const linhas = await sql<{ id: string }[]>`
      insert into jobs (perfil_id, tipo, chave_idempotencia, entrada, disponivel_em)
      values (
        ${perfilId},
        ${tipo},
        ${opcoes.referencia ?? null},
        ${comoJson(opcoes.entrada ?? {})},
        now() + make_interval(secs => ${opcoes.atrasoSegundos ?? 0})
      )
      on conflict (tipo, chave_idempotencia) where chave_idempotencia is not null
        do update set atualizado_em = now()
      returning id
    `;
    return linhas[0]!.id;
  });
}

/** Estado de um job — sempre no escopo do dono. */
export async function jobDoPerfil(perfilId: string, jobId: string): Promise<JobResumo | null> {
  const linhas = await bd()<
    { id: string; tipo: TipoJob; estado: EstadoJob; progresso: number; erro: string | null; criado_em: Date }[]
  >`
    select id, tipo, estado, progresso, erro, criado_em
      from jobs
     where id = ${jobId} and perfil_id = ${perfilId}
  `;

  const l = linhas[0];
  if (!l) return null;
  return {
    id: l.id,
    tipo: l.tipo,
    estado: l.estado,
    progresso: l.progresso,
    erro: l.erro,
    criadoEm: l.criado_em.toISOString(),
  };
}

export async function jobsAtivos(perfilId: string): Promise<JobResumo[]> {
  const linhas = await bd()<
    { id: string; tipo: TipoJob; estado: EstadoJob; progresso: number; erro: string | null; criado_em: Date }[]
  >`
    select id, tipo, estado, progresso, erro, criado_em
      from jobs
     where perfil_id = ${perfilId} and estado in ('pendente', 'processando')
     order by criado_em desc
     limit 20
  `;

  return linhas.map((l) => ({
    id: l.id,
    tipo: l.tipo,
    estado: l.estado,
    progresso: l.progresso,
    erro: l.erro,
    criadoEm: l.criado_em.toISOString(),
  }));
}
