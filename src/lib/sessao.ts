import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { modoDemo } from "./env";
import { temPapel, type Papel } from "./roles";

/** O mesmo nome de auth/sessoes.ts — repetido para não carregar o banco aqui. */
const COOKIE_SESSAO = "shopia_sessao";

export type Usuario = {
  id: string;
  email: string;
  nome: string;
  usuario: string;
  papel: Papel;
  plano: string | null;
  creditos: number;
  emailVerificado: boolean;
  /** true quando a sessão vem do modo demo, não do banco. */
  demo?: boolean;
};

/**
 * Quem está pedindo. `null` quando não há sessão.
 *
 * O papel vem da tabela `perfis`, lido do banco a cada requisição — nunca de
 * um claim de token. É a correção direta do "flag admin dentro do JWT"
 * apontado em docs/PLANO.md §1.
 */
export async function obterUsuario(): Promise<Usuario | null> {
  if (modoDemo) {
    const { usuarioDemo } = await import("./demo");
    return usuarioDemo();
  }

  const { usuarioDaSessao } = await import("./auth/sessoes");
  return usuarioDaSessao();
}

export async function exigirUsuario(destino?: string): Promise<Usuario> {
  const usuario = await obterUsuario();
  if (!usuario) {
    const params = new URLSearchParams();
    if (destino) params.set("proximo", destino);
    // Cookie presente mas sessão inválida (expirou, revogada, senha trocada):
    // o proxy manda quem tem cookie de /login para /inicio, e /inicio manda de
    // volta para /login — o navegador desiste com "redirecionamentos demais".
    // Com `expirou`, o proxy apaga o cookie morto em vez de redirecionar.
    if (!modoDemo && (await cookies()).has(COOKIE_SESSAO)) params.set("expirou", "1");
    const query = params.toString();
    redirect(query ? `/login?${query}` : "/login");
  }
  return usuario;
}

/**
 * Guard de papel do lado do servidor. O proxy não checa papel de propósito:
 * papel mora no banco, e o proxy não deve consultar banco a cada requisição.
 */
export async function exigirPapel(exigidos: readonly Papel[]): Promise<Usuario> {
  const usuario = await exigirUsuario();
  if (!temPapel(usuario.papel, exigidos)) redirect("/perfil");
  return usuario;
}
