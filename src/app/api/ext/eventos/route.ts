import { NextResponse, type NextRequest } from "next/server";
import {
  autenticarLicenca,
  dentroDoLimite,
  origemDaRequisicao,
  tokenDoCabecalho,
} from "@/lib/dados/extensao";
import { registrarEventosDaExtensao, type EventoDaExtensao } from "@/lib/dados/ext-live";
import { ErroDominio } from "@/lib/dados/erros";
import { modoDemo } from "@/lib/env";

/**
 * POST /api/ext/eventos — ingestão em lote do que aconteceu na live.
 *
 * Em lote porque live movimentada gera centenas de eventos por minuto, e uma
 * requisição por comentário é banda paga por nós para nada.
 *
 * O que esta rota NÃO faz: registrar venda. Venda entra por outro caminho, com
 * origem verificável — aceitar valor de venda de um cliente que controla a
 * própria extensão seria deixar o ranking e o faturamento serem escritos por
 * quem os disputa.
 *
 * Corpo: { sessaoId, eventos: [{ tipo, apelido?, texto?, espectadores?, dados? }] }
 */

export const dynamic = "force-dynamic";

const TETO_POR_LICENCA = 120;
const TETO_POR_ORIGEM = 400;
const JANELA_S = 60;
const MAX_EVENTOS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tipos que a EXTENSÃO pode escrever.
 *
 * O catálogo do banco tem mais (inicio, fim, queda, erro, venda), mas esses são
 * escritos pelo servidor: quem abre a sessão registra 'inicio', quem a fecha
 * registra 'fim', a faxina registra 'queda'. Deixar a extensão escrever
 * qualquer tipo do catálogo permitiria forjar o histórico da própria live.
 */
const TIPOS_DA_EXTENSAO = new Set(["entrada", "seguidor", "comentario", "resposta_ia"]);

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
    if (!(await dentroDoLimite(`ext:eventos:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) {
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

    if (!(await dentroDoLimite(`ext:eventos:${licenca.licencaId}`, TETO_POR_LICENCA, JANELA_S))) {
      return excedeu();
    }

    const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    const sessaoId = typeof corpo?.sessaoId === "string" && UUID.test(corpo.sessaoId)
      ? corpo.sessaoId
      : null;
    if (!sessaoId) {
      return NextResponse.json({ ok: false, erro: "sessao_invalida" }, { status: 400 });
    }

    const bruto = Array.isArray(corpo?.eventos) ? corpo.eventos : [];
    if (bruto.length === 0) {
      return NextResponse.json({ ok: true, gravados: 0, recusados: 0 });
    }
    if (bruto.length > MAX_EVENTOS) {
      return NextResponse.json(
        { ok: false, erro: "lote_grande", maximo: MAX_EVENTOS },
        { status: 413 },
      );
    }

    let recusados = 0;
    const eventos: EventoDaExtensao[] = [];

    for (const item of bruto) {
      const e = item as Record<string, unknown>;
      const tipo = typeof e?.tipo === "string" ? e.tipo : "";

      if (!TIPOS_DA_EXTENSAO.has(tipo)) {
        recusados += 1;
        continue;
      }

      const espectadoresBruto = Number(e?.espectadores);
      const espectadores =
        Number.isSafeInteger(espectadoresBruto) &&
        espectadoresBruto >= 0 &&
        espectadoresBruto < 10_000_000
          ? espectadoresBruto
          : null;

      eventos.push({
        tipo,
        // Apelido de espectador é dado de terceiro que nunca aceitou nada
        // conosco. Entra porque o painel ao vivo precisa mostrar com quem a
        // apresentadora está falando, e sai do histórico junto com a conta.
        apelido: texto(e?.apelido, 80),
        texto: texto(e?.texto, 500),
        espectadores,
        dados: null,
      });
    }

    if (eventos.length === 0) {
      return NextResponse.json({ ok: true, gravados: 0, recusados });
    }

    const gravados = await registrarEventosDaExtensao(licenca.perfilId, sessaoId, eventos);

    return NextResponse.json({ ok: true, gravados, recusados });
  } catch (erro) {
    if (erro instanceof ErroDominio) {
      const status = erro.codigo === "nao_encontrado" ? 404 : 400;
      return NextResponse.json({ ok: false, erro: erro.codigo }, { status });
    }
    console.error("[api/ext/eventos]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}
