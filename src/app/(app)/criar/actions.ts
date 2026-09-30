"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { contarCaracteres } from "@/lib/caracteres";
import { comecarCriacao } from "@/lib/dados/criacao";
import { ErroDominio } from "@/lib/dados/erros";
import { LIMITES_PRODUTO, type EntradaProduto } from "@/lib/dados/produtos";
import { centavosDe } from "@/lib/dinheiro";
import { modoDemo } from "@/lib/env";
import { exigirUsuario } from "@/lib/sessao";

/**
 * A ação do assistente: cadastrar o produto e seguir para o manual.
 *
 * Termina num `redirect` para a mesma página com o produto na URL. É isso que
 * faz recarregar, voltar ou abrir de novo cair onde a pessoa parou.
 */

export type EstadoCriar = {
  erro?: string;
  /** Campo que recusou o valor, para o formulário marcar. */
  campo?: string;
  codigo?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AVISO_DEMO =
  "Modo demonstração: nada é gravado aqui. Configure o banco para criar de verdade.";

function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function uuid(valor: FormDataEntryValue | null): string | null {
  const bruto = texto(valor);
  return UUID.test(bruto) ? bruto : null;
}

function mensagem(erro: unknown): EstadoCriar {
  if (erro instanceof ErroDominio) return { erro: erro.message, codigo: erro.codigo };
  console.error("[criar]", erro);
  return { erro: "Não foi possível concluir. Tente de novo." };
}

type LeituraProduto = { produto: EntradaProduto } | EstadoCriar;

function lerProduto(formData: FormData): LeituraProduto {
  const nome = texto(formData.get("nome"));
  if (contarCaracteres(nome) < 2) {
    return { erro: "Diga o nome do produto.", campo: "nome" };
  }
  if (contarCaracteres(nome) > LIMITES_PRODUTO.nome) {
    return { erro: `O nome passa de ${LIMITES_PRODUTO.nome} caracteres.`, campo: "nome" };
  }

  const descricao = texto(formData.get("descricao"));
  if (contarCaracteres(descricao) > LIMITES_PRODUTO.descricao) {
    return {
      erro: `A descrição passa de ${LIMITES_PRODUTO.descricao} caracteres.`,
      campo: "descricao",
    };
  }

  const preco = centavosDe(texto(formData.get("preco")));
  if (preco === "invalido") return { erro: "Preço inválido. Use algo como 89,90.", campo: "preco" };

  const precoDe = centavosDe(texto(formData.get("precoDe")));
  if (precoDe === "invalido") {
    return { erro: "Preço antigo inválido. Use algo como 149,90.", campo: "precoDe" };
  }
  if (precoDe !== null && preco !== null && precoDe < preco) {
    return { erro: "O preço antigo precisa ser maior que o de hoje.", campo: "precoDe" };
  }

  const cupom = texto(formData.get("cupom"));
  if (contarCaracteres(cupom) > LIMITES_PRODUTO.cupom) {
    return { erro: `O cupom passa de ${LIMITES_PRODUTO.cupom} caracteres.`, campo: "cupom" };
  }

  return {
    produto: {
      nome,
      descricao: descricao || null,
      precoCentavos: preco,
      precoDeCentavos: precoDe,
      cupom: cupom || null,
      link: null,
      beneficios: [],
      objecoes: [],
    },
  };
}

/** Passo 1: produto (novo ou escolhido). Daqui segue para o manual. */
export async function comecarLive(_anterior: EstadoCriar, formData: FormData): Promise<EstadoCriar> {
  const usuario = await exigirUsuario("/criar");
  if (modoDemo) return { erro: AVISO_DEMO };

  const produtoId = uuid(formData.get("produtoId"));
  let produto: EntradaProduto | null = null;
  if (!produtoId) {
    const leitura = lerProduto(formData);
    if (!("produto" in leitura)) return leitura;
    produto = leitura.produto;
  }

  let id: string;
  try {
    id = await comecarCriacao(usuario.id, { produtoId, produto });
  } catch (erro) {
    return mensagem(erro);
  }

  revalidatePath("/produtos");
  revalidatePath("/manual");
  redirect(`/criar?produto=${id}`);
}
