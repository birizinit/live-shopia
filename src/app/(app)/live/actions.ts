"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { ErroDominio } from "@/lib/dados/erros";
import {
  aceitarRisco,
  ajustarModulosExtensao,
  configuracaoLive,
  desvincularConta,
  iniciarLive,
  pararLive,
  pararTudo,
  salvarConfiguracaoLive,
  vincularConta,
} from "@/lib/dados/live";
import { exigirUsuario } from "@/lib/sessao";
import { ipDoPedido } from "@/lib/rede";

/**
 * Acoes da sala de live e do painel.
 *
 * Todas seguem o mesmo contrato de `useActionState`: (estado, FormData) ->
 * EstadoAcao. Nenhuma delas gasta credito — a live toca a montagem em laco, e
 * laco nao chama TTS. Por isso aqui nao existe chave de idempotencia vinda de
 * campo oculto: ela pertence a `debitarEEnfileirar`, que e a unica porta de
 * gasto (src/lib/dados/creditos.ts). O que protege o duplo clique aqui e o
 * indice unico de conta com live aberta, mais a devolucao da sessao ja existente
 * em `iniciarLive`.
 */

export type EstadoAcao = {
  ok?: boolean;
  erro?: string;
  mensagem?: string;
};

const INICIAL: EstadoAcao = {};

function falhar(erro: unknown): EstadoAcao {
  if (erro instanceof ErroDominio) return { ok: false, erro: erro.message };
  // Erro desconhecido nao vira texto de banco na tela: mensagem de driver diz
  // menos ao usuario do que uma frase honesta, e as vezes diz demais.
  console.error("[live] ação falhou", erro);
  return { ok: false, erro: "Não foi possível concluir. Tente de novo." };
}

/** As duas telas leem os mesmos dados; salvar numa precisa revalidar a outra. */
function revalidarLive() {
  revalidatePath("/live");
  revalidatePath("/painel");
}

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor.trim() : "";
}

function marcado(formData: FormData, campo: string): boolean {
  return formData.get(campo) !== null;
}

function inteiro(formData: FormData, campo: string, padrao: number): number {
  const valor = Number(texto(formData, campo));
  return Number.isFinite(valor) ? Math.trunc(valor) : padrao;
}

/**
 * IP do cliente para a trilha de auditoria do aceite.
 *
 * A coluna e `inet`: um valor torto derruba o cast e, com ele, o aceite inteiro.
 * Como o aceite importa mais do que o IP, o que nao parece endereco vira null.
 */
async function contextoDaRequisicao() {
  const cabecalhos = await headers();
  const bruto = ipDoPedido(cabecalhos) ?? "";
  const ehEndereco = /^[0-9a-fA-F:.]{3,45}$/.test(bruto);

  return {
    ip: ehEndereco ? bruto : null,
    userAgent: cabecalhos.get("user-agent")?.slice(0, 400) ?? null,
  };
}

export async function vincularContaAcao(
  _anterior: EstadoAcao = INICIAL,
  formData: FormData,
): Promise<EstadoAcao> {
  const usuario = await exigirUsuario("/live");

  try {
    const conta = await vincularConta(
      usuario.id,
      texto(formData, "usuario"),
      texto(formData, "apelido") || null,
    );

    // A primeira conta vira a conta da live sozinha — escolher entre uma opcao
    // so e passo sem informacao. Quem ja escolheu uma nao tem a escolha
    // trocada pelas costas ao vincular a segunda.
    const config = await configuracaoLive(usuario.id);
    if (!config.contaId) {
      await salvarConfiguracaoLive(usuario.id, { contaId: conta.id });
    }

    revalidarLive();
    return { ok: true, mensagem: `@${conta.usuario} vinculada.` };
  } catch (erro) {
    return falhar(erro);
  }
}

export async function desvincularContaAcao(
  _anterior: EstadoAcao = INICIAL,
  formData: FormData,
): Promise<EstadoAcao> {
  const usuario = await exigirUsuario("/live");

  try {
    await desvincularConta(usuario.id, texto(formData, "contaId"));
    revalidarLive();
    return { ok: true, mensagem: "Conta desvinculada." };
  } catch (erro) {
    return falhar(erro);
  }
}

