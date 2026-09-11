import { NextResponse, type NextRequest } from "next/server";
import { consumirTokenEmail } from "@/lib/auth/tokens";
import { bd } from "@/lib/db";
import { modoDemo } from "@/lib/env";

/**
 * Link de confirmação de e-mail. Rota pública: quem clica pode estar em outro
 * navegador, sem sessão nenhuma.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const destino = new URL("/perfil", request.url);

  if (modoDemo || !token) {
    destino.searchParams.set("email", modoDemo ? "demo" : "invalido");
    return NextResponse.redirect(destino);
  }

  const perfilId = await consumirTokenEmail("verificacao", token);
  if (!perfilId) {
    destino.searchParams.set("email", "expirado");
    return NextResponse.redirect(destino);
  }

  await bd()`
    update perfis
       set email_verificado_em = coalesce(email_verificado_em, now())
     where id = ${perfilId}
  `;

  destino.searchParams.set("email", "confirmado");
  return NextResponse.redirect(destino);
}
