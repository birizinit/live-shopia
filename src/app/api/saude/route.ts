import { NextResponse } from "next/server";
import { bd } from "@/lib/db";
import { modoDemo } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Healthcheck do deploy. Responde 503 se o banco não responder — senão a
 * Railway promove uma versão que sobe e não funciona.
 */
export async function GET() {
  if (modoDemo) {
    return NextResponse.json({ ok: true, modo: "demo" });
  }

  try {
    await bd()`select 1`;
    return NextResponse.json({ ok: true, modo: "banco" });
  } catch (erro) {
    // O detalhe vai para o log de quem opera o deploy. A resposta publica nao
    // carrega nome de host interno nem mensagem crua do driver.
    console.error("[saude] banco indisponível:", erro);
    return NextResponse.json({ ok: false, modo: "banco" }, { status: 503 });
  }
}
