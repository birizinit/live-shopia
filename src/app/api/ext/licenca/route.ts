import { NextResponse, type NextRequest } from "next/server";
import {
  ALVO_PADRAO,
  autenticarLicenca,
  chatDesligadoNaBase,
  dentroDoLimite,
  origemDaRequisicao,
  paradaForcada,
  registrarContato,
  renovarSeAssinaturaAtiva,
  tokenDoCabecalho,
  versaoPara,
} from "@/lib/dados/extensao";
import { configuracao } from "@/lib/dados/comum";
import { ErroDominio } from "@/lib/dados/erros";
import { modoDemo } from "@/lib/env";

/**
 * GET /api/ext/licenca — o heartbeat da extensão.
 *
 * É a única chamada que a extensão precisa fazer para saber tudo: se ainda
 * pode operar, o que o plano libera, qual versão deveria estar rodando, se
 * precisa PARAR agora e se o mapa de seletores mudou.
 *
 * Sem sessão de navegador, de propósito: a extensão roda numa aba do TikTok e
 * não tem — nem deve ter — o cookie do painel. A identidade é o token da
 * licença, no cabeçalho.
 *
 * Cabeçalho: `Authorization: Bearer shpx_…` (ou `X-Shopia-Licenca`).
 * Query: instalacao, versao, mapa, sistema, navegador.
 */

export const dynamic = "force-dynamic";

/** Um pouco acima do heartbeat padrão (120s), para caber retentativa. */
const TETO_POR_LICENCA = 60;
const TETO_POR_ORIGEM = 240;
const JANELA_S = 60;

const CHAVE_INSTALACAO = /^[A-Za-z0-9._-]{8,128}$/;
const VERSAO = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$/;

function texto(valor: string | null, limite: number) {
  const limpo = valor?.trim();
  return limpo ? limpo.slice(0, limite) : null;
}

function inteiro(valor: string | null) {
  if (!valor) return null;
  const n = Number.parseInt(valor, 10);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export async function GET(request: NextRequest) {
  if (modoDemo) {
    // Sem banco não há licença nenhuma. Dizer "ok" aqui faria a extensão
    // acreditar que está licenciada — exatamente o tipo de simulação que o
    // projeto não faz.
    return NextResponse.json(
      { ok: false, erro: "modo_demo", detalhe: "Servidor em modo demonstração, sem banco." },
      { status: 503 },
    );
  }

  const origem = origemDaRequisicao(request.headers);

  try {
    // Teto por origem ANTES de tocar na licença: quem manda token inválido em
    // rajada nunca chega a ter licença e, sem isto, nunca seria barrado.
    if (!(await dentroDoLimite(`ext:licenca:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) {
      return excedeu();
    }

    const licenca = await autenticarLicenca(tokenDoCabecalho(request.headers));
    if (!licenca) {
      return NextResponse.json(
        { ok: false, erro: "token_invalido" },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      );
    }

    if (!(await dentroDoLimite(`ext:licenca:${licenca.licencaId}`, TETO_POR_LICENCA, JANELA_S))) {
      return excedeu();
    }

    if (licenca.estado === "revogada") {
      return NextResponse.json(
        { ok: false, erro: "revogada", motivo: licenca.revogadaMotivo },
        { status: 403 },
      );
    }

    const parametros = request.nextUrl.searchParams;
    const versaoAtual = texto(parametros.get("versao"), 12);
    const versaoValida = versaoAtual && VERSAO.test(versaoAtual) ? versaoAtual : null;

    if (licenca.estado === "expirada") {
      return NextResponse.json(
        {
          ok: false,
          erro: "expirada",
          expiraEm: licenca.expiraEm,
          pararAgora: true,
          detalhe: "A janela de graça acabou. Abra o painel e confira a assinatura.",
        },
        { status: 403 },
      );
    }

    const gracaDias = await configuracao("ext.licenca_graca_dias", 7);

    const [versao, parada, chatDesligado, expiraEm, heartbeat] = await Promise.all([
      versaoPara(licenca.licencaId, versaoValida),
      // O kill switch vale para a versão que a extensão JÁ roda, não para a que
      // deveria rodar: mandar parar não pode depender de existir versão nova
      // para onde ir — e no dia em que a extensão derruba a conta do cliente,
      // é exatamente esse o caso.
      paradaForcada(versaoValida),
      chatDesligadoNaBase(),
      renovarSeAssinaturaAtiva(licenca.perfilId, gracaDias),
      configuracao("ext.heartbeat_segundos", 120),
    ]);

    // Registrar a máquina é opcional: a extensão manda a chave a partir do
    // segundo contato dela. Sem chave a resposta continua válida — o que se
    // perde é o denominador do alerta de quebra, não a licença.
    const chaveInstalacao = texto(parametros.get("instalacao"), 128);
    const instalacao =
      chaveInstalacao && CHAVE_INSTALACAO.test(chaveInstalacao) && versaoValida
        ? await registrarContato(licenca.licencaId, {
            instalacaoChave: chaveInstalacao,
            versao: versaoValida,
            userAgent: texto(request.headers.get("user-agent"), 500),
            sistema: texto(parametros.get("sistema"), 60),
            navegador: texto(parametros.get("navegador"), 60),
            mapaVersao: inteiro(parametros.get("mapa")),
          })
        : null;

    return NextResponse.json(
      {
        ok: true,
        licenca: {
          estado: "ativa",
          canal: licenca.canal,
          // A renovação só anda com assinatura ativa; sem ela, este prazo é o
          // fim da linha e a extensão precisa saber disso com antecedência.
          expiraEm: expiraEm ?? licenca.expiraEm,
          renovada: expiraEm !== null,
        },
        recursos: {
          ...licenca.recursos,
          mixer: licenca.mixer,
          // Dois freios independentes (PLANO.md §6): por conta, na licença; na
          // base inteira, em `configuracoes`. Nenhum dos dois toca o mixer.
          chat: licenca.chat && licenca.recursos.chat && !chatDesligado,
          chatDesligadoNaBase: chatDesligado,
        },
        versao: versao
          ? {
              publicada: versao.versao,
              canal: versao.canal,
              obrigatoria: versao.obrigatoria,
              notas: versao.notas,
              temPacote: versao.temPacote,
              baixar: versao.temPacote ? "/api/ext/baixar" : null,
            }
          : null,
        // Sobre a versão que ela tem agora, não sobre a que deveria ter.
        pararAgora: parada.parar,
        pararMotivo: parada.motivo,
        mapa: { alvo: ALVO_PADRAO, buscarEm: "/api/ext/seletores" },
        instalacao,
        heartbeatSegundos: Math.round(heartbeat),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (erro) {
    return falhou(erro);
  }
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}

function falhou(erro: unknown) {
  // A licença pode ter sido revogada entre a autenticação e o heartbeat: a
  // função do banco levanta 28000 e `registrarContato` traduz para domínio.
  // Isso é 403, não indisponibilidade nossa.
  if (erro instanceof ErroDominio && erro.codigo === "sem_permissao") {
    return NextResponse.json({ ok: false, erro: "revogada" }, { status: 403 });
  }
  console.error("[api/ext/licenca]", erro);
  return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
}
