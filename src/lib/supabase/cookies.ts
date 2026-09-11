import type { CookieOptionsWithName } from "@supabase/ssr";
import { env } from "@/lib/env";

/**
 * O contrário do que o Live Fox faz: o token não fica ao alcance do JavaScript.
 *
 * `httpOnly: true` significa que nenhum código de página (nem um XSS) consegue
 * ler o access/refresh token — o preço é que toda chamada ao Supabase passa
 * pelo servidor (Server Component, Server Action ou Route Handler). O cliente
 * de browser do Supabase fica de fora de propósito.
 *
 * Consequência a resolver na fase 4: Realtime precisa de um token no browser.
 * A saída é o servidor emitir um token curto e específico para isso, nunca
 * expor o refresh token.
 */
export const COOKIE_OPTIONS: CookieOptionsWithName = {
  name: "shopia-auth",
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: env.producao,
  maxAge: 60 * 60 * 24 * 30,
};
