import "server-only";
import { createHash } from "node:crypto";
import { bd } from "@/lib/db";
import { contarCaracteres } from "@/lib/caracteres";
import { servicos } from "@/lib/env";
import { audioProntoIgual, estadoAoVivo } from "./audios";
import { gerarAudioPago } from "./geracao-audio";

/**
 * Fala curta na voz da live — boas-vindas pelo nome, resposta de chat.
 *
 * A apresentadora responde falando, não escrevendo: escrever no chat do TikTok
 * dependia de simular digitação no editor dele (na primeira live real o texto
 * entrou no campo mas não foi enviado), e voz é o que a pessoa assistindo
 * espera de uma apresentadora.
 *
 * A frase passa pela mesma porta paga de qualquer áudio (`gerarAudioPago`):
 * cobra os caracteres UMA vez e fica guardada — "Seja bem-vindo(a), Ana!"
 * na segunda vez sai de graça, e a chave derivada do texto impede cobrança em
 * dobro se dois comentários iguais chegarem juntos.
 */

export type Fala = { audioId: string; blocos: { arquivoId: string; ordem: number }[] };

/** Quanto a decisão espera a síntese. Frase curta sai em 1–3 s. */
const ESPERA_MAXIMA_MS = 12_000;
const INTERVALO_MS = 400;

/** Voz da live; sem ela, a do primeiro áudio da montagem que está no ar. */
async function vozDaLive(perfilId: string): Promise<string | null> {
  const linhas = await bd()<{ voz_id: string | null }[]>`
    select coalesce(
      (select lc.voz_id from live_config lc where lc.perfil_id = ${perfilId}),
      (select a.voz_id
         from montagem_itens i
         join montagens m on m.id = i.montagem_id and m.ativa and m.perfil_id = ${perfilId}
         join audios a on a.id = i.audio_id and a.perfil_id = ${perfilId}
        where i.perfil_id = ${perfilId}
        order by i.ordem
        limit 1)
    ) as voz_id
  `;
  return linhas[0]?.voz_id ?? null;
}

function blocosDe(vivo: Awaited<ReturnType<typeof estadoAoVivo>>) {
  return (vivo?.blocos ?? []).map((b) => ({ arquivoId: b.id, ordem: b.ordem }));
}

/**
 * A fala pronta para tocar, ou `null` quando não deu a tempo (sem voz
 * configurada, sem saldo, provedor lento). `null` vira silêncio — melhor do que
 * responder um minuto depois, quando a pessoa já saiu.
 */
export async function falaPronta(perfilId: string, texto: string): Promise<Fala | null> {
  if (!servicos.voz) return null;
  const vozId = await vozDaLive(perfilId);
  if (!vozId) return null;

  const igual = await audioProntoIgual(perfilId, vozId, texto);
  if (igual) {
    const vivo = await estadoAoVivo(perfilId, igual.id);
    const blocos = blocosDe(vivo);
    if (blocos.length) return { audioId: igual.id, blocos };
  }

  const chave = `fala:${createHash("sha256").update(`${vozId}|${texto}`).digest("hex").slice(0, 40)}`;
  let audioId: string;
  try {
    ({ audioId } = await gerarAudioPago(
      perfilId,
      { vozId, titulo: `Resposta ao vivo: ${texto.slice(0, 50)}`, texto, roteiroVersaoId: null },
      chave,
      contarCaracteres(texto),
    ));
  } catch {
    // Saldo insuficiente ou voz indisponível: a live segue, só sem esta fala.
    return null;
  }

  const limite = Date.now() + ESPERA_MAXIMA_MS;
  while (Date.now() < limite) {
    const vivo = await estadoAoVivo(perfilId, audioId);
    if (vivo?.estado === "pronto") return { audioId, blocos: blocosDe(vivo) };
    if (vivo?.estado === "falhou" || vivo?.job?.estado === "falhou") return null;
    await new Promise((r) => setTimeout(r, INTERVALO_MS));
  }
  return null;
}

// -----------------------------------------------------------------------------
// Falas curtas da live: pontes e interações.
// -----------------------------------------------------------------------------

/**
 * Ditas depois de responder alguém, antes de retomar o roteiro. Sem elas a
 * apresentadora voltava do ponto exato em que parou, como fita que despausa.
 */
export const PONTES = [
  "Então, voltando aqui…",
  "Bom, como eu tava falando…",
  "Mas continuando…",
  "Enfim, voltando pro que eu tava mostrando…",
];

/**
 * Ditas de vez em quando entre as partes do roteiro. É o que uma apresentadora
 * de verdade faz entre um argumento e outro — e o que faltava para a live não
 * soar como gravação lida em laço.
 */
export const INTERACOES = [
  "Se você acabou de chegar, seja muito bem-vindo! Comenta aqui de onde você tá assistindo.",
  "Qualquer dúvida sobre o produto, pode mandar no chat que eu respondo.",
  "Deixa o seu like aí pra live chegar em mais gente!",
  "Pra garantir o seu, é só tocar no carrinho aqui embaixo.",
];

export type FalasCurtas = { pontes: Fala[]; interacoes: Fala[] };

/**
 * As falas curtas que já estão prontas na voz da live.
 *
 * Não espera síntese: a montagem é pedida no caminho quente da extensão. O que
 * falta é encomendado agora e aparece na próxima vez que a extensão atualizar
 * a montagem — cobrado uma vez só (~350 caracteres no total), pela chave
 * derivada do texto.
 */
export async function falasCurtasDaLive(perfilId: string): Promise<FalasCurtas> {
  const vazio: FalasCurtas = { pontes: [], interacoes: [] };
  if (!servicos.voz) return vazio;
  const vozId = await vozDaLive(perfilId);
  if (!vozId) return vazio;

  const pronta = async (texto: string): Promise<Fala | null> => {
    const igual = await audioProntoIgual(perfilId, vozId, texto);
    if (igual) {
      const blocos = blocosDe(await estadoAoVivo(perfilId, igual.id));
      if (blocos.length) return { audioId: igual.id, blocos };
    }
    const chave = `fala:${createHash("sha256").update(`${vozId}|${texto}`).digest("hex").slice(0, 40)}`;
    void gerarAudioPago(
      perfilId,
      { vozId, titulo: `Fala da live: ${texto.slice(0, 50)}`, texto, roteiroVersaoId: null },
      chave,
      contarCaracteres(texto),
    ).catch(() => {});
    return null;
  };

  const prontas = async (textos: string[]) =>
    (await Promise.all(textos.map(pronta))).filter((f): f is Fala => f !== null);

  return { pontes: await prontas(PONTES), interacoes: await prontas(INTERACOES) };
}
