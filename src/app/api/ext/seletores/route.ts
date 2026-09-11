import { NextResponse, type NextRequest } from "next/server";
import {
  ALVO_PADRAO,
  autenticarLicenca,
  dentroDoLimite,
  mapaAtivo,
  origemDaRequisicao,
  tokenDoCabecalho,
} from "@/lib/dados/extensao";
import { modoDemo } from "@/lib/env";

/**
 * GET /api/ext/seletores — o mapa de seletores ativo.
 *
 * Esta rota é a defesa principal contra a quebra técnica do PLANO.md §6: a
 * extensão não compila seletor nenhum, ela pede o mapa aqui. Quando o TikTok
 * muda o DOM, o conserto é um INSERT (`publicar_mapa_seletores`) que a base
 * inteira busca no próximo heartbeat — minutos, em vez de dias de análise da
 * Web Store com todo mundo parado.
 *
 * Query: `alvo` (padrão tiktok_live_studio) e `versao`, a versão do mapa que a
 * extensão já tem. Se não mudou, a resposta vem sem o JSON: o heartbeat é de
 * minuto em minuto e trafegar o mapa inteiro toda vez é banda paga por nós.
 */

export const dynamic = "force-dynamic";

const TETO_POR_LICENCA = 60;
const TETO_POR_ORIGEM = 240;
const JANELA_S = 60;

const ALVO = /^[a-z_]{3,40}$/;

export async function GET(request: NextRequest) {
  if (modoDemo) {
    return NextResponse.json(
      { ok: false, erro: "modo_demo", detalhe: "Servidor em modo demonstração, sem banco." },
      { status: 503 },
    );
  }

  const origem = origemDaRequisicao(request.headers);

  try {
    if (!(await dentroDoLimite(`ext:seletores:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) {
      return excedeu();
    }

    const licenca = await autenticarLicenca(tokenDoCabecalho(request.headers));
    if (!licenca) {
      return NextResponse.json(
        { ok: false, erro: "token_invalido" },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      );
    }

    // Mapa é para quem está operando. Licença revogada ou vencida não recebe —
    // e é a mesma resposta que /licenca dá, para a extensão não ter que
    // reconciliar dois estados diferentes vindos de duas rotas.
    if (licenca.estado !== "ativa") {
      return NextResponse.json({ ok: false, erro: licenca.estado }, { status: 403 });
    }

    if (!(await dentroDoLimite(`ext:seletores:${licenca.licencaId}`, TETO_POR_LICENCA, JANELA_S))) {
      return excedeu();
    }

    const parametros = request.nextUrl.searchParams;

    const alvoBruto = parametros.get("alvo")?.trim() || ALVO_PADRAO;
    if (!ALVO.test(alvoBruto)) {
      return NextResponse.json({ ok: false, erro: "alvo_invalido" }, { status: 400 });
    }

    const versaoBruta = parametros.get("versao");
    const conhecida = versaoBruta ? Number.parseInt(versaoBruta, 10) : null;
    const versaoConhecida =
      conhecida !== null && Number.isSafeInteger(conhecida) && conhecida > 0 ? conhecida : null;

    const resposta = await mapaAtivo(alvoBruto, versaoConhecida);

    if (!resposta.existe) {
      // Nenhum mapa no ar para este alvo. Não é erro da extensão, e devolver um
      // objeto vazio faria ela achar que todas as âncoras sumiram.
      return NextResponse.json(
        { ok: false, erro: "sem_mapa", alvo: alvoBruto },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        alvo: alvoBruto,
        versao: resposta.versao,
        mudou: resposta.mapa !== null,
        // null = a extensão já tem esta versão. Ela mantém o mapa em cache.
        mapa: resposta.mapa,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (erro) {
    console.error("[api/ext/seletores]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}
