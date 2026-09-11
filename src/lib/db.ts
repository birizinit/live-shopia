import "server-only";
import postgres from "postgres";
import { env, exigirBanco } from "./env";

/**
 * Conexão com o Postgres.
 *
 * Em desenvolvimento o Next recarrega os módulos a cada edição; sem o cache no
 * globalThis cada recarga abriria um pool novo e o banco acabaria recusando
 * conexão. Em produção o módulo é avaliado uma vez e o cache não é preciso.
 */
declare global {
  var __shopia_sql: ReturnType<typeof postgres> | undefined;
}

let cliente: ReturnType<typeof postgres> | undefined;

export function bd() {
  exigirBanco();

  if (globalThis.__shopia_sql) return globalThis.__shopia_sql;
  if (cliente) return cliente;

  cliente = postgres(env.databaseUrl, {
    max: env.producao ? 10 : 3,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: env.databaseSsl ? "require" : false,
    onnotice: () => {},
  });

  if (!env.producao) globalThis.__shopia_sql = cliente;
  return cliente;
}
