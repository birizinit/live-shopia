import "server-only";
import { bd } from "@/lib/db";
import { revisarTexto } from "@/lib/termos-restritos";
import { encerramentoNormal } from "@/lib/telemetria-legado";
import { ErroDominio } from "./erros";
import { comoJson } from "./comum";

/**
 * O que a extensão precisa do servidor para operar a live.
 *
 * Estas funções são o outro lado das rotas em /api/ext: elas são chamadas por
 * requisição autenticada por TOKEN DE LICENÇA, não por cookie de sessão. Por
 * isso o `perfilId` aqui vem da licença já autenticada — nunca do corpo da
 * requisição, que é escrito pelo cliente.
 *
 * A convenção do projeto continua valendo sem exceção: perfilId é o primeiro
 * argumento e entra no `where` de toda consulta (db/README.md).
 */

export type RevisaoDoManual = {
  alertas: number;
  itens: { id: string; rotulo: string; exemplos: string[] }[];
};

/**
 * Revisão anti-restrição do MANUAL.
 *
 * A Shopia escreve no chat exatamente o que está no manual, palavra por
 * palavra — então é ali, e só ali, que pode haver frase que faz o TikTok
 * restringir a live: mandar para o WhatsApp, pedir Pix por fora, prometer
 * resultado. Revisar na hora do envio seria tarde; revisar o manual avisa
 * antes de a live começar.
 *
 * Não impede nada: quem decide é o vendedor, avisado. A extensão mostra o
 * número e aponta qual resposta corrigir.
 */
export async function revisaoDoManual(perfilId: string): Promise<RevisaoDoManual> {
  const linhas = await bd()<{ id: string; rotulo: string; resposta: string }[]>`
    select id, rotulo, resposta
      from temas_resposta
     where perfil_id = ${perfilId} and ativo
     order by ordem
  `;

  const itens: RevisaoDoManual["itens"] = [];
  let alertas = 0;

  for (const linha of linhas) {
    const achados = revisarTexto(linha.resposta);
    if (achados.length === 0) continue;
    alertas += achados.length;
    itens.push({
      id: linha.id,
      rotulo: linha.rotulo,
      exemplos: achados.slice(0, 3).map((a) => a.trecho),
    });
  }

  return { alertas, itens };
}

/**
 * O aceite do aviso de automação, na versão vigente.
 *
 * O painel já exigia isto para subir a live pelo site; a extensão abria sessão
 * sem conferir — e é ela que de fato opera a conta. Conferir aqui fecha a
 * porta que a tela sozinha não fecha.
 */
export async function riscoAceitoNaVersaoVigente(perfilId: string): Promise<boolean> {
  const linhas = await bd()<{ ok: boolean }[]>`
    select coalesce(lc.risco_aceito_versao, 0) >= coalesce(
             (select (c.valor #>> '{}')::int from configuracoes c
               where c.chave = 'live.risco_aceito_versao'), 1) as ok
      from live_config lc
     where lc.perfil_id = ${perfilId} and lc.risco_aceito_em is not null
  `;
  return linhas[0]?.ok === true;
}

/**
 * Abre a sessão de live, ou devolve a que já está aberta.
 *
 * Idempotente de propósito: a extensão reabre a sessão quando o navegador
 * reinicia, e criar uma linha nova a cada reconexão faria o dashboard contar
 * quatro lives onde houve uma.
 */
export async function abrirSessaoExtensao(
  perfilId: string,
  dados: { contaTikTokId: string | null },
): Promise<{ sessaoId: string; jaEstavaAberta: boolean }> {
  const sql = bd();

  const abertas = await sql<{ id: string }[]>`
    select id from live_sessoes
     where perfil_id = ${perfilId} and fim is null
     order by inicio desc
     limit 1
  `;

  if (abertas[0]) {
    await sql`
      update live_sessoes
         set visto_em = now(),
             estado = case when estado = 'iniciando' then 'ativa'::estado_live else estado end
       where id = ${abertas[0].id} and perfil_id = ${perfilId}
    `;
    return { sessaoId: abertas[0].id, jaEstavaAberta: true };
  }

  // O vínculo vem por SELECT filtrado pelo dono: id de conta mandado pela
  // extensão não prova posse, e a FK só confere existência.
  const criadas = await sql<{ id: string }[]>`
    insert into live_sessoes (perfil_id, conta_tiktok_id, estado, origem)
    values (
      ${perfilId},
      (select c.id from contas_tiktok c
        where c.id = ${dados.contaTikTokId} and c.perfil_id = ${perfilId}),
      'ativa',
      'extensao'
    )
    returning id
  `;

  const id = criadas[0]?.id;
  if (!id) throw new ErroDominio("dado_invalido", "Não foi possível abrir a sessão.");

  await sql`
    insert into live_eventos (live_sessao_id, perfil_id, tipo)
    values (${id}, ${perfilId}, 'inicio')
  `;

  return { sessaoId: id, jaEstavaAberta: false };
}

