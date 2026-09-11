import "server-only";
import { bd } from "@/lib/db";
import {
  comDemo,
  comoJson,
  montarPagina,
  normalizarConsulta,
  numeroDe,
} from "./comum";
import { ErroDominio, comTraducao, exigirAchado } from "./erros";
import type { Consulta, Pagina } from "./tipos";

/**
 * Produtos — a raiz do pipeline.
 *
 * Sem produto nao existe roteiro, nem audio, nem live: e daqui que saem o nome,
 * a oferta, os beneficios e as objecoes que a IA usa para escrever.
 *
 * Nao ha RLS neste banco. Toda funcao recebe `perfilId` como PRIMEIRO argumento
 * e o usa no `where` — inclusive quando o id do produto veio da URL, que e
 * justamente o caso em que confiar no id e vazar dado alheio.
 */

export type Produto = {
  id: string;
  nome: string;
  descricao: string | null;
  precoCentavos: number | null;
  precoDeCentavos: number | null;
  cupom: string | null;
  link: string | null;
  imagemId: string | null;
  beneficios: string[];
  objecoes: string[];
  fixado: boolean;
  arquivadoEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
  /** Roteiros vivos apontando para este produto. E o que separa arquivar de excluir. */
  roteiros: number;
};

export type EntradaProduto = {
  nome: string;
  descricao: string | null;
  precoCentavos: number | null;
  precoDeCentavos: number | null;
  cupom: string | null;
  link: string | null;
  beneficios: string[];
  objecoes: string[];
};

export type ConsultaProdutos = Consulta & { arquivados?: boolean };

/** O que esta pendurado no produto. Zero em tudo e a unica licenca para excluir. */
export type Vinculos = { roteiros: number; audios: number };

export const MAX_ITENS_LISTA = 12;

/**
 * Politica da imagem do produto, num lugar so.
 *
 * O teto e menor que os 8 MB que `arquivos` aceita por linha: foto de celular
 * passa fácil de 8 MB, e recusar com mensagem clara e melhor que estourar a
 * constraint do banco. Fica aqui (e nao no formulario) porque quem valida de
 * verdade e o servidor; a tela recebe estes valores por prop so para avisar
 * antes de o arquivo subir.
 */
export const TETO_IMAGEM_BYTES = 4 * 1024 * 1024;

export const TIPOS_IMAGEM = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

export type TipoImagem = (typeof TIPOS_IMAGEM)[number];

/**
 * Todo limite do produto num objeto so.
 *
 * A tela e um Client Component e nao pode importar este modulo (ele e
 * `server-only`), entao a pagina passa este objeto por prop. Assim a validacao
 * do servidor e o aviso da interface saem do MESMO numero — duas copias
 * divergem no primeiro ajuste e o usuario descobre o limite real so no erro.
 */
export const LIMITES_PRODUTO = {
  nome: 140,
  descricao: 1200,
  cupom: 40,
  link: 500,
  item: 160,
  itens: MAX_ITENS_LISTA,
  imagemBytes: TETO_IMAGEM_BYTES,
  tiposImagem: TIPOS_IMAGEM,
} as const;

export type LimitesProduto = typeof LIMITES_PRODUTO;

// -----------------------------------------------------------------------------
// Leitura
// -----------------------------------------------------------------------------

type LinhaProduto = {
  id: string;
  nome: string;
  descricao: string | null;
  preco_centavos: number | null;
  preco_de_centavos: number | null;
  cupom: string | null;
  link: string | null;
  imagem_id: string | null;
  beneficios: unknown;
  objecoes: unknown;
  fixado: boolean;
  arquivado_em: Date | null;
  criado_em: Date;
  atualizado_em: Date;
  roteiros: string;
  total: string;
};

/** jsonb chega como `unknown`: so sobrevive o que de fato e texto. */
function listaDeTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function comoProduto(l: LinhaProduto): Produto {
  return {
    id: l.id,
    nome: l.nome,
    descricao: l.descricao,
    precoCentavos: l.preco_centavos,
    precoDeCentavos: l.preco_de_centavos,
    cupom: l.cupom,
    link: l.link,
    imagemId: l.imagem_id,
    beneficios: listaDeTexto(l.beneficios),
    objecoes: listaDeTexto(l.objecoes),
    fixado: l.fixado,
    arquivadoEm: l.arquivado_em ? l.arquivado_em.toISOString() : null,
    criadoEm: l.criado_em.toISOString(),
    atualizadoEm: l.atualizado_em.toISOString(),
    roteiros: numeroDe(l.roteiros),
  };
}

