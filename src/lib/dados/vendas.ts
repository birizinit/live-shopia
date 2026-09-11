import "server-only";
import { bd } from "@/lib/db";
import { comDemo, numeroDe } from "./comum";
import type { Periodo } from "./tipos";

/**
 * Vendas da live — o que o dashboard e o ranking leem.
 *
 * A única origem de `vendas` é a extensão do Chrome, que ainda não existe.
 * Enquanto ela não sobe, estas consultas devolvem zero de verdade: a tela
 * mostra estado vazio explicando o porquê, em vez de inventar movimento. Em
 * modo demo devolvem exemplo determinístico e rotulado, para o desenho poder
 * ser visto e revisado.
 *
 * O dia é SEMPRE o de America/Sao_Paulo. `vendas.dia` é coluna gerada nesse
 * fuso e é ela que o rollup de `vendas_diarias` usa
 * (db/migrations/0006_live_dados.sql). Por isso nenhuma consulta daqui recorta
 * por `now()` do processo Node: das 21h à meia-noite os dois discordariam.
 */

const FUSO = "America/Sao_Paulo";

/** "en-CA" é o único locale que já formata data como YYYY-MM-DD. */
const DIA_ISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const HORA_SP = new Intl.DateTimeFormat("en-GB", {
  timeZone: FUSO,
  hour: "numeric",
  hour12: false,
});

/**
 * O rótulo do eixo nasce no SERVIDOR de propósito: o balde é um dia de
 * America/Sao_Paulo, não do fuso de quem abriu a tela. Formatar no navegador
 * faria o gráfico de quem está em Lisboa rotular o dia seguinte.
 */
const ROTULO_DIA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
});

const ROTULO_DIA_LONGO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  weekday: "short",
  day: "2-digit",
  month: "long",
});

export type Granularidade = "hora" | "dia";

export type FaixaPeriodo = {
  /** Primeiro dia do recorte (YYYY-MM-DD em São Paulo). `null` = desde o início. */
  inicio: string | null;
  fim: string;
  granularidade: Granularidade;
};

export type ResumoVendas = {
  /** Soma de `valor_centavos`: o que o comprador pagou por unidade. */
  faturamentoCentavos: number;
  /** Soma de `gmv_centavos`: o total dos pedidos, com frete, cupom e taxa. */
  gmvCentavos: number;
  vendas: number;
  itens: number;
  /** Soma do pico de espectadores de cada live do período. */
  espectadores: number;
  lives: number;
};

export type PontoSerie = {
  /** Chave estável do balde: "2026-09-11" no dia, "2026-09-11T20" na hora. */
  chave: string;
  rotulo: string;
  rotuloLongo: string;
  vendas: number;
  faturamentoCentavos: number;
  gmvCentavos: number;
};

export type SerieVendas = {
  granularidade: Granularidade;
  pontos: PontoSerie[];
  /** true quando o recorte "total" foi limitado à janela do gráfico. */
  recortada: boolean;
};

export type FatiaProduto = {
  id: string;
  nome: string;
  vendas: number;
  faturamentoCentavos: number;
  gmvCentavos: number;
};

export type VendaRecente = {
  id: string;
  ocorridoEm: string;
  produto: string | null;
  comprador: string | null;
  quantidade: number;
  valorCentavos: number;
  gmvCentavos: number;
};

export type LinhaRanking = {
  posicao: number;
  /** Nome de exibição. NUNCA e-mail, CPF ou telefone (LGPD). */
  nome: string;
  vendas: number;
  faturamentoCentavos: number;
  gmvCentavos: number;
  voce: boolean;
};

/** Quantos dias o gráfico de série desenha quando o período é "total". */
const JANELA_TOTAL = 90;

export const DESCRICAO_PERIODO: Record<Periodo, string> = {
  hoje: "hoje",
  ontem: "ontem",
  "7d": "nos últimos 7 dias",
  "30d": "nos últimos 30 dias",
  total: "desde o início",
};

