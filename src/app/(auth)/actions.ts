"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { modoDemo, env } from "@/lib/env";
import { ROTA_POS_LOGIN } from "@/lib/rotas";

export type EstadoForm = {
  erro?: string;
  mensagem?: string;
  campos?: Record<string, string>;
};

const SENHA_MINIMA = 8;

const esquemaEntrar = z.object({
  email: z.string().min(1, "Informe o e-mail"),
  senha: z.string().min(1, "Informe a senha"),
});

const esquemaCadastro = z
  .object({
    nome: z.string().min(2, "Informe seu nome"),
    usuario: z
      .string()
      .min(3, "Mínimo de 3 caracteres")
      .max(24, "Máximo de 24 caracteres")
      .regex(/^[a-z0-9_.]+$/i, "Use apenas letras, números, ponto e _"),
    email: z.email("E-mail inválido"),
    senha: z.string().min(SENHA_MINIMA, `Mínimo de ${SENHA_MINIMA} caracteres`),
    confirmacao: z.string(),
    ref: z.string().optional(),
  })
  .refine((d) => d.senha === d.confirmacao, {
    path: ["confirmacao"],
    message: "As senhas não conferem",
  });

function primeiroErro(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? "Confira os dados informados";
}

function destinoSeguro(bruto: FormDataEntryValue | null): string {
  const valor = typeof bruto === "string" ? bruto : "";
  // Só caminho interno: "//evil.com" e "https://…" viram redirect aberto.
  return valor.startsWith("/") && !valor.startsWith("//") ? valor : ROTA_POS_LOGIN;
}

export async function entrar(
  _anterior: EstadoForm,
  formData: FormData,
): Promise<EstadoForm> {
  const dados = {
    email: String(formData.get("email") ?? "").trim(),
    senha: String(formData.get("senha") ?? ""),
  };
  const proximo = destinoSeguro(formData.get("proximo"));

  const parsed = esquemaEntrar.safeParse(dados);
  if (!parsed.success) return { erro: primeiroErro(parsed.error), campos: { email: dados.email } };

  if (modoDemo) {
    if (dados.senha.length < SENHA_MINIMA) {
      return { erro: `A senha precisa de ao menos ${SENHA_MINIMA} caracteres`, campos: dados };
    }
    const { entrarDemo } = await import("@/lib/demo");
    await entrarDemo(dados.email.split("@")[0]!);
    redirect(proximo);
  }

  const { clienteServidor } = await import("@/lib/supabase/server");
  const supabase = await clienteServidor();
  const { error } = await supabase.auth.signInWithPassword({
    email: dados.email,
    password: dados.senha,
  });

  // Mensagem genérica de propósito: dizer "e-mail não existe" entrega quais
  // contas existem para quem está testando lista de e-mails.
  if (error) return { erro: "E-mail ou senha incorretos", campos: { email: dados.email } };

  redirect(proximo);
}

export async function cadastrar(
  _anterior: EstadoForm,
  formData: FormData,
): Promise<EstadoForm> {
  const dados = {
    nome: String(formData.get("nome") ?? "").trim(),
    usuario: String(formData.get("usuario") ?? "").trim().toLowerCase(),
    email: String(formData.get("email") ?? "").trim(),
    senha: String(formData.get("senha") ?? ""),
    confirmacao: String(formData.get("confirmacao") ?? ""),
    ref: String(formData.get("ref") ?? "").trim() || undefined,
  };

  const parsed = esquemaCadastro.safeParse(dados);
  if (!parsed.success) {
    // Senha nunca volta para o formulário.
    return {
      erro: primeiroErro(parsed.error),
      campos: { nome: dados.nome, usuario: dados.usuario, email: dados.email },
    };
  }

  if (modoDemo) {
    const { entrarDemo } = await import("@/lib/demo");
    await entrarDemo(dados.usuario, dados.nome);
    redirect(ROTA_POS_LOGIN);
  }

  const { clienteServidor } = await import("@/lib/supabase/server");
  const supabase = await clienteServidor();
  const { error } = await supabase.auth.signUp({
    email: dados.email,
    password: dados.senha,
    options: {
      // Lido pelo trigger handle_new_user (supabase/migrations) para criar
      // a linha em `perfis`. Papel NUNCA vem daqui — o banco define "user".
      data: { nome: dados.nome, usuario: dados.usuario, ref: dados.ref ?? null },
      emailRedirectTo: `${env.siteUrl}/inicio`,
    },
  });

  if (error) {
    const duplicado = /already registered|already been registered/i.test(error.message);
    return {
      erro: duplicado ? "Já existe uma conta com este e-mail" : "Não foi possível criar a conta",
      campos: { nome: dados.nome, usuario: dados.usuario, email: dados.email },
    };
  }

  return {
    mensagem:
      "Conta criada. Confira seu e-mail para confirmar o endereço e já pode entrar.",
  };
}

export async function solicitarRecuperacao(
  _anterior: EstadoForm,
  formData: FormData,
): Promise<EstadoForm> {
  const email = String(formData.get("email") ?? "").trim();
  if (!z.email().safeParse(email).success) return { erro: "E-mail inválido" };

  if (!modoDemo) {
    const { clienteServidor } = await import("@/lib/supabase/server");
    const supabase = await clienteServidor();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${env.siteUrl}/redefinir`,
    });
  }

  // Resposta idêntica exista ou não a conta — senão isto vira um oráculo de
  // "este e-mail é cliente".
  return {
    mensagem: "Se houver conta com este e-mail, o link de redefinição chegou lá.",
  };
}

export async function redefinirSenha(
  _anterior: EstadoForm,
  formData: FormData,
): Promise<EstadoForm> {
  const senha = String(formData.get("senha") ?? "");
  const confirmacao = String(formData.get("confirmacao") ?? "");

  if (senha.length < SENHA_MINIMA) {
    return { erro: `A senha precisa de ao menos ${SENHA_MINIMA} caracteres` };
  }
  if (senha !== confirmacao) return { erro: "As senhas não conferem" };

  if (modoDemo) return { mensagem: "Senha redefinida (modo demo)." };

  const { clienteServidor } = await import("@/lib/supabase/server");
  const supabase = await clienteServidor();
  const { error } = await supabase.auth.updateUser({ password: senha });

  if (error) {
    return { erro: "O link expirou. Peça um novo e-mail de redefinição." };
  }

  redirect(ROTA_POS_LOGIN);
}

export async function sair() {
  if (modoDemo) {
    const { sairDemo } = await import("@/lib/demo");
    await sairDemo();
  } else {
    const { clienteServidor } = await import("@/lib/supabase/server");
    const supabase = await clienteServidor();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
