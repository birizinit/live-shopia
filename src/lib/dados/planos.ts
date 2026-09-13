import "server-only";
import { duracaoEstimadaMs, formatarDuracao } from "@/lib/caracteres";
import { bd } from "@/lib/db";
import { env, servicos } from "@/lib/env";
import { brl } from "@/lib/utils";
import { comDemo, numeroDe } from "./comum";
import { extrato, saldoDe, type LancamentoExtrato } from "./creditos";
import { ErroDominio } from "./erros";

/**
 * Monetizacao: catalogo de planos, pacotes avulsos, estado da assinatura e a
 * leitura de consumo que sustenta a projecao de saldo.
 *
 * Duas observacoes que valem para o arquivo inteiro:
 *
 * 1. `planos` e `creditos_pacotes` sao CATALOGO — nao tem coluna de dono, e
 *    /planos e rota publica (src/lib/rotas.ts). Por isso, e so por isso, as
 *    duas listagens nao recebem perfilId: nao existe linha de outro usuario
 *    para vazar. Tudo que toca `assinaturas`, `assinatura_ciclos` e
 *    `creditos_lancamentos` recebe perfilId como PRIMEIRO argumento e o usa no
 *    where, sem excecao.
 *
 * 2. Nada aqui cobra. Enquanto o gateway nao for escolhido (PLANO.md §9.1),
 *    `criarCobranca` lanca em vez de inventar um PIX — ver o comentario dela.
 */

export type { LancamentoExtrato };

export type MotivoCredito =
  | "compra"
  | "assinatura"
  | "bonus"
  | "consumo"
  | "estorno"
  | "ajuste";

export type StatusAssinatura = "pendente" | "ativa" | "cancelada" | "inadimplente";

export type Plano = {
  id: string;
  slug: string;
  nome: string;
  descricao: string | null;
  precoCentavos: number;
  /** Meses cobertos por cobrança: 1, 3 ou 12. */
  meses: number;
  /** Preço dividido pelos meses — é o número que permite comparar planos. */
  precoMensalCentavos: number;
  contasTiktok: number;
  vozPremium: boolean;
  /**
   * Teto mensal em CARACTERES. `null` e um estado de verdade, nao um zero
   * disfarcado: a cota ainda nao foi definida (PLANO.md §9.4), e a tela precisa
   * dizer isso em vez de exibir numero inventado.
   */
  creditosMes: number | null;
  recursos: string[];
};

export type PacoteCreditos = {
  id: string;
  slug: string;
  nome: string;
  caracteres: number;
  precoCentavos: number;
};

export type CicloAssinatura = {
  id: string;
  inicio: string;
  fim: string;
  /** `now()` cai dentro do periodo. Ciclo vencido continua aparecendo. */
  vigente: boolean;
  /** Quando a cota do mes caiu na razao. `null` = ainda nao caiu. */
  concedidoEm: string | null;
  caracteresConcedidos: number;
};

export type Assinatura = {
  id: string;
  status: StatusAssinatura;
  inicio: string | null;
  fim: string | null;
  plano: Plano;
  ciclo: CicloAssinatura | null;
};

export type ConsumoRecente = {
  dias: number;
  /** Debitado menos o que voltou por estorno. Nunca negativo. */
  caracteres: number;
  geracoes: number;
};

/**
 * A projecao e um estado, nao um numero solto: "nao da para projetar" precisa
 * chegar na tela como tal, e nao como 0 dias — que se le como "acaba hoje".
 */
export type Projecao =
  | { tipo: "sem_saldo" }
  | { tipo: "sem_consumo" }
  | { tipo: "estimada"; mediaDiaria: number; dias: number; ate: string };

// -----------------------------------------------------------------------------
// Formatacao do dominio
//
// Mora aqui, e nao em @/lib/utils, porque e formatacao DESTE dominio: as duas
// telas precisam das mesmas regras (caractere -> fala, centavo -> real, preco
// por mil caracteres) e duas copias divergem no primeiro ajuste.
// -----------------------------------------------------------------------------

/**
 * O banco conversa em America/Sao_Paulo (src/lib/db.ts). Sem repetir o fuso na
 * formatacao, o servidor em UTC mostraria "11/09" para um lancamento que o
 * usuario fez as 22h do dia 10.
 */
const FUSO = "America/Sao_Paulo";

