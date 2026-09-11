import "server-only";
import { bd } from "@/lib/db";

/**
 * Faxina periodica.
 *
 * Reune tudo que as migracoes deixaram a cargo deste job: expirar cobranca e
 * convite vencidos, fechar live que a extensao abandonou, podar telemetria
 * antiga e remover sessao, token e arquivo orfao.
 *
 * Cada rotina roda isolada: uma funcao que ainda nao existe (ou que falhou)
 * nao pode impedir as outras de rodarem, senao a primeira quebra desliga a
 * manutencao inteira em silencio.
 */
const ROTINAS: { nome: string; sql: string }[] = [
  { nome: "lives_caidas", sql: "select marcar_lives_caidas(config_num('live.batimento_segundos', 90)::int)" },
  { nome: "pagamentos_expirados", sql: "select expirar_pagamentos()" },
  { nome: "convites_expirados", sql: "select expirar_convites_gerente()" },
  {
    nome: "telemetria_podada",
    sql: `delete from ext_telemetria
           where criado_em < now() - make_interval(days => config_num('ext.telemetria_retencao_dias', 30)::int)`,
  },
  {
    nome: "sessoes",
    sql: `delete from sessoes
           where expira_em < now() - interval '30 days'
              or (revogada_em is not null and revogada_em < now() - interval '30 days')`,
  },
  { nome: "tokens", sql: "delete from tokens_email where expira_em < now() - interval '7 days'" },
  { nome: "limites", sql: "delete from limites_acesso where janela_em < now() - interval '1 day'" },
  {
    nome: "arquivos_orfaos",
    sql: `update arquivos
             set estado = 'removido', removido_em = now(), conteudo = null
           where estado = 'pendente' and criado_em < now() - interval '1 day'`,
  },
];

export async function executarFaxina() {
  const resumo: Record<string, number | string> = {};

  for (const rotina of ROTINAS) {
    try {
      const linhas = await bd().unsafe(rotina.sql);
      resumo[rotina.nome] = linhas.count ?? linhas.length ?? 0;
    } catch (erro) {
      resumo[rotina.nome] = `falhou: ${erro instanceof Error ? erro.message : "?"}`;
    }
  }

  return resumo;
}
