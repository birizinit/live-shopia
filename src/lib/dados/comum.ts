import "server-only";
import { bd } from "@/lib/db";
import { modoDemo } from "@/lib/env";
import type { Consulta, Pagina } from "./tipos";

/** Teto de pagina. Protege o servidor de `limite=100000` vindo da URL. */
export const LIMITE_PADRAO = 24;
export const LIMITE_MAXIMO = 100;

export function limitar(valor: number | undefined, padrao = LIMITE_PADRAO) {
  if (!valor || !Number.isFinite(valor)) return padrao;
  return Math.min(Math.max(Math.trunc(valor), 1), LIMITE_MAXIMO);
}

/**
 * Paginacao por cursor, nao por offset.
 *
 * Offset relista o que ja passou quando um item novo entra no topo — e no
 * dashboard e na biblioteca item novo entra o tempo todo. O cursor e o par
 * (timestamp, id) do ultimo item, que e estavel.
 */
export function lerCursor(cursor: string | null | undefined) {
  if (!cursor) return null;
  try {
    const [instante, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!instante || !id) return null;
    return { instante, id };
  } catch {
    return null;
  }
}

export function escreverCursor(instante: Date | string, id: string) {
  const iso = instante instanceof Date ? instante.toISOString() : instante;
  return Buffer.from(`${iso}|${id}`).toString("base64url");
}

/** Monta a pagina pedindo um item a mais para saber se existe proxima. */
export function montarPagina<T extends { id: string; criadoEm: string }>(
  linhas: T[],
  limite: number,
): Pagina<T> {
  const temMais = linhas.length > limite;
  const itens = temMais ? linhas.slice(0, limite) : linhas;
  const ultimo = itens.at(-1);
  return {
    itens,
    proximo: temMais && ultimo ? escreverCursor(ultimo.criadoEm, ultimo.id) : null,
  };
}

export function normalizarConsulta(consulta: Consulta = {}) {
  return {
    busca: consulta.busca?.trim().slice(0, 120) || null,
    cursor: lerCursor(consulta.cursor),
    limite: limitar(consulta.limite),
  };
}

/**
 * Modo demo: devolve o exemplo em vez de consultar.
 *
 * A sessao demo nao tem linha no banco, entao qualquer `where perfil_id = $1`
 * com o id falso estoura 22P02 e quebra a tela. Toda funcao de leitura passa
 * por aqui antes de tocar o banco.
 */
export async function comDemo<T>(exemplo: () => T, consulta: () => Promise<T>): Promise<T> {
  if (modoDemo) return exemplo();
  return consulta();
}

/** Número vindo do Postgres como string (bigint/numeric). */
export function numeroDe(valor: unknown, padrao = 0): number {
  if (valor === null || valor === undefined) return padrao;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

export async function configuracao(chave: string, padrao: number): Promise<number> {
  const linhas = await bd()<{ v: string }[]>`select config_num(${chave}, ${padrao}) as v`;
  return numeroDe(linhas[0]?.v, padrao);
}

/**
 * Embrulha um valor para coluna `jsonb`.
 *
 * O tipo `JSONValue` do postgres.js é mais estreito que `Record<string,
 * unknown>`, e afrouxar isso em cada chamada espalharia `as never` pelo
 * projeto. A conversão acontece aqui, uma vez, com o porquê à vista.
 */
export function comoJson(valor: unknown) {
  return bd().json(valor as Parameters<ReturnType<typeof bd>["json"]>[0]);
}