const FMT_DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: FUSO,
});

const FMT_DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: FUSO,
});

export function formatarData(iso: string) {
  return FMT_DATA.format(new Date(iso));
}

export function formatarDataHora(iso: string) {
  return FMT_DATA_HORA.format(new Date(iso));
}

export function formatarPreco(centavos: number) {
  return brl(centavos / 100);
}

/** Quanto de fala cabe em N caracteres (~600 chars/min, @/lib/caracteres). */
export function falaDe(caracteres: number) {
  return formatarDuracao(duracaoEstimadaMs(caracteres));
}

/**
 * Preco por mil caracteres — a unica forma de comparar pacotes de tamanhos
 * diferentes sem fazer conta de cabeca na vitrine.
 */
export function precoPorMil(precoCentavos: number, caracteres: number) {
  if (caracteres <= 0) return null;
  return brl((precoCentavos / 100 / caracteres) * 1000);
}

// -----------------------------------------------------------------------------
// Exemplos do modo demo
//
// A sessao demo nao tem linha no banco (src/lib/demo.ts): consulta com o id
// falso estoura 22P02 e quebra a tela. Todo leitor deste arquivo passa por
// `comDemo`, e o exemplo espelha a semente das migracoes 0002 e 0005 —
// inclusive `creditosMes: null`, que e o estado real do catalogo hoje.
// -----------------------------------------------------------------------------

const PLANOS_DEMO: Plano[] = [
  {
    id: "00000000-0000-4000-8000-0000000a1001",
    slug: "mensal",
    nome: "Mensal",
    descricao: "Acesso a tudo, cobrado todo mês. Cancele quando quiser.",
    precoCentavos: 9700,
    meses: 1,
    precoMensalCentavos: 9700,
    contasTiktok: 3,
    vozPremium: true,
    creditosMes: 30000,
    recursos: [
      "Acesso a tudo",
      "Voz premium",
      "Roteiro por IA",
      "Áudio contínuo da live",
      "3 contas TikTok",
      "30 mil caracteres por mês",
    ],
  },
  {
    id: "00000000-0000-4000-8000-0000000a1002",
    slug: "trimestral",
    nome: "Trimestral",
    descricao: "Os mesmos recursos, cobrados a cada três meses.",
    precoCentavos: 19700,
    meses: 3,
    precoMensalCentavos: 6567,
    contasTiktok: 3,
    vozPremium: true,
    creditosMes: 30000,
    recursos: [
      "Acesso a tudo",
      "Voz premium",
      "Roteiro por IA",
      "Áudio contínuo da live",
      "3 contas TikTok",
      "30 mil caracteres por mês",
      "Economia de 32% sobre o mensal",
    ],
  },
  {
    id: "00000000-0000-4000-8000-0000000a1003",
    slug: "anual",
    nome: "Anual",
    descricao: "Os mesmos recursos, cobrados uma vez por ano.",
    precoCentavos: 49700,
    meses: 12,
    precoMensalCentavos: 4142,
    contasTiktok: 3,
    vozPremium: true,
    creditosMes: 30000,
    recursos: [
      "Acesso a tudo",
      "Voz premium",
      "Roteiro por IA",
      "Áudio contínuo da live",
      "3 contas TikTok",
      "30 mil caracteres por mês",
      "Economia de 57% sobre o mensal",
    ],
  },
];
const PACOTES_DEMO: PacoteCreditos[] = [
  {
    id: "00000000-0000-4000-8000-0000000b2001",
    slug: "avulso-1k",
    nome: "Avulso",
    caracteres: 1000,
    precoCentavos: 300,
  },
  {
    id: "00000000-0000-4000-8000-0000000b2002",
    slug: "pacote-10k",
    nome: "Pacote 10 mil",
    caracteres: 10000,
    precoCentavos: 3000,
  },
  {
    id: "00000000-0000-4000-8000-0000000b2003",
    slug: "pacote-20k",
    nome: "Pacote 20 mil",
    caracteres: 20000,
    precoCentavos: 5000,
  },
  {
    id: "00000000-0000-4000-8000-0000000b2004",
    slug: "pacote-40k",
    nome: "Pacote 40 mil",
    caracteres: 40000,
    precoCentavos: 10000,
  },
];

function diasAtras(dias: number) {
  return new Date(Date.now() - dias * 86_400_000).toISOString();
}

