import { NextResponse, type NextRequest } from "next/server";
import {
  autenticarLicenca,
  dentroDoLimite,
  origemDaRequisicao,
  tokenDoCabecalho,
} from "@/lib/dados/extensao";
import { blocoParaExtensao } from "@/lib/dados/ext-live";
import { modoDemo } from "@/lib/env";

/**
 * GET /api/ext/bloco?id=<arquivo> — um bloco de áudio, para a extensão tocar.
 *
 * Existe separada de /api/arquivos/[id] porque aquela autentica por cookie de
 * sessão do navegador e esta autentica por token de licença. Mesmo arquivo,
 * duas portas, dois tipos de credencial — juntar as duas numa rota só é como
 * se constrói um IDOR sem perceber.
 *
 * A conferência de dono está na consulta (blocoParaExtensao), não aqui: sem
 * RLS, o `where` é a única barreira, e ela precisa estar junto do SELECT.
 */

export const dynamic = "force-dynamic";

// Um áudio de três horas são ~45 blocos, e a extensão busca cada um uma vez
// por volta do laço. O teto é alto porque o caminho é legítimo e frequente.
const TETO_POR_LICENCA = 300;
const TETO_POR_ORIGEM = 900;
const JANELA_S = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  if (modoDemo) {
    return NextResponse.json({ ok: false, erro: "modo_demo" }, { status: 503 });
  }

  const origem = origemDaRequisicao(request.headers);

  try {
    if (!(await dentroDoLimite(`ext:bloco:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) {
      return excedeu();
    }

    const licenca = await autenticarLicenca(tokenDoCabecalho(request.headers));
    if (!licenca) {
      return NextResponse.json(
        { ok: false, erro: "token_invalido" },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      );
    }

    if (licenca.estado !== "ativa" || !licenca.mixer) {
      return NextResponse.json({ ok: false, erro: "sem_permissao" }, { status: 403 });
    }

    if (!(await dentroDoLimite(`ext:bloco:${licenca.licencaId}`, TETO_POR_LICENCA, JANELA_S))) {
      return excedeu();
    }

    const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
    // Id malformado vira 22P02 no Postgres e 500 na resposta. Peneira antes.
    if (!UUID.test(id)) {
      return NextResponse.json({ ok: false, erro: "id_invalido" }, { status: 400 });
    }

    const bloco = await blocoParaExtensao(licenca.perfilId, id);
    if (!bloco) {
      return NextResponse.json({ ok: false, erro: "nao_encontrado" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(bloco.conteudo), {
      headers: {
        "content-type": bloco.mime,
        "content-length": String(bloco.bytes),
        // Bloco é imutável: gerado uma vez, nunca reescrito. Deixar o navegador
        // guardar é o que faz o laço de horas não voltar ao servidor a cada
        // volta — e é exatamente por isso que repetir não custa nada.
        "cache-control": "private, max-age=86400, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (erro) {
    console.error("[api/ext/bloco]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}
