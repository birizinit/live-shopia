"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ErroDominio, traduzirErro } from "@/lib/dados/erros";
import type { ResultadoAcao } from "@/lib/dados/tipos";
import {
  definirVozAtiva,
  sincronizarCatalogo,
  type ResumoSincronizacao,
  type VozAtivaDefinida,
} from "@/lib/dados/vozes";
import { modoDemo, servicos } from "@/lib/env";
import { temPapel } from "@/lib/roles";
import { exigirUsuario } from "@/lib/sessao";

/**
 * Mutações da tela de vozes.
 *
 * Nenhuma delas gasta crédito — por isso não há `chaveIdempotente` nem campo
 * oculto de idempotência em lugar nenhum desta tela. Definir a voz ativa é um
 * UPSERT de uma coluna: repetir o clique grava o mesmo valor de novo, e isso
 * não cobra ninguém. Quem gasta crédito é o estúdio, na hora de gerar o áudio.
 *
 * O papel vem de `exigirUsuario()`, que lê `perfis` a cada requisição — nunca
 * de um campo escondido no formulário nem de um claim de token.
 */

const esquemaVozId = z.uuid("Voz inválida.");

function comoFalha(erro: unknown): ResultadoAcao<never> {
  const dominio = erro instanceof ErroDominio ? erro : traduzirErro(erro);
  return { ok: false, erro: dominio.message, codigo: dominio.codigo };
}

// -----------------------------------------------------------------------------
// Voz ativa da live
// -----------------------------------------------------------------------------

export type EstadoVozAtiva = ResultadoAcao<VozAtivaDefinida> | null;

export async function usarVoz(
  _anterior: EstadoVozAtiva,
  formData: FormData,
): Promise<EstadoVozAtiva> {
  const usuario = await exigirUsuario("/vozes");

  const analise = esquemaVozId.safeParse(String(formData.get("vozId") ?? ""));
  if (!analise.success) {
    return { ok: false, erro: "Voz inválida.", codigo: "dado_invalido" };
  }

  try {
    // Quem confere se a voz é do catálogo ou desta pessoa é a consulta, não o
    // formulário: o id chegou do navegador e vale o que vale.
    const dado = await definirVozAtiva(usuario.id, analise.data);
    if (dado.salvo) revalidatePath("/vozes");
    return { ok: true, dado };
  } catch (erro) {
    return comoFalha(erro);
  }
}

// -----------------------------------------------------------------------------
// Sincronização do catálogo — só admin
// -----------------------------------------------------------------------------

export type EstadoSincronizacao = ResultadoAcao<ResumoSincronizacao> | null;

export async function sincronizarVozes(
  _anterior: EstadoSincronizacao,
  _formData: FormData,
): Promise<EstadoSincronizacao> {
  const usuario = await exigirUsuario("/vozes");

  // O botão só aparece para admin, mas Server Action é endpoint: esconder na
  // interface não é autorizar. A checagem de verdade é esta.
  if (!temPapel(usuario.papel, ["admin"])) {
    return {
      ok: false,
      erro: "Só administrador sincroniza o catálogo de vozes.",
      codigo: "sem_permissao",
    };
  }

  if (modoDemo) {
    return {
      ok: false,
      erro: "Modo demonstração: não há banco para gravar o catálogo.",
      codigo: "servico_indisponivel",
    };
  }

  if (!servicos.voz) {
    return {
      ok: false,
      erro: "Sem ELEVENLABS_API_KEY não há catálogo real para sincronizar.",
      codigo: "servico_indisponivel",
    };
  }

  try {
    const dado = await sincronizarCatalogo(usuario.id);
    revalidatePath("/vozes");
    return { ok: true, dado };
  } catch (erro) {
    return comoFalha(erro);
  }
}
