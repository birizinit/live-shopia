import { NextResponse, type NextRequest } from "next/server";
import {
  autenticarLicenca,
  chatDesligadoNaBase,
  dentroDoLimite,
  origemDaRequisicao,
  planoVigente,
  tokenDoCabecalho,
} from "@/lib/dados/extensao";
import { encerradaPor, sessaoAberta } from "@/lib/dados/ext-live";
import { decidirResposta, registrarResposta } from "@/lib/dados/respostas";
import { proximaTarefa, registrarRefixada } from "@/lib/dados/automacoes";
import { tetoDaConta } from "@/lib/dados/automacoes";
import { modoDemo } from "@/lib/env";

/**
 * POST /api/ext/responder — o que a Shopia faz com um comentário.
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
      return NextResponse.json(
        { ok: false, erro: licenca.estado, detalhe: licenca.revogadaMotivo },
        { status: 403 },
      );
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

    // Sessão fechada (pelo painel, pela faxina) não responde nem programa:
    // sem isto, entre o "Encerrar" e o próximo batimento as respostas saíam
    // sem teto, porque nada era registrado numa sessão fechada.
    if (!(await sessaoAberta(licenca.perfilId, sessaoId))) {
      return NextResponse.json(
        { ok: false, erro: "sessao_encerrada", pelo: await encerradaPor(licenca.perfilId, sessaoId) },
        { status: 409 },
      );
    }

    // Confirmação de envio: a extensão avisa que a resposta de fato saiu.
    if (corpo?.acao === "registrar") {
      const enviado = texto(corpo?.texto, 500);
      if (!enviado) {
        return NextResponse.json({ ok: false, erro: "texto_vazio" }, { status: 400 });
      }
      const avisoId =
        typeof corpo?.avisoId === "string" && UUID.test(corpo.avisoId) ? corpo.avisoId : null;

      await registrarResposta(licenca.perfilId, sessaoId, enviado, texto(corpo?.tema, 30), {
        // Aviso programado é gravado como `aviso` para o agendador saber quando
        // cada um saiu pela última vez. A cadência conta os dois tipos.
        tipo: avisoId ? "aviso" : "resposta_ia",
        avisoId,
      });
      return NextResponse.json({ ok: true });
    }

    if (corpo?.acao === "refixou") {
      await registrarRefixada(licenca.perfilId, sessaoId);
      return NextResponse.json({ ok: true });
    }

    // Os dois freios da automação de chat, checados aqui: o da licença (por
    // conta) e o global (base inteira).
    const chatLiberado =
      licenca.chat &&
      licenca.recursos.chat &&
      !(await chatDesligadoNaBase()) &&
      (await planoVigente(licenca.perfilId));

    /**
     * "Tem algo programado para agora?"
     *
     * A extensão pergunta; o servidor decide. O relógio de cada automação mora
     * aqui porque a extensão roda na máquina do cliente — duas abas abertas na
     * mesma conta contariam o intervalo em dobro e postariam em dobro.
     */
    if (corpo?.acao === "programado") {
      if (!chatLiberado) {
        return NextResponse.json({ ok: true, acao: "nada", motivo: "chat_desligado" });
      }
      const tarefa = await proximaTarefa(licenca.perfilId, sessaoId, {
        tetoPorMinuto: await tetoDaConta(licenca.perfilId),
      });
      return NextResponse.json({ ok: true, ...tarefa });
    }

    const tipo = corpo?.tipo === "entrada" ? "entrada" : "comentario";

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
