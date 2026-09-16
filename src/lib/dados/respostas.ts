import "server-only";
import { bd } from "@/lib/db";
import { comoJson, numeroDe } from "./comum";

/**
 * A decisão de responder — e de calar.
 *
 * Mora no servidor, não na extensão, por três motivos:
 *   1. A cadência tem que ser decidida num lugar só. Duas abas abertas na mesma
 *      conta responderiam em dobro, e cadência dobrada é o sinal mais visível
 *      de automação que existe.
 *   2. Mudar uma resposta não pode exigir republicar a extensão.
 *   3. A extensão roda na máquina do cliente. Regra que protege a conta dele
 *      não pode ficar onde ele (ou um bug) consegue desligar.
 */

export type Decisao =
  | { acao: "ignorar"; motivo: string }
  | { acao: "escrever"; texto: string; esperarMs: number; tema: string | null }
  | {
      acao: "falar";
      texto: string;
      audioId: string;
      blocos: { arquivoId: string; ordem: number }[];
      esperarMs: number;
      tema: string;
    };

type LinhaConfig = {
  responder_chat: boolean;
  dar_boas_vindas: boolean;
  boas_vindas_texto: string | null;
  chat_intervalo_min_s: number;
  chat_intervalo_max_s: number;
  chat_teto_por_minuto: number;
};

/**
 * Espera antes de enviar, sorteada dentro da janela configurada.
 *
 * O sorteio é o ponto, não a espera: resposta que sai sempre em 12 segundos
 * exatos é mais denunciável do que resposta que demora. Gente responde em
 * tempo irregular.
 */
function esperaComJitter(minS: number, maxS: number) {
  const min = Math.max(1, minS) * 1000;
  const max = Math.max(min, maxS * 1000);
  return Math.round(min + Math.random() * (max - min));
}

async function configDaLive(perfilId: string): Promise<LinhaConfig | null> {
  const linhas = await bd()<LinhaConfig[]>`
    select responder_chat, dar_boas_vindas, boas_vindas_texto,
           chat_intervalo_min_s, chat_intervalo_max_s, chat_teto_por_minuto
      from live_config
     where perfil_id = ${perfilId}
  `;
  return linhas[0] ?? null;
}

/** Quantas respostas saíram no último minuto, e quando foi a última. */
async function ritmoRecente(perfilId: string, sessaoId: string) {
  const linhas = await bd()<{ no_minuto: number; segundos_desde: number | null }[]>`
    select
      count(*) filter (where criado_em > now() - interval '1 minute')::int as no_minuto,
      extract(epoch from (now() - max(criado_em)))::int as segundos_desde
      from live_eventos
     where perfil_id = ${perfilId}
       and live_sessao_id = ${sessaoId}
       and tipo = 'resposta_ia'
  `;
  return {
    noMinuto: numeroDe(linhas[0]?.no_minuto),
    segundosDesde: linhas[0]?.segundos_desde ?? null,
  };
}

export type PedidoDeResposta = {
  sessaoId: string;
  tipo: "comentario" | "entrada";
  apelido: string | null;
  texto: string | null;
  /** Produto em cena, quando a extensão souber dizer. */
  produtoId: string | null;
  /** A licença libera automação de chat? Vem do token, não do cliente. */
  chatLiberado: boolean;
};

