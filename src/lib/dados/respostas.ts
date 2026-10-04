import "server-only";
import { bd } from "@/lib/db";
import { comoJson, numeroDe } from "./comum";
import { ehCumprimento } from "@/lib/cumprimento";

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

/**
 * Teto de uma mensagem no chat da live, declarado pelo próprio TikTok
 * (`maxlength="150"` no campo). Cortar aqui é melhor do que a página cortar:
 * ela corta no meio da palavra e ninguém fica sabendo.
 */
const TETO_CHAT = 150;

export type Decisao =
  | {
      acao: "ignorar";
      motivo: string;
      /**
       * Vai preenchido mesmo quando a gente NÃO responde: o evento aconteceu, e
       * o contador e o sininho da extensão não dependem de a reação no chat
       * estar ligada. Quem desligou o texto ainda quer ver o número subir.
       */
      loja?: "carrinho" | "venda";
    }
  | {
      acao: "escrever";
      texto: string;
      esperarMs: number;
      tema: string | null;
      /**
       * Quando a mensagem é reação a um evento da loja. A extensão usa para
       * tocar o sino e para contar — e `tipo` vira o tipo do evento gravado,
       * para o contador da live saber o que foi carrinho e o que foi venda.
       */
      loja?: "carrinho" | "venda";
    };

