import "server-only";
import { cookies } from "next/headers";
import { modoDemo } from "./env";
import { ehPapel, type Papel } from "./roles";
import type { Usuario } from "./sessao";

/**
 * MODO DEMO — só existe para a interface poder ser vista e navegada antes de
 * haver um projeto Supabase. Não é autenticação: o cookie não é assinado e
 * qualquer um pode forjá-lo. Fica desligado em produção (ver src/lib/env.ts).
 */

const COOKIE = "shopia_demo";

export const CONTAS_DEMO: readonly { usuario: string; nome: string; papel: Papel }[] = [
  { usuario: "demo", nome: "Ana Demo", papel: "user" },
  { usuario: "afiliado", nome: "Bruno Afiliado", papel: "affiliate" },
  { usuario: "gerente", nome: "Carla Gerente", papel: "manager" },
];

/**
 * UUIDs fixos. O id da sessão demo entra em `where perfil_id = $1` de dezenas
 * de consultas; um id que não é uuid estoura 22P02 e quebra a tela em vez de
 * mostrar exemplo — que é justamente o que o modo demo existe para evitar.
 */
const IDS_DEMO: Record<string, string> = {
  demo: "00000000-0000-4000-8000-000000000001",
  afiliado: "00000000-0000-4000-8000-000000000002",
  gerente: "00000000-0000-4000-8000-000000000003",
};

function montar(usuario: string, nome: string, papel: Papel): Usuario {
  return {
    id: IDS_DEMO[usuario] ?? "00000000-0000-4000-8000-0000000000ff",
    email: `${usuario}@shopia.demo`,
    nome,
    usuario,
    papel,
    plano: papel === "user" ? "Copy Live" : "Premium",
    creditos: papel === "user" ? 1_000 : 40_000,
    emailVerificado: true,
    demo: true,
  };
}

export async function usuarioDemo(): Promise<Usuario | null> {
  if (!modoDemo) return null;
  const bruto = (await cookies()).get(COOKIE)?.value;
  if (!bruto) return null;

  try {
    const dados = JSON.parse(Buffer.from(bruto, "base64url").toString("utf8"));
    if (!ehPapel(dados?.papel) || typeof dados?.usuario !== "string") return null;
    return montar(dados.usuario, dados.nome ?? dados.usuario, dados.papel);
  } catch {
    return null;
  }
}

export async function entrarDemo(usuario: string, nome?: string) {
  const conta =
    CONTAS_DEMO.find((c) => c.usuario === usuario.toLowerCase()) ??
    ({ usuario: usuario.toLowerCase(), nome: nome ?? usuario, papel: "user" } as const);

  const valor = Buffer.from(
    JSON.stringify({ usuario: conta.usuario, nome: nome ?? conta.nome, papel: conta.papel }),
  ).toString("base64url");

  (await cookies()).set(COOKIE, valor, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function sairDemo() {
  (await cookies()).delete(COOKIE);
}