export async function decidirResposta(
  perfilId: string,
  pedido: PedidoDeResposta,
): Promise<Decisao> {
  if (!pedido.chatLiberado) {
    return { acao: "ignorar", motivo: "chat_desligado" };
  }

  const config = await configDaLive(perfilId);
  if (!config) return { acao: "ignorar", motivo: "sem_config" };

  // ------------------------------------------------------------------ entrada
  if (pedido.tipo === "entrada") {
    if (!config.dar_boas_vindas) return { acao: "ignorar", motivo: "desligado" };

    const apelido = pedido.apelido?.trim();
    if (!apelido) return { acao: "ignorar", motivo: "sem_apelido" };

    const modelo = config.boas_vindas_texto?.trim() || "Seja bem-vindo(a), {nome}!";

    // Boas-vindas entram na mesma conta de cadência: saudar trinta pessoas em
    // trinta segundos é tão denunciável quanto responder trinta perguntas.
    const ritmo = await ritmoRecente(perfilId, pedido.sessaoId);
    if (ritmo.noMinuto >= config.chat_teto_por_minuto) {
      return { acao: "ignorar", motivo: "teto_por_minuto" };
    }

    return {
      acao: "escrever",
      texto: modelo.replaceAll("{nome}", apelido).slice(0, 280),
      esperarMs: esperaComJitter(config.chat_intervalo_min_s, config.chat_intervalo_max_s),
      tema: null,
    };
  }

  // --------------------------------------------------------------- comentário
  if (!config.responder_chat) return { acao: "ignorar", motivo: "desligado" };

  const texto = pedido.texto?.trim();
  if (!texto || texto.length < 2) return { acao: "ignorar", motivo: "vazio" };

  const ritmo = await ritmoRecente(perfilId, pedido.sessaoId);

  if (ritmo.noMinuto >= config.chat_teto_por_minuto) {
    return { acao: "ignorar", motivo: "teto_por_minuto" };
  }
  if (ritmo.segundosDesde !== null && ritmo.segundosDesde < config.chat_intervalo_min_s) {
    return { acao: "ignorar", motivo: "intervalo_minimo" };
  }

  const temas = await bd()<
    { id: string; chave: string; resposta: string; audio_id: string | null }[]
  >`
    select id, chave, resposta, audio_id
      from casar_tema(${perfilId}, ${texto}, ${pedido.produtoId})
     where id is not null
  `;

  const tema = temas[0];
  // Sem tema, silêncio. Inventar resposta com IA a cada comentário solto é
  // custo por evento num produto cuja margem depende de custo por geração —
  // e é assim que a apresentadora responde bobagem na frente da audiência.
  if (!tema) return { acao: "ignorar", motivo: "sem_tema" };

  const esperarMs = esperaComJitter(
    config.chat_intervalo_min_s,
    config.chat_intervalo_max_s,
  );

  if (tema.audio_id) {
    const blocos = await bd()<{ arquivo_id: string; ordem: number }[]>`
      select b.arquivo_id, b.ordem
        from audio_blocos b
        join arquivos a on a.id = b.arquivo_id and a.estado = 'pronto'
       where b.audio_id = ${tema.audio_id}
         and b.perfil_id = ${perfilId}
         and b.estado = 'pronto'
       order by b.ordem
    `;

    if (blocos.length > 0) {
      await bd()`
        update temas_resposta set vezes_usado = vezes_usado + 1 where id = ${tema.id}
      `;

      return {
        acao: "falar",
        texto: tema.resposta,
        audioId: tema.audio_id,
        blocos: blocos.map((b) => ({ arquivoId: b.arquivo_id, ordem: numeroDe(b.ordem) })),
        esperarMs,
        tema: tema.chave,
      };
    }
    // Áudio marcado mas sem bloco pronto: responde por texto em vez de calar.
  }

  await bd()`update temas_resposta set vezes_usado = vezes_usado + 1 where id = ${tema.id}`;

  return {
    acao: "escrever",
    texto: tema.resposta.slice(0, 280),
    esperarMs,
    tema: tema.chave,
  };
}

/**
 * Registra que a resposta saiu.
 *
 * Chamado pela extensão DEPOIS do envio, e não junto da decisão: contar antes
 * de enviar faria a cadência apertar por respostas que nunca saíram — e a
 * apresentadora ficaria muda porque o servidor achou que ela já tinha falado.
 */
export async function registrarResposta(
  perfilId: string,
  sessaoId: string,
  texto: string,
  tema: string | null,
): Promise<void> {
  // comoJson e não JSON.stringify: com `${JSON.stringify(obj)}::jsonb` o
  // postgres.js codifica a string de novo e o que fica gravado é um jsonb do
  // tipo STRING — `dados->>'tema'` devolve null e o histórico perde o tema.
  await bd()`
    insert into live_eventos (live_sessao_id, perfil_id, tipo, texto, dados)
    select ${sessaoId}, ${perfilId}, 'resposta_ia', ${texto.slice(0, 500)},
           ${comoJson({ tema })}
     where exists (
       select 1 from live_sessoes
        where id = ${sessaoId} and perfil_id = ${perfilId} and fim is null
     )
  `;
}
