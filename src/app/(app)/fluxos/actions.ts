"use server";

import { revalidatePath } from "next/cache";
import {
  alternarFluxo,
  criarFluxo,
  editarFluxo,
  removerFluxo,
  type DadosFluxo,
} from "@/lib/dados/fluxos";
import { ErroDominio } from "@/lib/dados/erros";
import { exigirUsuario } from "@/lib/sessao";

/**
 * Ações da tela de fluxos. Mesmo contrato das automações: cada uma confere a
 * sessão por conta própria e o `perfilId` sai dela, nunca do formulário.
 */

export type EstadoFluxo = { ok?: boolean; erro?: string; mensagem?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor.trim() : "";
}

function idOuNulo(formData: FormData): string | null {
  const valor = texto(formData, "id");
  return UUID.test(valor) ? valor : null;
}

const linhas = (bruto: string) => bruto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function inteiro(formData: FormData, campo: string, padrao: number): number {
  const valor = Number(texto(formData, campo));
  return Number.isFinite(valor) ? Math.trunc(valor) : padrao;
}

function falhar(erro: unknown, onde: string): EstadoFluxo {
  if (erro instanceof ErroDominio) return { ok: false, erro: erro.message };
  console.error(`[fluxos] ${onde}`, erro);
  return { ok: false, erro: "Não deu para salvar. Tente de novo." };
}

function lerDados(formData: FormData): DadosFluxo {
  return {
    nome: texto(formData, "nome"),
    modo: texto(formData, "modo") === "exato" ? "exato" : "contem",
    gatilhos: linhas(texto(formData, "gatilhos")),
    respostas: linhas(texto(formData, "respostas")),
    atrasoS: inteiro(formData, "atrasoS", 10),
    intervaloS: inteiro(formData, "intervaloS", 20),
    marcar: formData.get("marcar") !== null,
    umaVezPorPessoa: formData.get("umaVez") !== null,
    ativo: formData.get("ativo") !== null,
  };
}

export async function salvarFluxoAcao(_anterior: EstadoFluxo, formData: FormData): Promise<EstadoFluxo> {
  const usuario = await exigirUsuario("/fluxos");
  const id = idOuNulo(formData);
  try {
    const dados = lerDados(formData);
    if (id) await editarFluxo(usuario.id, id, dados);
    else await criarFluxo(usuario.id, dados);
    revalidatePath("/fluxos");
    return { ok: true, mensagem: id ? "Fluxo salvo." : "Fluxo criado. A extensão pega na próxima atualização (até 2 min)." };
  } catch (erro) {
    return falhar(erro, "salvar");
  }
}

export async function alternarFluxoAcao(_anterior: EstadoFluxo, formData: FormData): Promise<EstadoFluxo> {
  const usuario = await exigirUsuario("/fluxos");
  const id = idOuNulo(formData);
  if (!id) return { ok: false, erro: "Fluxo não encontrado." };
  const ligar = texto(formData, "ligar") === "1";
  try {
    await alternarFluxo(usuario.id, id, ligar);
    revalidatePath("/fluxos");
    return { ok: true, mensagem: ligar ? "Fluxo ligado." : "Fluxo desligado." };
  } catch (erro) {
    return falhar(erro, "alternar");
  }
}

export async function removerFluxoAcao(_anterior: EstadoFluxo, formData: FormData): Promise<EstadoFluxo> {
  const usuario = await exigirUsuario("/fluxos");
  const id = idOuNulo(formData);
  if (!id) return { ok: false, erro: "Fluxo não encontrado." };
  try {
    await removerFluxo(usuario.id, id);
    revalidatePath("/fluxos");
    return { ok: true, mensagem: "Fluxo removido." };
  } catch (erro) {
    return falhar(erro, "remover");
  }
}
