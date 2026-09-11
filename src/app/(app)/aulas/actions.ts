"use server";

import { revalidatePath } from "next/cache";
import { registrarProgresso, type ProgressoAula } from "@/lib/dados/aulas";
import { ErroDominio, traduzirErro } from "@/lib/dados/erros";
import type { ResultadoAcao } from "@/lib/dados/tipos";
import { exigirUsuario } from "@/lib/sessao";

/** `aulas.id` e uuid. O player manda o que estiver na propria pagina, mas o
 *  formato se confere antes de virar parametro de consulta. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Teto de sanidade: nenhuma aula tem 24 horas, e numero absurdo aqui so pode
 *  ser tentativa de fechar a aula sem assistir. */
const SEGUNDOS_MAXIMOS = 86_400;

/**
 * Guarda onde o video parou.
 *
 * Nao e formulario: o player chama direto enquanto o video roda, entao nao ha
 * `useActionState` aqui. O dono vem SEMPRE da sessao — o navegador manda a
 * aula e a posicao, nunca de quem e o progresso.
 */
export async function salvarProgresso(
  aulaId: string,
  segundos: number,
): Promise<ResultadoAcao<ProgressoAula>> {
  const usuario = await exigirUsuario("/aulas");

  if (!UUID.test(aulaId)) {
    return { ok: false, erro: "Aula inválida.", codigo: "dado_invalido" };
  }

  if (!Number.isFinite(segundos) || segundos < 0 || segundos > SEGUNDOS_MAXIMOS) {
    return { ok: false, erro: "Posição do vídeo inválida.", codigo: "dado_invalido" };
  }

  try {
    const progresso = await registrarProgresso(usuario.id, aulaId, segundos);

    // So invalida a lista quando a aula ACABOU de concluir: o estado dela muda
    // uma vez, e revalidar a cada 15 s de video jogaria o cache fora a toa.
    if (progresso.concluidaAgora) revalidatePath("/aulas");

    return { ok: true, dado: progresso };
  } catch (erro) {
    const dominio = erro instanceof ErroDominio ? erro : traduzirErro(erro);
    return { ok: false, erro: dominio.message, codigo: dominio.codigo };
  }
}
