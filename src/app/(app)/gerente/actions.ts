"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  cancelarConvite,
  convidarParaEquipe,
  promoverAfiliado,
} from "@/lib/dados/afiliados";
import { ErroDominio } from "@/lib/dados/erros";
import { modoDemo } from "@/lib/env";
import { exigirPapel } from "@/lib/sessao";

/**
 * Mutações de /gerente.
 *
 * `exigirPapel(["manager"])` é repetido em cada uma porque Server Action é um
 * endpoint: quem descobre o id dela pode chamá-la sem nunca abrir a tela, e
 * guard que só existe na página não guarda nada.
 *
 * O resultado volta como CÓDIGO na query; o catálogo de frases mora na tela.
 */

const ROTA = "/gerente";

function codigoDoErro(erro: unknown): string {
  if (erro instanceof ErroDominio) return erro.codigo;
  return "desconhecido";
}

export async function convidar(formData: FormData): Promise<void> {
  const usuario = await exigirPapel(["manager"]);

  const codigo = String(formData.get("codigo") ?? "").trim();
  const mensagem = String(formData.get("mensagem") ?? "");

  let aviso = "convite_enviado";

  if (modoDemo) {
    aviso = "demo";
  } else if (!codigo) {
    aviso = "codigo_vazio";
  } else {
    try {
      await convidarParaEquipe(usuario.id, { codigo, mensagem });
    } catch (erro) {
      aviso = codigoDoErro(erro);
    }
  }

  revalidatePath(ROTA);
  redirect(`${ROTA}?aviso=${aviso}`);
}

export async function cancelarConviteEnviado(formData: FormData): Promise<void> {
  const usuario = await exigirPapel(["manager"]);

  const conviteId = String(formData.get("conviteId") ?? "").trim();
  let aviso = "convite_cancelado";

  if (modoDemo) {
    aviso = "demo";
  } else if (!conviteId) {
    aviso = "dado_invalido";
  } else {
    try {
      // `gerente_id` entra no where: o id do convite vindo do formulário não
      // autoriza apagar o convite de outro gerente.
      await cancelarConvite(usuario.id, conviteId);
    } catch (erro) {
      aviso = codigoDoErro(erro);
    }
  }

  revalidatePath(ROTA);
  redirect(`${ROTA}?aviso=${aviso}`);
}

/**
 * Promove um membro da equipe a Afiliado PRO.
 *
 * O papel é o que abre painel financeiro, então a permissão é conferida em dois
 * lugares independentes: aqui (quem chama precisa ser gerente) e dentro do
 * próprio `update` (o alvo precisa estar na equipe ACEITA deste gerente e ainda
 * ser 'user'). Um id adulterado no formulário afeta zero linha.
 */
export async function promover(formData: FormData): Promise<void> {
  const usuario = await exigirPapel(["manager"]);

  const alvoId = String(formData.get("alvoId") ?? "").trim();
  let aviso = "promovido";

  if (modoDemo) {
    aviso = "demo";
  } else if (!alvoId) {
    aviso = "dado_invalido";
  } else {
    try {
      await promoverAfiliado(usuario.id, alvoId);
    } catch (erro) {
      aviso = codigoDoErro(erro);
    }
  }

  revalidatePath(ROTA);
  redirect(`${ROTA}?aviso=${aviso}`);
}
