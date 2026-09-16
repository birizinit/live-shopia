import { NextResponse, type NextRequest } from "next/server";
import {
  autenticarLicenca,
  chatDesligadoNaBase,
  dentroDoLimite,
  origemDaRequisicao,
  tokenDoCabecalho,
} from "@/lib/dados/extensao";
import { decidirResposta, registrarResposta } from "@/lib/dados/respostas";
import { modoDemo } from "@/lib/env";

/**
 * POST /api/ext/responder — o que a apresentadora faz com um comentário.
 *
 * A extensão pergunta, o servidor decide. Ela nunca escolhe sozinha se
 * responde, o que responde ou quando: essas três decisões protegem a conta do
 * cliente contra bloqueio, e regra que protege alguém não pode morar na
 * máquina dessa pessoa.
 *
 * Duas ações: `registrar` (confirma que a resposta saiu) e a decisão em si.
 */

export const dynamic = "force-dynamic";

const TETO_POR_LICENCA = 300;
const TETO_POR_ORIGEM = 900;
const JANELA_S = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(valor: unknown, limite: number): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo ? limpo.slice(0, limite) : null;
}

export async function POST(request: NextRequest) {
  if (modoDemo) {
    return NextResponse.json({ ok: false, erro: "modo_demo" }, { status: 503 });
  }

  const origem = origemDaRequisicao(request.headers);

  try {
    if (!(await dentroDoLimite(`ext:responder:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) {
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

    if (!(await dentroDoLimite(`ext:responder:${licenca.licencaId}`, TETO_POR_LICENCA, JANELA_S))) {
      return excedeu();
    }

    const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    const sessaoId =
      typeof corpo?.sessaoId === "string" && UUID.test(corpo.sessaoId) ? corpo.sessaoId : null;
    if (!sessaoId) {
      return NextResponse.json({ ok: false, erro: "sessao_invalida" }, { status: 400 });
    }

    // Confirmação de envio: a extensão avisa que a resposta de fato saiu.
    if (corpo?.acao === "registrar") {
      const enviado = texto(corpo?.texto, 500);
      if (!enviado) {
        return NextResponse.json({ ok: false, erro: "texto_vazio" }, { status: 400 });
      }
      await registrarResposta(licenca.perfilId, sessaoId, enviado, texto(corpo?.tema, 30));
      return NextResponse.json({ ok: true });
    }

    const tipo = corpo?.tipo === "entrada" ? "entrada" : "comentario";

    // Os dois freios da automação de chat, checados aqui: o da licença (por
    // conta) e o global (base inteira). O do mixer não entra — áudio e chat
    // são recursos independentes de propósito.
    const chatLiberado =
      licenca.chat && licenca.recursos.chat && !(await chatDesligadoNaBase());

    const decisao = await decidirResposta(licenca.perfilId, {
      sessaoId,
      tipo,
      apelido: texto(corpo?.apelido, 80),
      texto: texto(corpo?.texto, 500),
      produtoId:
        typeof corpo?.produtoId === "string" && UUID.test(corpo.produtoId)
          ? corpo.produtoId
          : null,
      chatLiberado,
    });

    return NextResponse.json(
      { ok: true, ...decisao },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (erro) {
    console.error("[api/ext/responder]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}