/* -------------------------------------------------------------------------- */
/* Recorte de período                                                         */
/* -------------------------------------------------------------------------- */

export function ehPeriodo(valor: unknown): valor is Periodo {
  return (
    valor === "hoje" ||
    valor === "ontem" ||
    valor === "7d" ||
    valor === "30d" ||
    valor === "total"
  );
}

/** Lê o período da URL. Qualquer coisa fora da lista vira "7d". */
export function lerPeriodo(valor: unknown): Periodo {
  return ehPeriodo(valor) ? valor : "7d";
}

export function hojeEmSaoPaulo(agora = new Date()): string {
  return DIA_ISO.format(agora);
}

function horaEmSaoPaulo(agora = new Date()): number {
  const parte = HORA_SP.formatToParts(agora).find((p) => p.type === "hour");
  // `% 24` porque alguns ambientes formatam a meia-noite como "24".
  return Number(parte?.value ?? 0) % 24;
}

/** Soma dias sobre uma data YYYY-MM-DD sem passar por fuso nenhum. */
function somarDias(dia: string, delta: number): string {
  const [ano, mes, data] = dia.split("-").map(Number);
  return new Date(Date.UTC(ano ?? 1970, (mes ?? 1) - 1, (data ?? 1) + delta))
    .toISOString()
    .slice(0, 10);
}

function comoData(dia: string): Date {
  // Meio-dia UTC: qualquer fuso de formatação cai no mesmo dia do calendário.
  return new Date(`${dia}T12:00:00Z`);
}

export function faixaDoPeriodo(periodo: Periodo, agora = new Date()): FaixaPeriodo {
  const hoje = hojeEmSaoPaulo(agora);

  switch (periodo) {
    case "hoje":
      return { inicio: hoje, fim: hoje, granularidade: "hora" };
    case "ontem": {
      const ontem = somarDias(hoje, -1);
      return { inicio: ontem, fim: ontem, granularidade: "hora" };
    }
    case "7d":
      return { inicio: somarDias(hoje, -6), fim: hoje, granularidade: "dia" };
    case "30d":
      return { inicio: somarDias(hoje, -29), fim: hoje, granularidade: "dia" };
    case "total":
      return { inicio: null, fim: hoje, granularidade: "dia" };
  }
}

function rotulosDoDia(dia: string) {
  const data = comoData(dia);
  return {
    rotulo: ROTULO_DIA.format(data),
    rotuloLongo: ROTULO_DIA_LONGO.format(data),
  };
}

function rotulosDaHora(dia: string, hora: number) {
  return {
    rotulo: `${hora}h`,
    rotuloLongo: `${ROTULO_DIA.format(comoData(dia))}, das ${hora}h às ${(hora + 1) % 24}h`,
  };
}

/* -------------------------------------------------------------------------- */
/* Leitura                                                                    */
/* -------------------------------------------------------------------------- */

type LinhaResumo = {
  valor: string;
  gmv: string;
  vendas: string;
  itens: string;
  espectadores: string;
  lives: string;
};

