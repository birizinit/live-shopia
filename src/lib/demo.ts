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

function montar(usuario: string, nome: string, papel: Papel): Usuario {
  return {
    id: `demo-${usuario}`,
    email: `${usuario}@shopia.demo`,
    nome,
    usuario,
    papel,
    plano: papel === "user" ? "Copy Live" : "Premium",
    creditos: papel === "user" ? 1_000 : 40_000,
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
