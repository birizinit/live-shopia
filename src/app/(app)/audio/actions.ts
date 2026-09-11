"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ErroDominio } from "@/lib/dados/erros";
import {
  TETO_ITENS,
  ativarMontagem,
  criarMontagem,
  desativarMontagem,
  ehId,
  excluirMontagem,
  salvarMontagem,
} from "@/lib/dados/montagens";
import { exigirUsuario } from "@/lib/sessao";

/**
 * Ações da tela de áudio da live.
 *
 * Nenhuma delas gasta crédito, e isso é a regra do produto e não um detalhe:
 * montar, reordenar, ativar e tocar em laço acontecem sobre áudio que já foi
 * pago uma vez. Por isso aqui não existe chaveIdempotente() nem campo oculto de
 * idempotência — não há débito a proteger contra duplo clique. O que cobra é a
 * geração, em /estudio.
 */

export type EstadoMontador = {
  erro?: string;
  mensagem?: string;
  /** Muda a cada resposta: é o gatilho do aviso passageiro na tela. */
  carimbo?: number;
};

function agora(): number {
  return Date.now();
}

function falhar(erro: unknown): EstadoMontador {
  if (erro instanceof ErroDominio) {
    return { erro: erro.message, carimbo: agora() };
  }
  // Erro fora do domínio é bug nosso: o usuário vê uma frase, o servidor vê o
  // rastro inteiro.
  console.error("[audio] ação falhou", erro);
  return { erro: "Não foi possível concluir a operação.", carimbo: agora() };
}

/** A ordem da lista viaja como JSON num campo oculto mantido pelo montador. */
function lerLista(bruto: FormDataEntryValue | null): string[] {
  if (typeof bruto !== "string" || !bruto) return [];
  try {
    const valor: unknown = JSON.parse(bruto);
    if (!Array.isArray(valor)) return [];
    return valor.filter(ehId).slice(0, TETO_ITENS);
  } catch {
    return [];
  }
}

function lerNumero(bruto: FormDataEntryValue | null, padrao: number): number {
  const numero = Number(bruto);
  return Number.isFinite(numero) ? numero : padrao;
}

export async function salvarAcao(
  _anterior: EstadoMontador,
  formData: FormData,
): Promise<EstadoMontador> {
  const usuario = await exigirUsuario("/audio");

  const montagemId = String(formData.get("montagemId") ?? "");
  if (!ehId(montagemId)) return { erro: "Montagem inválida.", carimbo: agora() };

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) return { erro: "Dê um nome para a montagem.", carimbo: agora() };

  const trilha = String(formData.get("trilha") ?? "");

  try {
    const { itens } = await salvarMontagem(usuario.id, montagemId, {
      nome,
      trilhaId: ehId(trilha) ? trilha : null,
      volumeTrilha: lerNumero(formData.get("volume"), 15),
      intervaloMs: lerNumero(formData.get("intervalo"), 800),
      embaralhar: formData.get("embaralhar") === "1",
      audios: lerLista(formData.get("audios")),
    });

    revalidatePath("/audio");

    return {
      mensagem:
        itens === 0
          ? "Montagem salva sem áudio nenhum. Ela não vai tocar assim."
          : `Montagem salva com ${itens} ${itens === 1 ? "áudio" : "áudios"}. Repetir em laço não custa crédito.`,
      carimbo: agora(),
    };
  } catch (erro) {
    return falhar(erro);
  }
}

export async function ativarAcao(
  _anterior: EstadoMontador,
  formData: FormData,
): Promise<EstadoMontador> {
  const usuario = await exigirUsuario("/audio");

  const montagemId = String(formData.get("montagemId") ?? "");
  if (!ehId(montagemId)) return { erro: "Montagem inválida.", carimbo: agora() };

  const ligar = formData.get("ligar") === "1";

  try {
    if (ligar) await ativarMontagem(usuario.id, montagemId);
    else await desativarMontagem(usuario.id, montagemId);

    revalidatePath("/audio");

    return {
      mensagem: ligar
        ? "Montagem ativa. É esta que a extensão vai tocar na próxima live."
        : "Montagem fora do ar. Nenhuma está ativa agora.",
      carimbo: agora(),
    };
  } catch (erro) {
    // `montagens_ativa_idx` deixa uma ativa por perfil. Duas abas ativando ao
    // mesmo tempo batem nele — e o caminho de saída é recarregar, não repetir.
    if (erro instanceof ErroDominio && erro.codigo === "conflito") {
      return {
        erro: "Outra montagem foi ativada ao mesmo tempo. Atualize a página e tente de novo.",
        carimbo: agora(),
      };
    }
    return falhar(erro);
  }
}

export async function criarAcao(
  _anterior: EstadoMontador,
  formData: FormData,
): Promise<EstadoMontador> {
  const usuario = await exigirUsuario("/audio");
  const nome = String(formData.get("nome") ?? "").trim() || "Montagem da live";

  let id: string;
  try {
    id = await criarMontagem(usuario.id, nome);
  } catch (erro) {
    return falhar(erro);
  }

  revalidatePath("/audio");
  // Fora do try: redirect() sinaliza por exceção e seria engolido pelo catch.
  redirect(`/audio?m=${id}`);
}

export async function excluirAcao(montagemId: string): Promise<EstadoMontador> {
  const usuario = await exigirUsuario("/audio");

  try {
    await excluirMontagem(usuario.id, montagemId);
  } catch (erro) {
    return falhar(erro);
  }

  revalidatePath("/audio");
  redirect("/audio");
}
