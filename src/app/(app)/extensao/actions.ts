"use server";

import { revalidatePath } from "next/cache";
import {
  esquecerInstalacao,
  revogarLicenca,
} from "@/lib/dados/extensao";
import { ErroDominio } from "@/lib/dados/erros";
import type { ResultadoAcao } from "@/lib/dados/tipos";
import { modoDemo } from "@/lib/env";
import { exigirUsuario } from "@/lib/sessao";

/**
 * Mutações da tela da extensão.
 *
 * Nenhuma delas gasta crédito, então nenhuma passa por `debitarEEnfileirar` —
 * licença é direito do plano, não geração paga. Emitir o token não mora mais
 * aqui: desde a 3.0 quem emite é o login da própria extensão (/api/ext/entrar).
 */

const ROTA = "/extensao";

const RECADO_DEMO =
  "Modo demonstração: não há banco, então nada é desconectado de verdade.";

export async function revogarLicencaAcao(): Promise<ResultadoAcao> {
  const usuario = await exigirUsuario(ROTA);

  if (modoDemo) return { ok: false, erro: RECADO_DEMO };

  try {
    const revogou = await revogarLicenca(usuario.id, "Revogada pelo próprio usuário no painel.");
    revalidatePath(ROTA);
    return revogou
      ? { ok: true, dado: undefined }
      : { ok: false, erro: "Não havia extensão conectada." };
  } catch (erro) {
    return { ok: false, erro: mensagem(erro) };
  }
}

/**
 * Some com uma máquina da lista.
 *
 * Formulário comum, sem estado: é a única mutação da tela que funciona com o
 * JavaScript desligado, e não há resposta para mostrar além da lista atualizada.
 * Máquina que ainda roda a extensão reaparece no próximo heartbeat — a tela
 * avisa isso ao lado do botão.
 */
export async function esquecerInstalacaoAcao(formData: FormData): Promise<void> {
  const usuario = await exigirUsuario(ROTA);
  if (modoDemo) return;

  const id = String(formData.get("instalacao") ?? "");
  // Formato conferido antes do banco: id torto vira 22P02, e a tela inteira
  // cairia no error.tsx por causa de um campo oculto adulterado.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;

  // O dono é confrontado dentro da consulta (`where perfil_id = …`), nunca aqui.
  await esquecerInstalacao(usuario.id, id);
  revalidatePath(ROTA);
}

function mensagem(erro: unknown) {
  if (erro instanceof ErroDominio) return erro.message;
  console.error("[extensao/actions]", erro);
  return "Não foi possível concluir a operação. Tente de novo.";
}
