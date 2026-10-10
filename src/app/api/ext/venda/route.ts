import { NextResponse, type NextRequest } from "next/server";
import {
  autenticarLicenca,
  dentroDoLimite,
  origemDaRequisicao,
  tokenDoCabecalho,
} from "@/lib/dados/extensao";
import { bd } from "@/lib/db";
import { preferenciasDe } from "@/lib/dados/push";
import { modoDemo } from "@/lib/env";

/**
 * POST /api/ext/venda — "vendi agora": vira notificação no celular do vendedor.
 *
 * Corpo: { vendas?, valor?, gmv?, espectadores? } — tudo texto como a tela do
 * TikTok mostra ("R$ 79,90", "12").
 *
 * Isto NÃO registra venda. O número vem de uma extensão que o próprio cliente
 * controla, e por isso não entra no ranking nem no faturamento (ver
 * extensao/LEIA-ME.md). Serve só para o aviso chegar no bolso de quem vendeu —
 * mandar para si mesmo um valor errado não prejudica ninguém além de si.
 */

export const dynamic = "force-dynamic";

/** Uma live movimentada vende rápido; o aviso agrupa pela tag, não precisa de mais. */
const TETO_POR_LICENCA = 30;
const TETO_POR_ORIGEM = 120;
const JANELA_S = 60;

function curto(valor: unknown, limite = 24): string | null {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const texto = String(valor).replace(/\s+/g, " ").trim();
  return texto && texto !== "—" ? texto.slice(0, limite) : null;
}

export async function POST(request: NextRequest) {
  if (modoDemo) {
    return NextResponse.json({ ok: false, erro: "modo_demo" }, { status: 503 });
  }

  const origem = origemDaRequisicao(request.headers);

  try {
    if (!(await dentroDoLimite(`ext:venda:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) {
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
    if (!(await dentroDoLimite(`ext:venda:${licenca.licencaId}`, TETO_POR_LICENCA, JANELA_S))) {
      return excedeu();
    }

    const preferencias = await preferenciasDe(licenca.perfilId);
    if (!preferencias.venda) return NextResponse.json({ ok: true, enviado: false });

    const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const valor = curto(corpo?.valor);
    const vendas = curto(corpo?.vendas, 8);
    const gmv = curto(corpo?.gmv);

    const partes = [
      valor,
      vendas ? `${vendas} venda${vendas === "1" ? "" : "s"}` : null,
      gmv ? `GMV ${gmv}` : null,
    ].filter(Boolean);

    // Pela porta única do push: ela não cria job quando não há aparelho
    // inscrito, e a chave junta o mesmo total de vendas lido duas vezes.
    const [linha] = await bd()<{ id: string | null }[]>`
      select enfileirar_push(
        ${licenca.perfilId},
        ${"🛒 Nova venda na live!"},
        ${partes.length ? partes.join(" · ") : "Abra o painel para ver os detalhes."},
        ${"/live"},
        ${"venda-live"},
        ${vendas ? `venda:${licenca.perfilId}:${vendas}:${valor ?? ""}` : null}
      ) as id
    `;

    return NextResponse.json({ ok: true, enviado: Boolean(linha?.id) });
  } catch (erro) {
    console.error("[api/ext/venda]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}
