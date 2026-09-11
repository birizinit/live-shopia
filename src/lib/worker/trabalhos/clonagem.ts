import "server-only";
import { bd } from "@/lib/db";
import { ler } from "@/lib/armazenamento";
import { env, servicos } from "@/lib/env";
import { ErroDominio } from "@/lib/dados/erros";
import type { GeneroVoz, ModoClonagem } from "@/lib/dados/clonagem";
import type { Contexto } from "../index";

/**
 * Cria a voz clonada a partir de uma amostra já enviada e consentida.
 *
 * A chamada à ElevenLabs mora aqui, e não em src/lib/integracoes/elevenlabs.ts,
 * porque aquele módulo é da fase 1 (síntese) e este handler é o único ponto do
 * sistema que fala com o endpoint de clonagem.
 *
 * O consentimento é reconferido no banco antes de enviar qualquer byte para
 * fora. A constraint de 0009 já impede a amostra chegar aqui sem ele, mas o
 * trabalho roda minutos depois da tela — e é exatamente esse tipo de "já foi
 * validado antes" que produz clonagem sem autorização.
 */

const BASE = "https://api.elevenlabs.io/v1";

const EXTENSAO_POR_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
};

type LinhaAmostra = {
  id: string;
  nome: string;
  modo: ModoClonagem;
  estado: string;
  arquivo_id: string | null;
  voz_id: string | null;
  consentimento_em: Date | null;
  consentimento_texto: string | null;
};

async function registrarErro(amostraId: string, mensagem: string, definitivo: boolean) {
  const texto = mensagem.slice(0, 500);
  await bd()`
    update vozes_amostras
       set erro = ${texto},
           estado = ${definitivo ? "recusada" : "processando"}::estado_amostra
     where id = ${amostraId}
  `;
}

/**
 * É a última tentativa?
 *
 * `reservar_jobs` já somou 1 em `tentativas` ao reservar, e `falhar_job` mata o
 * job quando `tentativas >= max_tentativas`. Sem esta conta, a amostra ficaria
 * "processando" para sempre depois do job morrer, e o usuário esperaria uma
 * voz que nunca vem.
 */
async function ultimaTentativa(jobId: string): Promise<boolean> {
  const linhas = await bd()<{ tentativas: number; max_tentativas: number }[]>`
    select tentativas, max_tentativas from jobs where id = ${jobId}
  `;
  const l = linhas[0];
  return l ? l.tentativas >= l.max_tentativas : true;
}

type VozNoProvedor = { provedorVozId: string; exigeVerificacao: boolean };