/**
 * `%` e `_` sao literais para quem digita e curinga para o `ilike`. Sem
 * escapar, buscar "50%" devolve o catalogo inteiro.
 */
function paraIlike(busca: string) {
  return `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Id da URL que nem uuid e: devolve nada em vez de estourar 22P02 na tela. */
function ehUuid(valor: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
}

export async function listarProdutos(
  perfilId: string,
  consulta: ConsultaProdutos = {},
): Promise<Pagina<Produto>> {
  const { busca, cursor, limite } = normalizarConsulta(consulta);
  const arquivados = consulta.arquivados === true;

  return comDemo(
    () => paginaExemplo({ busca, arquivados, limite }),
    async () => {
      const sql = bd();

      const linhas = await sql<LinhaProduto[]>`
        select p.id, p.nome, p.descricao, p.preco_centavos, p.preco_de_centavos,
               p.cupom, p.link, p.imagem_id, p.beneficios, p.objecoes,
               p.fixado, p.arquivado_em, p.criado_em, p.atualizado_em,
               (select count(*) from roteiros r
                 where r.produto_id = p.id and r.perfil_id = p.perfil_id
                   and r.arquivado_em is null) as roteiros,
               -- A janela e calculada antes do LIMIT, entao na primeira pagina
               -- (sem cursor) isto ja e o total e evita uma segunda consulta.
               -- Nas paginas seguintes o valor e descartado.
               count(*) over () as total
          from produtos p
         where p.perfil_id = ${perfilId}
           and ${arquivados ? sql`p.arquivado_em is not null` : sql`p.arquivado_em is null`}
           ${busca ? sql`and p.nome ilike ${paraIlike(busca)}` : sql``}
           ${
             cursor
               ? sql`and (p.criado_em, p.id) < (${cursor.instante}::timestamptz, ${cursor.id}::uuid)`
               : sql``
           }
         order by p.criado_em desc, p.id desc
         limit ${limite + 1}
      `;

      const pagina = montarPagina(linhas.map(comoProduto), limite);
      return cursor ? pagina : { ...pagina, total: numeroDe(linhas[0]?.total) };
    },
  );
}

export async function obterProduto(
  perfilId: string,
  produtoId: string,
): Promise<Produto | null> {
  if (!ehUuid(produtoId)) return null;

  return comDemo(
    () => EXEMPLOS.find((p) => p.id === produtoId) ?? null,
    async () => {
      const linhas = await bd()<LinhaProduto[]>`
        select p.id, p.nome, p.descricao, p.preco_centavos, p.preco_de_centavos,
               p.cupom, p.link, p.imagem_id, p.beneficios, p.objecoes,
               p.fixado, p.arquivado_em, p.criado_em, p.atualizado_em,
               (select count(*) from roteiros r
                 where r.produto_id = p.id and r.perfil_id = p.perfil_id
                   and r.arquivado_em is null) as roteiros,
               0 as total
          from produtos p
         where p.id = ${produtoId} and p.perfil_id = ${perfilId}
      `;
      const l = linhas[0];
      return l ? comoProduto(l) : null;
    },
  );
}

/** O produto que a live destaca. No maximo um por perfil (indice unico). */
export async function produtoFixado(perfilId: string): Promise<Produto | null> {
  return comDemo(
    () => EXEMPLOS.find((p) => p.fixado) ?? null,
    async () => {
      const linhas = await bd()<LinhaProduto[]>`
        select p.id, p.nome, p.descricao, p.preco_centavos, p.preco_de_centavos,
               p.cupom, p.link, p.imagem_id, p.beneficios, p.objecoes,
               p.fixado, p.arquivado_em, p.criado_em, p.atualizado_em,
               (select count(*) from roteiros r
                 where r.produto_id = p.id and r.perfil_id = p.perfil_id
                   and r.arquivado_em is null) as roteiros,
               0 as total
          from produtos p
         where p.perfil_id = ${perfilId} and p.fixado and p.arquivado_em is null
         limit 1
      `;
      const l = linhas[0];
      return l ? comoProduto(l) : null;
    },
  );
}

/**
 * Quantos produtos arquivados existem. Sem esta contagem a aba "Arquivados"
 * seria um convite as cegas: ninguem clica para descobrir que nao ha nada.
 */
export async function contarArquivados(perfilId: string): Promise<number> {
  return comDemo(
    () => EXEMPLOS.filter((p) => p.arquivadoEm).length,
    async () => {
      const linhas = await bd()<{ total: string }[]>`
        select count(*) as total from produtos
         where perfil_id = ${perfilId} and arquivado_em is not null
      `;
      return numeroDe(linhas[0]?.total);
    },
  );
}

export async function vinculosDoProduto(
  perfilId: string,
  produtoId: string,
): Promise<Vinculos> {
  if (!ehUuid(produtoId)) return { roteiros: 0, audios: 0 };

  return comDemo(
    () => ({
      roteiros: EXEMPLOS.find((p) => p.id === produtoId)?.roteiros ?? 0,
      audios: 0,
    }),
    async () => {
      const linhas = await bd()<{ roteiros: string; audios: string }[]>`
        select
          (select count(*) from roteiros r
            where r.produto_id = ${produtoId} and r.perfil_id = ${perfilId}) as roteiros,
          (select count(*) from audios a
            where a.produto_id = ${produtoId} and a.perfil_id = ${perfilId}) as audios
      `;
      return {
        roteiros: numeroDe(linhas[0]?.roteiros),
        audios: numeroDe(linhas[0]?.audios),
      };
    },
  );
}

/** Id do arquivo da imagem, ja no escopo do dono. E disto que a rota de API vive. */
export async function imagemDoProduto(
  perfilId: string,
  produtoId: string,
): Promise<string | null> {
  if (!ehUuid(produtoId)) return null;

  const linhas = await bd()<{ imagem_id: string | null }[]>`
    select imagem_id from produtos
     where id = ${produtoId} and perfil_id = ${perfilId}
  `;
  return linhas[0]?.imagem_id ?? null;
}

// -----------------------------------------------------------------------------
// Escrita
// -----------------------------------------------------------------------------

export async function criarProduto(
  perfilId: string,
  entrada: EntradaProduto,
): Promise<string> {
  return comTraducao(async () => {
    const linhas = await bd()<{ id: string }[]>`
      insert into produtos
        (perfil_id, nome, descricao, preco_centavos, preco_de_centavos,
         cupom, link, beneficios, objecoes)
      values (
        ${perfilId}, ${entrada.nome}, ${entrada.descricao},
        ${entrada.precoCentavos}, ${entrada.precoDeCentavos},
        ${entrada.cupom}, ${entrada.link},
        ${comoJson(entrada.beneficios)}, ${comoJson(entrada.objecoes)}
      )
      returning id
    `;
    return linhas[0]!.id;
  });
}

export async function atualizarProduto(
  perfilId: string,
  produtoId: string,
  entrada: EntradaProduto,
): Promise<string> {
  if (!ehUuid(produtoId)) throw new ErroDominio("nao_encontrado", "Produto não encontrado.");

  return comTraducao(async () => {
    const linhas = await bd()<{ id: string }[]>`
      update produtos
         set nome = ${entrada.nome},
             descricao = ${entrada.descricao},
             preco_centavos = ${entrada.precoCentavos},
             preco_de_centavos = ${entrada.precoDeCentavos},
             cupom = ${entrada.cupom},
             link = ${entrada.link},
             beneficios = ${comoJson(entrada.beneficios)},
             objecoes = ${comoJson(entrada.objecoes)}
       where id = ${produtoId} and perfil_id = ${perfilId}
      returning id
    `;
    return exigirAchado(linhas[0]?.id, "Produto");
  });
}

/**
 * Fixa (ou desafixa) o produto que a live destaca.
 *
 * Desafixar o anterior e fixar o novo acontecem na MESMA transacao: o indice
 * unico parcial `produtos_fixado_idx` recusa dois fixados, e fazer isso em dois
 * passos deixaria o perfil sem nenhum fixado se o segundo falhasse. A traducao
 * de erro continua no caminho porque duas abas fixando ao mesmo tempo ainda
 * colidem — e ai o que a pessoa precisa ler e "desafixe o outro primeiro", nao
 * um SQLSTATE.
 */
export async function fixarProduto(
  perfilId: string,
  produtoId: string,
  fixar: boolean,
): Promise<void> {
  if (!ehUuid(produtoId)) throw new ErroDominio("nao_encontrado", "Produto não encontrado.");

  await comTraducao(async () => {
    await bd().begin(async (tx) => {
      if (fixar) {
        await tx`
          update produtos set fixado = false
           where perfil_id = ${perfilId} and fixado and id <> ${produtoId}
        `;
      }

      const linhas = await tx<{ id: string }[]>`
        update produtos set fixado = ${fixar}
         where id = ${produtoId} and perfil_id = ${perfilId} and arquivado_em is null
        returning id
      `;
      exigirAchado(linhas[0]?.id, "Produto ativo");
    });
  });
}

/**
 * Arquivar tira o produto de circulacao sem cortar o vinculo com os roteiros e
 * audios ja gerados. Arquivado nunca continua fixado: a live estaria
 * destacando algo que saiu de linha.
 */
export async function arquivarProduto(
  perfilId: string,
  produtoId: string,
  arquivar: boolean,
): Promise<void> {
  if (!ehUuid(produtoId)) throw new ErroDominio("nao_encontrado", "Produto não encontrado.");

  await comTraducao(async () => {
    const sql = bd();
    const linhas = arquivar
      ? await sql<{ id: string }[]>`
          update produtos set arquivado_em = now(), fixado = false
           where id = ${produtoId} and perfil_id = ${perfilId} and arquivado_em is null
          returning id
        `
      : await sql<{ id: string }[]>`
          update produtos set arquivado_em = null
           where id = ${produtoId} and perfil_id = ${perfilId} and arquivado_em is not null
          returning id
        `;
    exigirAchado(linhas[0]?.id, "Produto");
  });
}

/**
 * Excluir de vez, e so quando nao ha nada pendurado.
 *
 * As FKs de roteiros e audios sao `on delete set null`: o banco DEIXARIA
 * excluir e o roteiro sobreviveria orfao, sem nome de produto, sem preco e sem
 * como saber do que falava. A regra do produto e mais estrita que a do banco de
 * proposito — quem ja produziu material se arquiva.
 *
 * Devolve o id da imagem para quem chamou apagar o binario.
 */
export async function excluirProduto(
  perfilId: string,
  produtoId: string,
): Promise<{ imagemId: string | null }> {
  if (!ehUuid(produtoId)) throw new ErroDominio("nao_encontrado", "Produto não encontrado.");

  const vinculos = await vinculosDoProduto(perfilId, produtoId);
  if (vinculos.roteiros > 0 || vinculos.audios > 0) {
    throw new ErroDominio(
      "conflito",
      "Este produto já tem roteiro ou áudio gerado. Arquive em vez de excluir: " +
        "excluir deixaria esse material sem o produto que o originou.",
    );
  }

  return comTraducao(async () => {
    const linhas = await bd()<{ imagem_id: string | null }[]>`
      delete from produtos
       where id = ${produtoId} and perfil_id = ${perfilId}
      returning imagem_id
    `;
    const l = exigirAchado(linhas[0], "Produto");
    return { imagemId: l.imagem_id };
  });
}

/**
 * Troca a imagem do produto e devolve a que estava la.
 *
 * Ler e escrever na mesma transacao, com a linha travada: duas trocas
 * simultaneas sem o `for update` poderiam ler o mesmo id anterior e a segunda
 * apagaria o binario que a primeira acabou de pendurar.
 */
export async function definirImagem(
  perfilId: string,
  produtoId: string,
  arquivoId: string | null,
): Promise<{ anterior: string | null }> {
  if (!ehUuid(produtoId)) throw new ErroDominio("nao_encontrado", "Produto não encontrado.");

  return comTraducao(async () =>
    bd().begin(async (tx) => {
      const atuais = await tx<{ imagem_id: string | null }[]>`
        select imagem_id from produtos
         where id = ${produtoId} and perfil_id = ${perfilId}
         for update
      `;
      const atual = exigirAchado(atuais[0], "Produto");

      await tx`
        update produtos set imagem_id = ${arquivoId}
         where id = ${produtoId} and perfil_id = ${perfilId}
      `;

      return { anterior: atual.imagem_id };
    }),
  );
}

// -----------------------------------------------------------------------------
// Modo demo — a sessao demo nao tem linha no banco. Sem exemplo, toda consulta
// com o id falso estouraria e a tela quebraria em vez de ser navegavel.
// -----------------------------------------------------------------------------

const DIA = 86_400_000;
const REFERENCIA = Date.UTC(2026, 0, 15, 12, 0, 0);
const emDias = (dias: number) => new Date(REFERENCIA - dias * DIA).toISOString();

const EXEMPLOS: Produto[] = [
  {
    id: "00000000-0000-4000-9000-000000000001",
    nome: "Kit Skincare Vitamina C",
    descricao:
      "Sérum facial de 30ml com vitamina C encapsulada, hidratante leve e protetor solar FPS 50. A rotina da manhã inteira em três passos.",
    precoCentavos: 8990,
    precoDeCentavos: 14990,
    cupom: "LIVE40",
    link: "https://exemplo.com.br/kit-skincare",
    imagemId: null,
    beneficios: [
      "Clareia manchas em 28 dias",
      "Absorve em 1 minuto e não deixa a pele oleosa",
      "Rende 3 meses de uso diário",
    ],
    objecoes: [
      "«Vitamina C arde na minha pele» — esta é encapsulada, pH 5.5",
      "«Já tentei outros e não vi nada» — comparativo com foto no dia 28",
    ],
    fixado: true,
    arquivadoEm: null,
    criadoEm: emDias(2),
    atualizadoEm: emDias(1),
    roteiros: 2,
  },
  {
    id: "00000000-0000-4000-9000-000000000002",
    nome: "Air Fryer 5L Digital",
    descricao: "Painel digital com 8 programas, cesto antiaderente e timer de 60 minutos.",
    precoCentavos: 32900,
    precoDeCentavos: 49900,
    cupom: "AIRFRY",
    link: "https://exemplo.com.br/air-fryer",
    imagemId: null,
    beneficios: ["Frita sem óleo", "Cabe um frango inteiro", "Garantia de 1 ano"],
    objecoes: ["«Gasta muita luz?» — 1500W, menos que um chuveiro elétrico"],
    fixado: false,
    arquivadoEm: null,
    criadoEm: emDias(9),
    atualizadoEm: emDias(9),
    roteiros: 1,
  },
  {
    id: "00000000-0000-4000-9000-000000000003",
    nome: "Fone Bluetooth com Cancelamento de Ruído",
    descricao: "Bluetooth 5.3, 40 horas de bateria com o estojo e cancelamento ativo.",
    precoCentavos: 15900,
    precoDeCentavos: null,
    cupom: null,
    link: null,
    imagemId: null,
    beneficios: ["40h de bateria", "Estojo carrega por indução"],
    objecoes: [],
    fixado: false,
    arquivadoEm: null,
    criadoEm: emDias(21),
    atualizadoEm: emDias(20),
    roteiros: 0,
  },
  {
    id: "00000000-0000-4000-9000-000000000004",
    nome: "Caneca Térmica 500ml — coleção de inverno",
    descricao: "Saiu de linha depois da campanha de julho, mas o roteiro dela continua salvo.",
    precoCentavos: 6900,
    precoDeCentavos: null,
    cupom: null,
    link: null,
    imagemId: null,
    beneficios: ["Mantém a bebida quente por 12h"],
    objecoes: [],
    fixado: false,
    arquivadoEm: emDias(30),
    criadoEm: emDias(120),
    atualizadoEm: emDias(30),
    roteiros: 1,
  },
];

function paginaExemplo({
  busca,
  arquivados,
  limite,
}: {
  busca: string | null;
  arquivados: boolean;
  limite: number;
}): Pagina<Produto> {
  const itens = EXEMPLOS.filter((p) => {
    if (arquivados !== Boolean(p.arquivadoEm)) return false;
    if (!busca) return true;
    return p.nome.toLowerCase().includes(busca.toLowerCase());
  });

  // O exemplo inteiro cabe numa pagina: nao ha proxima para pedir.
  return { itens: itens.slice(0, limite), proximo: null, total: itens.length };
}
