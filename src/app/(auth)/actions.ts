"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { criarTokenEmail, consumirTokenEmail } from "@/lib/auth/tokens";
import { criarSessao, encerrarSessao, encerrarTodasAsSessoes } from "@/lib/auth/sessoes";
import { bd } from "@/lib/db";
import { emailDeConfirmacao, emailDeRecuperacao } from "@/lib/email";
import { modoDemo } from "@/lib/env";
import { ROTA_POS_LOGIN } from "@/lib/rotas";
import { conferirSenha, gastarTempoDeConferencia, gerarHash } from "@/lib/senha";
import { consumirLimite } from "@/lib/dados/comum";
import { ipDoPedido } from "@/lib/rede";
import { headers } from "next/headers";

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

/**
 * Teto de tentativas. Era o que o Supabase dava de graça e agora é nosso.
 *
 * Dois baldes de propósito: por origem, que barra o varredor; e por e-mail
 * alvo, que barra a força bruta distribuída contra uma conta específica —
 * botnet troca de IP, não troca de alvo.
 *
 * Importa mais aqui do que em API comum: cada tentativa de login custa uma
 * verificação Argon2id de 19 MiB, então o próprio custo que protege a senha
 * viraria a arma contra o servidor.
 */
async function dentroDoLimite(acao: string, alvo: string, teto: number, janelaS: number) {
  const ip = ipDoPedido(await headers()) ?? "sem-ip";
  const [porOrigem, porAlvo] = await Promise.all([
    consumirLimite(`${acao}:ip:${ip}`, teto * 2, janelaS),
    consumirLimite(`${acao}:alvo:${alvo.toLowerCase()}`, teto, janelaS),
  ]);
  return porOrigem && porAlvo;
}

const EXCESSO = "Muitas tentativas. Espere alguns minutos e tente de novo.";

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
  if (!parsed.success) {
    return { erro: primeiroErro(parsed.error), campos: { email: dados.email } };
  }

  if (!(await dentroDoLimite("login", dados.email, 10, 900))) {
    return { erro: EXCESSO, campos: { email: dados.email } };
  }

  if (modoDemo) {
    if (dados.senha.length < SENHA_MINIMA) {
      return { erro: `A senha precisa de ao menos ${SENHA_MINIMA} caracteres`, campos: dados };
    }
    const { entrarDemo } = await import("@/lib/demo");
    await entrarDemo(dados.email.split("@")[0]!);
    redirect(proximo);
  }

  const linhas = await bd()<{ id: string; senha_hash: string }[]>`
    select id, senha_hash from perfis where lower(email) = lower(${dados.email})
  `;
  const perfil = linhas[0];

  // Mensagem e tempo de resposta iguais nos dois casos: dizer "este e-mail não
  // existe" — ou só responder mais rápido — entrega a lista de clientes.
  if (!perfil) {
    await gastarTempoDeConferencia(dados.senha);
    return { erro: "E-mail ou senha incorretos", campos: { email: dados.email } };
  }

  if (!(await conferirSenha(perfil.senha_hash, dados.senha))) {
    return { erro: "E-mail ou senha incorretos", campos: { email: dados.email } };
  }

  await criarSessao(perfil.id);
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

  if (!(await dentroDoLimite("cadastro", dados.email, 5, 3600))) {
    return {
      erro: EXCESSO,
      campos: { nome: dados.nome, usuario: dados.usuario, email: dados.email },
    };
  }

  if (modoDemo) {
    const { entrarDemo } = await import("@/lib/demo");
    await entrarDemo(dados.usuario, dados.nome);
    redirect(ROTA_POS_LOGIN);
  }

  const senhaHash = await gerarHash(dados.senha);

  let perfilId: string;
  try {
    // A função resolve colisão de @usuario e gera o código de indicação numa
    // transação só — ver db/migrations/0001.
    const linhas = await bd()<{ id: string }[]>`
      select id from criar_perfil(
        ${dados.email}, ${senhaHash}, ${dados.nome}, ${dados.usuario}, ${dados.ref ?? null}
      )
    `;
    perfilId = linhas[0]!.id;
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    if (detalhe.includes("perfis_email_unico")) {
      return {
        erro: "Já existe uma conta com este e-mail",
        campos: { nome: dados.nome, usuario: dados.usuario, email: dados.email },
      };
    }
    throw erro;
  }

  // O envio pode não sair (sem provedor configurado). O cadastro não depende
  // disso: a conta entra, e a confirmação fica pendente.
  const token = await criarTokenEmail(perfilId, "verificacao");
  await emailDeConfirmacao(dados.email, token);

  await criarSessao(perfilId);

  // Conta nova vai para o tour, e nao para /inicio: o aviso de risco de
  // automacao e o funcionamento do credito precisam ser lidos ANTES da
  // primeira geracao. Quem ja tem conta continua caindo em ROTA_POS_LOGIN.
  redirect("/bem-vindo");
}

export async function solicitarRecuperacao(
  _anterior: EstadoForm,
  formData: FormData,
): Promise<EstadoForm> {
  const email = String(formData.get("email") ?? "").trim();
  if (!z.email().safeParse(email).success) return { erro: "E-mail inválido" };

  // Mesmo estourando o teto, a resposta final é a genérica de sempre — dizer
  // "muitas tentativas" só para e-mail existente viraria um oráculo de conta.
  const podeSeguir = await dentroDoLimite("recuperacao", email, 5, 3600);

  if (!modoDemo && podeSeguir) {
    const linhas = await bd()<{ id: string }[]>`
      select id from perfis where lower(email) = lower(${email})
    `;
    const perfil = linhas[0];
    if (perfil) {
      const token = await criarTokenEmail(perfil.id, "recuperacao");
      await emailDeRecuperacao(email, token);
    }
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
  const token = String(formData.get("token") ?? "");
  const senha = String(formData.get("senha") ?? "");
  const confirmacao = String(formData.get("confirmacao") ?? "");

  if (senha.length < SENHA_MINIMA) {
    return { erro: `A senha precisa de ao menos ${SENHA_MINIMA} caracteres` };
  }
  if (senha !== confirmacao) return { erro: "As senhas não conferem" };

  if (modoDemo) return { mensagem: "Senha redefinida (modo demo)." };

  if (!token) return { erro: "Link inválido. Peça um novo e-mail de redefinição." };

  const perfilId = await consumirTokenEmail("recuperacao", token);
  if (!perfilId) {
    return { erro: "O link expirou ou já foi usado. Peça um novo." };
  }

  const senhaHash = await gerarHash(senha);

  // Quem recebeu o e-mail provou que o endereço é dele.
  await bd()`
    update perfis
       set senha_hash = ${senhaHash},
           email_verificado_em = coalesce(email_verificado_em, now())
     where id = ${perfilId}
  `;

  // Trocar a senha derruba tudo: se alguém tinha o cookie, perde agora.
  await encerrarTodasAsSessoes(perfilId);

  return { mensagem: "Senha alterada. Entre com a nova senha." };
}

export async function sair() {
  if (modoDemo) {
    const { sairDemo } = await import("@/lib/demo");
    await sairDemo();
  } else {
    await encerrarSessao();
  }
  redirect("/login");
}
