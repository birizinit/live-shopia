"use server";

import { revalidatePath } from "next/cache";
import {
  DICA_CARTAO_TOUR,
  aceitarRiscoAutomacao,
  ehChaveDeDica,
  marcarDicaVista,
  marcarPassoVisto,
} from "@/lib/dados/onboarding";
import { exigirUsuario } from "@/lib/sessao";

/**
 * Acoes do onboarding.
 *
 * Nenhuma delas recebe `perfilId` do cliente: quem esta pedindo sai de
 * `exigirUsuario()`, dentro da acao. Id de dono vindo do formulario e um campo
 * que o navegador pode reescrever — marcar o tour de outra conta como visto
 * seria bobagem, registrar o aceite de risco dela nao seria.
 */

/**
 * Marca um passo como lido assim que ele aparece na tela.
 *
 * Sem `revalidatePath` de proposito: o progresso so muda o cartao de /inicio,
 * que e uma tela dinamica e sempre refeita na proxima visita. Revalidar aqui
 * custaria um re-render do tour a cada seta do teclado.
 */
export async function verPasso(chave: string): Promise<void> {
  const usuario = await exigirUsuario("/bem-vindo");
  await marcarPassoVisto(usuario.id, chave);
}

export type EstadoAceite = {
  ok?: boolean;
  erro?: string;
  versao?: number;
};

/**
 * Registra o aceite do aviso de risco de automacao.
 *
 * O aceite so vale marcado: sem a caixa marcada a acao recusa, em vez de
 * gravar um "sim" que o usuario nao deu. Quem grava e
 * `aceitar_risco_automacao()` no banco, que escreve em `live_config` — e e la
 * que a extensao e a sala de live olham antes de ligar. Aceite que morasse so
 * no tour nao impediria nada.
 */
export async function aceitarRisco(
  _anterior: EstadoAceite,
  formData: FormData,
): Promise<EstadoAceite> {
  const usuario = await exigirUsuario("/bem-vindo");

  if (formData.get("aceite") !== "sim") {
    return { erro: "Marque a caixa de aceite para continuar." };
  }

  try {
    const versao = await aceitarRiscoAutomacao(usuario.id);
    // O cartao de retomada em /inicio conta este passo como pendente enquanto
    // o aceite nao existe; sem revalidar, ele continuaria cobrando.
    revalidatePath("/inicio");
    return { ok: true, versao };
  } catch (erro) {
    const mensagem =
      erro instanceof Error ? erro.message : "Não foi possível registrar o aceite.";
    return { erro: mensagem };
  }
}

/** "Agora não" no cartao de retomada do tour em /inicio. */
export async function dispensarCartaoTour(): Promise<void> {
  const usuario = await exigirUsuario("/inicio");
  await marcarDicaVista(usuario.id, DICA_CARTAO_TOUR);
  revalidatePath("/inicio");
}

/**
 * Fecha uma dica de primeira visita.
 *
 * O caminho vem do formulario porque a acao nao tem como saber de que tela foi
 * chamada — e por isso e conferido aqui: `revalidatePath` com texto livre do
 * cliente derrubaria o cache de qualquer rota a pedido de qualquer um.
 */
export async function dispensarDica(formData: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  const chave = String(formData.get("chave") ?? "");
  const caminho = String(formData.get("caminho") ?? "");

  if (!ehChaveDeDica(chave)) return;

  await marcarDicaVista(usuario.id, chave);

  if (/^\/[a-z0-9/_-]*$/.test(caminho)) revalidatePath(caminho);
}
