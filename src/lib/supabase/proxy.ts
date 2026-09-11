import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { env, exigirSupabase } from "@/lib/env";
import { COOKIE_OPTIONS } from "./cookies";

/**
 * Renova a sessão e devolve o usuário.
 *
 * O proxy é o único lugar que consegue gravar cookie em toda requisição, então
 * é aqui que a rotação do refresh token acontece. Os cookies renovados são
 * gravados na `resposta` **e** devolvidos ao `request`, senão o render que vem
 * a seguir ainda enxerga o token velho.
 */
export async function renovarSessao(request: NextRequest, resposta: NextResponse) {
  exigirSupabase();

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookieOptions: COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (paraGravar, headers) => {
        for (const { name, value, options } of paraGravar) {
          request.cookies.set(name, value);
          resposta.cookies.set(name, value, options);
        }
        // Resposta que grava cookie de auth não pode ser cacheada por CDN.
        for (const [chave, valor] of Object.entries(headers)) {
          resposta.headers.set(chave, valor);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}
