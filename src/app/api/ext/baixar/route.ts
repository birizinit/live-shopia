import { NextResponse, type NextRequest } from "next/server";
import {
  autenticarLicenca,
  conferirTicket,
  dentroDoLimite,
  downloadPeloNavegadorLigado,
  origemDaRequisicao,
  pacoteDaVersao,
  tokenDoCabecalho,
} from "@/lib/dados/extensao";
import { modoDemo } from "@/lib/env";

/**
 * GET /api/ext/baixar — serve o ZIP da extensão.
 *
 * Dois chamadores, duas provas de identidade, nenhuma delas sessão de
 * navegador:
 *
 *  · a própria extensão, para autoatualizar — `Authorization: Bearer shpx_…`;
 *  · o cliente clicando no painel — `?t=<ticket>`, um HMAC de 15 minutos
 *    emitido no render da página. Um `<a href>` não manda cabeçalho, e pôr o
 *    token da licença na URL o deixaria no histórico, no log do proxy e no
 *    Referer — o token vale por sete dias, o ticket por quinze minutos e só
 *    serve para baixar.
 *
 * Quando não há pacote publicado a resposta é 404 com motivo, nunca um arquivo
 * vazio: a página lê isso e diz que o pacote ainda não existe, em vez de
 * oferecer um botão que baixa nada.
 */

export const dynamic = "force-dynamic";

const TETO_POR_PERFIL = 10;
const TETO_POR_ORIGEM = 30;
const JANELA_S = 300;

const VERSAO = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$/;

export async function GET(request: NextRequest) {
  if (modoDemo) {
    return NextResponse.json(
      {
        ok: false,
        erro: "modo_demo",
        detalhe: "Servidor em modo demonstração: não há pacote publicado.",
      },
      { status: 503 },
    );
  }

  const origem = origemDaRequisicao(request.headers);

  try {
    if (!(await dentroDoLimite(`ext:baixar:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) {
      return excedeu();
    }

    const parametros = request.nextUrl.searchParams;
    const pedida = parametros.get("versao")?.trim() || null;
    if (pedida && !VERSAO.test(pedida)) {
      return NextResponse.json({ ok: false, erro: "versao_invalida" }, { status: 400 });
    }

    const quem = await identificar(request, pedida);
    if (!quem) {
      return NextResponse.json(
        {
          ok: false,
          erro: "nao_autorizado",
          detalhe: downloadPeloNavegadorLigado
            ? "Apresente o token da licença ou um ticket válido."
            : "Sem EXTENSAO_SEGREDO no ambiente, o download pelo navegador está desligado.",
        },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      );
    }

    if (!(await dentroDoLimite(`ext:baixar:${quem.perfilId}`, TETO_POR_PERFIL, JANELA_S))) {
      return excedeu();
    }

    const pacote = await pacoteDaVersao(quem.perfilId, quem.versao);
    if (!pacote) {
      return NextResponse.json(
        {
          ok: false,
          erro: "sem_pacote",
          detalhe: "Nenhuma versão da extensão foi publicada com pacote até agora.",
        },
        { status: 404 },
      );
    }

    // Cópia para um Uint8Array comum: `Buffer` do Node carrega um ArrayBuffer
    // compartilhado do pool, e mandá-lo direto como corpo arrisca servir bytes
    // vizinhos se alguém fatiar o buffer depois.
    const corpo = new Uint8Array(pacote.conteudo);

    return new NextResponse(corpo, {
      headers: {
        "content-type": pacote.mime || "application/zip",
        "content-length": String(pacote.bytes),
        "content-disposition": `attachment; filename="shopia-extensao-${pacote.versao}.zip"`,
        // Pacote é por licença e o ticket expira: cache intermediário aqui
        // serviria o arquivo para quem não provou nada.
        "cache-control": "private, no-store",
        "x-shopia-versao": pacote.versao,
      },
    });
  } catch (erro) {
    console.error("[api/ext/baixar]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}

/** Ticket do navegador ou token da extensão. Nesta ordem: o ticket é mais estreito. */
async function identificar(
  request: NextRequest,
  pedida: string | null,
): Promise<{ perfilId: string; versao: string | null } | null> {
  const ticket = conferirTicket(request.nextUrl.searchParams.get("t"));
  if (ticket) return { perfilId: ticket.perfilId, versao: ticket.versao };

  const licenca = await autenticarLicenca(tokenDoCabecalho(request.headers));
  // Licença vencida ou revogada não baixa versão nova: atualizar é operar.
  if (!licenca || licenca.estado !== "ativa") return null;

  return { perfilId: licenca.perfilId, versao: pedida };
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}
