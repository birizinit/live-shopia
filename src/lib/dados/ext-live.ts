import "server-only";
import { bd } from "@/lib/db";
import { ErroDominio } from "./erros";
import { numeroDe } from "./comum";

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

export type BlocoParaTocar = {
  /** Id do ARQUIVO, que é o que a extensão vai buscar em /api/ext/bloco. */
  arquivoId: string;
  ordem: number;
  bytes: number;
  duracaoMs: number | null;
};

export type FalaParaTocar = {
  audioId: string;
  ordem: number;
  titulo: string;
  duracaoMs: number;
  blocos: BlocoParaTocar[];
};

export type MontagemParaTocar = {
  id: string;
  nome: string;
  intervaloMs: number;
  embaralhar: boolean;
  volumeTrilha: number;
  trilha: { arquivoId: string; nome: string } | null;
  duracaoMs: number;
  falas: FalaParaTocar[];
};

/**
 * A montagem ativa, em blocos, pronta para tocar em laço.
 *
 * O arquivo contínuo de três horas não existe: são ~45 blocos de ~2 MB que a
 * extensão toca em ordem. Repetir a lista não gasta crédito nenhum, e é isso
 * que sustenta a margem do produto — por isso a extensão recebe a LISTA, e não
 * um pedido de geração.
 */
export async function montagemAtivaParaExtensao(
  perfilId: string,
): Promise<MontagemParaTocar | null> {
  const sql = bd();

  const montagens = await sql<
    {
      id: string;
      nome: string;
      intervalo_ms: number;
      embaralhar: boolean;
      volume_trilha: number;
      duracao_ms: number | null;
      trilha_arquivo: string | null;
      trilha_nome: string | null;
    }[]
  >`
    select m.id, m.nome, m.intervalo_ms, m.embaralhar, m.volume_trilha, m.duracao_ms,
           t.arquivo_id as trilha_arquivo, t.nome as trilha_nome
      from montagens m
      left join trilhas_ambiente t on t.id = m.trilha_id and t.ativa
     where m.perfil_id = ${perfilId} and m.ativa
     limit 1
  `;

  const m = montagens[0];
  if (!m) return null;

  // Uma consulta só para todos os blocos de todas as falas: a montagem tem
  // dezenas de blocos e uma consulta por fala seria N+1 no caminho quente da
  // extensão, que refaz isso a cada troca de montagem.
  const linhas = await sql<
    {
      audio_id: string;
      ordem_fala: number;
      titulo: string;
      audio_duracao: number | null;
      arquivo_id: string;
      ordem_bloco: number;
      bytes: number;
      bloco_duracao: number | null;
    }[]
  >`
    select a.id as audio_id, i.ordem as ordem_fala, a.titulo,
           a.duracao_ms as audio_duracao,
           b.arquivo_id, b.ordem as ordem_bloco,
           arq.bytes, b.duracao_ms as bloco_duracao
      from montagem_itens i
      join audios a on a.id = i.audio_id and a.perfil_id = ${perfilId}
      join audio_blocos b on b.audio_id = a.id and b.perfil_id = ${perfilId}
      join arquivos arq on arq.id = b.arquivo_id and arq.estado = 'pronto'
     where i.montagem_id = ${m.id} and i.perfil_id = ${perfilId}
       and b.estado = 'pronto' and b.arquivo_id is not null
     order by i.ordem, b.ordem
  `;

  const porFala = new Map<string, FalaParaTocar>();
  for (const l of linhas) {
    let fala = porFala.get(l.audio_id);
    if (!fala) {
      fala = {
        audioId: l.audio_id,
        ordem: numeroDe(l.ordem_fala),
        titulo: l.titulo,
        duracaoMs: numeroDe(l.audio_duracao),
        blocos: [],
      };
      porFala.set(l.audio_id, fala);
    }
    fala.blocos.push({
      arquivoId: l.arquivo_id,
      ordem: numeroDe(l.ordem_bloco),
      bytes: numeroDe(l.bytes),
      duracaoMs: l.bloco_duracao === null ? null : numeroDe(l.bloco_duracao),
    });
  }

  return {
    id: m.id,
    nome: m.nome,
    intervaloMs: numeroDe(m.intervalo_ms),
    embaralhar: m.embaralhar,
    volumeTrilha: Number(m.volume_trilha),
    trilha:
      m.trilha_arquivo && m.trilha_nome
        ? { arquivoId: m.trilha_arquivo, nome: m.trilha_nome }
        : null,
    duracaoMs: numeroDe(m.duracao_ms),
    falas: [...porFala.values()].sort((a, b) => a.ordem - b.ordem),
  };
}

export type BlocoServivel = {
  mime: string;
  bytes: number;
  conteudo: Buffer;
};

/**
 * Um bloco de áudio, conferindo o dono.
 *
 * A trilha de ambiente é global (perfil_id nulo) e vale para todo mundo; áudio
 * gerado é do dono e de mais ninguém. O `or` abaixo cobre os dois casos sem
 * abrir a porta: arquivo de OUTRO perfil não casa em nenhum dos dois lados.
 */
export async function blocoParaExtensao(
  perfilId: string,
  arquivoId: string,
): Promise<BlocoServivel | null> {
  const linhas = await bd()<
    { mime: string; bytes: number; conteudo: Buffer | null }[]
  >`
    select mime, bytes, conteudo
      from arquivos
     where id = ${arquivoId}
       and estado = 'pronto'
       and removido_em is null
       and (perfil_id = ${perfilId} or perfil_id is null)
  `;

  const a = linhas[0];
  if (!a?.conteudo) return null;

  return { mime: a.mime, bytes: numeroDe(a.bytes), conteudo: a.conteudo };
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
  dados: { montagemId: string | null; contaTikTokId: string | null },
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

  // Vínculos vêm por SELECT filtrado pelo dono: id de montagem ou de conta
  // mandado pela extensão não prova posse, e a FK só confere existência.
  const criadas = await sql<{ id: string }[]>`
    insert into live_sessoes (perfil_id, montagem_id, conta_tiktok_id, estado, origem)
    values (
      ${perfilId},
      (select m.id from montagens m
        where m.id = ${dados.montagemId} and m.perfil_id = ${perfilId}),
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

  // Encerrar com erro é "caiu", não "encerrada": para quem lê o dashboard, a
  // diferença entre a live que o dono desligou e a que morreu sozinha é a
  // informação inteira. O texto do erro fica na coluna `erro`.
  const linhas = await sql<{ id: string }[]>`
    update live_sessoes
       set fim = now(),
           visto_em = now(),
           estado = ${erro ? "caiu" : "encerrada"}::estado_live,
           erro = ${erro}
     where id = ${sessaoId} and perfil_id = ${perfilId} and fim is null
    returning id
  `;

  if (!linhas.length) return false;

  await sql`
    insert into live_eventos (live_sessao_id, perfil_id, tipo, texto)
    values (${sessaoId}, ${perfilId}, ${erro ? "erro" : "fim"}, ${erro})
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
    dados: JSON.stringify(e.dados ?? {}),
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
