import { NextResponse, type NextRequest } from "next/server";
import {
  autenticarLicenca,
  dentroDoLimite,
  origemDaRequisicao,
  tokenDoCabecalho,
} from "@/lib/dados/extensao";
import {
  abrirSessaoExtensao,
  baterSessaoExtensao,
  fecharSessaoExtensao,
} from "@/lib/dados/ext-live";
import { ErroDominio } from "@/lib/dados/erros";
import { modoDemo } from "@/lib/env";

/**
 * POST /api/ext/sessao — abrir, bater e fechar a sessão de live.
 *
 * Três ações numa rota só porque são o mesmo objeto e o mesmo dono; separar em
 * três endpoints só multiplicaria autenticação e teto de uso.
 *
 * Corpo: { acao: "abrir" | "batimento" | "fechar", sessaoId?, montagemId?,
 *          contaTikTokId?, espectadores?, erro? }
 */

export const dynamic = "force-dynamic";

const TETO_POR_LICENCA = 90;
const TETO_POR_ORIGEM = 300;
const JANELA_S = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOuNulo(valor: unknown): string | null {
  return typeof valor === "string" && UUID.test(valor) ? valor : null;
}

export async function POST(request: NextRequest) {
  if (modoDemo) {
    return NextResponse.json({ ok: false, erro: "modo_demo" }, { status: 503 });
  }

  const origem = origemDaRequisicao(request.headers);

  try {
    if (!(await dentroDoLimite(`ext:sessao:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) {
      return excedeu();
    }

    const licenca = await autenticarLicenca(tokenDoCabecalho(request.headers));
    if (!licenca) {
      return NextResponse.json(
        { ok: false, erro: "token_invalido" },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      );
    }

    if (licenca.estado !== "ativa") {
      return NextResponse.json({ ok: false, erro: licenca.estado }, { status: 403 });
    }

    if (!(await dentroDoLimite(`ext:sessao:${licenca.licencaId}`, TETO_POR_LICENCA, JANELA_S))) {
      return excedeu();
    }

    const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const acao = typeof corpo?.acao === "string" ? corpo.acao : "";

    if (acao === "abrir") {
      const { sessaoId, jaEstavaAberta } = await abrirSessaoExtensao(licenca.perfilId, {
        montagemId: uuidOuNulo(corpo?.montagemId),
        contaTikTokId: uuidOuNulo(corpo?.contaTikTokId),
      });
      return NextResponse.json({ ok: true, sessaoId, jaEstavaAberta });
    }

    const sessaoId = uuidOuNulo(corpo?.sessaoId);
    if (!sessaoId) {
      return NextResponse.json({ ok: false, erro: "sessao_invalida" }, { status: 400 });
    }

    if (acao === "batimento") {
      const bruto = Number(corpo?.espectadores);
      const espectadores =
        Number.isSafeInteger(bruto) && bruto >= 0 && bruto < 10_000_000 ? bruto : null;

      const viva = await baterSessaoExtensao(licenca.perfilId, sessaoId, espectadores);
      // 409 e não 404: a sessão pode ter sido encerrada pelo painel enquanto a
      // extensão batia. A extensão trata isso reabrindo, não como erro.
      return viva
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ ok: false, erro: "sessao_encerrada" }, { status: 409 });
    }

    if (acao === "fechar") {
      const erroTexto =
        typeof corpo?.erro === "string" && corpo.erro.trim()
          ? corpo.erro.trim().slice(0, 300)
          : null;

      const fechou = await fecharSessaoExtensao(licenca.perfilId, sessaoId, erroTexto);
      return NextResponse.json({ ok: fechou, jaEstavaFechada: !fechou });
    }

    return NextResponse.json({ ok: false, erro: "acao_invalida" }, { status: 400 });
  } catch (erro) {
    if (erro instanceof ErroDominio) {
      return NextResponse.json({ ok: false, erro: erro.codigo }, { status: 400 });
    }
    console.error("[api/ext/sessao]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}