/** Batimento: é o que separa "no ar" de "o navegador fechou às 3h da manhã". */
export async function baterSessaoExtensao(
  perfilId: string,
  sessaoId: string,
  espectadores: number | null,
): Promise<boolean> {
  const linhas = await bd()<{ id: string }[]>`
    update live_sessoes
       set visto_em = now(),
           estado = case when estado = 'iniciando' then 'ativa'::estado_live else estado end,
           espectadores_pico = greatest(espectadores_pico, ${espectadores ?? 0})
     where id = ${sessaoId} and perfil_id = ${perfilId} and fim is null
    returning id
  `;
  return linhas.length > 0;
}

export async function fecharSessaoExtensao(
  perfilId: string,
  sessaoId: string,
  erro: string | null,
): Promise<boolean> {
  const sql = bd();
  // "Encerrada pelo usuário", "tempo programado encerrado"... chegam neste
  // campo mas não são erro: a pessoa desligou. Só o resto é queda.
  const falha = encerramentoNormal(erro) ? null : erro;

  // Encerrar com erro é "caiu", não "encerrada": para quem lê o dashboard, a
  // diferença entre a live que o dono desligou e a que morreu sozinha é a
  // informação inteira. O texto do erro fica na coluna `erro`.
  const linhas = await sql<{ id: string }[]>`
    update live_sessoes
       set fim = now(),
           visto_em = now(),
           estado = ${falha ? "caiu" : "encerrada"}::estado_live,
           erro = ${falha}
     where id = ${sessaoId} and perfil_id = ${perfilId} and fim is null
    returning id
  `;

  if (!linhas.length) return false;

  await sql`
    insert into live_eventos (live_sessao_id, perfil_id, tipo, texto)
    values (${sessaoId}, ${perfilId}, ${falha ? "erro" : "fim"}, ${erro})
  `;

  return true;
}

export type EventoDaExtensao = {
  tipo: string;
  apelido?: string | null;
  texto?: string | null;
  espectadores?: number | null;
  dados?: Record<string, unknown> | null;
};

/**
 * Ingestão em lote dos eventos da live.
 *
 * Em lote porque live movimentada gera centenas de eventos por minuto e uma
 * requisição por comentário seria tráfego pago por nós para nada.
 *
 * O tipo é conferido contra `live_evento_tipos` pela FK — evento inventado pela
 * extensão é recusado pelo banco, não aceito e guardado como lixo.
 */
export async function registrarEventosDaExtensao(
  perfilId: string,
  sessaoId: string,
  eventos: EventoDaExtensao[],
): Promise<number> {
  if (eventos.length === 0) return 0;

  const sql = bd();

  const pertence = await sql<{ id: string }[]>`
    select id from live_sessoes
     where id = ${sessaoId} and perfil_id = ${perfilId}
  `;
  if (!pertence.length) {
    throw new ErroDominio("nao_encontrado", "Sessão não encontrada ou não é sua.");
  }

  const linhas = eventos.map((e) => ({
    live_sessao_id: sessaoId,
    perfil_id: perfilId,
    tipo: e.tipo,
    apelido: e.apelido ?? null,
    texto: e.texto ?? null,
    espectadores: e.espectadores ?? null,
    // comoJson mantem o jsonb como OBJETO. JSON.stringify aqui gravaria uma
    // string JSON, e `dados->>chave` devolveria null em toda leitura.
    dados: comoJson(e.dados ?? {}),
  }));

  const gravados = await sql`
    insert into live_eventos ${sql(
      linhas,
      "live_sessao_id",
      "perfil_id",
      "tipo",
      "apelido",
      "texto",
      "espectadores",
      "dados",
    )}
    returning id
  `;

  return gravados.length;
}