export async function resumoDeVendas(
  perfilId: string,
  periodo: Periodo,
): Promise<ResumoVendas> {
  const faixa = faixaDoPeriodo(periodo);

  return comDemo(
    () => exemploResumo(faixa),
    async () => {
      // Um `cross join` de dois agregados em vez de quatro subconsultas soltas:
      // cada lado varre a sua tabela uma vez só.
      const linhas = await bd()<LinhaResumo[]>`
        select v.valor, v.gmv, v.vendas, v.itens, l.espectadores, l.lives
          from (
            select coalesce(sum(d.valor_centavos), 0)    as valor,
                   coalesce(sum(d.gmv_centavos), 0)      as gmv,
                   coalesce(sum(d.quantidade_vendas), 0) as vendas,
                   coalesce(sum(d.quantidade_itens), 0)  as itens
              from vendas_diarias d
             where d.perfil_id = ${perfilId}
               and d.dia <= ${faixa.fim}::date
               and (${faixa.inicio}::date is null or d.dia >= ${faixa.inicio}::date)
          ) v
          cross join (
            select coalesce(sum(s.espectadores_pico), 0) as espectadores,
                   count(*)                              as lives
              from live_sessoes s
             where s.perfil_id = ${perfilId}
               and s.inicio < ((${faixa.fim}::date + 1)::timestamp at time zone 'America/Sao_Paulo')
               and (
                 ${faixa.inicio}::date is null
                 or s.inicio >= ((${faixa.inicio}::date)::timestamp at time zone 'America/Sao_Paulo')
               )
          ) l
      `;

      const l = linhas[0];
      return {
        faturamentoCentavos: numeroDe(l?.valor),
        gmvCentavos: numeroDe(l?.gmv),
        vendas: numeroDe(l?.vendas),
        itens: numeroDe(l?.itens),
        espectadores: numeroDe(l?.espectadores),
        lives: numeroDe(l?.lives),
      };
    },
  );
}

export async function serieDeVendas(
  perfilId: string,
  periodo: Periodo,
): Promise<SerieVendas> {
  const faixa = faixaDoPeriodo(periodo);

  return comDemo(
    () => exemploSerie(faixa),
    async () =>
      faixa.granularidade === "hora"
        ? seriePorHora(perfilId, faixa)
        : seriePorDia(perfilId, faixa),
  );
}

async function seriePorHora(
  perfilId: string,
  faixa: FaixaPeriodo,
): Promise<SerieVendas> {
  const dia = faixa.fim;

  // `extract` devolve inteiro. Um `timestamp` sem fuso atravessando o driver
  // seria reinterpretado no fuso do processo Node, e a hora sairia trocada.
  const linhas = await bd()<
    { hora: number; vendas: string; valor: string; gmv: string }[]
  >`
    select extract(hour from (v.ocorrido_em at time zone 'America/Sao_Paulo'))::int as hora,
           count(*)                           as vendas,
           coalesce(sum(v.valor_centavos), 0) as valor,
           coalesce(sum(v.gmv_centavos), 0)   as gmv
      from vendas v
     where v.perfil_id = ${perfilId}
       and v.dia = ${dia}::date
     group by 1
     order by 1
  `;

  const porHora = new Map(linhas.map((l) => [l.hora, l]));
  // "Hoje" para na hora corrente: catorze horas de zero à frente do último dado
  // achatariam o gráfico do dia inteiro.
  const ultima = dia === hojeEmSaoPaulo() ? horaEmSaoPaulo() : 23;

  const pontos: PontoSerie[] = [];
  for (let hora = 0; hora <= ultima; hora++) {
    const l = porHora.get(hora);
    pontos.push({
      chave: `${dia}T${String(hora).padStart(2, "0")}`,
      ...rotulosDaHora(dia, hora),
      vendas: numeroDe(l?.vendas),
      faturamentoCentavos: numeroDe(l?.valor),
      gmvCentavos: numeroDe(l?.gmv),
    });
  }

  return { granularidade: "hora", pontos, recortada: false };
}

