import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { bd } from "../db";

export type TipoToken = "verificacao" | "recuperacao";

/**
 * Link de confirmação dura um dia; link de recuperação dura uma hora — é ele
 * que troca a senha de alguém, então a janela tem que ser curta.
 */
const VALIDADE: Record<TipoToken, string> = {
  verificacao: "24 hours",
  recuperacao: "1 hour",
};

function hashDoToken(token: string) {
  return createHash("sha256").update(token).digest();
}

export async function criarTokenEmail(perfilId: string, tipo: TipoToken) {
  const sql = bd();
  const token = randomBytes(32).toString("base64url");

  // Pedir um link novo invalida o anterior: dois links válidos ao mesmo tempo
  // é o dobro de superfície pela mesma conveniência.
  await sql`
    update tokens_email set usado_em = now()
     where perfil_id = ${perfilId} and tipo = ${tipo} and usado_em is null
  `;

  await sql`
    insert into tokens_email (perfil_id, tipo, token_hash, expira_em)
    values (${perfilId}, ${tipo}, ${hashDoToken(token)}, now() + ${VALIDADE[tipo]}::interval)
  `;

  return token;
}

/** Consome de uma vez: o mesmo link não serve duas vezes. */
export async function consumirTokenEmail(tipo: TipoToken, token: string) {
  const linhas = await bd()<{ perfil_id: string }[]>`
    update tokens_email
       set usado_em = now()
     where token_hash = ${hashDoToken(token)}
       and tipo = ${tipo}
       and usado_em is null
       and expira_em > now()
    returning perfil_id
  `;

  return linhas[0]?.perfil_id ?? null;
}
