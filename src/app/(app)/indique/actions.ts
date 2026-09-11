"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { responderConvite } from "@/lib/dados/afiliados";
import { ErroDominio } from "@/lib/dados/erros";
import { modoDemo } from "@/lib/env";
import { exigirUsuario } from "@/lib/sessao";

/**
 * Mutação de /indique.
 *
 * O retorno viaja como CÓDIGO na query (`?aviso=`), e a tela traduz o código
 * num texto do catálogo dela. Devolver a frase pronta pela URL deixaria
 * qualquer pessoa montar um link que faz a nossa tela dizer o que ela quiser —
 * e o formulário aqui funciona sem JavaScript, então não há estado de cliente
 * onde guardar a mensagem.
 */

const ROTA = "/indique";

/** `redirect` lança para funcionar; chamá-lo dentro de um try seria engolido. */
function codigoDoErro(erro: unknown): string {
  if (erro instanceof ErroDominio) return erro.codigo;
  return "desconhecido";
}

export async function responderConviteDeGerente(formData: FormData): Promise<void> {
  const usuario = await exigirUsuario(ROTA);

  const conviteId = String(formData.get("conviteId") ?? "").trim();
  const aceitar = String(formData.get("resposta") ?? "") === "aceitar";

  let aviso = aceitar ? "convite_aceito" : "convite_recusado";

  if (modoDemo) {
    // A sessão demo não tem linha em `perfis`: escrever com esse id estouraria
    // a FK. A tela responde, e diz que não gravou.
    aviso = "demo";
  } else if (!conviteId) {
    aviso = "dado_invalido";
  } else {
    try {
      // O dono é conferido dentro da consulta (perfil_id no where). O id vindo
      // do formulário não autoriza nada sozinho.
      await responderConvite(usuario.id, conviteId, aceitar);
    } catch (erro) {
      aviso = codigoDoErro(erro);
    }
  }

  revalidatePath(ROTA);
  redirect(`${ROTA}?aviso=${aviso}`);
}
