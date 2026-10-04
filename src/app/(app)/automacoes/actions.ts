"use server";

import { revalidatePath } from "next/cache";
import {
  criarAviso,
  editarAviso,
  removerAviso,
  salvarAutomacoes,
  type ConfigAutomacoes,
} from "@/lib/dados/automacoes";
import { ErroDominio } from "@/lib/dados/erros";
import { exigirUsuario } from "@/lib/sessao";

/**
 * Ações da tela de automações.
 *
 * Cada uma chama `exigirUsuario` por conta própria porque Server Action é
 * endpoint, não continuação da página: a sessão conferida quando a tela foi
 * montada não acompanha o POST que chega meia hora depois. Pelo mesmo motivo
 * o `perfilId` sai sempre da sessão e nunca de campo de formulário — campo de
 * formulário é texto que o cliente escolhe.
 *
 * Nenhuma delas gasta crédito: o texto do aviso já está escrito, não há
 * serviço pago no caminho. Quem recusa de verdade é a camada de dados (e o
 * CHECK do banco atrás dela); aqui o `ErroDominio` só é traduzido em mensagem
 * para o formulário.
 */

export type EstadoAutomacao = {
  ok?: boolean;
  erro?: string;
  mensagem?: string;
};

const INICIAL: EstadoAutomacao = {};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idOuNulo(bruto: FormDataEntryValue | null): string | null {
  const valor = typeof bruto === "string" ? bruto : "";
  return UUID.test(valor) ? valor : null;
}

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor.trim() : "";
}

/** Interruptor desligado não manda campo nenhum: a ausência é o "false". */
function marcado(formData: FormData, campo: string): boolean {
  return formData.get(campo) !== null;
}

function inteiro(formData: FormData, campo: string, padrao: number): number {
  const valor = Number(texto(formData, campo));
  return Number.isFinite(valor) ? Math.trunc(valor) : padrao;
}

function falhar(erro: unknown, onde: string): EstadoAutomacao {
  if (erro instanceof ErroDominio) return { ok: false, erro: erro.message };
  // Mensagem de driver não vira texto de tela: diz menos ao vendedor do que
  // uma frase honesta e, às vezes, diz demais sobre o banco.
  console.error(`[automacoes] ${onde}`, erro);
  return { ok: false, erro: "Não deu para salvar. Tente de novo." };
}

export async function salvarRefixarAcao(
  _anterior: EstadoAutomacao = INICIAL,
  formData: FormData,
): Promise<EstadoAutomacao> {
  const usuario = await exigirUsuario("/automacoes");

  try {
    await salvarAutomacoes(usuario.id, {
      refixarAtivo: marcado(formData, "refixarAtivo"),
      refixarIntervaloS: inteiro(formData, "refixarIntervaloS", 180),
      refixarPosicao: inteiro(formData, "refixarPosicao", 1),
    });

    revalidatePath("/automacoes");
    return { ok: true, mensagem: "Produto fixado salvo." };
  } catch (erro) {
    return falhar(erro, "refixar");
  }
}

/**
 * Carrinho e venda numa ação só.
 *
 * Os dois gatilhos têm o mesmo formato — interruptor mais texto — e duas ações
 * idênticas seria o tipo de duplicação que depois divergem. O `qual` vem do
 * formulário e é conferido contra a lista fechada: valor fora dela não escolhe
 * coluna nenhuma.
 */
export async function salvarGatilhoAcao(
  _anterior: EstadoAutomacao = INICIAL,
  formData: FormData,
): Promise<EstadoAutomacao> {
  const usuario = await exigirUsuario("/automacoes");

  const qual = texto(formData, "qual");
  if (qual !== "carrinho" && qual !== "venda") {
    return { ok: false, erro: "Gatilho desconhecido." };
  }

  const corpo = texto(formData, "texto");
  const ativo = marcado(formData, "ativo");

  const dados: Partial<ConfigAutomacoes> =
    qual === "carrinho"
      ? { carrinhoAtivo: ativo, carrinhoTexto: corpo }
      : { vendaAtivo: ativo, vendaTexto: corpo, sinoAtivo: marcado(formData, "sino") };

  try {
    await salvarAutomacoes(usuario.id, dados);

    revalidatePath("/automacoes");
    return {
      ok: true,
      mensagem: qual === "carrinho" ? "Gatilho de carrinho salvo." : "Gatilho de venda salvo.",
    };
  } catch (erro) {
    return falhar(erro, `gatilho_${qual}`);
  }
}

/**
 * Cria ou edita um aviso, e é a mesma ação para os dois blocos da tela.
 *
 * Criar e editar numa função só porque o formulário é um só: o que separa os
 * casos é a presença do `id`, e não um botão diferente. O `tipo` decide em qual
 * bloco o aviso aparece — relâmpago ou comentário — e por isso é conferido
 * contra a lista fechada antes de virar escrita.
 */
export async function salvarAvisoAcao(
  _anterior: EstadoAutomacao = INICIAL,
  formData: FormData,
): Promise<EstadoAutomacao> {
  const usuario = await exigirUsuario("/automacoes");

  const tipo = texto(formData, "tipo");
  if (tipo !== "aviso" && tipo !== "relampago") {
    return { ok: false, erro: "Tipo de aviso desconhecido." };
  }

  const corpo = texto(formData, "texto");
  const intervaloS = inteiro(formData, "intervaloS", 300);
  const id = idOuNulo(formData.get("id"));

  try {
    if (id) {
      await editarAviso(usuario.id, id, {
        texto: corpo,
        intervaloS,
        ativo: marcado(formData, "ativo"),
      });
    } else {
      await criarAviso(usuario.id, { tipo, texto: corpo, intervaloS });
    }

    revalidatePath("/automacoes");
    return {
      ok: true,
      mensagem:
        tipo === "relampago" ? "Oferta relâmpago salva." : "Comentário automático salvo.",
    };
  } catch (erro) {
    return falhar(erro, "aviso");
  }
}

export async function removerAvisoAcao(
  _anterior: EstadoAutomacao = INICIAL,
  formData: FormData,
): Promise<EstadoAutomacao> {
  const usuario = await exigirUsuario("/automacoes");

  const id = idOuNulo(formData.get("id"));
  if (!id) return { ok: false, erro: "Aviso não encontrado." };

  try {
    await removerAviso(usuario.id, id);

    revalidatePath("/automacoes");
    return { ok: true, mensagem: "Aviso removido." };
  } catch (erro) {
    return falhar(erro, "remover");
  }
}
