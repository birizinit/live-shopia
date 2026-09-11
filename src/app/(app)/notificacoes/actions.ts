"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ErroDominio } from "@/lib/dados/erros";
import { esquecerInscricao, salvarPreferencias, LIMIAR_MAXIMO } from "@/lib/dados/push";
import { exigirUsuario } from "@/lib/sessao";

/**
 * Mutacoes da tela de notificacoes.
 *
 * A inscricao em si nao passa por aqui: ela nasce no navegador e e gravada
 * pela rota /api/push/inscrever, que o service worker tambem usa quando o
 * navegador rotaciona a inscricao sozinho. O que sobra para Server Action e o
 * que e formulario de verdade: as preferencias e o esquecer aparelho.
 */

export type EstadoAcao = {
  tom?: "sucesso" | "info" | "erro";
  mensagem?: string;
  /**
   * Instante do envio. Dois salvamentos seguidos com o MESMO resultado
   * produziriam estados iguais, e o aviso nao apareceria na segunda vez.
   */
  em?: number;
};

const ROTA = "/notificacoes";

const booleano = z.enum(["0", "1"]).transform((valor) => valor === "1");

const esquemaPreferencias = z.object({
  venda: booleano,
  quedaLive: booleano,
  creditosBaixos: booleano,
  limiar: z.coerce
    .number()
    .int("Use um número inteiro")
    .min(0, "O limite não pode ser negativo")
    .max(LIMIAR_MAXIMO, "Limite alto demais"),
});

const esquemaEsquecer = z.object({
  id: z.uuid("Aparelho inválido"),
});

function falha(erro: unknown): EstadoAcao {
  const mensagem =
    erro instanceof ErroDominio ? erro.message : "Não foi possível salvar agora.";
  return { tom: "erro", mensagem, em: Date.now() };
}

export async function salvarPreferenciasAcao(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const usuario = await exigirUsuario(ROTA);

  const dados = esquemaPreferencias.safeParse({
    venda: formData.get("venda"),
    quedaLive: formData.get("quedaLive"),
    creditosBaixos: formData.get("creditosBaixos"),
    limiar: formData.get("limiar"),
  });

  if (!dados.success) {
    return {
      tom: "erro",
      mensagem: dados.error.issues[0]?.message ?? "Confira os campos.",
      em: Date.now(),
    };
  }

  if (usuario.demo) {
    // A sessao demo nao tem linha em `perfis`; o upsert quebraria na chave
    // estrangeira. Dizer que salvou seria mentir.
    return {
      tom: "info",
      mensagem: "Modo demonstração: a escolha não foi salva.",
      em: Date.now(),
    };
  }

  try {
    await salvarPreferencias(usuario.id, {
      venda: dados.data.venda,
      quedaLive: dados.data.quedaLive,
      creditosBaixos: dados.data.creditosBaixos,
      creditosLimiar: dados.data.limiar,
    });
  } catch (erro) {
    return falha(erro);
  }

  revalidatePath(ROTA);
  return { tom: "sucesso", mensagem: "Preferências salvas.", em: Date.now() };
}

export async function esquecerDispositivoAcao(
  _anterior: EstadoAcao,
  formData: FormData,
): Promise<EstadoAcao> {
  const usuario = await exigirUsuario(ROTA);

  const dados = esquemaEsquecer.safeParse({ id: formData.get("id") });
  if (!dados.success) {
    return { tom: "erro", mensagem: "Aparelho inválido.", em: Date.now() };
  }

  if (usuario.demo) {
    return {
      tom: "info",
      mensagem: "Modo demonstração: os aparelhos são de exemplo.",
      em: Date.now(),
    };
  }

  try {
    const removida = await esquecerInscricao(usuario.id, dados.data.id);
    if (!removida) {
      return { tom: "info", mensagem: "Esse aparelho já tinha saído da lista.", em: Date.now() };
    }
  } catch (erro) {
    return falha(erro);
  }

  revalidatePath(ROTA);
  return {
    tom: "sucesso",
    mensagem: "Aparelho esquecido. Ele para de receber notificações.",
    em: Date.now(),
  };
}
