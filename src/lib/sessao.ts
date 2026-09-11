import "server-only";
import { redirect } from "next/navigation";
import { modoDemo } from "./env";
import { temPapel, type Papel } from "./roles";

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
    redirect(destino ? `/login?proximo=${encodeURIComponent(destino)}` : "/login");
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