async function seriePorDia(
  perfilId: string,
  faixa: FaixaPeriodo,
): Promise<SerieVendas> {
  // "Total" pode ser de anos. O gráfico desenha a janela; os cartões continuam
  // somando tudo — e o subtítulo do gráfico diz qual recorte está na tela.
  const recortada = faixa.inicio === null;
  const inicio = faixa.inicio ?? somarDias(faixa.fim, -(JANELA_TOTAL - 1));

  const linhas = await bd()<
    { dia: string; vendas: string; valor: string; gmv: string }[]
  >`
    select to_char(d.dia, 'YYYY-MM-DD') as dia,
           d.quantidade_vendas          as vendas,
           d.valor_centavos             as valor,
           d.gmv_centavos               as gmv
      from vendas_diarias d
     where d.perfil_id = ${perfilId}
       and d.dia between ${inicio}::date and ${faixa.fim}::date
     order by d.dia
  `;

  const porDia = new Map(linhas.map((l) => [l.dia, l]));

  // Dia sem venda não tem linha no rollup, e buraco no eixo mente sobre a
  // frequência: o preenchimento com zero é parte da leitura correta.
  const pontos: PontoSerie[] = [];
  for (let dia = inicio; dia <= faixa.fim; dia = somarDias(dia, 1)) {
    const l = porDia.get(dia);
    pontos.push({
      chave: dia,
      ...rotulosDoDia(dia),
      vendas: numeroDe(l?.vendas),
      faturamentoCentavos: numeroDe(l?.valor),
      gmvCentavos: numeroDe(l?.gmv),
    });
  }

  return {
    granularidade: "dia",
    // Em "total", oitenta dias vazios antes da primeira venda só espremem o
    // que interessa contra a margem direita.
    pontos: recortada ? aparaInicioVazio(pontos) : pontos,
    recortada,
  };
}

/** Tira os baldes zerados do começo, preservando um respiro de contexto. */
function aparaInicioVazio(pontos: PontoSerie[], minimo = 7): PontoSerie[] {
  const primeiro = pontos.findIndex((p) => p.vendas > 0 || p.gmvCentavos > 0);
  if (primeiro <= 0) return pontos;
  const corte = Math.min(primeiro, Math.max(0, pontos.length - minimo));
  return pontos.slice(corte);
}

export async function vendasPorProduto(
  perfilId: string,
  periodo: Periodo,
  limite = 6,
): Promise<FatiaProduto[]> {
  const faixa = faixaDoPeriodo(periodo);

  return comDemo(
    () => exemploProdutos(faixa, limite),
    async () => {
      const linhas = await bd()<
        { id: string; nome: string; vendas: string; valor: string; gmv: string }[]
      >`
        select coalesce(p.id::text, 'sem-produto')       as id,
               coalesce(p.nome, 'Sem produto vinculado') as nome,
               count(*)                                  as vendas,
               coalesce(sum(v.valor_centavos), 0)        as valor,
               coalesce(sum(v.gmv_centavos), 0)          as gmv
          from vendas v
          left join produtos p
            on p.id = v.produto_id
           -- Redundante com o gatilho vendas_vinculos, e fica: sem RLS, o
           -- escopo do dono é de cada junção, não de uma regra que mora longe.
           and p.perfil_id = v.perfil_id
         where v.perfil_id = ${perfilId}
           and v.dia <= ${faixa.fim}::date
           and (${faixa.inicio}::date is null or v.dia >= ${faixa.inicio}::date)
         group by 1, 2
         order by gmv desc, vendas desc
         limit ${limite}
      `;

      return linhas.map((l) => ({
        id: l.id,
        nome: l.nome,
        vendas: numeroDe(l.vendas),
        faturamentoCentavos: numeroDe(l.valor),
        gmvCentavos: numeroDe(l.gmv),
      }));
    },
  );
}

export async function ultimasVendas(
  perfilId: string,
  periodo: Periodo,
  limite = 8,
): Promise<VendaRecente[]> {
  const faixa = faixaDoPeriodo(periodo);

  return comDemo(
    () => exemploUltimasVendas(faixa, limite),
    async () => {
      const linhas = await bd()<
        {
          id: string;
          ocorrido_em: Date;
          produto: string | null;
          comprador: string | null;
          quantidade: number;
          valor: string;
          gmv: string;
        }[]
      >`
        select v.id,
               v.ocorrido_em,
               p.nome              as produto,
               v.comprador_apelido as comprador,
               v.quantidade,
               v.valor_centavos    as valor,
               v.gmv_centavos      as gmv
          from vendas v
          left join produtos p
            on p.id = v.produto_id and p.perfil_id = v.perfil_id
         where v.perfil_id = ${perfilId}
           and v.dia <= ${faixa.fim}::date
           and (${faixa.inicio}::date is null or v.dia >= ${faixa.inicio}::date)
         order by v.ocorrido_em desc
         limit ${limite}
      `;

      return linhas.map((l) => ({
        id: l.id,
        ocorridoEm: l.ocorrido_em.toISOString(),
        produto: l.produto,
        comprador: l.comprador,
        quantidade: l.quantidade,
        valorCentavos: numeroDe(l.valor),
        gmvCentavos: numeroDe(l.gmv),
      }));
    },
  );
}