async function clonarNoProvedor(opcoes: {
  nome: string;
  descricao: string | null;
  modo: ModoClonagem;
  idioma: string;
  genero: GeneroVoz;
  conteudo: Buffer;
  mime: string;
}): Promise<VozNoProvedor> {
  const extensao = EXTENSAO_POR_MIME[opcoes.mime] ?? "mp3";

  const corpo = new FormData();
  corpo.append("name", opcoes.nome);
  corpo.append(
    "files",
    new Blob([new Uint8Array(opcoes.conteudo)], { type: opcoes.mime }),
    `amostra.${extensao}`,
  );
  if (opcoes.descricao) corpo.append("description", opcoes.descricao);
  corpo.append(
    "labels",
    JSON.stringify({
      idioma: opcoes.idioma,
      genero: opcoes.genero,
      modo: opcoes.modo,
      origem: "shopia",
    }),
  );
  // No modo treino a amostra é longa e costuma vir de gravação caseira; limpar
  // o ruído de fundo é o que separa o resultado fiel do resultado abafado.
  corpo.append("remove_background_noise", opcoes.modo === "treino" ? "true" : "false");

  const resposta = await fetch(`${BASE}/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": env.elevenlabsApiKey },
    body: corpo,
  });

  if (!resposta.ok) {
    const detalhe = (await resposta.text().catch(() => "")).slice(0, 300);
    // 401/402/403 é chave inválida, sem saldo ou plano sem clonagem; 422 é
    // amostra que o provedor recusou. Repetir qualquer um só queima tentativa.
    const permanente = [401, 402, 403, 422].includes(resposta.status);

    throw new ErroDominio(
      permanente ? "sem_permissao" : "servico_indisponivel",
      permanente
        ? `A conta de voz recusou a clonagem (HTTP ${resposta.status}). ${detalhe}`
        : "O provedor de voz não respondeu. Vamos tentar de novo.",
      detalhe,
    );
  }

  const dados = (await resposta.json()) as {
    voice_id?: string;
    requires_verification?: boolean;
  };

  if (!dados.voice_id) {
    throw new ErroDominio("servico_indisponivel", "O provedor não devolveu o id da voz.");
  }

  return {
    provedorVozId: dados.voice_id,
    exigeVerificacao: Boolean(dados.requires_verification),
  };
}

export async function executarClonagem({ jobId, perfilId, entrada, progresso }: Contexto) {
  const amostraId = String(entrada.amostra_id ?? "");
  if (!perfilId || !amostraId) {
    throw new ErroDominio("dado_invalido", "job de clonagem sem amostra");
  }

  const sql = bd();

  const amostra = (
    await sql<LinhaAmostra[]>`
      select id, nome, modo, estado::text as estado, arquivo_id, voz_id,
             consentimento_em, consentimento_texto
        from vozes_amostras
       where id = ${amostraId} and perfil_id = ${perfilId}
    `
  )[0];

  if (!amostra) throw new ErroDominio("nao_encontrado", "amostra não encontrada");

  // Repetição depois de a voz já ter nascido: não clona de novo (pagaria duas
  // vezes e deixaria duas vozes iguais no catálogo do usuário).
  if (amostra.voz_id) {
    await progresso(100);
    return { voz_id: amostra.voz_id, repetido: true };
  }

  try {
    if (!amostra.consentimento_em || !amostra.consentimento_texto?.trim()) {
      throw new ErroDominio(
        "sem_permissao",
        "A amostra não tem consentimento registrado e não pode ser clonada.",
      );
    }

    if (!servicos.voz) {
      throw new ErroDominio(
        "sem_permissao",
        "A clonagem depende de ELEVENLABS_API_KEY, que não está configurada.",
      );
    }

    if (!amostra.arquivo_id) {
      throw new ErroDominio("nao_encontrado", "o áudio desta amostra não está mais disponível");
    }

    await progresso(10);

    const arquivo = await ler(perfilId, amostra.arquivo_id);
    if (!arquivo) {
      throw new ErroDominio("nao_encontrado", "o áudio desta amostra não está mais disponível");
    }

    await progresso(30);

    const voz = await clonarNoProvedor({
      nome: amostra.nome,
      descricao: typeof entrada.descricao === "string" ? entrada.descricao : null,
      modo: amostra.modo,
      idioma: typeof entrada.idioma === "string" ? entrada.idioma : "pt-BR",
      genero: (entrada.genero as GeneroVoz) ?? "feminina",
      conteudo: arquivo.conteudo,
      mime: arquivo.mime,
    });

    await progresso(80);

    // A voz nasce com o consentimento da amostra copiado: é o que a constraint
    // `vozes_clonada_com_consentimento` (0004) exige para ela ficar 'pronta'.
    const linha = (
      await sql<{ id: string }[]>`
        insert into vozes
          (perfil_id, origem, estado, nome, descricao, genero, idioma,
           provedor, provedor_voz_id, premium, amostra_id, consentimento_em, ativa)
        values
          (${perfilId}, 'clonada', 'pronta', ${amostra.nome},
           ${typeof entrada.descricao === "string" ? entrada.descricao : null},
           ${(entrada.genero as GeneroVoz) ?? "feminina"},
           ${typeof entrada.idioma === "string" ? entrada.idioma : "pt-BR"},
           'elevenlabs', ${voz.provedorVozId}, false, ${amostra.arquivo_id},
           ${amostra.consentimento_em}, true)
        returning id
      `
    )[0]!;

    await sql`
      update vozes_amostras
         set voz_id = ${linha.id}, estado = 'clonada', erro = null
       where id = ${amostraId} and perfil_id = ${perfilId}
    `;

    await progresso(100);
    return {
      voz_id: linha.id,
      provedor_voz_id: voz.provedorVozId,
      exige_verificacao: voz.exigeVerificacao,
    };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    const permanente = erro instanceof ErroDominio && erro.codigo === "sem_permissao";

    // Falha passageira só anota o motivo e deixa o job tentar de novo; a
    // amostra só vira 'recusada' quando não há mais tentativa pela frente —
    // e a constraint `vozes_amostras_recusa_explicada` exige o erro junto.
    try {
      await registrarErro(amostraId, mensagem, permanente || (await ultimaTentativa(jobId)));
    } catch (aoRegistrar) {
      // Anotar a falha não pode engolir a falha: quem manda no retry é o erro
      // original, e é ele que precisa chegar ao worker.
      console.error(`[clonagem] não deu para anotar o erro da amostra ${amostraId}:`, aoRegistrar);
    }

    throw erro;
  }
}
