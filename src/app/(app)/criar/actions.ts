"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { contarCaracteres } from "@/lib/caracteres";
import {
  MINIMO_CARACTERES_AUDIO,
  TETO_CARACTERES_AUDIO,
  ehIdValido,
} from "@/lib/dados/audios";
import { colocarNaLive, comecarCriacao, type ModoNaLive } from "@/lib/dados/criacao";
import { estimar } from "@/lib/dados/creditos";
import { ErroDominio } from "@/lib/dados/erros";
import { gerarAudioPago } from "@/lib/dados/geracao-audio";
import { LIMITES_PRODUTO, type EntradaProduto } from "@/lib/dados/produtos";
import { obterRoteiro } from "@/lib/dados/roteiros";
import { centavosDe } from "@/lib/dinheiro";
import { modoDemo, servicos } from "@/lib/env";
import { exigirUsuario } from "@/lib/sessao";
import { numero } from "@/lib/utils";

/**
 * As três ações do assistente "Criar live".
 *
 * Cada uma termina num `redirect` para a mesma página com o próximo passo na
 * URL (?roteiro=, ?audio=). É isso que faz recarregar, voltar ou abrir de
 * novo pela extensão cair exatamente onde a pessoa parou.
 */

export type EstadoCriar = {
  erro?: string;
  /** Campo que recusou o valor, para o formulário marcar. */
  campo?: string;
  /** "saldo_insuficiente" liga o link de compra de créditos na tela. */
  codigo?: string;
};

const TONS: readonly string[] = ["energético", "acolhedor", "direto ao ponto", "divertido"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVE_ROTEIRO = /^roteiro:[0-9a-f-]{36}$/i;
const CHAVE_TTS = /^tts:[0-9a-f-]{36}$/i;

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

/** Passo 1: produto (novo ou escolhido) e a IA começa a escrever. */
export async function comecarLive(_anterior: EstadoCriar, formData: FormData): Promise<EstadoCriar> {
  const usuario = await exigirUsuario("/criar");
  if (modoDemo) return { erro: AVISO_DEMO };

  const referencia = texto(formData.get("referencia"));
  if (!CHAVE_ROTEIRO.test(referencia)) return { erro: "A página expirou. Recarregue e tente de novo." };

  const produtoId = uuid(formData.get("produtoId"));
  let produto: EntradaProduto | null = null;
  if (!produtoId) {
    const leitura = lerProduto(formData);
    if (!("produto" in leitura)) return leitura;
    produto = leitura.produto;
  }

  const minutos = Math.min(10, Math.max(1, Math.round(Number(texto(formData.get("minutos"))) || 3)));
  const tomBruto = texto(formData.get("tom"));
  const tom = TONS.includes(tomBruto) ? tomBruto : null;

  let roteiroId: string;
  try {
    roteiroId = await comecarCriacao(usuario.id, { produtoId, produto, minutos, tom, referencia });
  } catch (erro) {
    return mensagem(erro);
  }

  revalidatePath("/produtos");
  revalidatePath("/roteiro");
  redirect(`/criar?roteiro=${roteiroId}`);
}

/** Passo 2: a voz lê a versão do roteiro que está na tela. É aqui que cobra. */
export async function gerarAudioDaLive(
  _anterior: EstadoCriar,
  formData: FormData,
): Promise<EstadoCriar> {
  const usuario = await exigirUsuario("/criar");
  if (modoDemo) return { erro: AVISO_DEMO };

  // Sem chave da ElevenLabs a síntese devolveria um tom de exemplo — cobrar
  // crédito de verdade por isso seria cobrar por um bipe.
  if (!servicos.voz) {
    return { erro: "A geração de voz está desligada no momento. Nenhum crédito foi gasto." };
  }

  const chave = texto(formData.get("chave"));
  const roteiroId = uuid(formData.get("roteiroId"));
  const versaoId = uuid(formData.get("versaoId"));
  const vozId = texto(formData.get("vozId"));

  if (!CHAVE_TTS.test(chave)) return { erro: "A página expirou. Recarregue e tente de novo." };
  if (!roteiroId || !versaoId) return { erro: "Roteiro não encontrado." };
  if (!ehIdValido(vozId)) return { erro: "Escolha a voz da apresentadora.", campo: "vozId" };

  const roteiro = await obterRoteiro(usuario.id, roteiroId);
  if (!roteiro?.versao) return { erro: "Roteiro não encontrado." };

  // O custo mostrado foi o DESTA versão. Se outra aba gerou uma nova, cobrar
  // pela nova seria cobrar por um texto que a pessoa não viu.
  if (roteiro.versao.id !== versaoId) {
    return { erro: "O roteiro mudou desde que você abriu esta tela. Recarregue para ver o texto novo." };
  }

  const fala = roteiro.versao.texto;
  const caracteres = contarCaracteres(fala);
  if (caracteres < MINIMO_CARACTERES_AUDIO || caracteres > TETO_CARACTERES_AUDIO) {
    return { erro: "O tamanho do roteiro está fora do que dá para narrar. Edite o texto e tente de novo." };
  }

  const estimativa = await estimar(usuario.id, fala);
  if (!estimativa.suficiente) {
    return {
      erro: `Faltam ${numero(estimativa.faltam)} créditos para gerar este áudio.`,
      codigo: "saldo_insuficiente",
    };
  }

  let audioId: string;
  try {
    ({ audioId } = await gerarAudioPago(
      usuario.id,
      { vozId, titulo: roteiro.titulo, texto: fala, roteiroVersaoId: versaoId },
      chave,
      caracteres,
    ));
  } catch (erro) {
    return mensagem(erro);
  }

  revalidatePath("/estudio");
  revalidatePath("/biblioteca");
  redirect(`/criar?audio=${audioId}`);
}

/** Passo 3: o áudio pronto entra no que a extensão toca. */
export async function colocarNaLiveAcao(
  _anterior: EstadoCriar,
  formData: FormData,
): Promise<EstadoCriar> {
  const usuario = await exigirUsuario("/criar");
  if (modoDemo) return { erro: AVISO_DEMO };

  const audioId = uuid(formData.get("audioId"));
  if (!audioId) return { erro: "Áudio não encontrado." };
  const modo: ModoNaLive = texto(formData.get("modo")) === "sozinho" ? "sozinho" : "juntar";

  try {
    await colocarNaLive(usuario.id, audioId, modo);
  } catch (erro) {
    return mensagem(erro);
  }

  revalidatePath("/inicio");
  revalidatePath("/audio");
  revalidatePath("/live");
  redirect(`/criar?audio=${audioId}`);
}