/**
 * Placar do período.
 *
 * É a única leitura do projeto que atravessa perfis — placar de um usuário só
 * não é placar. O `perfilId` continua vindo primeiro e continua indo ao
 * `where`: é ele que marca a linha "você" e que garante a própria posição na
 * resposta mesmo quando ela cai fora do topo.
 *
 * LGPD: daqui sai NOME DE EXIBIÇÃO e número, mais nada. E-mail, CPF, telefone
 * e até o id dos outros perfis não cruzam esta fronteira — a tela não tem como
 * vazar o que nunca recebeu.
 *
 * `nomeExibicao` só desenha a linha "você" no modo demo, onde a conta não tem
 * linha no banco. Em produção o nome vem de `perfis`.
 */
export async function rankingDoPeriodo(
  perfilId: string,
  periodo: Periodo,
  opcoes: { limite?: number; nomeExibicao?: string } = {},
): Promise<LinhaRanking[]> {
  const faixa = faixaDoPeriodo(periodo);
  const limite = Math.min(Math.max(opcoes.limite ?? 20, 3), 50);

  return comDemo(
    () => exemploRanking(faixa, limite, opcoes.nomeExibicao),
    async () => {
      const linhas = await bd()<
        {
          posicao: string;
          nome: string;
          vendas: string;
          valor: string;
          gmv: string;
          voce: boolean;
        }[]
      >`
        with totais as (
          select d.perfil_id,
                 sum(d.quantidade_vendas) as vendas,
                 sum(d.valor_centavos)    as valor,
                 sum(d.gmv_centavos)      as gmv
            from vendas_diarias d
           where d.dia <= ${faixa.fim}::date
             and (${faixa.inicio}::date is null or d.dia >= ${faixa.inicio}::date)
           group by d.perfil_id
          having sum(d.quantidade_vendas) > 0
        ), classificado as (
          -- rank() e não row_number(): empate divide a mesma posição, que é
          -- o que um placar promete.
          select t.*, rank() over (order by t.gmv desc, t.vendas desc) as posicao
            from totais t
        )
        select c.posicao,
               coalesce(nullif(btrim(p.nome), ''), '@' || p.usuario) as nome,
               c.vendas,
               c.valor,
               c.gmv,
               (c.perfil_id = ${perfilId}) as voce
          from classificado c
          join perfis p on p.id = c.perfil_id
         where c.posicao <= ${limite} or c.perfil_id = ${perfilId}
         order by c.posicao, nome
      `;

      return linhas.map((l) => ({
        posicao: numeroDe(l.posicao),
        nome: l.nome,
        vendas: numeroDe(l.vendas),
        faturamentoCentavos: numeroDe(l.valor),
        gmvCentavos: numeroDe(l.gmv),
        voce: l.voce,
      }));
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Exemplos do modo demo                                                      */
/*                                                                            */
/* Tudo daqui para baixo é FICÇÃO, e a tela diz isso na cara do usuário. Nada  */
/* é aleatório: número que muda a cada F5 parece defeito, não demonstração —   */
/* o ruído é função do dia, então a mesma tela continua a mesma tela.          */
/* -------------------------------------------------------------------------- */

function ruido(semente: number): number {
  const x = Math.sin(semente * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function sementeDoDia(dia: string): number {
  const [ano, mes, data] = dia.split("-").map(Number);
  return (ano ?? 0) * 372 + (mes ?? 0) * 31 + (data ?? 0);
}

/** Curva de audiência de live noturna, das 0h às 23h. */
const PESO_HORA = [
  2, 1, 1, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 6, 7, 8, 9, 11, 14, 18, 22, 20, 13, 6,
];

function diaExemplo(dia: string) {
  const semente = sementeDoDia(dia);
  const diaSemana = comoData(dia).getUTCDay();
  const fimDeSemana = diaSemana === 0 || diaSemana === 6;

  const vendas = Math.round((9 + ruido(semente) * 21) * (fimDeSemana ? 1.6 : 1));
  const ticket = 4_900 + Math.round(ruido(semente + 7) * 9_100);
  const faturamentoCentavos = vendas * ticket;

  return {
    vendas,
    faturamentoCentavos,
    // GMV acima do faturamento porque carrega frete, taxa e mais de um item.
    gmvCentavos: Math.round(faturamentoCentavos * (1.12 + ruido(semente + 13) * 0.24)),
  };
}

function exemploSerie(faixa: FaixaPeriodo): SerieVendas {
  if (faixa.granularidade === "hora") {
    const dia = faixa.fim;
    const base = diaExemplo(dia);
    const ultima = dia === hojeEmSaoPaulo() ? horaEmSaoPaulo() : 23;
    const total = PESO_HORA.reduce((soma, peso) => soma + peso, 0);

    const pontos = PESO_HORA.slice(0, ultima + 1).map((peso, hora) => ({
      chave: `${dia}T${String(hora).padStart(2, "0")}`,
      ...rotulosDaHora(dia, hora),
      vendas: Math.round((base.vendas * peso) / total),
      faturamentoCentavos: Math.round((base.faturamentoCentavos * peso) / total),
      gmvCentavos: Math.round((base.gmvCentavos * peso) / total),
    }));

    return { granularidade: "hora", pontos, recortada: false };
  }

  const recortada = faixa.inicio === null;
  const inicio = faixa.inicio ?? somarDias(faixa.fim, -(JANELA_TOTAL - 1));

  const pontos: PontoSerie[] = [];
  for (let dia = inicio; dia <= faixa.fim; dia = somarDias(dia, 1)) {
    pontos.push({ chave: dia, ...rotulosDoDia(dia), ...diaExemplo(dia) });
  }

  return { granularidade: "dia", pontos, recortada };
}

/**
 * O resumo do exemplo é SOMADO da série do exemplo: cartão e gráfico na mesma
 * tela precisam fechar a conta, senão a demonstração se desmente sozinha.
 */
function exemploResumo(faixa: FaixaPeriodo): ResumoVendas {
  const { pontos } = exemploSerie(faixa);

  const resumo = pontos.reduce(
    (acumulado, ponto) => ({
      faturamentoCentavos: acumulado.faturamentoCentavos + ponto.faturamentoCentavos,
      gmvCentavos: acumulado.gmvCentavos + ponto.gmvCentavos,
      vendas: acumulado.vendas + ponto.vendas,
    }),
    { faturamentoCentavos: 0, gmvCentavos: 0, vendas: 0 },
  );

  const lives =
    faixa.granularidade === "hora"
      ? 1
      : pontos.filter((ponto) => ponto.vendas > 0).length;

  return {
    ...resumo,
    itens: Math.round(resumo.vendas * 1.3),
    espectadores: Math.round(resumo.vendas * 38 + lives * 120),
    lives,
  };
}

const PRODUTOS_EXEMPLO = [
  { nome: "Kit Skincare Vitamina C", peso: 30 },
  { nome: "Secador Íon 2000W", peso: 22 },
  { nome: "Perfume Amadeirado 100ml", peso: 17 },
  { nome: "Batom Matte, 6 cores", peso: 13 },
  { nome: "Escova Alisadora Titânio", peso: 10 },
  { nome: "Máscara de Cílios à Prova de Água", peso: 8 },
] as const;

function exemploProdutos(faixa: FaixaPeriodo, limite: number): FatiaProduto[] {
  const resumo = exemploResumo(faixa);
  if (resumo.vendas === 0) return [];

  const total = PRODUTOS_EXEMPLO.reduce((soma, p) => soma + p.peso, 0);

  return PRODUTOS_EXEMPLO.slice(0, limite).map((produto, indice) => ({
    id: `exemplo-${indice}`,
    nome: produto.nome,
    vendas: Math.max(1, Math.round((resumo.vendas * produto.peso) / total)),
    faturamentoCentavos: Math.round((resumo.faturamentoCentavos * produto.peso) / total),
    gmvCentavos: Math.round((resumo.gmvCentavos * produto.peso) / total),
  }));
}

const COMPRADORES_EXEMPLO = [
  "@mari.andrade",
  "@ju_oliveira",
  "@tatibeauty",
  "@carol.ns",
  "@paty_lima",
  "@re.nascimento",
  "@bia.costa",
  "@dani_alves22",
] as const;

function exemploUltimasVendas(faixa: FaixaPeriodo, limite: number): VendaRecente[] {
  const resumo = exemploResumo(faixa);
  if (resumo.vendas === 0) return [];

  const produtos = exemploProdutos(faixa, PRODUTOS_EXEMPLO.length);
  const base = comoData(faixa.fim).getTime();

  return Array.from({ length: Math.min(limite, resumo.vendas) }, (_, indice) => {
    const semente = sementeDoDia(faixa.fim) + indice * 17;
    const quantidade = 1 + Math.round(ruido(semente) * 2);
    const valor = 4_900 + Math.round(ruido(semente + 3) * 9_100);

    return {
      id: `exemplo-venda-${indice}`,
      // Espaçadas em minutos para a coluna de horário não sair toda igual.
      ocorridoEm: new Date(base - indice * 7 * 60_000).toISOString(),
      produto: produtos[indice % Math.max(produtos.length, 1)]?.nome ?? null,
      comprador: COMPRADORES_EXEMPLO[indice % COMPRADORES_EXEMPLO.length] ?? null,
      quantidade,
      valorCentavos: valor,
      gmvCentavos: Math.round(valor * quantidade * 1.16),
    };
  });
}

const RANKING_EXEMPLO = [
  "Camila Ribeiro",
  "Loja da Rê",
  "Thiago Martins",
  "Beauty da Ju",
  "Fernanda Aguiar",
  "Studio Lu Cosméticos",
  "Rafael Nunes",
  "Priscila Tavares",
  "Casa & Estilo",
  "Marcos Vinícius",
  "Ateliê da Bia",
  "Vanessa Prado",
] as const;

/** A conta que abriu a tela entra em 4º: posição boa para mostrar o destaque. */
const POSICAO_VOCE = 4;

function exemploRanking(
  faixa: FaixaPeriodo,
  limite: number,
  nomeExibicao?: string,
): LinhaRanking[] {
  const resumo = exemploResumo(faixa);
  if (resumo.vendas === 0) return [];

  const nomes: string[] = [...RANKING_EXEMPLO];
  nomes.splice(POSICAO_VOCE - 1, 0, nomeExibicao?.trim() || "Sua conta");

  const semente = sementeDoDia(faixa.fim);
  const lider = Math.max(resumo.gmvCentavos, 120_000) * 2.4;

  // `Math.max` porque a linha "voce" nao pode cair fora por causa do limite.
  return nomes.slice(0, Math.max(limite, POSICAO_VOCE)).map((nome, indice) => {
    // Queda suave do 1º ao último, com um empurrão de ruído por linha.
    const fator = (1 / (1 + indice * 0.22)) * (0.88 + ruido(semente + indice) * 0.24);
    const gmv = Math.round(lider * fator);
    const ehVoce = indice === POSICAO_VOCE - 1;

    return {
      posicao: indice + 1,
      nome,
      vendas: Math.max(1, Math.round(gmv / 9_800)),
      faturamentoCentavos: Math.round(gmv / 1.2),
      gmvCentavos: ehVoce ? Math.max(resumo.gmvCentavos, gmv) : gmv,
      voce: ehVoce,
    };
  });
}
