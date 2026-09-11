"use server";

import { revalidatePath } from "next/cache";
import { remover } from "@/lib/armazenamento";
import { contarCaracteres } from "@/lib/caracteres";
import { ErroDominio } from "@/lib/dados/erros";
import {
  LIMITES_PRODUTO,
  arquivarProduto,
  atualizarProduto,
  criarProduto,
  excluirProduto,
  fixarProduto,
  listarProdutos,
  type EntradaProduto,
  type Produto,
} from "@/lib/dados/produtos";
import type { Pagina, ResultadoAcao } from "@/lib/dados/tipos";
import { modoDemo } from "@/lib/env";
import { exigirUsuario } from "@/lib/sessao";

/**
 * Mutacoes de /produtos.
 *
 * Nenhuma acao recebe `perfilId` de fora: quem manda o formulario tambem
 * mandaria o dono. O id sai sempre da sessao e vai como primeiro argumento
 * para a camada de dados, que o usa no `where`.
 *
 * Nada aqui gasta credito — produto e cadastro, nao geracao. Por isso nao ha
 * chave de idempotencia neste arquivo: quem cobra e `debitarEEnfileirar`, na
 * tela de roteiro e na de estudio.
 */

export type EstadoFormProduto = {
  erro?: string;
  /** Campo que recusou o valor, para o formulario focar e marcar. */
  campo?: string;
  /** Id do produto salvo — e o que libera o envio da imagem no cadastro. */
  produtoId?: string;
  /** Muda a cada resposta: e como o cliente sabe que esta e nova. */
  em?: number;
};

const AVISO_DEMO =
  "Modo demo: a sessão não tem linha no banco, então nada é gravado. " +
  "Configure DATABASE_URL para cadastrar de verdade.";

function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * Limite de tamanho com a contagem do projeto.
 *
 * `.length` (e o `.max()` do zod, que usa `.length`) conta unidades UTF-16:
 * um emoji sozinho ja vale 2 e o texto seria recusado antes do limite real.
 * `contarCaracteres` conta code points, que e o que o `length()` do Postgres
 * usa nos CHECKs desta tabela.
 */
function excede(valor: string, maximo: number) {
  return contarCaracteres(valor) > maximo;
}

/**
 * "R$ 1.234,56", "1234,56", "89.90" e "8990" — tudo vira centavos.
 *
 * Ponto sozinho com tres casas e separador de milhar ("1.234" = R$ 1.234,00):
 * preco de varejo em real nao tem milesimo de centavo, entao esta leitura
 * acerta muito mais vezes do que a alternativa.
 */
