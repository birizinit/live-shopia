import { NextResponse } from "next/server";
import { dentroDoLimite, pacoteDaVersao } from "@/lib/dados/extensao";
import { modoDemo } from "@/lib/env";
import { pacoteLocal } from "@/lib/pacote-local";
import { obterUsuario } from "@/lib/sessao";

/**
 * GET /api/extensao/baixar — o botão "Baixar a extensão" da tela /extensao.
 *
 * Autentica pela SESSÃO do site (o cookie vai junto num `<a href>` da mesma
 * origem), então funciona sem `EXTENSAO_SEGREDO`. A extensão continua usando
 * /api/ext/baixar, que autentica pelo token da licença.
 *
 * Serve a versão mais nova entre o catálogo e a pasta `extensao/` do deploy.
 */

export const dynamic = "force-dynamic";

const TETO_POR_PERFIL = 10;
const JANELA_S = 300;

export async function GET() {
  const usuario = await obterUsuario();
  if (!usuario) {
    return NextResponse.json({ ok: false, erro: "sessao_expirada" }, { status: 401 });
  }

  try {
    const pacote = modoDemo
      ? await pacoteLocal()
      : (await dentroDoLimite(`ext:baixar:${usuario.id}`, TETO_POR_PERFIL, JANELA_S))
        ? await pacoteDaVersao(usuario.id, null)
        : "limite";

    if (pacote === "limite") {
      return NextResponse.json(
        { ok: false, erro: "limite_excedido" },
        { status: 429, headers: { "retry-after": String(JANELA_S) } },
      );
    }
    if (!pacote) {
      return NextResponse.json(
        { ok: false, erro: "sem_pacote", detalhe: "Nenhum pacote da extensão disponível." },
        { status: 404 },
      );
    }

    return new NextResponse(new Uint8Array(pacote.conteudo), {
      headers: {
        "content-type": pacote.mime || "application/zip",
        "content-length": String(pacote.bytes),
        "content-disposition": `attachment; filename="shopia-extensao-${pacote.versao}.zip"`,
        "cache-control": "private, no-store",
        "x-shopia-versao": pacote.versao,
      },
    });
  } catch (erro) {
    console.error("[api/extensao/baixar]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}
