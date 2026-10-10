import { NextResponse, type NextRequest } from "next/server";
import {
  autenticarLicenca,
  dentroDoLimite,
  origemDaRequisicao,
  tokenDoCabecalho,
} from "@/lib/dados/extensao";
import { assinaturaDoPerfil, listarPlanos, saldoAtual } from "@/lib/dados/planos";
import { contasTikTok, desvincularConta, limiteDeContas, vincularConta } from "@/lib/dados/live";
import { ErroDominio } from "@/lib/dados/erros";
import { modoDemo } from "@/lib/env";

/**
 * /api/ext/conta — o que o overlay "IA de vendas" da extensão mostra.
 *
 * GET  → plano, créditos, contas TikTok e a vitrine de planos.
 * POST → { acao: "adicionar", usuario } | { acao: "remover", id }
 *
 * O pagamento não acontece aqui: a extensão abre /planos no site, onde a
 * pessoa já tem sessão. Cartão e Pix não passam por uma aba do TikTok.
 */

export const dynamic = "force-dynamic";

const TETO_POR_LICENCA = 30;
const TETO_POR_ORIGEM = 120;
const JANELA_S = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function autenticar(request: NextRequest) {
  const origem = origemDaRequisicao(request.headers);
  if (!(await dentroDoLimite(`ext:conta:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) {
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
  if (licenca.estado === "revogada") {
    return { resposta: NextResponse.json({ ok: false, erro: "revogada" }, { status: 403 }) };
  }
  if (!(await dentroDoLimite(`ext:conta:${licenca.licencaId}`, TETO_POR_LICENCA, JANELA_S))) {
    return { resposta: excedeu() };
  }
  return { licenca };
}

async function retrato(perfilId: string) {
  const [assinatura, saldo, contas, limite, planos] = await Promise.all([
    assinaturaDoPerfil(perfilId),
    saldoAtual(perfilId),
    contasTikTok(perfilId),
    limiteDeContas(perfilId),
    listarPlanos(),
  ]);

  // Vigente = ativa E dentro do prazo: cortesia e plano gravam `fim`, e nada
  // muda o status quando ele passa.
  const ativa =
    assinatura?.status === "ativa" &&
    (!assinatura.fim || new Date(assinatura.fim).getTime() > Date.now());
  const diasRestantes =
    ativa && assinatura?.fim
      ? Math.max(0, Math.ceil((new Date(assinatura.fim).getTime() - Date.now()) / 86_400_000))
      : null;

  return {
    ok: true,
    plano: {
      ativo: ativa,
      nome: assinatura?.plano.nome ?? null,
      status: assinatura?.status ?? null,
      fim: assinatura?.fim ?? null,
      diasRestantes,
      nuncaAssinou: !assinatura,
    },
    creditos: {
      saldo,
      cotaMes: assinatura?.plano.creditosMes ?? null,
    },
    contas: contas.map((c) => ({ id: c.id, usuario: c.usuario, apelido: c.apelido })),
    limiteContas: limite,
    planos: planos.map((p) => ({
      slug: p.slug,
      nome: p.nome,
      precoCentavos: p.precoCentavos,
      meses: p.meses,
      precoMensalCentavos: p.precoMensalCentavos,
      contasTiktok: p.contasTiktok,
      recursos: p.recursos,
    })),
  };
}

export async function GET(request: NextRequest) {
  if (modoDemo) return demo();
  try {
    const { licenca, resposta } = await autenticar(request);
    if (!licenca) return resposta;
    return NextResponse.json(await retrato(licenca.perfilId), {
      headers: { "cache-control": "no-store" },
    });
  } catch (erro) {
    return falhou(erro);
  }
}

export async function POST(request: NextRequest) {
  if (modoDemo) return demo();
  try {
    const { licenca, resposta } = await autenticar(request);
    if (!licenca) return resposta;

    const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const acao = typeof corpo?.acao === "string" ? corpo.acao : "";

    if (acao === "adicionar") {
      const usuario = typeof corpo?.usuario === "string" ? corpo.usuario : "";
      if (!usuario.trim()) {
        return NextResponse.json({ ok: false, erro: "dado_invalido", detalhe: "Informe o @ da conta." }, { status: 400 });
      }
      await vincularConta(licenca.perfilId, usuario);
    } else if (acao === "remover") {
      const id = typeof corpo?.id === "string" && UUID.test(corpo.id) ? corpo.id : null;
      if (!id) return NextResponse.json({ ok: false, erro: "dado_invalido" }, { status: 400 });
      await desvincularConta(licenca.perfilId, id);
    } else {
      return NextResponse.json({ ok: false, erro: "acao_invalida" }, { status: 400 });
    }

    return NextResponse.json(await retrato(licenca.perfilId));
  } catch (erro) {
    return falhou(erro);
  }
}

function demo() {
  return NextResponse.json({ ok: false, erro: "modo_demo" }, { status: 503 });
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}

function falhou(erro: unknown) {
  if (erro instanceof ErroDominio) {
    return NextResponse.json({ ok: false, erro: erro.codigo, detalhe: erro.message }, { status: 400 });
  }
  console.error("[api/ext/conta]", erro);
  return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
}
