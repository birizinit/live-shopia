import { NextResponse, type NextRequest } from "next/server";
import {
  autenticarLicenca,
  dentroDoLimite,
  origemDaRequisicao,
  tokenDoCabecalho,
} from "@/lib/dados/extensao";
import {
  LIMITES_AVISO,
  alternarAviso,
  ajustarIntervaloAviso,
  configAutomacoes,
  dispararAviso,
  garantirAutomacoesBasicas,
  listarAvisos,
  salvarAutomacoes,
} from "@/lib/dados/automacoes";
import { ErroDominio } from "@/lib/dados/erros";
import { modoDemo } from "@/lib/env";

/**
 * POST /api/ext/automacoes — os interruptores da live, do lado da extensão.
 *
 * -----------------------------------------------------------------------------
 * POR QUE A EXTENSÃO MEXE NISTO, E ATÉ ONDE
 *
 * O texto de um aviso se escreve com calma, no painel do site, onde dá para ler
 * inteiro e onde a revisão anti-restrição aponta o trecho problemático. Já o
 * INTERRUPTOR se aperta no meio da live, com a audiência chegando — e nessa
 * hora a mão da pessoa está na extensão, não numa aba que ela teria de ir
 * procurar.
 *
 * Então a divisão é por natureza, não por capricho:
 *
 *   escrever e revisar texto → só no site
 *   ligar, desligar, mudar intervalo, disparar agora → aqui também
 *
 * O que a extensão NÃO pode mexer, de propósito: o texto dos avisos (passaria
 * por cima da revisão de conteúdo) e o teto por minuto da cadência. O teto é a
 * única defesa real da conta do cliente contra bloqueio, e defesa que roda na
 * máquina de quem ela protege não é defesa — basta um bug para desligá-la.
 *
 * O piso de intervalo também é conferido AQUI (`salvarAutomacoes` e
 * `ajustarIntervaloAviso` limitam), e não na extensão: pedido vindo do cliente
 * não define o que o servidor aceita.
 * -----------------------------------------------------------------------------
 */

export const dynamic = "force-dynamic";

const TETO_POR_LICENCA = 120;
const TETO_POR_ORIGEM = 400;
const JANELA_S = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** As chaves que a extensão pode alternar. Lista fechada, não `keyof`. */
const INTERRUPTORES = [
  "refixarAtivo",
  "carrinhoAtivo",
  "vendaAtivo",
  "sinoAtivo",
] as const;

type Interruptor = (typeof INTERRUPTORES)[number];

function ehInterruptor(valor: unknown): valor is Interruptor {
  return typeof valor === "string" && (INTERRUPTORES as readonly string[]).includes(valor);
}

function uuidOuNulo(valor: unknown): string | null {
  return typeof valor === "string" && UUID.test(valor) ? valor : null;
}

export async function POST(request: NextRequest) {
  if (modoDemo) {
    return NextResponse.json({ ok: false, erro: "modo_demo" }, { status: 503 });
  }

  const origem = origemDaRequisicao(request.headers);

  try {
    if (!(await dentroDoLimite(`ext:auto:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) {
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
    if (!(await dentroDoLimite(`ext:auto:${licenca.licencaId}`, TETO_POR_LICENCA, JANELA_S))) {
      return excedeu();
    }

    const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const acao = typeof corpo?.acao === "string" ? corpo.acao : "ler";

    if (acao === "ler") {
      // Semeia aqui também: quem instala a extensão antes de abrir a tela do
      // site veria tudo vazio e concluiria que não funciona.
      await garantirAutomacoesBasicas(licenca.perfilId);

      const [config, avisos] = await Promise.all([
        configAutomacoes(licenca.perfilId),
        listarAvisos(licenca.perfilId),
      ]);
      return NextResponse.json({
        ok: true,
        config,
        avisos,
        limites: {
          intervaloMinS: LIMITES_AVISO.intervaloMinS,
          intervaloMaxS: LIMITES_AVISO.intervaloMaxS,
        },
      });
    }

    if (acao === "alternar") {
      if (!ehInterruptor(corpo?.chave)) {
        return NextResponse.json({ ok: false, erro: "chave_invalida" }, { status: 400 });
      }
      await salvarAutomacoes(licenca.perfilId, { [corpo.chave]: corpo?.valor === true });
      return NextResponse.json({ ok: true, config: await configAutomacoes(licenca.perfilId) });
    }

    if (acao === "intervalo") {
      // Só o do refixar: o dos avisos tem ação própria, porque é por aviso.
      const segundos = Number(corpo?.segundos);
      if (!Number.isSafeInteger(segundos)) {
        return NextResponse.json({ ok: false, erro: "segundos_invalido" }, { status: 400 });
      }
      await salvarAutomacoes(licenca.perfilId, { refixarIntervaloS: segundos });
      return NextResponse.json({ ok: true, config: await configAutomacoes(licenca.perfilId) });
    }

    if (acao === "posicao") {
      const posicao = Number(corpo?.posicao);
      if (!Number.isSafeInteger(posicao)) {
        return NextResponse.json({ ok: false, erro: "posicao_invalida" }, { status: 400 });
      }
      await salvarAutomacoes(licenca.perfilId, { refixarPosicao: posicao });
      return NextResponse.json({ ok: true, config: await configAutomacoes(licenca.perfilId) });
    }

    const avisoId = uuidOuNulo(corpo?.avisoId);

    if (acao === "aviso") {
      if (!avisoId) return NextResponse.json({ ok: false, erro: "aviso_invalido" }, { status: 400 });
      await alternarAviso(licenca.perfilId, avisoId, corpo?.ativo === true);
      return NextResponse.json({ ok: true, avisos: await listarAvisos(licenca.perfilId) });
    }

    if (acao === "aviso_intervalo") {
      if (!avisoId) return NextResponse.json({ ok: false, erro: "aviso_invalido" }, { status: 400 });
      const segundos = Number(corpo?.segundos);
      if (!Number.isSafeInteger(segundos)) {
        return NextResponse.json({ ok: false, erro: "segundos_invalido" }, { status: 400 });
      }
      await ajustarIntervaloAviso(licenca.perfilId, avisoId, segundos);
      return NextResponse.json({ ok: true, avisos: await listarAvisos(licenca.perfilId) });
    }

    /**
     * "Dispara este agora."
     *
     * Pula o intervalo, que é justamente o ponto: oferta relâmpago existe para
     * ser disparada no momento em que a pessoa decide. O que ele NÃO pula é o
     * teto por minuto — esse vale para tudo, inclusive para o que o vendedor
     * mandou de propósito, porque é ele que protege a conta.
     */
    if (acao === "disparar") {
      const sessaoId = uuidOuNulo(corpo?.sessaoId);
      if (!avisoId || !sessaoId) {
        return NextResponse.json({ ok: false, erro: "dado_invalido" }, { status: 400 });
      }
      const r = await dispararAviso(licenca.perfilId, sessaoId, avisoId);
      return NextResponse.json({ ok: true, ...r });
    }

    return NextResponse.json({ ok: false, erro: "acao_invalida" }, { status: 400 });
  } catch (erro) {
    if (erro instanceof ErroDominio) {
      return NextResponse.json({ ok: false, erro: erro.codigo, detalhe: erro.message }, { status: 400 });
    }
    console.error("[api/ext/automacoes]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}
