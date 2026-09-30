"use server";

import { revalidatePath } from "next/cache";
import {
  alternarItemManual,
  criarItemManual,
  editarItemManual,
  removerItemManual,
  type EntradaManual,
} from "@/lib/dados/manual";
import { ErroDominio } from "@/lib/dados/erros";
import { exigirUsuario } from "@/lib/sessao";

export type EstadoManual = { erro?: string; mensagem?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idOuNulo(bruto: FormDataEntryValue | null): string | null {
  const valor = typeof bruto === "string" ? bruto : "";
  return UUID.test(valor) ? valor : null;
}

function entradaDe(formData: FormData): EntradaManual {
  return {
    rotulo: String(formData.get("rotulo") ?? ""),
    resposta: String(formData.get("resposta") ?? ""),
    gatilhos: String(formData.get("gatilhos") ?? ""),
    produtoId: idOuNulo(formData.get("produtoId")),
  };
}

async function comGuarda(acao: (perfilId: string) => Promise<void>): Promise<EstadoManual> {
  const usuario = await exigirUsuario("/manual");
  try {
    await acao(usuario.id);
    revalidatePath("/manual");
    return { mensagem: "Manual atualizado." };
  } catch (erro) {
    if (erro instanceof ErroDominio) return { erro: erro.message };
    console.error("[manual]", erro);
    return { erro: "Não deu para salvar. Tente de novo." };
  }
}

export async function salvarItem(
  _anterior: EstadoManual,
  formData: FormData,
): Promise<EstadoManual> {
  return comGuarda(async (perfilId) => {
    const id = idOuNulo(formData.get("id"));
    if (id) await editarItemManual(perfilId, id, entradaDe(formData));
    else await criarItemManual(perfilId, entradaDe(formData));
  });
}

export async function alternarItem(formData: FormData) {
  const usuario = await exigirUsuario("/manual");
  const id = idOuNulo(formData.get("id"));
  if (!id) return;
  await alternarItemManual(usuario.id, id, formData.get("ativo") === "1");
  revalidatePath("/manual");
}

export async function removerItem(formData: FormData) {
  const usuario = await exigirUsuario("/manual");
  const id = idOuNulo(formData.get("id"));
  if (!id) return;
  await removerItemManual(usuario.id, id);
  revalidatePath("/manual");
}