type LinhaConfig = {
  responder_chat: boolean;
  dar_boas_vindas: boolean;
  boas_vindas_texto: string | null;
  chat_intervalo_min_s: number;
  chat_intervalo_max_s: number;
  chat_teto_por_minuto: number;
  carrinho_ativo: boolean;
  carrinho_texto: string | null;
  venda_ativo: boolean;
  venda_texto: string | null;
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

/**
 * Mensagem de sistema do TikTok, ou pergunta de gente?
 *
 * Os padrões moram no banco (`padroes_sistema`, 0029) pelo mesmo motivo do mapa
 * de seletores: a frase é escrita pelo TikTok, muda sem avisar e sem versão, e
 * o conserto precisa ser um INSERT em vez de um deploy.
 */
async function classificarSistema(texto: string): Promise<"carrinho" | "venda" | "ignorar" | null> {
  const linhas = await bd()<{ tipo: "carrinho" | "venda" | "ignorar" | null }[]>`
    select classificar_mensagem(${texto}) as tipo
  `;
  return linhas[0]?.tipo ?? null;
}

async function configDaLive(perfilId: string): Promise<LinhaConfig | null> {
  const linhas = await bd()<LinhaConfig[]>`
    select responder_chat, dar_boas_vindas, boas_vindas_texto,
           chat_intervalo_min_s, chat_intervalo_max_s, chat_teto_por_minuto,
           carrinho_ativo, carrinho_texto, venda_ativo, venda_texto
      from live_config
     where perfil_id = ${perfilId}
  `;
  return linhas[0] ?? null;
}

/** Quantas respostas saíram no último minuto, e quando foi a última. */
/**
 * Tudo que a Shopia ESCREVEU no chat conta para a cadência.
 *
 * Os tipos são dois porque servem a leituras diferentes — `aviso` existe para o
 * agendador saber quando cada aviso saiu pela última vez — mas para a cadência
 * eles são a mesma coisa: mensagem nossa aparecendo no chat. Contar só
 * `resposta_ia` deixaria os avisos programados fora da conta, e aí o teto por
 * minuto seria furado justamente pela automação que roda sozinha e que ninguém
 * está olhando.
 */
export const TIPOS_QUE_ESCREVEM = ["resposta_ia", "aviso"] as const;

async function ritmoRecente(perfilId: string, sessaoId: string) {
  const linhas = await bd()<{ no_minuto: number; segundos_desde: number | null }[]>`
    select
      count(*) filter (where criado_em > now() - interval '1 minute')::int as no_minuto,
      extract(epoch from (now() - max(criado_em)))::int as segundos_desde
      from live_eventos
     where perfil_id = ${perfilId}
       and live_sessao_id = ${sessaoId}
       and tipo = any(${[...TIPOS_QUE_ESCREVEM]})
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
      texto: modelo.replaceAll("{nome}", apelido).slice(0, TETO_CHAT),
      esperarMs: esperaComJitter(config.chat_intervalo_min_s, config.chat_intervalo_max_s),
      tema: "boas_vindas",
    };
  }

  // --------------------------------------------------------------- comentário
  const texto = pedido.texto?.trim();
  if (!texto || texto.length < 2) return { acao: "ignorar", motivo: "vazio" };

  // ------------------------------------------------- mensagem de sistema
  //
  // Vem ANTES de `responder_chat` e antes do manual, porque não é pergunta de
  // ninguém: é o TikTok anunciando no chat que alguém adicionou ao carrinho,
  // comprou, ou só compartilhou. Tratar isso como comentário tem dois custos
  // reais que a gente já pagou: "compartilhou a LIVE" foi para a lista de
  // "perguntas que ninguém soube responder" como se alguém tivesse perguntado
  // algo, e um gatilho de manual com a palavra "comprar" responderia à
  // mensagem de sistema em vez de ao cliente.
  const sistema = await classificarSistema(texto);

  if (sistema === "ignorar") return { acao: "ignorar", motivo: "mensagem_de_sistema" };

  if (sistema === "carrinho" || sistema === "venda") {
    // Grava primeiro, decide depois: o contador não depende de a gente reagir.
    await registrarEventoDaLoja(perfilId, pedido.sessaoId, sistema, pedido.apelido ?? null);

    const ligado = sistema === "carrinho" ? config.carrinho_ativo : config.venda_ativo;
    const modelo = (sistema === "carrinho" ? config.carrinho_texto : config.venda_texto)?.trim();

    // Mesmo desligado, o evento é devolvido para a extensão contar e tocar o
    // sino. Quem não quer reagir no chat ainda quer ver o número subir.
    if (!ligado || !modelo) {
      return { acao: "ignorar", motivo: `loja_${sistema}_desligado`, loja: sistema };
    }

    const ritmoLoja = await ritmoRecente(perfilId, pedido.sessaoId);
    if (ritmoLoja.noMinuto >= config.chat_teto_por_minuto) {
      return { acao: "ignorar", motivo: "teto_por_minuto", loja: sistema };
    }

    // O nome vem de quem "falou": é assim que o TikTok monta a mensagem de
    // sistema — apelido de quem agiu, ação no texto.
    const quem = pedido.apelido?.trim() || "alguém";

    return {
      acao: "escrever",
      texto: modelo.replaceAll("{nome}", quem).slice(0, TETO_CHAT),
      // Reação a venda é a única que não espera: o valor dela é ser imediata,
      // e ela acontece raramente — não é ela que cria rajada.
      esperarMs: esperaComJitter(1, Math.max(1, config.chat_intervalo_min_s)),
      tema: `loja_${sistema}`,
      loja: sistema,
    };
  }

  // ------------------------------------------------------- pergunta de cliente
  if (!config.responder_chat) return { acao: "ignorar", motivo: "desligado" };

  const ritmo = await ritmoRecente(perfilId, pedido.sessaoId);

  if (ritmo.noMinuto >= config.chat_teto_por_minuto) {
    return { acao: "ignorar", motivo: "teto_por_minuto" };
  }
  if (ritmo.segundosDesde !== null && ritmo.segundosDesde < config.chat_intervalo_min_s) {
    return { acao: "ignorar", motivo: "intervalo_minimo" };
  }

  const temas = await bd()<{ id: string; chave: string; resposta: string }[]>`
    select id, chave, resposta
      from casar_tema(${perfilId}, ${texto}, ${pedido.produtoId})
     where id is not null
  `;

  // Cumprimento solto ("oi", "boa noite") não casa com tema nenhum, mas pede
  // resposta: quem cumprimenta e é ignorado vai embora.
  if (ehCumprimento(texto) && config.dar_boas_vindas) {
    const apelido = pedido.apelido?.trim() || "";
    const modelo = config.boas_vindas_texto?.trim() || "Seja bem-vindo(a), {nome}!";
    const frase = apelido ? modelo.replaceAll("{nome}", apelido) : "Oi! Seja bem-vindo(a) à live!";
    return {
      acao: "escrever",
      texto: frase.slice(0, TETO_CHAT),
      esperarMs: esperaComJitter(config.chat_intervalo_min_s, config.chat_intervalo_max_s),
      tema: "cumprimento",
    };
  }

  const tema = temas[0];
  // Sem tema, silêncio. Inventar resposta com IA a cada comentário solto é
  // custo por evento num produto cuja margem depende de custo por geração —
  // e é assim que a Shopia responde bobagem na frente da audiência.
  if (!tema) return { acao: "ignorar", motivo: "sem_tema" };

  const esperarMs = esperaComJitter(
    config.chat_intervalo_min_s,
    config.chat_intervalo_max_s,
  );

  await bd()`update temas_resposta set vezes_usado = vezes_usado + 1 where id = ${tema.id}`;

  return {
    acao: "escrever",
    texto: tema.resposta.slice(0, TETO_CHAT),
    esperarMs,
    tema: tema.chave,
  };
}

/**
 * Registra que a resposta saiu.
 *
 * Chamado pela extensão DEPOIS do envio, e não junto da decisão: contar antes
 * de enviar faria a cadência apertar por respostas que nunca saíram — e a
 * Shopia ficaria calada porque o servidor achou que ela já tinha respondido.
 */
export async function registrarResposta(
  perfilId: string,
  sessaoId: string,
  texto: string,
  tema: string | null,
  /** `aviso` quando foi texto programado; o id dele vai no `dados`. */
  opcoes: { tipo?: "resposta_ia" | "aviso"; avisoId?: string | null } = {},
): Promise<void> {
  const tipo = opcoes.tipo ?? "resposta_ia";

  // comoJson e não JSON.stringify: com `${JSON.stringify(obj)}::jsonb` o
  // postgres.js codifica a string de novo e o que fica gravado é um jsonb do
  // tipo STRING — `dados->>'tema'` devolve null e o histórico perde o tema.
  await bd()`
    insert into live_eventos (live_sessao_id, perfil_id, tipo, texto, dados)
    select ${sessaoId}, ${perfilId}, ${tipo}, ${texto.slice(0, 500)},
           ${comoJson({ tema, aviso_id: opcoes.avisoId ?? null })}
     where exists (
       select 1 from live_sessoes
        where id = ${sessaoId} and perfil_id = ${perfilId} and fim is null
     )
  `;
}

/**
 * Grava que o TikTok anunciou carrinho ou venda.
 *
 * Separado do registro da RESPOSTA de propósito: o evento aconteceu, e precisa
 * entrar no contador, mesmo que a pessoa tenha desligado a reação no chat.
 * Juntar os dois faria o contador parar de subir quando alguém desliga o texto.
 *
 * Não escreve em `vendas`, que é o que alimenta dashboard e ranking. Venda
 * DETECTADA numa mensagem de chat não é venda MEDIDA — e aceitar número vindo
 * de uma extensão que o próprio cliente controla seria deixar o ranking ser
 * escrito por quem o disputa.
 */
async function registrarEventoDaLoja(
  perfilId: string,
  sessaoId: string,
  tipo: "carrinho" | "venda",
  apelido: string | null,
): Promise<void> {
  await bd()`
    insert into live_eventos (live_sessao_id, perfil_id, tipo, apelido, dados)
    select ${sessaoId}, ${perfilId}, ${tipo}, ${apelido?.slice(0, 80) ?? null},
           ${comoJson({ origem: "mensagem_do_chat" })}
     where exists (
       select 1 from live_sessoes
        where id = ${sessaoId} and perfil_id = ${perfilId} and fim is null
     )
  `;
}
