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
 * POST /api/ext/relatorio — o resumo da live que acabou, no celular.
 *
 * Corpo: { minutos, vendas, carrinhos, cliques, reclamacoes, perguntas,
 * respostas, picoEspectadores } — números contados pela extensão.
 *
 * Como o aviso de venda, isto NÃO registra nada: o número vem de uma extensão
 * que o próprio cliente controla, e só volta para ele mesmo como notificação.
 * Segue a preferência "venda" (os avisos da live no celular).
 */

export const dynamic = "force-dynamic";

const TETO_POR_LICENCA = 6;
const TETO_POR_ORIGEM = 60;
const JANELA_S = 60;

function inteiro(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number.parseInt(String(valor ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), 1_000_000) : 0;
}

export async function POST(request: NextRequest) {
  if (modoDemo) return NextResponse.json({ ok: false, erro: "modo_demo" }, { status: 503 });
  const origem = origemDaRequisicao(request.headers);
  try {
    if (!(await dentroDoLimite(`ext:relatorio:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) return excedeu();
    const licenca = await autenticarLicenca(tokenDoCabecalho(request.headers));
    if (!licenca) {
      return NextResponse.json(
        { ok: false, erro: "token_invalido" },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      );
    }
    if (licenca.estado !== "ativa") return NextResponse.json({ ok: false, erro: licenca.estado }, { status: 403 });
    if (!(await dentroDoLimite(`ext:relatorio:${licenca.licencaId}`, TETO_POR_LICENCA, JANELA_S))) return excedeu();

    const preferencias = await preferenciasDe(licenca.perfilId);
    if (!preferencias.venda) return NextResponse.json({ ok: true, enviado: false });

    const c = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const minutos = inteiro(c.minutos);
    const duracao = minutos >= 60 ? `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}` : `${minutos} min`;
    const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
    const partes = [
      plural(inteiro(c.vendas), "venda", "vendas"),
      plural(inteiro(c.carrinhos), "carrinho", "carrinhos"),
      inteiro(c.cliques) ? plural(inteiro(c.cliques), "clique", "cliques") : null,
      inteiro(c.reclamacoes) ? plural(inteiro(c.reclamacoes), "reclamação", "reclamações") : null,
      inteiro(c.perguntas) ? plural(inteiro(c.perguntas), "pergunta sem resposta", "perguntas sem resposta") : null,
      inteiro(c.picoEspectadores) ? `pico de ${inteiro(c.picoEspectadores)} espectadores` : null,
    ].filter(Boolean);

    const [linha] = await bd()<{ id: string | null }[]>`
      select enfileirar_push(
        ${licenca.perfilId},
        ${`Live encerrada · ${duracao}`},
        ${partes.join(" · ")},
        ${inteiro(c.perguntas) ? "/manual" : "/live"},
        ${"relatorio-live"},
        null
      ) as id
    `;
    return NextResponse.json({ ok: true, enviado: Boolean(linha?.id) });
  } catch (erro) {
    console.error("[api/ext/relatorio]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}
