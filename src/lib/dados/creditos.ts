import "server-only";
import { randomUUID } from "node:crypto";
import { bd } from "@/lib/db";
import { CHARS_POR_BLOCO, contarCaracteres, duracaoEstimadaMs } from "@/lib/caracteres";
import { comTraducao } from "./erros";
import { comoJson, numeroDe } from "./comum";
import type { Estimativa, TipoJob } from "./tipos";

/**
 * A unica porta de gasto de credito.
 *
 * Nenhuma tela debita por conta propria. O debito e o enfileiramento do
 * trabalho acontecem no MESMO commit (funcao debitar_e_enfileirar no banco):
 * ou o usuario foi cobrado e o job existe, ou nada aconteceu.
 */

/**
 * Chave de idempotencia.
 *
 * Precisa ser gerada no RENDER do formulario e viajar num campo oculto — nunca
 * dentro da action. Chave criada na action muda a cada clique, entao duplo
 * clique gera duas chaves, dois debitos e duas chamadas pagas para o mesmo
 * texto. Este era o defeito mais caro do desenho original.
 */
export function chaveIdempotente(prefixo: string) {
  return `${prefixo}:${randomUUID()}`;
}

export async function saldoDe(perfilId: string): Promise<number> {
  const linhas = await bd()<{ creditos: string }[]>`
    select creditos from perfis where id = ${perfilId}
  `;
  return numeroDe(linhas[0]?.creditos);
}

/** O que o usuario ve antes de confirmar. */
export async function estimar(perfilId: string, texto: string): Promise<Estimativa> {
  const caracteres = contarCaracteres(texto);
  const disponiveis = await saldoDe(perfilId);

  return {
    caracteres,
    blocos: Math.max(1, Math.ceil(caracteres / CHARS_POR_BLOCO)),
    duracaoMs: duracaoEstimadaMs(caracteres),
    creditosDisponiveis: disponiveis,
    suficiente: disponiveis >= caracteres,
    faltam: Math.max(0, caracteres - disponiveis),
  };
}

export type Debito = {
  jobId: string;
  lancamentoId: string;
  /** true quando a chave ja tinha sido usada — nao cobrou de novo. */
  jaExistia: boolean;
};

export async function debitarEEnfileirar(
  perfilId: string,
  opcoes: {
    caracteres: number;
    referencia: string;
    tipo: TipoJob;
    entrada?: Record<string, unknown>;
  },
): Promise<Debito> {
  return comTraducao(async () => {
    const linhas = await bd()<
      { job_id: string; lancamento_id: string; ja_existia: boolean }[]
    >`
      select * from debitar_e_enfileirar(
        ${perfilId},
        ${opcoes.caracteres},
        ${opcoes.referencia},
        ${opcoes.tipo},
        ${comoJson(opcoes.entrada ?? {})}
      )
    `;

    const linha = linhas[0]!;
    return {
      jobId: linha.job_id,
      lancamentoId: linha.lancamento_id,
      jaExistia: linha.ja_existia,
    };
  });
}

/** Job que morreu de vez devolve o que cobrou. Idempotente. */
export async function estornar(lancamentoId: string, motivo: string) {
  await bd()`select estornar_creditos(${lancamentoId}, ${motivo})`;
}

export type LancamentoExtrato = {
  id: string;
  delta: number;
  motivo: string;
  criadoEm: string;
  detalhe: string | null;
};

export async function extrato(perfilId: string, limite = 50): Promise<LancamentoExtrato[]> {
  const linhas = await bd()<
    { id: string; delta: string; motivo: string; criado_em: Date; metadados: Record<string, unknown> }[]
  >`
    select id, delta, motivo, criado_em, metadados
      from creditos_lancamentos
     where perfil_id = ${perfilId}
     order by criado_em desc
     limit ${limite}
  `;

  return linhas.map((l) => ({
    id: l.id,
    delta: numeroDe(l.delta),
    motivo: l.motivo,
    criadoEm: l.criado_em.toISOString(),
    detalhe: typeof l.metadados?.motivo === "string" ? l.metadados.motivo : null,
  }));
}
