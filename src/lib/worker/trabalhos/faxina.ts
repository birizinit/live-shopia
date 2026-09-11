import "server-only";
import { bd } from "@/lib/db";

/**
 * Faxina periodica. Sem ela, sessao expirada, token usado e arquivo orfao
 * crescem para sempre — o que so incomoda quando ja incomoda muito.
 */
export async function executarFaxina() {
  const sql = bd();

  const sessoes = await sql`
    delete from sessoes
     where (expira_em < now() - interval '30 days')
        or (revogada_em is not null and revogada_em < now() - interval '30 days')
    returning 1
  `;

  const tokens = await sql`
    delete from tokens_email
     where expira_em < now() - interval '7 days'
    returning 1
  `;

  const limites = await sql`
    delete from limites_acesso where janela_em < now() - interval '1 day' returning 1
  `;

  // Arquivo que ficou 'pendente' e nunca virou bloco: upload interrompido.
  const orfaos = await sql`
    update arquivos
       set estado = 'removido', removido_em = now(), conteudo = null
     where estado = 'pendente' and criado_em < now() - interval '1 day'
    returning 1
  `;

  return {
    sessoes: sessoes.length,
    tokens: tokens.length,
    limites: limites.length,
    arquivos_orfaos: orfaos.length,
  };
}
