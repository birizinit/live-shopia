import "server-only";
import {
  audioDaChave,
  audioProntoIgual,
  criarAudio,
  ehIdValido,
  marcarNaFila,
  removerRascunho,
  tituloSugerido,
} from "./audios";
import { debitarEEnfileirar } from "./creditos";

/**
 * Transforma texto em áudio pago — a mesma porta para o estúdio e para o
 * assistente de criação da live.
 *
 * Mora aqui, e não dentro de uma action, porque as duas telas precisam das
 * mesmas garantias: duplo clique volta para o MESMO áudio, texto igual com a
 * mesma voz é reaproveitado de graça, e rascunho que não chegou a ser cobrado
 * não sobra na lista.
 */

export type PedidoDeAudio = {
  vozId: string;
  titulo: string;
  texto: string;
  /** Versão do roteiro que virou fala, quando veio de um. */
  roteiroVersaoId: string | null;
};

export type AudioPedido = {
  audioId: string;
  /** novo = cobrou agora; andamento = esta chave já tinha cobrado; reuso = de graça. */
  situacao: "novo" | "andamento" | "reuso";
};

export async function gerarAudioPago(
  perfilId: string,
  pedido: PedidoDeAudio,
  chave: string,
  caracteres: number,
): Promise<AudioPedido> {
  // 1. Esta chave já gerou? Duplo clique e retry de rede caem aqui e voltam
  //    para o MESMO áudio, sem segunda cobrança.
  const jaGerado = await audioDaChave(perfilId, chave);
  if (jaGerado?.audioId) return { audioId: jaGerado.audioId, situacao: "andamento" };

  // 2. Mesmo texto, mesma voz, já pronto: reaproveita de graça.
  const igual = await audioProntoIgual(perfilId, pedido.vozId, pedido.texto);
  if (igual) return { audioId: igual.id, situacao: "reuso" };

  // 3. Fatia e grava os blocos ANTES de enfileirar: o job de tts trabalha em
  //    cima de audio_blocos, não do texto solto.
  const audio = await criarAudio(perfilId, {
    vozId: pedido.vozId,
    titulo: pedido.titulo || tituloSugerido(pedido.texto),
    texto: pedido.texto,
    roteiroVersaoId: ehIdValido(pedido.roteiroVersaoId) ? pedido.roteiroVersaoId : null,
  });

  try {
    const debito = await debitarEEnfileirar(perfilId, {
      caracteres,
      referencia: chave,
      tipo: "tts",
      entrada: { audio_id: audio.id },
    });

    if (debito.jaExistia) {
      // Outra aba (ou outro clique) venceu a corrida e já pagou por ESTA chave.
      // O job dela aponta para o áudio dela; o rascunho recém-criado aqui não
      // tem dono e é apagado, senão ficaria "na fila" para sempre.
      const dono = await audioDaChave(perfilId, chave);
      if (dono?.audioId && dono.audioId !== audio.id) {
        await removerRascunho(perfilId, audio.id);
        return { audioId: dono.audioId, situacao: "andamento" };
      }

      await marcarNaFila(perfilId, audio.id, debito);
      return { audioId: audio.id, situacao: "andamento" };
    }

    await marcarNaFila(perfilId, audio.id, debito);
    return { audioId: audio.id, situacao: "novo" };
  } catch (erro) {
    // Nada foi cobrado (o débito e o job são o mesmo commit), então o rascunho
    // não pode sobrar na lista fingindo que algo está sendo gerado.
    await removerRascunho(perfilId, audio.id).catch(() => {});
    throw erro;
  }
}
