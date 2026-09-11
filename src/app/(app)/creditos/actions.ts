"use server";

import { criarCobranca, listarPacotes } from "@/lib/dados/planos";
import { ErroDominio } from "@/lib/dados/erros";
import { exigirUsuario } from "@/lib/sessao";

/**
 * Comprar um pacote avulso.
 *
 * Hoje esta action nunca chega ao fim: `criarCobranca` lanca enquanto nao
 * houver gateway (PLANO.md §9.1). Ela existe assim mesmo, e o formulario da
 * tela aponta para ela, porque o botao desabilitado e uma trava de interface —
 * um POST forjado passa por cima dele. Quem recusa de verdade e o servidor.
 */
export async function comprar(formData: FormData): Promise<void> {
  const usuario = await exigirUsuario("/creditos");

  // O id vem do formulario, entao e do cliente: so vale depois de ser
  // reencontrado no catalogo ativo. Pacote desativado nao volta a vender por
  // causa de uma aba velha aberta.
  const pacoteId = String(formData.get("pacoteId") ?? "");
  const pacote = (await listarPacotes()).find((p) => p.id === pacoteId);

  if (!pacote) {
    throw new ErroDominio("nao_encontrado", "Este pacote não está mais à venda.");
  }

  await criarCobranca(usuario.id, { tipo: "creditos", pacoteId: pacote.id });
}
