import "server-only";
import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id com os parâmetros que a OWASP recomenda (19 MiB, 2 passes).
 * O formato PHC devolvido já carrega sal e parâmetros — por isso não existe
 * coluna de sal, e por isso dá para endurecer os custos depois sem invalidar
 * as senhas antigas.
 */
const OPCOES = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function gerarHash(senha: string) {
  return hash(senha, OPCOES);
}

export async function conferirSenha(hashArmazenado: string, senha: string) {
  try {
    return await verify(hashArmazenado, senha, OPCOES);
  } catch {
    // Hash corrompido ou em formato desconhecido: trata como senha errada.
    return false;
  }
}

/**
 * Hash descartável para gastar o mesmo tempo quando o e-mail não existe.
 * Sem isto, "login rápido" x "login lento" entrega quais e-mails têm conta.
 */
const HASH_FALSO =
  "$argon2id$v=19$m=19456,t=2,p=1$c2hvcGlhLWR1bW15LXNhbHQ$8dLHKzNwq0e0kK1oBq1fvVQxWJ0dGZ7T7cPCJcU8PSE";

export async function gastarTempoDeConferencia(senha: string) {
  await conferirSenha(HASH_FALSO, senha);
}
