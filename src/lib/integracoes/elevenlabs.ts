import "server-only";
import { env, servicos } from "@/lib/env";
import { ErroDominio } from "@/lib/dados/erros";
import { contarCaracteres, duracaoEstimadaMs } from "@/lib/caracteres";

/**
 * Sintese de voz.
 *
 * Chamada por bloco, nunca pelo texto inteiro: o endpoint tem teto por
 * requisicao e e isso que define o tamanho do bloco em todo o resto do
 * sistema. Um bloco de ~2.400 caracteres da ~4 minutos e ~2 MB.
 *
 * Sem ELEVENLABS_API_KEY, devolve um audio de exemplo sintetizado localmente
 * (um tom curto), para o player e a montagem existirem antes da conta. O
 * retorno diz `demo: true` e a interface rotula — nunca finge que e voz.
 */

export type VozDoCatalogo = {
  provedorVozId: string;
  nome: string;
  descricao: string | null;
  genero: "feminina" | "masculina" | "neutra";
  idade: string | null;
  sotaque: string | null;
  categoria: string | null;
  uso: string | null;
  premium: boolean;
};

export type AudioSintetizado = {
  conteudo: Buffer;
  mime: string;
  duracaoMs: number;
  demo: boolean;
};

const BASE = "https://api.elevenlabs.io/v1";

/** WAV de 8 kHz mono com um tom suave — só para o player ter o que tocar. */
function audioDeExemplo(caracteres: number): AudioSintetizado {
  const duracaoMs = Math.min(duracaoEstimadaMs(caracteres), 8_000);
  const taxa = 8_000;
  const amostras = Math.max(1, Math.round((taxa * duracaoMs) / 1000));
  const dados = Buffer.alloc(amostras * 2);

  for (let i = 0; i < amostras; i += 1) {
    const envelope = Math.min(1, i / 400) * Math.min(1, (amostras - i) / 400);
    const valor = Math.sin((2 * Math.PI * 220 * i) / taxa) * 0.18 * envelope;
    dados.writeInt16LE(Math.round(valor * 32767), i * 2);
  }

  const cabecalho = Buffer.alloc(44);
  cabecalho.write("RIFF", 0);
  cabecalho.writeUInt32LE(36 + dados.length, 4);
  cabecalho.write("WAVEfmt ", 8);
  cabecalho.writeUInt32LE(16, 16);
  cabecalho.writeUInt16LE(1, 20);
  cabecalho.writeUInt16LE(1, 22);
  cabecalho.writeUInt32LE(taxa, 24);
  cabecalho.writeUInt32LE(taxa * 2, 28);
  cabecalho.writeUInt16LE(2, 32);
  cabecalho.writeUInt16LE(16, 34);
  cabecalho.write("data", 36);
  cabecalho.writeUInt32LE(dados.length, 40);

  return {
    conteudo: Buffer.concat([cabecalho, dados]),
    mime: "audio/wav",
    duracaoMs,
    demo: true,
  };
}

function generoDe(rotulos: Record<string, unknown> | undefined): VozDoCatalogo["genero"] {
  const bruto = String(rotulos?.gender ?? "").toLowerCase();
  if (bruto.startsWith("f")) return "feminina";
  if (bruto.startsWith("m")) return "masculina";
  return "neutra";
}

export async function catalogoDeVozes(): Promise<VozDoCatalogo[]> {
  if (!servicos.voz) return [];

  const resposta = await fetch(`${BASE}/voices`, {
    headers: { "xi-api-key": env.elevenlabsApiKey },
    cache: "no-store",
  });

  if (!resposta.ok) {
    throw new ErroDominio("servico_indisponivel", "Não foi possível ler o catálogo de vozes.");
  }

  const corpo = (await resposta.json()) as {
    voices?: {
      voice_id: string;
      name: string;
      description?: string | null;
      labels?: Record<string, unknown>;
      category?: string;
    }[];
  };

  return (corpo.voices ?? []).map((v) => ({
    provedorVozId: v.voice_id,
    nome: v.name,
    descricao: v.description ?? null,
    genero: generoDe(v.labels),
    idade: (v.labels?.age as string) ?? null,
    sotaque: (v.labels?.accent as string) ?? null,
    categoria: v.category ?? null,
    uso: (v.labels?.use_case as string) ?? null,
    premium: v.category !== "premade",
  }));
}

export async function sintetizar(
  texto: string,
  provedorVozId: string,
): Promise<AudioSintetizado> {
  const caracteres = contarCaracteres(texto);
  if (!servicos.voz) return audioDeExemplo(caracteres);

  const resposta = await fetch(
    `${BASE}/text-to-speech/${encodeURIComponent(provedorVozId)}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: {
        "xi-api-key": env.elevenlabsApiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: texto,
        model_id: env.elevenlabsModelo,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 },
      }),
    },
  );

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => "");
    // 401/402 é chave inválida ou sem saldo: não adianta repetir.
    const permanente = resposta.status === 401 || resposta.status === 402;
    throw new ErroDominio(
      permanente ? "sem_permissao" : "servico_indisponivel",
      permanente
        ? "A conta de voz recusou a chamada (chave inválida ou sem saldo)."
        : "A síntese de voz falhou. Vamos tentar de novo.",
      detalhe.slice(0, 300),
    );
  }

  const conteudo = Buffer.from(await resposta.arrayBuffer());
  return {
    conteudo,
    mime: "audio/mpeg",
    duracaoMs: duracaoEstimadaMs(caracteres),
    demo: false,
  };
}
