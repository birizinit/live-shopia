import { NextResponse, type NextRequest } from "next/server";
import { bd } from "@/lib/db";
import { conferirSenha, gastarTempoDeConferencia } from "@/lib/senha";
import { dentroDoLimite, emitirLicenca, origemDaRequisicao } from "@/lib/dados/extensao";
import { ErroDominio } from "@/lib/dados/erros";
import { modoDemo } from "@/lib/env";

/**
 * POST /api/ext/entrar — login direto no painel lateral da extensão.
 *
 * Corpo: { login, senha } — `login` aceita e-mail ou @usuario.
 *
 * Devolve um token de licença NOVO: emitir é rotacionar (`emitir_licenca_ext`
 * faz upsert por perfil), então entrar numa máquina desliga a extensão da
 * máquina anterior. É a regra "1 conta = 1 dispositivo" sem precisar de uma
 * trava separada — e é o mesmo efeito de "Gerar novo código" no painel.
 *
 * A senha nunca fica na extensão: ela troca por token aqui e esquece.
 */

export const dynamic = "force-dynamic";

/** Mesmos tetos do login do site: cada tentativa custa um Argon2id. */
const TETO_POR_ALVO = 10;
const TETO_POR_ORIGEM = 20;
const JANELA_S = 900;

const ERRO_CREDENCIAL = "E-mail ou senha incorretos.";

export async function POST(request: NextRequest) {
  if (modoDemo) {
    return NextResponse.json(
      { ok: false, erro: "modo_demo", detalhe: "Servidor em modo demonstração, sem banco." },
      { status: 503 },
    );
  }

  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const login = typeof corpo?.login === "string" ? corpo.login.trim().slice(0, 200) : "";
  const senha = typeof corpo?.senha === "string" ? corpo.senha.slice(0, 200) : "";

  if (!login || !senha) {
    return NextResponse.json(
      { ok: false, erro: "dado_invalido", detalhe: "Preencha e-mail e senha." },
      { status: 400 },
    );
  }

  const origem = origemDaRequisicao(request.headers);

  try {
    const [porOrigem, porAlvo] = await Promise.all([
      dentroDoLimite(`ext:entrar:ip:${origem}`, TETO_POR_ORIGEM, JANELA_S),
      dentroDoLimite(`ext:entrar:alvo:${login.toLowerCase()}`, TETO_POR_ALVO, JANELA_S),
    ]);
    if (!porOrigem || !porAlvo) {
      return NextResponse.json(
        { ok: false, erro: "limite_excedido", detalhe: "Muitas tentativas. Espere alguns minutos." },
        { status: 429, headers: { "retry-after": String(JANELA_S) } },
      );
    }

    const semArroba = login.replace(/^@/, "");
    const linhas = await bd()<{ id: string; senha_hash: string; nome: string; usuario: string }[]>`
      select id, senha_hash, nome, usuario
        from perfis
       where lower(email) = lower(${login}) or lower(usuario) = lower(${semArroba})
       limit 1
    `;
    const perfil = linhas[0];

    // Mesma resposta e mesmo tempo nos dois casos, como no login do site.
    if (!perfil) {
      await gastarTempoDeConferencia(senha);
      return NextResponse.json({ ok: false, erro: "credencial", detalhe: ERRO_CREDENCIAL }, { status: 401 });
    }
    if (!(await conferirSenha(perfil.senha_hash, senha))) {
      return NextResponse.json({ ok: false, erro: "credencial", detalhe: ERRO_CREDENCIAL }, { status: 401 });
    }

    const { token } = await emitirLicenca(perfil.id);

    return NextResponse.json(
      { ok: true, token, usuario: { nome: perfil.nome, usuario: perfil.usuario } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (erro) {
    if (erro instanceof ErroDominio) {
      return NextResponse.json({ ok: false, erro: erro.codigo, detalhe: erro.message }, { status: 400 });
    }
    console.error("[api/ext/entrar]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}