function centavosDe(bruto: string): number | null | "invalido" {
  if (!bruto) return null;

  const limpo = bruto.replace(/[^\d.,-]/g, "");
  if (!limpo) return null;
  if (limpo.includes("-")) return "invalido";

  let normalizado = limpo;
  if (limpo.includes(",")) {
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else {
    const partes = limpo.split(".");
    const ultima = partes.at(-1) ?? "";
    if (partes.length > 1 && ultima.length === 3) normalizado = partes.join("");
  }

  const valor = Number(normalizado);
  if (!Number.isFinite(valor) || valor < 0) return "invalido";

  const centavos = Math.round(valor * 100);
  // Teto do `integer` da coluna: R$ 21.474.836,47.
  if (centavos > 2_147_483_647) return "invalido";
  return centavos;
}

function lista(formData: FormData, campo: string): string[] {
  return formData
    .getAll(campo)
    .map((valor) => (typeof valor === "string" ? valor.trim() : ""))
    .filter(Boolean)
    .slice(0, LIMITES_PRODUTO.itens);
}

function linkValido(bruto: string): boolean {
  try {
    const url = new URL(bruto);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

type Leitura = { entrada: EntradaProduto } | { erro: string; campo: string };

function lerFormulario(formData: FormData): Leitura {
  const nome = texto(formData.get("nome"));
  if (contarCaracteres(nome) < 2) {
    return { erro: "O nome precisa de ao menos 2 caracteres.", campo: "nome" };
  }
  if (excede(nome, LIMITES_PRODUTO.nome)) {
    return { erro: `O nome passa de ${LIMITES_PRODUTO.nome} caracteres.`, campo: "nome" };
  }

  const descricao = texto(formData.get("descricao"));
  if (excede(descricao, LIMITES_PRODUTO.descricao)) {
    return {
      erro: `A descrição passa de ${LIMITES_PRODUTO.descricao} caracteres.`,
      campo: "descricao",
    };
  }

  const preco = centavosDe(texto(formData.get("preco")));
  if (preco === "invalido") {
    return { erro: "Preço inválido. Use algo como 89,90.", campo: "preco" };
  }

  const precoDe = centavosDe(texto(formData.get("precoDe")));
  if (precoDe === "invalido") {
    return { erro: "Preço anterior inválido. Use algo como 149,90.", campo: "precoDe" };
  }

  if (precoDe !== null && preco !== null && precoDe < preco) {
    return {
      erro: "O preço anterior precisa ser maior que o preço de hoje — senão não é desconto.",
      campo: "precoDe",
    };
  }

  const cupom = texto(formData.get("cupom"));
  if (excede(cupom, LIMITES_PRODUTO.cupom)) {
    return { erro: `O cupom passa de ${LIMITES_PRODUTO.cupom} caracteres.`, campo: "cupom" };
  }

  const link = texto(formData.get("link"));
  if (link && !linkValido(link)) {
    return { erro: "O link precisa começar com http:// ou https://.", campo: "link" };
  }
  if (excede(link, LIMITES_PRODUTO.link)) {
    return { erro: "Esse link é longo demais.", campo: "link" };
  }

  const beneficios = lista(formData, "beneficio");
  const objecoes = lista(formData, "objecao");

  const longo = [...beneficios, ...objecoes].find((item) => excede(item, LIMITES_PRODUTO.item));
  if (longo) {
    return {
      erro: `Cada item da lista cabe em ${LIMITES_PRODUTO.item} caracteres. Encurte: “${longo.slice(0, 40)}…”`,
      campo: "beneficio",
    };
  }

  return {
    entrada: {
      nome,
      descricao: descricao || null,
      precoCentavos: preco,
      precoDeCentavos: precoDe,
      cupom: cupom || null,
      link: link || null,
      beneficios,
      objecoes,
    },
  };
}

/** Erro de dominio ja vem traduzido de erros.ts; o resto vira frase generica. */
function mensagem(erro: unknown): string {
  if (erro instanceof ErroDominio) return erro.message;
  return "Não foi possível concluir. Tente de novo.";
}

export async function salvarProduto(
  _anterior: EstadoFormProduto,
  formData: FormData,
): Promise<EstadoFormProduto> {
  const usuario = await exigirUsuario("/produtos");
  const em = Date.now();

  const leitura = lerFormulario(formData);
  if ("erro" in leitura) return { erro: leitura.erro, campo: leitura.campo, em };

  if (modoDemo) return { erro: AVISO_DEMO, em };

  const id = texto(formData.get("id"));

  try {
    const produtoId = id
      ? await atualizarProduto(usuario.id, id, leitura.entrada)
      : await criarProduto(usuario.id, leitura.entrada);

    revalidatePath("/produtos");
    return { produtoId, em };
  } catch (erro) {
    return { erro: mensagem(erro), em };
  }
}

export async function alternarFixado(
  produtoId: string,
  fixar: boolean,
): Promise<ResultadoAcao<null>> {
  const usuario = await exigirUsuario("/produtos");
  if (modoDemo) return { ok: false, erro: AVISO_DEMO };

  try {
    await fixarProduto(usuario.id, produtoId, fixar);
    revalidatePath("/produtos");
    return { ok: true, dado: null };
  } catch (erro) {
    return { ok: false, erro: mensagem(erro) };
  }
}

export async function alternarArquivado(
  produtoId: string,
  arquivar: boolean,
): Promise<ResultadoAcao<null>> {
  const usuario = await exigirUsuario("/produtos");
  if (modoDemo) return { ok: false, erro: AVISO_DEMO };

  try {
    await arquivarProduto(usuario.id, produtoId, arquivar);
    revalidatePath("/produtos");
    return { ok: true, dado: null };
  } catch (erro) {
    return { ok: false, erro: mensagem(erro) };
  }
}

/**
 * Excluir de vez. A camada de dados recusa se houver roteiro ou audio preso no
 * produto — e a mensagem que volta ja diz para arquivar.
 */
export async function removerProduto(produtoId: string): Promise<ResultadoAcao<null>> {
  const usuario = await exigirUsuario("/produtos");
  if (modoDemo) return { ok: false, erro: AVISO_DEMO };

  try {
    const { imagemId } = await excluirProduto(usuario.id, produtoId);
    // A linha do produto ja se foi; o binario e o que sobraria ocupando o teto
    // de armazenamento do plano sem nada apontando para ele.
    if (imagemId) await remover(imagemId);

    revalidatePath("/produtos");
    return { ok: true, dado: null };
  } catch (erro) {
    return { ok: false, erro: mensagem(erro) };
  }
}

/** Proxima pagina da lista. O cursor e opaco e veio da pagina anterior. */
export async function carregarMaisProdutos(
  cursor: string,
  busca: string,
  arquivados: boolean,
): Promise<ResultadoAcao<Pagina<Produto>>> {
  const usuario = await exigirUsuario("/produtos");

  try {
    const pagina = await listarProdutos(usuario.id, { cursor, busca, arquivados });
    return { ok: true, dado: pagina };
  } catch (erro) {
    return { ok: false, erro: mensagem(erro) };
  }
}
