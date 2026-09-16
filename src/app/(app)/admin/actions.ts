"use server";

import { revalidatePath } from "next/cache";
import {
  ajustarCreditos,
  concederCortesia,
  criarConvite,
  encerrarCortesia,
  mudarPapel,
  revogarConvite,
} from "@/lib/dados/admin";
import { ErroDominio } from "@/lib/dados/erros";
import { exigirPapel } from "@/lib/sessao";
import { PAPEIS, type Papel } from "@/lib/roles";

/**
 * Ações da operação.
 *
 * Toda uma delas chama exigirPapel(["admin"]) de novo, mesmo a página já
 * exigindo: Server Action é um endpoint, e endpoint que confia na tela que o
 * chamou não tem guarda nenhuma — basta descobrir o id da action.
 */

export type EstadoAdmin = { erro?: string; mensagem?: string; codigo?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(formData: FormData, campo: string): string {
  const valor = String(formData.get(campo) ?? "");
  if (!UUID.test(valor)) throw new ErroDominio("dado_invalido", "Identificador inválido.");
  return valor;
}

function inteiro(formData: FormData, campo: string, padrao: number): number {
  const n = Number.parseInt(String(formData.get(campo) ?? ""), 10);
  return Number.isSafeInteger(n) ? n : padrao;
}

async function comGuarda<T>(acao: (atorId: string) => Promise<T>): Promise<EstadoAdmin> {
  const admin = await exigirPapel(["admin"]);
  try {
    const r = await acao(admin.id);
    revalidatePath("/admin");
    return typeof r === "string" ? { mensagem: "Feito.", codigo: r } : { mensagem: "Feito." };
  } catch (erro) {
    if (erro instanceof ErroDominio) return { erro: erro.message };
    console.error("[admin]", erro);
    return { erro: "Não deu para concluir. Tente de novo." };
  }
}

export async function acaoConcederCortesia(
  _anterior: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  return comGuarda(async (atorId) => {
    await concederCortesia(
      atorId,
      id(formData, "perfilId"),
      id(formData, "planoId"),
      inteiro(formData, "dias", 30),
      String(formData.get("motivo") ?? "cortesia").slice(0, 200),
    );
  });
}

export async function acaoEncerrarCortesia(
  _anterior: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  return comGuarda(async (atorId) => {
    const ok = await encerrarCortesia(atorId, id(formData, "perfilId"));
    if (!ok) throw new ErroDominio("nao_encontrado", "Esta conta não tem cortesia ativa.");
  });
}

export async function acaoMudarPapel(
  _anterior: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  return comGuarda(async (atorId) => {
    const papel = String(formData.get("papel") ?? "");
    if (!(PAPEIS as readonly string[]).includes(papel)) {
      throw new ErroDominio("dado_invalido", "Papel desconhecido.");
    }
    await mudarPapel(atorId, id(formData, "perfilId"), papel as Papel);
  });
}

export async function acaoAjustarCreditos(
  _anterior: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  return comGuarda(async (atorId) => {
    await ajustarCreditos(
      atorId,
      id(formData, "perfilId"),
      inteiro(formData, "delta", 0),
      String(formData.get("motivo") ?? "ajuste manual").slice(0, 200),
    );
  });
}

export async function acaoCriarConvite(
  _anterior: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  return comGuarda(async (atorId) =>
    criarConvite(atorId, {
      planoId: id(formData, "planoId"),
      dias: Math.min(Math.max(inteiro(formData, "dias", 30), 1), 3650),
      usosMax: Math.min(Math.max(inteiro(formData, "usosMax", 1), 1), 1000),
      validadeDias: Math.min(Math.max(inteiro(formData, "validadeDias", 30), 1), 365),
      observacao: String(formData.get("observacao") ?? "").trim().slice(0, 200) || null,
    }),
  );
}

export async function acaoRevogarConvite(
  _anterior: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  return comGuarda(async (atorId) => {
    const ok = await revogarConvite(atorId, id(formData, "conviteId"));
    if (!ok) throw new ErroDominio("nao_encontrado", "Convite já estava revogado.");
  });
}
