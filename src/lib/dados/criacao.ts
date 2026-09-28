import "server-only";
import { bd } from "@/lib/db";
import { audioDoPerfil } from "./audios";
import { comDemo, numeroDe } from "./comum";
import { ErroDominio } from "./erros";
import { enfileirar } from "./fila";
import { salvarConfiguracaoLive } from "./live";
import {
  TETO_ITENS,
  ativarMontagem,
  criarMontagem,
  listarMontagens,
  montagemDoPerfil,
  salvarMontagem,
} from "./montagens";
import { criarProduto, type EntradaProduto } from "./produtos";
import { criarRoteiro, roteiroDaChave } from "./roteiros";

/**
 * O caminho curto até a live: produto → roteiro → voz → áudio → no ar.
 *
 * Antes, cada passo era uma tela e a pessoa precisava saber a ordem — as
 * primeiras clientes instalaram a extensão sem nunca ter gerado um áudio, e a
 * extensão não tinha o que tocar. Este módulo junta os passos que não pedem
 * decisão, e deixa para a tela só o que pede: o texto, a voz e o custo.
 *
 * Nada aqui cobra por conta própria. Quem cobra continua sendo
 * `debitarEEnfileirar`, via `gerarAudioPago`, depois de a pessoa ver o custo.
 */

export const NOME_MONTAGEM_PADRAO = "Minha live";

export type PedidoDeLive = {
  /** Produto já cadastrado… */
  produtoId: string | null;
  /** …ou o que acabou de ser digitado no assistente. */
  produto: EntradaProduto | null;
  minutos: number;
  tom: string | null;
  /** chaveIdempotente("roteiro"), gerada no render do formulário. */
  referencia: string;
};

/**
 * Cadastra o produto (se for novo), cria o roteiro e põe a IA para escrever.
 *
 * O duplo clique reencontra o roteiro da primeira submissão pela chave, antes
 * de criar qualquer coisa — sem isso, sairiam dois produtos iguais.
 */
export async function comecarCriacao(perfilId: string, pedido: PedidoDeLive): Promise<string> {
  const existente = await roteiroDaChave(perfilId, pedido.referencia);
  if (existente) return existente;

  const produtoId =
    pedido.produtoId ?? (pedido.produto ? await criarProduto(perfilId, pedido.produto) : null);
  if (!produtoId) throw new ErroDominio("dado_invalido", "Diga o que você vai vender.");

  const { id } = await criarRoteiro(perfilId, { produtoId });

  await enfileirar(perfilId, "roteiro", {
    referencia: pedido.referencia,
    entrada: {
      roteiro_id: id,
      minutos_alvo: pedido.minutos,
      ...(pedido.tom ? { tom: pedido.tom } : {}),
    },
  });

  return id;
}

export type ModoNaLive = "juntar" | "sozinho";

/**
 * Põe um áudio pronto no que a extensão toca, e deixa tudo apontando para ele.
 *
 * "juntar" acrescenta à montagem que já está no ar (a live alterna os
 * produtos); "sozinho" usa a montagem "Minha live" só com este áudio — a
 * montagem anterior fica guardada, só sai do ar.
 */
export async function colocarNaLive(
  perfilId: string,
  audioId: string,
  modo: ModoNaLive,
): Promise<{ montagemId: string; itens: number }> {
  const audio = await audioDoPerfil(perfilId, audioId);
  if (!audio) throw new ErroDominio("nao_encontrado", "Áudio não encontrado.");
  if (audio.estado !== "pronto") {
    throw new ErroDominio("dado_invalido", "O áudio ainda não ficou pronto.");
  }

  const montagens = await listarMontagens(perfilId);
  const ativa = montagens.find((m) => m.ativa) ?? null;

  let alvoId: string;
  let lista: string[];
  if (modo === "juntar" && ativa) {
    alvoId = ativa.id;
    const atual = await montagemDoPerfil(perfilId, alvoId);
    lista = [...(atual?.audios ?? []).filter((id) => id !== audioId), audioId].slice(-TETO_ITENS);
  } else {
    const padrao = montagens.find((m) => m.nome === NOME_MONTAGEM_PADRAO);
    alvoId = padrao?.id ?? (await criarMontagem(perfilId, NOME_MONTAGEM_PADRAO));
    lista = [audioId];
  }

  const base = await montagemDoPerfil(perfilId, alvoId);
  const resultado = await salvarMontagem(perfilId, alvoId, {
    nome: base?.nome ?? NOME_MONTAGEM_PADRAO,
    trilhaId: base?.trilhaId ?? null,
    volumeTrilha: base?.volumeTrilha ?? 15,
    intervaloMs: base?.intervaloMs ?? 800,
    embaralhar: base?.embaralhar ?? false,
    audios: lista,
  });

  // `salvarMontagem` descarta em silêncio áudio que não está pronto. Se o
  // nosso não entrou, dizer "pronto" seria mentir sobre a live.
  if (resultado.itens === 0) {
    throw new ErroDominio("dado_invalido", "O áudio não entrou na live. Recarregue e tente de novo.");
  }

  await ativarMontagem(perfilId, alvoId);
  // A voz deste áudio vira a voz da live: é a que o checklist de /live confere
  // e a que o estúdio sugere da próxima vez.
  await salvarConfiguracaoLive(perfilId, { vozId: audio.vozId });

  return { montagemId: alvoId, itens: resultado.itens };
}

