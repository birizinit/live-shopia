import "server-only";
import { bd } from "@/lib/db";
import { ErroDominio } from "@/lib/dados/erros";
import type { Contexto } from "../index";

/**
 * As duas pontas de comissão que já existem inteiras no banco (0008).
 *
 * O handler não calcula nada: quem decide valor, nível e teto é a função SQL,
 * que lê o pagamento confirmado e recusa o que não está pago. Aqui só se
 * acorda a função — é o que impede um erro de TypeScript virar comissão maior
 * que a venda.
 */
export async function executarComissao({ entrada }: Contexto) {
  const pagamentoId = String(entrada.pagamento_id ?? "");
  if (!pagamentoId) throw new ErroDominio("dado_invalido", "job de comissão sem pagamento");

  const linhas = await bd()<{ n: number }[]>`
    select count(*)::int as n from apurar_comissoes_do_pagamento(${pagamentoId})
  `;
  return { comissoes: linhas[0]?.n ?? 0 };
}

/** O D+30: comissão só vira saldo depois da janela de chargeback. */
export async function executarLiberacaoDeComissoes(_ctx: Contexto) {
  const linhas = await bd()<{ n: number }[]>`select liberar_comissoes() as n`;
  return { liberadas: linhas[0]?.n ?? 0 };
}
