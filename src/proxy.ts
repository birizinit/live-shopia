import { NextResponse, type NextRequest } from "next/server";
import { modoDemo } from "@/lib/env";
import {
  ROTA_LOGIN,
  ROTA_POS_LOGIN,
  ehAutenticacao,
  ehEmBreve,
  ehPublica,
} from "@/lib/rotas";

/**
 * Guard de sessão + rotação do refresh token.
 *
 * O que este arquivo NÃO faz: checar papel. Papel mora no banco e é checado
 * no servidor, por rota (ver exigirPapel em src/lib/sessao.ts). Fazer isso
 * aqui significaria ou consultar o banco a cada requisição, ou confiar num
 * claim do token — que é exatamente o erro do original.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const resposta = NextResponse.next({ request });

  if (ehEmBreve(pathname)) {
    return NextResponse.redirect(new URL(ROTA_POS_LOGIN, request.url));
  }

  const temSessao = modoDemo
    ? Boolean(request.cookies.get("shopia_demo")?.value)
    : Boolean(await (await import("@/lib/supabase/proxy")).renovarSessao(request, resposta));

  if (!temSessao && !ehPublica(pathname)) {
    const destino = new URL(ROTA_LOGIN, request.url);
    destino.searchParams.set("proximo", `${pathname}${search}`);
    return NextResponse.redirect(destino);
  }

  if (temSessao && ehAutenticacao(pathname)) {
    return NextResponse.redirect(new URL(ROTA_POS_LOGIN, request.url));
  }

  return resposta;
}

export const config = {
  matcher: [
    // Tudo, menos estáticos, imagens otimizadas, arquivos do PWA e assets.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
