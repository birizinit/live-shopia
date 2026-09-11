"use server";

import { revalidatePath } from "next/cache";
import {
  dentroDoLimite,
  emitirLicenca,
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
 * licença é direito do plano, não geração paga. O que precisa de trava aqui é
 * outro: emitir token é barato para nós e caro para o cliente (o token anterior
 * morre no mesmo UPDATE), então o teto existe para que clique repetido não vire
 * uma fila de tokens mortos.
 */

const ROTA = "/extensao";

export type EstadoTokenForm = {
  erro?: string;
  /** O token cru. Chega até aqui uma vez e não fica em lugar nenhum depois. */
  token?: string;
  /** true quando substituiu um token que já existia. */
  rotacionado?: boolean;
};

const RECADO_DEMO =
  "Modo demonstração: não há banco, então nenhuma licença é emitida de verdade.";

export async function emitirTokenAcao(
  _anterior: EstadoTokenForm,
  formData: FormData,
): Promise<EstadoTokenForm> {
  const usuario = await exigirUsuario(ROTA);

  if (modoDemo) return { erro: RECADO_DEMO };

  // `jaTinha` vem do formulário porque só o render sabia o estado anterior — e
  // depois do upsert essa informação já não existe na linha.
  const jaTinha = formData.get("jaTinha") === "1";

  try {
    if (!(await dentroDoLimite(`ext:emitir:${usuario.id}`, 5, 3600))) {
      return {
        erro: "Você gerou tokens demais na última hora. Tente de novo daqui a pouco.",
      };
    }

    const { token } = await emitirLicenca(usuario.id);
    revalidatePath(ROTA);
    return { token, rotacionado: jaTinha };
  } catch (erro) {
    return { erro: mensagem(erro) };
  }
}

export async function revogarLicencaAcao(): Promise<ResultadoAcao> {
  const usuario = await exigirUsuario(ROTA);

  if (modoDemo) return { ok: false, erro: RECADO_DEMO };

  try {
    const revogou = await revogarLicenca(usuario.id, "Revogada pelo próprio usuário no painel.");
    revalidatePath(ROTA);
    return revogou
      ? { ok: true, dado: undefined }
      : { ok: false, erro: "Não havia licença ativa para revogar." };
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