// -----------------------------------------------------------------------------
// Onde a pessoa está no caminho — o que o Início mostra.
// -----------------------------------------------------------------------------

export type JornadaDaLive = {
  audio: {
    /** A montagem ativa tem ao menos um áudio pronto: a extensão tem o que tocar. */
    pronto: boolean;
    montagemNome: string | null;
    falas: number;
    duracaoMs: number;
    /** Áudios na fila ou gerando agora. */
    gerando: number;
  };
  extensao: {
    instalada: boolean;
    /** Último contato de qualquer máquina desta conta. */
    vistaEm: string | null;
  };
  live: {
    noAr: boolean;
    desde: string | null;
    lives: number;
  };
  riscoAceito: boolean;
};

const JORNADA_DEMO: JornadaDaLive = {
  audio: { pronto: true, montagemNome: NOME_MONTAGEM_PADRAO, falas: 2, duracaoMs: 360_000, gerando: 0 },
  extensao: { instalada: false, vistaEm: null },
  live: { noAr: false, desde: null, lives: 0 },
  riscoAceito: true,
};

export async function jornadaDaLive(perfilId: string): Promise<JornadaDaLive> {
  return comDemo(
    () => JORNADA_DEMO,
    async () => {
      const linha = (
        await bd()<
          {
            montagem_nome: string | null;
            falas: number;
            duracao_ms: string | null;
            gerando: number;
            extensao_vista_em: Date | null;
            instalacoes: number;
            ao_vivo_desde: Date | null;
            lives: number;
            risco_ok: boolean | null;
          }[]
        >`
          select
            (select m.nome from montagens m where m.perfil_id = ${perfilId} and m.ativa) as montagem_nome,
            (select count(*)::int
               from montagem_itens i
               join montagens m on m.id = i.montagem_id and m.ativa and m.perfil_id = ${perfilId}
               join audios a on a.id = i.audio_id and a.estado = 'pronto' and a.perfil_id = ${perfilId}
              where i.perfil_id = ${perfilId}) as falas,
            (select sum(a.duracao_ms)
               from montagem_itens i
               join montagens m on m.id = i.montagem_id and m.ativa and m.perfil_id = ${perfilId}
               join audios a on a.id = i.audio_id and a.estado = 'pronto' and a.perfil_id = ${perfilId}
              where i.perfil_id = ${perfilId}) as duracao_ms,
            (select count(*)::int from audios a
              where a.perfil_id = ${perfilId} and a.estado in ('na_fila', 'gerando')) as gerando,
            (select max(e.ultimo_contato) from ext_instalacoes e
              where e.perfil_id = ${perfilId}) as extensao_vista_em,
            (select count(*)::int from ext_instalacoes e
              where e.perfil_id = ${perfilId}) as instalacoes,
            (select min(s.inicio) from live_sessoes s
              where s.perfil_id = ${perfilId} and s.estado = 'ativa' and s.fim is null) as ao_vivo_desde,
            (select count(*)::int from live_sessoes s where s.perfil_id = ${perfilId}) as lives,
            (select lc.risco_aceito_em is not null from live_config lc
              where lc.perfil_id = ${perfilId}) as risco_ok
        `
      )[0]!;

      const falas = numeroDe(linha.falas);
      return {
        audio: {
          pronto: falas > 0,
          montagemNome: linha.montagem_nome,
          falas,
          duracaoMs: numeroDe(linha.duracao_ms),
          gerando: numeroDe(linha.gerando),
        },
        extensao: {
          instalada: numeroDe(linha.instalacoes) > 0,
          vistaEm: linha.extensao_vista_em?.toISOString() ?? null,
        },
        live: {
          noAr: linha.ao_vivo_desde !== null,
          desde: linha.ao_vivo_desde?.toISOString() ?? null,
          lives: numeroDe(linha.lives),
        },
        riscoAceito: linha.risco_ok === true,
      };
    },
  );
}
