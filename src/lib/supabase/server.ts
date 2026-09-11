import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env, exigirSupabase } from "@/lib/env";
import { COOKIE_OPTIONS } from "./cookies";

/**
 * Cliente por requisição. Nunca reaproveitar entre requisições — o cliente
 * carrega a sessão de quem fez a chamada, e as políticas de RLS dependem disso.
 */
export async function clienteServidor() {
  // cookies() antes da validação de propósito: é o que marca a rota como
  // dinâmica. Validar primeiro faria `next build` quebrar na pré-renderização
  // em vez de deixar o erro aparecer na requisição.
  const jar = await cookies();
  exigirSupabase();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookieOptions: COOKIE_OPTIONS,
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (paraGravar) => {
        try {
          for (const { name, value, options } of paraGravar) {
            jar.set(name, value, options);
          }
        } catch {
          // Server Component não pode gravar cookie. Tudo bem: o refresh de
          // sessão acontece no proxy (src/proxy.ts), que pode.
        }
      },
    },
  });
}

/**
 * Cliente administrativo: ignora RLS. Só para jobs e webhooks de servidor —
 * nunca a partir de dados vindos do usuário sem checar o papel antes.
 */
export function clienteAdmin() {
  if (!env.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada.");
  }
  return createServerClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    cookieOptions: COOKIE_OPTIONS,
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