export async function salvarConfiguracaoAcao(
  _anterior: EstadoAcao = INICIAL,
  formData: FormData,
): Promise<EstadoAcao> {
  const usuario = await exigirUsuario("/live");

  try {
    await salvarConfiguracaoLive(usuario.id, {
      contaId: texto(formData, "contaId") || null,
      vozId: texto(formData, "vozId") || null,
      montagemId: texto(formData, "montagemId") || null,
      responderChat: marcado(formData, "responderChat"),
      saudarEntrada: marcado(formData, "saudarEntrada"),
      intervaloMinS: inteiro(formData, "intervaloMinS", 12),
      intervaloMaxS: inteiro(formData, "intervaloMaxS", 45),
      tetoPorMinuto: inteiro(formData, "tetoPorMinuto", 3),
    });

    revalidarLive();
    return { ok: true, mensagem: "Configuração da live salva." };
  } catch (erro) {
    return falhar(erro);
  }
}

export async function aceitarRiscoAcao(
  _anterior: EstadoAcao = INICIAL,
  formData: FormData,
): Promise<EstadoAcao> {
  const usuario = await exigirUsuario("/live");

  if (!marcado(formData, "confirmo")) {
    return { ok: false, erro: "Marque a confirmação para registrar o aceite." };
  }

  try {
    const versao = await aceitarRisco(usuario.id, await contextoDaRequisicao());
    revalidarLive();
    return { ok: true, mensagem: `Aceite registrado (versão ${versao} do aviso).` };
  } catch (erro) {
    return falhar(erro);
  }
}

export async function iniciarLiveAcao(
  _anterior: EstadoAcao = INICIAL,
  formData: FormData,
): Promise<EstadoAcao> {
  const usuario = await exigirUsuario("/live");

  try {
    await iniciarLive(usuario.id, {
      contaId: texto(formData, "contaId") || null,
      montagemId: texto(formData, "montagemId") || null,
    });

    revalidarLive();
    return { ok: true, mensagem: "Sessão aberta. A extensão assume em seguida." };
  } catch (erro) {
    return falhar(erro);
  }
}

export async function pararLiveAcao(
  _anterior: EstadoAcao = INICIAL,
  formData: FormData,
): Promise<EstadoAcao> {
  const usuario = await exigirUsuario("/live");

  try {
    await pararLive(usuario.id, texto(formData, "sessaoId"));
    revalidarLive();
    return { ok: true, mensagem: "Live encerrada." };
  } catch (erro) {
    return falhar(erro);
  }
}

/** Liga/desliga um modulo da extensao nesta conta. Usado pelo painel. */
export async function alternarModuloAcao(
  _anterior: EstadoAcao = INICIAL,
  formData: FormData,
): Promise<EstadoAcao> {
  const usuario = await exigirUsuario("/painel");
  const modulo = texto(formData, "modulo");
  const ligado = texto(formData, "ligado") === "1";

  if (modulo !== "mixer" && modulo !== "chat") {
    return { ok: false, erro: "Módulo desconhecido." };
  }

  try {
    await ajustarModulosExtensao(
      usuario.id,
      modulo === "mixer" ? { mixer: ligado } : { chat: ligado },
    );
    revalidarLive();
    return {
      ok: true,
      mensagem: `${modulo === "mixer" ? "Mixer de áudio" : "Automação de chat"} ${
        ligado ? "ligado" : "desligado"
      }.`,
    };
  } catch (erro) {
    return falhar(erro);
  }
}

export async function pararTudoAcao(
  _anterior: EstadoAcao = INICIAL,
  _formData?: FormData,
): Promise<EstadoAcao> {
  const usuario = await exigirUsuario("/painel");

  try {
    await pararTudo(usuario.id);
    revalidarLive();
    return { ok: true, mensagem: "Tudo parado: mixer, chat e a sessão da live." };
  } catch (erro) {
    return falhar(erro);
  }
}
