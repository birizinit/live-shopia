import "server-only";
import { env } from "./env";

/**
 * Remetente plugável.
 *
 * Com RESEND_API_KEY, envia pelo Resend. Sem ela, escreve no log do servidor —
 * o que em desenvolvimento é suficiente (o link aparece no terminal) e em
 * produção deixa registro de que o envio não saiu, em vez de fingir que saiu.
 *
 * Nenhum chamador decide o que mostrar ao usuário com base no retorno: a
 * resposta de "esqueci a senha" é a mesma exista ou não a conta.
 */
type Mensagem = {
  para: string;
  assunto: string;
  texto: string;
};

export async function enviarEmail({ para, assunto, texto }: Mensagem) {
  if (!env.resendApiKey) {
    console.warn(
      `[email] sem RESEND_API_KEY — não enviado.\n  para: ${para}\n  assunto: ${assunto}\n${texto}`,
    );
    return { enviado: false } as const;
  }

  try {
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.emailRemetente,
        to: [para],
        subject: assunto,
        text: texto,
      }),
    });

    if (!resposta.ok) {
      console.error("[email] Resend recusou:", resposta.status, await resposta.text());
      return { enviado: false } as const;
    }

    return { enviado: true } as const;
  } catch (erro) {
    console.error("[email] falha no envio:", erro);
    return { enviado: false } as const;
  }
}

export function emailDeConfirmacao(para: string, token: string) {
  const link = `${env.siteUrl}/confirmar?token=${encodeURIComponent(token)}`;
  return enviarEmail({
    para,
    assunto: "Confirme seu e-mail na Shopia",
    texto: `Bem-vindo à Shopia.\n\nConfirme seu e-mail: ${link}\n\nO link vale por 24 horas.`,
  });
}

export function emailDeRecuperacao(para: string, token: string) {
  const link = `${env.siteUrl}/redefinir?token=${encodeURIComponent(token)}`;
  return enviarEmail({
    para,
    assunto: "Redefinir sua senha na Shopia",
    texto: `Para definir uma senha nova: ${link}\n\nO link vale por 1 hora. Se não foi você, ignore este e-mail.`,
  });
}
