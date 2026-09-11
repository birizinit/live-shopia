import { NextResponse, type NextRequest } from "next/server";
import { modoDemo } from "@/lib/env";
import {
  ROTA_LOGIN,
  ROTA_POS_LOGIN,
  ehAutenticacao,
  ehEmBreve,
  ehPorToken,
  ehPublica,
} from "@/lib/rotas";

const COOKIE_SESSAO = "shopia_sessao";
const COOKIE_DEMO = "shopia_demo";

/**
 * Guard de rota.
 *
 * Só olha se existe cookie de sessão — não valida e não consulta banco. Isso
 * é de propósito: o proxy roda em toda requisição, inclusive nas que não
 * renderizam nada, e uma ida ao banco por requisição sairia cara para um
 * ganho nenhum. Quem valida a sessão de verdade (e o papel) é o servidor da
 * página, em `obterUsuario`/`exigirPapel`.
 *
 * O pior caso aqui é deixar passar um cookie expirado até a página redirecionar
 * — nunca deixar passar sem sessão.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (ehEmBreve(pathname)) {
    return NextResponse.redirect(new URL(ROTA_POS_LOGIN, request.url));
  }

  // A extensão autentica por token no cabeçalho e não tem cookie nenhum.
  // Mandá-la para /login mataria a superfície inteira.
  if (ehPorToken(pathname)) return NextResponse.next();

  const cookie = modoDemo ? COOKIE_DEMO : COOKIE_SESSAO;
  const temCookie = Boolean(request.cookies.get(cookie)?.value);

  if (!temCookie && !ehPublica(pathname)) {
    const destino = new URL(ROTA_LOGIN, request.url);
    destino.searchParams.set("proximo", `${pathname}${search}`);
    return NextResponse.redirect(destino);
  }

  if (temCookie && ehAutenticacao(pathname)) {
    return NextResponse.redirect(new URL(ROTA_POS_LOGIN, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Tudo, menos estáticos, imagens otimizadas, arquivos do PWA e assets.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|api/saude|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
