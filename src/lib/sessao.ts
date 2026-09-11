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
  /** true quando a sessão vem do modo demo, não do Supabase. */
  demo?: boolean;
};

/**
 * Quem está pedindo. `null` quando não há sessão.
 *
 * O papel vem da tabela `perfis`, lido do banco a cada requisição sob RLS —
 * nunca de um claim do token. É a correção direta do "flag admin dentro do
 * JWT" apontado em docs/PLANO.md §1.
 */
export async function obterUsuario(): Promise<Usuario | null> {
  if (modoDemo) {
    const { usuarioDemo } = await import("./demo");
    return usuarioDemo();
  }

  const { clienteServidor } = await import("./supabase/server");
  const supabase = await clienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Sem tipos gerados do banco (`supabase gen types`), o cliente infere
  // `never` para as colunas. Os tipos locais abaixo saem quando o schema
  // gerado entrar no repositório.
  type LinhaPerfil = {
    nome: string | null;
    usuario: string | null;
    papel: Papel | null;
    creditos: number | null;
  };

  const { data: dadosPerfil } = await supabase
    .from("perfis")
    .select("nome, usuario, papel, creditos")
    .eq("id", user.id)
    .maybeSingle();

  const perfil = dadosPerfil as unknown as LinhaPerfil | null;
  if (!perfil) return null;

  const { data: dadosAssinatura } = await supabase
    .from("assinaturas")
    .select("plano:planos(nome)")
    .eq("perfil_id", user.id)
    .eq("status", "ativa")
    .maybeSingle();

  const assinatura = dadosAssinatura as unknown as {
    plano: { nome: string } | null;
  } | null;

  return {
    id: user.id,
    email: user.email ?? "",
    nome: perfil.nome ?? "",
    usuario: perfil.usuario ?? "",
    papel: perfil.papel ?? "user",
    plano: assinatura?.plano?.nome ?? null,
    creditos: perfil.creditos ?? 0,
  };
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
 * papel mora no banco, e o proxy não deve consultar banco a cada request.
 */
export async function exigirPapel(exigidos: readonly Papel[]): Promise<Usuario> {
  const usuario = await exigirUsuario();
  if (!temPapel(usuario.papel, exigidos)) redirect("/perfil");
  return usuario;
}
