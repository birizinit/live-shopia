"use server";

import { criarCobranca, listarPlanos } from "@/lib/dados/planos";
import { ErroDominio } from "@/lib/dados/erros";
import { exigirUsuario } from "@/lib/sessao";

/**
 * Assinar um plano.
 *
 * Hoje esta action nunca chega ao fim: `criarCobranca` lanca enquanto nao
 * houver gateway (PLANO.md §9.1). Ela existe assim mesmo, e o formulario da
 * tela aponta para ela, porque o botao desabilitado e uma trava de interface —
 * um POST forjado passa por cima dele. Quem recusa de verdade e o servidor.
 */
export async function assinar(formData: FormData): Promise<void> {
  const usuario = await exigirUsuario("/planos");

  // O id vem do formulario, entao e do cliente: so vale depois de ser
  // reencontrado no catalogo ativo. Sem esta conferencia, plano desativado
  // (ou id qualquer) viraria cobranca.
  const planoId = String(formData.get("planoId") ?? "");
  const plano = (await listarPlanos()).find((p) => p.id === planoId);

  if (!plano) {
    throw new ErroDominio("nao_encontrado", "Este plano não está mais no catálogo.");
  }

  await criarCobranca(usuario.id, { tipo: "assinatura", planoId: plano.id });
}
