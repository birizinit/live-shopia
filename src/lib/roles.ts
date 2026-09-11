/**
 * Papéis. A checagem de verdade é no servidor (RLS + guards) — o que está
 * aqui serve só para montar a navegação e esconder o que não interessa.
 * Nunca confiar nisto para autorizar nada.
 */
export const PAPEIS = ["user", "affiliate", "manager", "admin"] as const;

export type Papel = (typeof PAPEIS)[number];

export function ehPapel(valor: unknown): valor is Papel {
  return typeof valor === "string" && (PAPEIS as readonly string[]).includes(valor);
}

/** manager cobre affiliate; admin cobre tudo. */
export function temPapel(papel: Papel, exigidos: readonly Papel[]) {
  if (papel === "admin") return true;
  if (papel === "manager" && exigidos.includes("affiliate")) return true;
  return exigidos.includes(papel);
}
