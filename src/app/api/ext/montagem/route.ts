import { NextResponse, type NextRequest } from "next/server";
import {
  autenticarLicenca,
  dentroDoLimite,
  origemDaRequisicao,
  tokenDoCabecalho,
} from "@/lib/dados/extensao";
import { montagemAtivaParaExtensao } from "@/lib/dados/ext-live";
import { modoDemo } from "@/lib/env";

/**
 * GET /api/ext/montagem — o que a extensão deve tocar.
 *
 * Devolve a montagem ativa em BLOCOS, na ordem. O arquivo contínuo de três
 * horas não existe: a extensão toca a lista em laço, e repetir não gasta
 * crédito nenhum — é essa mecânica que sustenta a margem do produto.
 *
 * Autentica por token de licença, como o resto de /api/ext. A extensão roda
 * numa aba do TikTok e não tem o cookie do painel.
 */

export const dynamic = "force-dynamic";

const TETO_POR_LICENCA = 30;
const TETO_POR_ORIGEM = 120;
const JANELA_S = 60;

export async function GET(request: NextRequest) {
  if (modoDemo) {
    return NextResponse.json(
      { ok: false, erro: "modo_demo", detalhe: "Servidor em modo demonstração, sem banco." },
      { status: 503 },
    );
  }

  const origem = origemDaRequisicao(request.headers);

  try {
    if (!(await dentroDoLimite(`ext:montagem:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) {
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

    // O mixer é o recurso que autoriza tocar áudio. Ele e o chat são freios
    // independentes (PLANO.md §6): desligar a resposta do chat não pode calar
    // a apresentadora, e é justamente essa separação que mantém o produto de
    // pé quando a automação de chat precisa morrer.
    if (!licenca.mixer) {
      return NextResponse.json(
        { ok: false, erro: "sem_mixer", detalhe: "Seu plano não libera o áudio da live." },
        { status: 403 },
      );
    }

    if (!(await dentroDoLimite(`ext:montagem:${licenca.licencaId}`, TETO_POR_LICENCA, JANELA_S))) {
      return excedeu();
    }

    const montagem = await montagemAtivaParaExtensao(licenca.perfilId);

    if (!montagem) {
      return NextResponse.json(
        {
          ok: false,
          erro: "sem_montagem",
          detalhe: "Nenhuma montagem ativa. Monte o áudio da live no painel.",
        },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }

    if (montagem.falas.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          erro: "montagem_vazia",
          montagem: { id: montagem.id, nome: montagem.nome },
          detalhe: "A montagem ativa não tem nenhum bloco de áudio pronto.",
        },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }

    return NextResponse.json(
      { ok: true, montagem, bloco: "/api/ext/bloco" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (erro) {
    console.error("[api/ext/montagem]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}
