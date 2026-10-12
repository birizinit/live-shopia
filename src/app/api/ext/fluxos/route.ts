import { NextResponse, type NextRequest } from "next/server";
import {
  autenticarLicenca,
  dentroDoLimite,
  origemDaRequisicao,
  tokenDoCabecalho,
} from "@/lib/dados/extensao";
import { contarUsoDoFluxo, fluxosAtivos } from "@/lib/dados/fluxos";
import { tetoDaConta } from "@/lib/dados/automacoes";
import { modoDemo } from "@/lib/env";

/**
 * /api/ext/fluxos — os fluxos de resposta que a extensão executa.
 *
 * GET  → { fluxos, tetoPorMinuto }: só os ligados, na ordem da tela.
 * POST → { acao: "usou", id }: conta que um fluxo respondeu.
 *
 * Quem decide QUANDO responder é a extensão (o fluxo é uma regra que a pessoa
 * montou, com espera e intervalo dela). O teto por minuto da conta vai junto
 * para a extensão respeitar a mesma cadência das outras respostas.
 */

export const dynamic = "force-dynamic";

const TETO_POR_LICENCA = 60;
const TETO_POR_ORIGEM = 240;
const JANELA_S = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function autenticar(request: NextRequest) {
  const origem = origemDaRequisicao(request.headers);
  if (!(await dentroDoLimite(`ext:fluxos:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) {
    return { resposta: excedeu() };
  }
  const licenca = await autenticarLicenca(tokenDoCabecalho(request.headers));
  if (!licenca) {
    return {
      resposta: NextResponse.json(
        { ok: false, erro: "token_invalido" },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      ),
    };
  }
  if (licenca.estado !== "ativa") {
    return { resposta: NextResponse.json({ ok: false, erro: licenca.estado }, { status: 403 }) };
  }
  if (!(await dentroDoLimite(`ext:fluxos:${licenca.licencaId}`, TETO_POR_LICENCA, JANELA_S))) {
    return { resposta: excedeu() };
  }
  return { licenca };
}

export async function GET(request: NextRequest) {
  if (modoDemo) return NextResponse.json({ ok: false, erro: "modo_demo" }, { status: 503 });
  try {
    const { licenca, resposta } = await autenticar(request);
    if (!licenca) return resposta;
    const [fluxos, tetoPorMinuto] = await Promise.all([
      fluxosAtivos(licenca.perfilId),
      tetoDaConta(licenca.perfilId),
    ]);
    return NextResponse.json(
      {
        ok: true,
        tetoPorMinuto,
        fluxos: fluxos.map((f) => ({
          id: f.id,
          nome: f.nome,
          modo: f.modo,
          gatilhos: f.gatilhos,
          respostas: f.respostas,
          atrasoS: f.atrasoS,
          marcar: f.marcar,
          umaVezPorPessoa: f.umaVezPorPessoa,
          intervaloS: f.intervaloS,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (erro) {
    console.error("[api/ext/fluxos]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (modoDemo) return NextResponse.json({ ok: false, erro: "modo_demo" }, { status: 503 });
  try {
    const { licenca, resposta } = await autenticar(request);
    if (!licenca) return resposta;
    const corpo = (await request.json().catch(() => null)) as { acao?: unknown; id?: unknown } | null;
    if (corpo?.acao !== "usou" || typeof corpo.id !== "string" || !UUID.test(corpo.id)) {
      return NextResponse.json({ ok: false, erro: "pedido_invalido" }, { status: 400 });
    }
    await contarUsoDoFluxo(licenca.perfilId, corpo.id);
    return NextResponse.json({ ok: true });
  } catch (erro) {
    console.error("[api/ext/fluxos]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}
