import "server-only";
import { bd } from "@/lib/db";
import { comoJson } from "@/lib/dados/comum";
import { bancoConfigurado, env } from "@/lib/env";

/**
 * Promove a admin as contas listadas em SHOPIA_ADMINS.
 *
 * O ovo e a galinha: /admin só abre para admin, e banco novo não tem nenhum.
 * A saída óbvia — UPDATE manual em produção — é justamente o que a tela de
 * operação existe para substituir, então a promoção inicial tinha que ter um
 * caminho próprio.
 *
 * Roda a cada boot porque a conta pode ser criada DEPOIS da variável existir:
 * quem põe o e-mail na Railway antes de se cadastrar seria promovido nunca.
 * É idempotente (só toca em quem ainda não é admin) e grava na auditoria.
 *
 * Só promove; nunca rebaixa. Tirar o e-mail da variável não tira o papel —
 * rebaixar é ato deliberado, feito pela tela, com quem fez registrado.
 */
export async function promoverAdminsIniciais() {
  if (!bancoConfigurado || env.adminsIniciais.length === 0) return;

  const promovidos = await bd()<{ id: string; email: string }[]>`
    update perfis
       set papel = 'admin'
     where lower(email) = any(${env.adminsIniciais})
       and papel <> 'admin'
    returning id, email
  `;

  for (const p of promovidos) {
    await bd()`
      -- ator_id nulo de propósito: quem promoveu não foi uma pessoa, foi a
      -- configuração do serviço. Registrar o próprio promovido como ator seria
      -- escrever na trilha que ele se promoveu sozinho, o que é falso.
      insert into auditoria (perfil_id, acao, entidade, entidade_id, antes, depois)
      values (${p.id}, 'papel_alterado', 'perfis', ${p.id},
              ${comoJson({ papel: "user" })},
              ${comoJson({ papel: "admin", por: "SHOPIA_ADMINS" })})
    `;
    console.log(`[admin-inicial] ${p.email} promovido a admin`);
  }
}
