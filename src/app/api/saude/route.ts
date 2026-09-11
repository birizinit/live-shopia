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
    return NextResponse.json(
      { ok: false, erro: erro instanceof Error ? erro.message : "desconhecido" },
      { status: 503 },
    );
  }
}
