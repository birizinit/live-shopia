"use server";

import { redirect } from "next/navigation";
import { contarCaracteres } from "@/lib/caracteres";
import { MINIMO_CARACTERES_AUDIO, TETO_CARACTERES_AUDIO, ehIdValido } from "@/lib/dados/audios";
import { estimar } from "@/lib/dados/creditos";
import { gerarAudioPago } from "@/lib/dados/geracao-audio";
import { traduzirErro } from "@/lib/dados/erros";
import type { Estimativa } from "@/lib/dados/tipos";
import { modoDemo, servicos } from "@/lib/env";
import { exigirUsuario } from "@/lib/sessao";
import { numero } from "@/lib/utils";

/**
 * A ação que gasta crédito.
 *
 * Ela acontece em DUAS passagens pelo mesmo formulário: a primeira devolve a
 * estimativa (`estimar`, que lê o saldo real) e não toca em nada; a segunda,
 * com `confirmado=1`, cobra. Mostrar o custo depois de cobrar é o mesmo que
 * não mostrar.
 *
 * A chave de idempotência NÃO nasce aqui. Ela é gerada no render do Server
 * Component e viaja num campo oculto, justamente para sobreviver às duas
 * passagens e ao duplo clique: chave criada dentro da ação seria outra a cada
 * envio, e o mesmo texto seria cobrado duas vezes.
 */

export type CamposEstudio = {
  titulo: string;
  vozId: string;
  texto: string;
  roteiroId: string;
};

export type EstadoEstudio = {
  /** "confirmar" = a estimativa está na tela esperando o aceite. */
  etapa?: "escrever" | "confirmar";
  estimativa?: Estimativa;
  erro?: string;
  /** O cliente usa para decidir se oferece o link de compra de créditos. */
  codigo?: string;
  campos?: CamposEstudio;
};

function lerCampos(formData: FormData): CamposEstudio {
  return {
    titulo: String(formData.get("titulo") ?? "").trim(),
    vozId: String(formData.get("vozId") ?? ""),
    texto: String(formData.get("texto") ?? "").trim(),
    roteiroId: String(formData.get("roteiroId") ?? ""),
  };
}

export async function gerarAudio(
  _anterior: EstadoEstudio,
  formData: FormData,
): Promise<EstadoEstudio> {
  const usuario = await exigirUsuario("/estudio");
  const campos = lerCampos(formData);
  const chave = String(formData.get("chave") ?? "");
  const confirmado = formData.get("confirmado") === "1";

  if (modoDemo) {
    return {
      etapa: "escrever",
      campos,
      erro: "Modo demonstração: o áudio ao lado é exemplo e nada é gerado aqui.",
      codigo: "demo",
    };
  }

  // Sem chave da ElevenLabs a síntese devolve um tom de exemplo. Gerar assim
  // cobraria crédito de verdade por um áudio que não é voz — por isso a ação
  // recusa em vez de "funcionar".
  if (!servicos.voz) {
    return {
      etapa: "escrever",
      campos,
      erro:
        "A geração de voz está desligada (sem chave da ElevenLabs). " +
        "Nada é gerado e nenhum crédito é gasto.",
      codigo: "servico_indisponivel",
    };
  }

  if (!chave) {
    return {
      etapa: "escrever",
      campos,
      erro: "A página ficou tempo demais aberta. Recarregue e tente de novo.",
    };
  }

  if (!ehIdValido(campos.vozId)) {
    return { etapa: "escrever", campos, erro: "Escolha a voz da apresentadora." };
  }

  // Contagem só por contarCaracteres: é a mesma unidade (code points) que o
  // `length()` do Postgres cobra. `.length` divergiria em qualquer emoji.
  const caracteres = contarCaracteres(campos.texto);

  if (caracteres < MINIMO_CARACTERES_AUDIO) {
    return {
      etapa: "escrever",
      campos,
      erro: `Escreva ao menos ${numero(MINIMO_CARACTERES_AUDIO)} caracteres de fala.`,
    };
  }

  if (caracteres > TETO_CARACTERES_AUDIO) {
    return {
      etapa: "escrever",
      campos,
      erro:
        `O texto passa de ${numero(TETO_CARACTERES_AUDIO)} caracteres (~3 horas de fala). ` +
        "Divida em dois áudios — a montagem da live junta os dois sem gastar de novo.",
    };
  }

  const estimativa = await estimar(usuario.id, campos.texto);

  // Primeira passagem: mostra o custo e para aqui.
  if (!confirmado) return { etapa: "confirmar", estimativa, campos };

  if (!estimativa.suficiente) {
    return {
      etapa: "confirmar",
      estimativa,
      campos,
      erro: `Faltam ${numero(estimativa.faltam)} créditos para gerar este áudio.`,
      codigo: "saldo_insuficiente",
    };
  }

  let destino: string;

  try {
    destino = await gerar(usuario.id, campos, chave, caracteres);
  } catch (erro) {
    const dominio = traduzirErro(erro);
    return {
      etapa: "confirmar",
      estimativa,
      campos,
      erro: dominio.message,
      codigo: dominio.codigo,
    };
  }

  // Fora do try: `redirect` funciona lançando, e um catch o engoliria.
  redirect(destino);
}

/** Devolve o caminho para onde a tela vai depois de gerar (ou de reaproveitar). */
async function gerar(
  perfilId: string,
  campos: CamposEstudio,
  chave: string,
  caracteres: number,
): Promise<string> {
  const { audioId, situacao } = await gerarAudioPago(
    perfilId,
    {
      vozId: campos.vozId,
      titulo: campos.titulo,
      texto: campos.texto,
      roteiroVersaoId: campos.roteiroId,
    },
    chave,
    caracteres,
  );
  return `/estudio?audio=${audioId}&estado=${situacao}`;
}