/**
 * Extrato de exemplo. A soma dos deltas e 1.000 de proposito: e o saldo da
 * conta demo padrao (src/lib/demo.ts), e saldo que nao bate com o extrato logo
 * abaixo e a primeira coisa que alguem nota.
 */
function extratoDemo(): LancamentoExtrato[] {
  return [
    {
      id: "demo-1",
      delta: 1200,
      motivo: "estorno",
      criadoEm: diasAtras(2),
      detalhe: "Geração que falhou nas três tentativas",
    },
    { id: "demo-2", delta: -1200, motivo: "consumo", criadoEm: diasAtras(2), detalhe: null },
    { id: "demo-3", delta: -1600, motivo: "consumo", criadoEm: diasAtras(9), detalhe: null },
    { id: "demo-4", delta: -2400, motivo: "consumo", criadoEm: diasAtras(17), detalhe: null },
    {
      id: "demo-5",
      delta: 5000,
      motivo: "bonus",
      criadoEm: diasAtras(26),
      detalhe: "Boas-vindas",
    },
  ];
}

function assinaturaDemo(): Assinatura {
  const plano = PLANOS_DEMO[0]!;
  const inicio = diasAtras(26);

  return {
    id: "00000000-0000-4000-8000-0000000c3001",
    status: "ativa",
    inicio,
    fim: null,
    plano,
    ciclo: {
      id: "00000000-0000-4000-8000-0000000c3002",
      inicio,
      fim: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      vigente: true,
      // Sem `creditos_mes` definido, `conceder_creditos_ciclo` nao concede nada
      // (migracao 0005). O exemplo mostra esse estado, nao um numero bonito.
      concedidoEm: null,
      caracteresConcedidos: 0,
    },
  };
}

// -----------------------------------------------------------------------------
// Leitura
// -----------------------------------------------------------------------------

