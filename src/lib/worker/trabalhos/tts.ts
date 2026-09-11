import "server-only";
import { bd } from "@/lib/db";
import { guardar } from "@/lib/armazenamento";
import { sintetizar } from "@/lib/integracoes/elevenlabs";
import { servicos } from "@/lib/env";
import { ErroDominio } from "@/lib/dados/erros";
import type { Contexto } from "../index";

/**
 * Sintetiza os blocos de um audio, em ordem.
 *
 * Um job por audio, nao por bloco: o credito ja foi debitado de uma vez e o
 * estorno precisa de um dono unico. Blocos ja prontos sao pulados, entao um
 * retry depois de falhar no bloco 30 nao refaz — nem repaga — os 29 primeiros.
 */
export async function executarTts({ perfilId, entrada, progresso }: Contexto) {
  const audioId = String(entrada.audio_id ?? "");
  if (!perfilId || !audioId) throw new ErroDominio("dado_invalido", "job de tts sem áudio");

  // Sem chave, sintetizar() devolve um tom de exemplo — e o crédito JA FOI
  // debitado quando o job entrou na fila. Gravar o exemplo como bloco pronto
  // fecharia o job com sucesso e o usuário teria pago por bipes. "sem_permissao"
  // é o código que o worker trata como falha permanente: estorna e não repete.
  if (!servicos.voz) {
    throw new ErroDominio(
      "sem_permissao",
      "A síntese de voz depende de ELEVENLABS_API_KEY, que não está configurada.",
    );
  }

  const sql = bd();

  const audio = (
    await sql<{ voz_id: string; provedor_voz_id: string | null; estado: string }[]>`
      select a.voz_id, v.provedor_voz_id, a.estado
        from audios a join vozes v on v.id = a.voz_id
       where a.id = ${audioId} and a.perfil_id = ${perfilId}
    `
  )[0];

  if (!audio) throw new ErroDominio("nao_encontrado", "áudio não encontrado");

  await sql`update audios set estado = 'gerando', erro = null where id = ${audioId}`;

  const blocos = await sql<{ id: string; ordem: number; texto: string }[]>`
    select id, ordem, texto from audio_blocos
     where audio_id = ${audioId} and estado <> 'pronto'
     order by ordem
  `;

  const total = (
    await sql<{ n: number }[]>`select count(*)::int as n from audio_blocos where audio_id = ${audioId}`
  )[0]!.n;

  let feitos = total - blocos.length;

  for (const bloco of blocos) {
    await sql`update audio_blocos set estado = 'gerando' where id = ${bloco.id}`;

    const fala = await sintetizar(bloco.texto, audio.provedor_voz_id ?? "");
    const arquivo = await guardar(perfilId, fala.conteudo, {
      mime: fala.mime,
      duracaoMs: fala.duracaoMs,
      metadados: { audio_id: audioId, ordem: bloco.ordem, demo: fala.demo },
    });

    await sql`
      update audio_blocos
         set estado = 'pronto', arquivo_id = ${arquivo.id}, duracao_ms = ${fala.duracaoMs}, erro = null
       where id = ${bloco.id}
    `;

    feitos += 1;
    await progresso(total ? (feitos / total) * 100 : 100);
  }

  return { blocos: total };
}