function listaDeTexto(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

type LinhaPlano = {
  id: string;
  slug: string;
  nome: string;
  descricao: string | null;
  preco_centavos: number;
  meses: number;
  contas_tiktok: number;
  voz_premium: boolean;
  creditos_mes: string | null;
  recursos: unknown;
};

function montarPlano(l: LinhaPlano): Plano {
  return {
    id: l.id,
    slug: l.slug,
    nome: l.nome,
    descricao: l.descricao,
    precoCentavos: numeroDe(l.preco_centavos),
    meses: numeroDe(l.meses, 1),
    // Preço mensalizado. Existe porque a tela precisa comparar planos de
    // periodicidades diferentes sem mentir: escrever "R$497,00/mês" num plano
    // anual é informação de preço errada, e informação de preço errada volta
    // como estorno.
    precoMensalCentavos: Math.round(
      numeroDe(l.preco_centavos) / Math.max(1, numeroDe(l.meses, 1)),
    ),
    contasTiktok: numeroDe(l.contas_tiktok, 1),
    vozPremium: l.voz_premium,
    // `numeroDe(null)` devolveria 0, e 0 aqui mentiria: "plano sem crédito
    // nenhum" e "cota ainda não definida" sao coisas diferentes na tela.
    creditosMes: l.creditos_mes === null ? null : numeroDe(l.creditos_mes),
    recursos: listaDeTexto(l.recursos),
  };
}

/** Catalogo de planos ativos, na ordem da vitrine. */
export async function listarPlanos(): Promise<Plano[]> {
  return comDemo(
    () => PLANOS_DEMO,
    async () => {
      const linhas = await bd()<LinhaPlano[]>`
        select id, slug, nome, descricao, preco_centavos, meses, contas_tiktok,
               voz_premium, creditos_mes, recursos
          from planos
         where ativo
         order by ordem, preco_centavos
      `;
      return linhas.map(montarPlano);
    },
  );
}

/** Catalogo de pacotes avulsos ativos. */
export async function listarPacotes(): Promise<PacoteCreditos[]> {
  return comDemo(
    () => PACOTES_DEMO,
    async () => {
      const linhas = await bd()<
        {
          id: string;
          slug: string;
          nome: string;
          caracteres: string;
          preco_centavos: number;
        }[]
      >`
        select id, slug, nome, caracteres, preco_centavos
          from creditos_pacotes
         where ativo
         order by ordem, preco_centavos
      `;

      return linhas.map((l) => ({
        id: l.id,
        slug: l.slug,
        nome: l.nome,
        caracteres: numeroDe(l.caracteres),
        precoCentavos: numeroDe(l.preco_centavos),
      }));
    },
  );
}

type LinhaAssinatura = LinhaPlano & {
  assinatura_id: string;
  status: StatusAssinatura;
  inicio: Date | null;
  fim: Date | null;
  ciclo_id: string | null;
  ciclo_inicio: Date | null;
  ciclo_fim: Date | null;
  ciclo_vigente: boolean | null;
  creditos_concedidos_em: Date | null;
  caracteres_concedidos: string | null;
};

/**
 * A assinatura do perfil, com o ciclo que interessa.
 *
 * Prefere a ativa; sem ativa, a mais recente — porque "voce cancelou em 03/08"
 * e informacao, e esconder a cancelada faz a tela parecer que nunca houve
 * assinatura nenhuma. O ciclo escolhido e o que cobre agora; sem nenhum
 * vigente, o ultimo, que e quem responde "quando venceu".
 */
export async function assinaturaDoPerfil(perfilId: string): Promise<Assinatura | null> {
  // O generico e explicito porque o exemplo do demo sempre devolve uma
  // assinatura, e sem ele `T` seria inferido como `Assinatura` — recusando o
  // `null` que a consulta real precisa poder devolver.
  return comDemo<Assinatura | null>(
    () => assinaturaDemo(),
    async () => {
      const linhas = await bd()<LinhaAssinatura[]>`
        select a.id as assinatura_id,
               a.status,
               a.inicio,
               a.fim,
               p.id, p.slug, p.nome, p.descricao, p.preco_centavos, p.meses,
               p.contas_tiktok, p.voz_premium, p.creditos_mes, p.recursos,
               c.id as ciclo_id,
               c.inicio as ciclo_inicio,
               c.fim as ciclo_fim,
               (c.inicio <= now() and c.fim > now()) as ciclo_vigente,
               c.creditos_concedidos_em,
               c.caracteres_concedidos
          from assinaturas a
          join planos p on p.id = a.plano_id
          left join lateral (
            select ac.*
              from assinatura_ciclos ac
             where ac.assinatura_id = a.id
               and ac.perfil_id = ${perfilId}
             order by (ac.inicio <= now() and ac.fim > now()) desc, ac.inicio desc
             limit 1
          ) c on true
         where a.perfil_id = ${perfilId}
         order by (a.status = 'ativa') desc, a.criado_em desc
         limit 1
      `;

      const l = linhas[0];
      if (!l) return null;

      return {
        id: l.assinatura_id,
        status: l.status,
        inicio: l.inicio?.toISOString() ?? null,
        fim: l.fim?.toISOString() ?? null,
        plano: montarPlano(l),
        ciclo:
          l.ciclo_id && l.ciclo_inicio && l.ciclo_fim
            ? {
                id: l.ciclo_id,
                inicio: l.ciclo_inicio.toISOString(),
                fim: l.ciclo_fim.toISOString(),
                vigente: l.ciclo_vigente === true,
                concedidoEm: l.creditos_concedidos_em?.toISOString() ?? null,
                caracteresConcedidos: numeroDe(l.caracteres_concedidos),
              }
            : null,
      };
    },
  );
}

/** Saldo em caracteres. `saldoDe` nao passa por `comDemo`; esta porta passa. */
export async function saldoAtual(perfilId: string): Promise<number> {
  return comDemo(
    () => extratoDemo().reduce((total, l) => total + l.delta, 0),
    () => saldoDe(perfilId),
  );
}

/** Extrato da razao — a mesma funcao de creditos.ts, com o modo demo coberto. */
export async function extratoDoPerfil(
  perfilId: string,
  limite = 40,
): Promise<LancamentoExtrato[]> {
  return comDemo(
    () => extratoDemo(),
    () => extrato(perfilId, limite),
  );
}

/**
 * O que saiu da razao na janela, para alimentar a projecao.
 *
 * Consumo menos estorno, porque geracao que falhou e devolveu o credito nao
 * gastou nada — conta-la como gasto encurtaria a projecao de graca. O piso em
 * zero cobre o estorno de um consumo mais velho que a janela.
 */
export async function consumoRecente(
  perfilId: string,
  dias = 30,
): Promise<ConsumoRecente> {
  return comDemo(
    () => {
      const corte = Date.now() - dias * 86_400_000;
      const dentro = extratoDemo().filter(
        (l) => new Date(l.criadoEm).getTime() >= corte,
      );
      const consumos = dentro.filter((l) => l.motivo === "consumo");
      const consumido = consumos.reduce((total, l) => total - l.delta, 0);
      const estornado = dentro
        .filter((l) => l.motivo === "estorno")
        .reduce((total, l) => total + l.delta, 0);

      return {
        dias,
        caracteres: Math.max(0, consumido - estornado),
        geracoes: consumos.length,
      };
    },
    async () => {
      const linhas = await bd()<
        { consumido: string; estornado: string; geracoes: string }[]
      >`
        select coalesce(-sum(delta) filter (where motivo = 'consumo'), 0) as consumido,
               coalesce(sum(delta) filter (where motivo = 'estorno'), 0)  as estornado,
               count(*) filter (where motivo = 'consumo')                 as geracoes
          from creditos_lancamentos
         where perfil_id = ${perfilId}
           and criado_em >= now() - make_interval(days => ${dias})
      `;

      const l = linhas[0];
      return {
        dias,
        caracteres: Math.max(0, numeroDe(l?.consumido) - numeroDe(l?.estornado)),
        geracoes: numeroDe(l?.geracoes),
      };
    },
  );
}

/**
 * Quanto tempo o saldo dura no ritmo medido. Funcao pura: a honestidade da
 * projecao esta em declarar os dois casos em que ela NAO existe.
 */
export function projetar(saldo: number, consumo: ConsumoRecente): Projecao {
  if (saldo <= 0) return { tipo: "sem_saldo" };
  if (consumo.caracteres <= 0 || consumo.dias <= 0) return { tipo: "sem_consumo" };

  const mediaDiaria = consumo.caracteres / consumo.dias;
  const dias = Math.floor(saldo / mediaDiaria);

  return {
    tipo: "estimada",
    mediaDiaria,
    dias,
    ate: new Date(Date.now() + dias * 86_400_000).toISOString(),
  };
}

// -----------------------------------------------------------------------------
// Cobranca
// -----------------------------------------------------------------------------

export type AlvoCobranca =
  | { tipo: "assinatura"; planoId: string }
  | { tipo: "creditos"; pacoteId: string };

/**
 * Da para cobrar hoje?
 *
 * As telas perguntam a ESTA funcao, e nao a `servicos.pagamento` direto, porque
 * ligar a chave do gateway nao basta: falta o adaptador que traduz cobranca e
 * webhook (PLANO.md §9.1). Quando ele existir, a condicao muda num lugar so.
 */
export function podeCobrar(): boolean {
  return servicos.pagamento;
}

/**
 * Abre uma cobranca. Hoje nao abre nenhuma — e o tipo de retorno diz isso.
 *
 * Sem gateway escolhido nao existe PIX, QR nem status 'pago' que signifiquem
 * alguma coisa. Gerar qualquer um deles para a tela ficar completa e fraude, e
 * nao demonstracao (src/lib/env.ts), entao a funcao lanca em vez de fingir.
 *
 * Quando o adaptador entrar, e daqui que sai: insere em `pagamentos` (status
 * 'pendente', `caracteres` congelado no caso de pacote, `expira_em` vindo do
 * gateway), chama a API e devolve o que o comprador precisa para pagar. O
 * estado da compra continua nascendo do webhook — `aplicar_evento_pagamento`
 * na migracao 0005 — e nunca desta chamada.
 */
export async function criarCobranca(
  perfilId: string,
  alvo: AlvoCobranca,
): Promise<never> {
  if (!servicos.pagamento) {
    throw new ErroDominio(
      "servico_indisponivel",
      "O meio de pagamento ainda não está ativo. Nenhuma cobrança foi aberta.",
    );
  }

  // Chave configurada e adaptador ausente: o erro precisa dizer isso, em vez de
  // virar um "tente de novo" que manda o suporte procurar no lugar errado.
  throw new ErroDominio(
    "servico_indisponivel",
    `Não há adaptador de cobrança para "${env.gatewayNome}" (${alvo.tipo}). ` +
      `Nenhuma cobrança foi aberta para o perfil ${perfilId}.`,
  );
}
