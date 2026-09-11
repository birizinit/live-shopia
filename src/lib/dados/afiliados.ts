import "server-only";
import { createHmac } from "node:crypto";
import { contarCaracteres } from "@/lib/caracteres";
import { bd } from "@/lib/db";
import { env, servicos } from "@/lib/env";
import type { Papel } from "@/lib/roles";
import { brl } from "@/lib/utils";
import { comDemo, configuracao, numeroDe } from "./comum";
import { ErroDominio, traduzirErro, type CodigoErro } from "./erros";

/**
 * Afiliados — leitura e operação do programa de indicação (fase 6).
 *
 * Todo dinheiro aqui é CENTAVOS inteiros. Nenhuma conta de comissão, saldo ou
 * teto acontece neste arquivo: quem calcula é o banco (0008_afiliados.sql), que
 * tem a razão append-only, o clawback no mesmo commit do estorno e as
 * constraints que impedem sacar a mesma comissão duas vezes. Este módulo lê o
 * resultado e chama as funções — refazer a soma em TypeScript criaria um
 * segundo número, e dois números de dinheiro discordam mais cedo ou mais tarde.
 *
 * LGPD, a regra que decide o que cada consulta pode selecionar:
 *
 *  - Nunca sai daqui e-mail, CPF ou telefone de terceiro. Nenhuma consulta
 *    abaixo cita essas colunas — a proteção é não pedir o dado, não filtrar
 *    depois de trazer.
 *  - Nome de EXIBIÇÃO (`nome`, caindo para `@usuario`) é o máximo que se mostra
 *    de outra pessoa.
 *  - Valor INDIVIDUAL só aparece quando o dinheiro é de quem está olhando: em
 *    /indique e /afiliado, "quanto este indicado gerou para MIM" é receita do
 *    próprio usuário. O faturamento do OUTRO é dado dele, e no painel do
 *    gerente sai só agregado (PLANO.md §7).
 */

// -----------------------------------------------------------------------------
// Tipos — espelham os enums da migração 0008.
// -----------------------------------------------------------------------------

export type OrigemComissao = "nivel_1" | "nivel_2" | "nivel_3" | "gerente";
export type StatusComissao = "pendente" | "disponivel" | "paga" | "estornada";
export type StatusSaque = "solicitado" | "aprovado" | "pago" | "recusado" | "cancelado";
export type StatusKyc = "pendente" | "verificado" | "recusado";
export type StatusConvite = "pendente" | "aceito" | "recusado" | "expirado";
export type TipoConta = "pix" | "conta";
export type TipoChavePix = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria";
export type MotivoLancamento =
  | "credito"
  | "liberacao"
  | "bloqueio"
  | "saque"
  | "estorno"
  | "clawback"
  | "ajuste";

/** Os quatro baldes da razão de comissão, em centavos. */
export type Saldo = {
  pendente: number;
  disponivel: number;
  bloqueado: number;
  sacado: number;
  /** Quando a comissão pendente mais antiga completa o D+30. */
  proximaLiberacao: string | null;
};

export type Taxa = {
  origem: OrigemComissao;
  percentual: number;
  /** true = número de trabalho, ainda não fechado com o dono do negócio. */
  provisorio: boolean;
};

export type NivelRede = {
  nivel: 1 | 2 | 3;
  pessoas: number;
  taxa: Taxa | null;
  /** Comissão que este nível já gerou para quem está olhando. */
  totalCentavos: number;
  pendenteCentavos: number;
  liberadoCentavos: number;
  vendas: number;
};

export type Indicado = {
  id: string;
  /** Nome de exibição. Nunca e-mail, CPF ou telefone. */
  nome: string;
  nivel: number;
  desde: string;
  /** O que ESTA pessoa gerou de comissão para quem está olhando. */
  comissaoCentavos: number;
  vendas: number;
};

export type ComissaoExtrato = {
  id: string;
  origem: OrigemComissao;
  nivel: number | null;
  status: StatusComissao;
  valorCentavos: number;
  baseCentavos: number;
  percentual: number;
  pagoEm: string;
  liberadaEm: string;
  estornadaEm: string | null;
  motivoEstorno: string | null;
  /** Referência do pagamento que gerou a comissão — a trilha da disputa. */
  pagamentoRef: string;
  origemNome: string | null;
};

export type Lancamento = {
  id: string;
  motivo: MotivoLancamento;
  pendente: number;
  disponivel: number;
  bloqueado: number;
  sacado: number;
  criadoEm: string;
};

export type SaqueResumo = {
  id: string;
  valorCentavos: number;
  retencaoCentavos: number;
  liquidoCentavos: number;
  status: StatusSaque;
  solicitadoEm: string;
  decididoEm: string | null;
  pagoEm: string | null;
  motivoRecusa: string | null;
  comprovanteRef: string | null;
  destino: string;
};

export type ContaRecebimento = {
  id: string;
  tipo: TipoConta;
  chaveTipo: TipoChavePix | null;
  /** Mascarada: o dono confere os últimos dígitos sem a chave inteira no HTML. */
  chaveMascarada: string | null;
  bancoNome: string | null;
  agencia: string | null;
  contaMascarada: string | null;
  titularNome: string;
  principal: boolean;
};

export type Kyc = {
  status: StatusKyc;
  nome: string;
  cpfFinal: string | null;
  verificadoEm: string | null;
  motivoRecusa: string | null;
};

export type ConviteRecebido = {
  id: string;
  gerente: string;
  mensagem: string | null;
  criadoEm: string;
  expiraEm: string;
};

export type ConviteEnviado = {
  id: string;
  nome: string;
  status: StatusConvite;
  criadoEm: string;
  expiraEm: string;
  respondidoEm: string | null;
};

export type MembroEquipe = {
  id: string;
  nome: string;
  papel: Papel;
  desde: string | null;
  /** Contagem, não dinheiro: o faturamento do membro é dado dele. */
  indicadosDiretos: number;
  podePromover: boolean;
};

// -----------------------------------------------------------------------------
// Rótulos e formatação. Ficam aqui para que as três telas digam a MESMA coisa
// sobre o mesmo estado — "disponível" com dois nomes vira dúvida no suporte.
// -----------------------------------------------------------------------------

export const ROTULO_ORIGEM: Record<OrigemComissao, string> = {
  nivel_1: "Nível 1 — indicação direta",
  nivel_2: "Nível 2",
  nivel_3: "Nível 3",
  gerente: "Gerente da equipe",
};

export const ROTULO_ORIGEM_CURTO: Record<OrigemComissao, string> = {
  nivel_1: "Nível 1",
  nivel_2: "Nível 2",
  nivel_3: "Nível 3",
  gerente: "Gerente",
};

export const ROTULO_STATUS_COMISSAO: Record<StatusComissao, string> = {
  pendente: "Pendente",
  disponivel: "Disponível",
  paga: "Paga",
  estornada: "Estornada",
};

export const ROTULO_STATUS_SAQUE: Record<StatusSaque, string> = {
  solicitado: "Em análise",
  aprovado: "Aprovado",
  pago: "Pago",
  recusado: "Recusado",
  cancelado: "Cancelado",
};

export const ROTULO_STATUS_KYC: Record<StatusKyc, string> = {
  pendente: "Em análise",
  verificado: "Verificado",
  recusado: "Recusado",
};

export const ROTULO_MOTIVO: Record<MotivoLancamento, string> = {
  credito: "Comissão gerada",
  liberacao: "Liberada (D+30)",
  bloqueio: "Reservada para saque",
  saque: "Paga no saque",
  estorno: "Devolvida ao disponível",
  clawback: "Estorno da venda (clawback)",
  ajuste: "Ajuste manual",
};

export const ROTULO_CHAVE_PIX: Record<TipoChavePix, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  aleatoria: "Chave aleatória",
};

/** Centavos inteiros para "R$ 1.234,56". A divisão por 100 mora num lugar só. */
export function dinheiro(centavos: number): string {
  return brl(centavos / 100);
}

/** 0.3 -> "30%". A fração é como o banco guarda; o % é como a pessoa lê. */
export function percentual(fracao: number): string {
  const n = fracao * 100;
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

export function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function dataHora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Dias inteiros que faltam até uma data. Passado vira 0. */
export function diasAte(iso: string | null): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function linkDeIndicacao(codigo: string): string {
  return `${env.siteUrl}/cadastro?ref=${encodeURIComponent(codigo)}`;
}

// -----------------------------------------------------------------------------
// CPF e o HMAC do KYC.
// -----------------------------------------------------------------------------

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/**
 * Corta texto no limite de CARACTERES do projeto (code points), que é o que o
 * `length()` do Postgres conta nos CHECKs. `.slice` conta unidade UTF-16 e
 * parte emoji ao meio — e meia surrogate é sequência UTF-8 inválida, que o
 * banco recusa com erro de encoding em vez de gravar truncado.
 */
export function recortar(texto: string, maximo: number): string {
  if (contarCaracteres(texto) <= maximo) return texto;
  return [...texto].slice(0, maximo).join("");
}

/**
 * Dígitos verificadores do CPF.
 *
 * Vale a checagem local mesmo sem provedor de KYC: barra erro de digitação
 * antes de gravar um hash que nunca mais pode ser conferido contra o número
 * original — e hash de CPF errado é um saque que trava na conferência manual.
 * Isto NÃO é verificação de identidade; quem verifica é uma pessoa.
 */
export function cpfValido(bruto: string): boolean {
  const cpf = somenteDigitos(bruto);
  if (cpf.length !== 11) return false;
  // Todos os dígitos iguais passam na conta dos verificadores e são inválidos.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  for (const [posicao, peso] of [
    [9, 10],
    [10, 11],
  ] as const) {
    let soma = 0;
    for (let i = 0; i < posicao; i++) soma += Number(cpf[i]) * (peso - i);
    const resto = (soma * 10) % 11;
    const digito = resto === 10 ? 0 : resto;
    if (digito !== Number(cpf[posicao])) return false;
  }

  return true;
}

/**
 * HMAC-SHA256(cpf, KYC_PEPPER).
 *
 * O pepper vive no ambiente e nunca no banco: um dump vazado não vira lista de
 * CPFs. SHA cru não serviria — 11 dígitos com dois verificadores são ~10^9
 * candidatos, tabela arco-íris de minutos. Sem o pepper configurado a operação
 * FALHA: gravar um hash sem segredo seria pior do que não gravar, porque a
 * tela diria "identidade registrada" sobre um dado que não protege ninguém.
 */
function hashDeCpf(cpf: string): Buffer {
  if (!servicos.kyc) {
    throw new ErroDominio(
      "servico_indisponivel",
      "KYC_PEPPER não está configurada. Sem o segredo, o CPF não pode ser guardado com segurança — e guardar sem ele seria pior do que não guardar.",
    );
  }
  return createHmac("sha256", env.kycPepper).update(somenteDigitos(cpf)).digest();
}

/** Últimos 4 caracteres à vista. O resto some do HTML. */
function mascarar(valor: string | null): string | null {
  if (!valor) return null;
  const limpo = valor.trim();
  if (limpo.length <= 4) return limpo;
  return `••••${limpo.slice(-4)}`;
}

// -----------------------------------------------------------------------------
// Erro. Os índices desta migração dizem coisas específicas; sem tradução o
// usuário lê "Esse registro já existe" e não sabe o que fazer.
// -----------------------------------------------------------------------------

const POR_CONSTRAINT: Record<string, [CodigoErro, string]> = {
  convites_gerente_equipe_idx: [
    "conflito",
    "Essa pessoa já faz parte da equipe de um gerente.",
  ],
  convites_gerente_pendente_idx: [
    "conflito",
    "Você já tem um convite pendente para essa pessoa.",
  ],
  convites_gerente_nao_convida_a_si: [
    "dado_invalido",
    "Você não pode convidar a si mesmo.",
  ],
  kyc_cpf_unico: [
    "conflito",
    "Esse CPF já está cadastrado em outra conta. Um CPF por conta de afiliado.",
  ],
  saque_comissoes_uma_vez: [
    "conflito",
    "Uma comissão deste pedido já entrou em outro saque. Atualize a página e tente de novo.",
  ],
  dados_bancarios_principal_idx: [
    "conflito",
    "Já existe uma conta principal. Atualize a página e tente de novo.",
  ],
};

async function comTraducaoDeAfiliado<T>(operacao: () => Promise<T>): Promise<T> {
  try {
    return await operacao();
  } catch (erro) {
    const nome = (erro as { constraint_name?: string })?.constraint_name;
    const especifico = nome ? POR_CONSTRAINT[nome] : undefined;
    if (especifico) throw new ErroDominio(especifico[0], especifico[1], erro);
    throw traduzirErro(erro);
  }
}

// -----------------------------------------------------------------------------
// Exemplos do modo demo.
//
// A sessão demo não tem linha no banco: qualquer `where perfil_id = $1` com o
// uuid falso volta vazio e a tela viraria um estado vazio mentiroso. Aqui as
// três telas mostram uma rede plausível, com o selo de exemplo na interface.
// -----------------------------------------------------------------------------

const DEMO_CODIGO = "SHOPIA01";

const DEMO_SALDO: Saldo = {
  pendente: 48_700,
  disponivel: 126_400,
  bloqueado: 0,
  sacado: 310_000,
  proximaLiberacao: new Date(Date.now() + 11 * 86_400_000).toISOString(),
};

const DEMO_TAXAS: Taxa[] = [
  { origem: "nivel_1", percentual: 0.3, provisorio: true },
  { origem: "nivel_2", percentual: 0.1, provisorio: true },
  { origem: "nivel_3", percentual: 0.05, provisorio: true },
  { origem: "gerente", percentual: 0.6, provisorio: true },
];

function demoTaxa(origem: OrigemComissao): Taxa | null {
  return DEMO_TAXAS.find((t) => t.origem === origem) ?? null;
}

const DEMO_INDICADOS: Indicado[] = [
  {
    id: "demo-1",
    nome: "Marina Prado",
    nivel: 1,
    desde: new Date(Date.now() - 64 * 86_400_000).toISOString(),
    comissaoCentavos: 89_100,
    vendas: 3,
  },
  {
    id: "demo-2",
    nome: "Rafael Mendes",
    nivel: 1,
    desde: new Date(Date.now() - 41 * 86_400_000).toISOString(),
    comissaoCentavos: 29_700,
    vendas: 1,
  },
  {
    id: "demo-3",
    nome: "@juliacs",
    nivel: 2,
    desde: new Date(Date.now() - 22 * 86_400_000).toISOString(),
    comissaoCentavos: 19_800,
    vendas: 2,
  },
  {
    id: "demo-4",
    nome: "Tiago Nunes",
    nivel: 3,
    desde: new Date(Date.now() - 9 * 86_400_000).toISOString(),
    comissaoCentavos: 4_950,
    vendas: 1,
  },
];

function demoNiveis(): NivelRede[] {
  const base: { nivel: 1 | 2 | 3; pessoas: number; total: number; vendas: number }[] = [
    { nivel: 1, pessoas: 2, total: 118_800, vendas: 4 },
    { nivel: 2, pessoas: 1, total: 19_800, vendas: 2 },
    { nivel: 3, pessoas: 1, total: 4_950, vendas: 1 },
  ];

  return base.map((n) => ({
    nivel: n.nivel,
    pessoas: n.pessoas,
    taxa: demoTaxa(`nivel_${n.nivel}` as OrigemComissao),
    totalCentavos: n.total,
    pendenteCentavos: Math.round(n.total * 0.3),
    liberadoCentavos: n.total - Math.round(n.total * 0.3),
    vendas: n.vendas,
  }));
}

// -----------------------------------------------------------------------------
// Leitura — todas com perfilId no primeiro argumento e no `where`.
// -----------------------------------------------------------------------------

type LinhaSaldo = {
  pendente: string;
  disponivel: string;
  bloqueado: string;
  sacado: string;
  proxima: Date | null;
};

async function lerSaldo(perfilId: string): Promise<Saldo> {
  // Parte de `perfis` para que a linha exista mesmo quando o afiliado ainda não
  // tem cache em `afiliados_saldos` — sem isso a tela nova quebraria em zero.
  const linhas = await bd()<LinhaSaldo[]>`
    select coalesce(s.pendente, 0)   as pendente,
           coalesce(s.disponivel, 0) as disponivel,
           coalesce(s.bloqueado, 0)  as bloqueado,
           coalesce(s.sacado, 0)     as sacado,
           (select min(c.liberada_em)
              from comissoes c
             where c.perfil_id = p.id and c.status = 'pendente') as proxima
      from perfis p
      left join afiliados_saldos s on s.perfil_id = p.id
     where p.id = ${perfilId}
  `;

  const l = linhas[0];
  return {
    pendente: numeroDe(l?.pendente),
    disponivel: numeroDe(l?.disponivel),
    bloqueado: numeroDe(l?.bloqueado),
    sacado: numeroDe(l?.sacado),
    proximaLiberacao: l?.proxima ? l.proxima.toISOString() : null,
  };
}

/**
 * Taxa vigente por origem.
 *
 * Sem `perfilId` porque não é dado de usuário: é a tabela de preço do programa,
 * igual para todo mundo e já pública na tela. `distinct on` pega a regra mais
 * recente de cada origem, que é o mesmo critério de `regra_comissao_vigente`.
 */
async function lerTaxas(): Promise<Taxa[]> {
  const linhas = await bd()<
    { origem: OrigemComissao; percentual: string; provisorio: boolean }[]
  >`
    select distinct on (origem) origem, percentual, provisorio
      from comissao_regras
     where vigencia_inicio <= now()
       and (vigencia_fim is null or vigencia_fim > now())
     order by origem, vigencia_inicio desc
  `;

  return linhas.map((l) => ({
    origem: l.origem,
    percentual: numeroDe(l.percentual),
    provisorio: l.provisorio,
  }));
}

async function lerNiveis(perfilId: string, taxas: Taxa[]): Promise<NivelRede[]> {
  const pessoas = await bd()<{ nivel: number; pessoas: number }[]>`
    select i.nivel::int as nivel, count(*)::int as pessoas
      from indicacoes i
     where i.ancestral_id = ${perfilId}
     group by i.nivel
  `;

  const ganhos = await bd()<
    { nivel: number; total: string; pendente: string; liberado: string; vendas: number }[]
  >`
    select c.nivel::int as nivel,
           coalesce(sum(c.valor_centavos), 0) as total,
           coalesce(sum(c.valor_centavos) filter (where c.status = 'pendente'), 0) as pendente,
           coalesce(sum(c.valor_centavos) filter (where c.status in ('disponivel', 'paga')), 0) as liberado,
           (count(distinct c.pagamento_ref))::int as vendas
      from comissoes c
     where c.perfil_id = ${perfilId}
       and c.nivel is not null
       and c.status <> 'estornada'
     group by c.nivel
  `;

  return ([1, 2, 3] as const).map((nivel) => {
    const p = pessoas.find((x) => x.nivel === nivel);
    const g = ganhos.find((x) => x.nivel === nivel);
    return {
      nivel,
      pessoas: p?.pessoas ?? 0,
      taxa: taxas.find((t) => t.origem === `nivel_${nivel}`) ?? null,
      totalCentavos: numeroDe(g?.total),
      pendenteCentavos: numeroDe(g?.pendente),
      liberadoCentavos: numeroDe(g?.liberado),
      vendas: g?.vendas ?? 0,
    };
  });
}

/**
 * A rede de quem está olhando.
 *
 * `comissaoCentavos` é o que cada indicado gerou PARA O DONO DA TELA — receita
 * dele, não faturamento do indicado. O join carrega `c.perfil_id = perfilId`
 * justamente para que nenhuma linha de comissão de outra pessoa entre na conta.
 */
async function lerIndicados(perfilId: string, nivelMaximo = 3, limite = 200) {
  const linhas = await bd()<
    {
      id: string;
      nome: string;
      nivel: number;
      criado_em: Date;
      comissao: string;
      vendas: number;
    }[]
  >`
    select p.id,
           coalesce(nullif(btrim(p.nome), ''), '@' || p.usuario) as nome,
           i.nivel::int as nivel,
           i.criado_em,
           coalesce(sum(c.valor_centavos) filter (where c.status <> 'estornada'), 0) as comissao,
           (count(distinct c.pagamento_ref) filter (where c.status <> 'estornada'))::int as vendas
      from indicacoes i
      join perfis p on p.id = i.perfil_id
      left join comissoes c
        on c.origem_perfil_id = i.perfil_id
       and c.perfil_id = ${perfilId}
     where i.ancestral_id = ${perfilId}
       and i.nivel <= ${nivelMaximo}
     group by p.id, p.nome, p.usuario, i.nivel, i.criado_em
     order by i.nivel, i.criado_em desc
     limit ${limite}
  `;

  return linhas.map<Indicado>((l) => ({
    id: l.id,
    nome: l.nome,
    nivel: l.nivel,
    desde: l.criado_em.toISOString(),
    comissaoCentavos: numeroDe(l.comissao),
    vendas: l.vendas,
  }));
}

export type PainelIndicacao = {
  codigo: string;
  link: string;
  diasLiberacao: number;
  saldo: Saldo;
  niveis: NivelRede[];
  indicados: Indicado[];
  taxas: Taxa[];
  /** Algum percentual ainda é provisório? É o que sustenta o aviso do topo. */
  temTaxaProvisoria: boolean;
};

export async function painelDeIndicacao(perfilId: string): Promise<PainelIndicacao> {
  return comDemo<PainelIndicacao>(
    () => ({
      codigo: DEMO_CODIGO,
      link: linkDeIndicacao(DEMO_CODIGO),
      diasLiberacao: 30,
      saldo: DEMO_SALDO,
      niveis: demoNiveis(),
      indicados: DEMO_INDICADOS,
      taxas: DEMO_TAXAS,
      temTaxaProvisoria: true,
    }),
    async () => {
      const perfil = await bd()<{ codigo_ref: string }[]>`
        select codigo_ref from perfis where id = ${perfilId}
      `;
      const codigo = perfil[0]?.codigo_ref ?? "";

      const taxas = await lerTaxas();
      const [saldo, niveis, indicados, diasLiberacao] = await Promise.all([
        lerSaldo(perfilId),
        lerNiveis(perfilId, taxas),
        lerIndicados(perfilId),
        configuracao("comissao.dias_liberacao", 30),
      ]);

      return {
        codigo,
        link: linkDeIndicacao(codigo),
        diasLiberacao: Math.round(diasLiberacao),
        saldo,
        niveis,
        indicados,
        taxas,
        temTaxaProvisoria: taxas.some((t) => t.provisorio),
      };
    },
  );
}

export type PainelAfiliado = {
  codigo: string;
  link: string;
  taxa: Taxa | null;
  taxaGerente: Taxa | null;
  saldo: Saldo;
  diretos: Indicado[];
  volume: { vendas: number; brutoCentavos: number; comissaoCentavos: number };
  gerente: string | null;
  diasLiberacao: number;
};

export async function painelDoAfiliado(perfilId: string): Promise<PainelAfiliado> {
  return comDemo<PainelAfiliado>(
    () => ({
      codigo: DEMO_CODIGO,
      link: linkDeIndicacao(DEMO_CODIGO),
      taxa: demoTaxa("nivel_1"),
      taxaGerente: demoTaxa("gerente"),
      saldo: DEMO_SALDO,
      diretos: DEMO_INDICADOS.filter((i) => i.nivel === 1),
      volume: { vendas: 4, brutoCentavos: 396_000, comissaoCentavos: 118_800 },
      gerente: "Carla Gerente",
      diasLiberacao: 30,
    }),
    async () => {
      const perfil = await bd()<{ codigo_ref: string }[]>`
        select codigo_ref from perfis where id = ${perfilId}
      `;
      const codigo = perfil[0]?.codigo_ref ?? "";

      const taxas = await lerTaxas();

      // Volume gerado = o valor das VENDAS que passaram pela indicação direta
      // (base_centavos das comissões de nível 1), não a comissão em cima delas.
      const volumeLinhas = await bd()<
        { vendas: number; bruto: string; comissao: string }[]
      >`
        select (count(distinct c.pagamento_ref))::int as vendas,
               coalesce(sum(c.base_centavos), 0)  as bruto,
               coalesce(sum(c.valor_centavos), 0) as comissao
          from comissoes c
         where c.perfil_id = ${perfilId}
           and c.origem = 'nivel_1'
           and c.status <> 'estornada'
      `;

      const gerenteLinhas = await bd()<{ nome: string }[]>`
        select coalesce(nullif(btrim(g.nome), ''), '@' || g.usuario) as nome
          from convites_gerente cg
          join perfis g on g.id = cg.gerente_id
         where cg.perfil_id = ${perfilId} and cg.status = 'aceito'
         limit 1
      `;

      const [saldo, diretos, diasLiberacao] = await Promise.all([
        lerSaldo(perfilId),
        lerIndicados(perfilId, 1),
        configuracao("comissao.dias_liberacao", 30),
      ]);

      const v = volumeLinhas[0];
      return {
        codigo,
        link: linkDeIndicacao(codigo),
        taxa: taxas.find((t) => t.origem === "nivel_1") ?? null,
        taxaGerente: taxas.find((t) => t.origem === "gerente") ?? null,
        saldo,
        diretos,
        volume: {
          vendas: v?.vendas ?? 0,
          brutoCentavos: numeroDe(v?.bruto),
          comissaoCentavos: numeroDe(v?.comissao),
        },
        gerente: gerenteLinhas[0]?.nome ?? null,
        diasLiberacao: Math.round(diasLiberacao),
      };
    },
  );
}

export type PainelGerente = {
  taxa: Taxa | null;
  /** "nivel_1" = fração da comissão do afiliado; "pagamento" = fração da venda. */
  baseDaComissao: "nivel_1" | "pagamento";
  saldo: Saldo;
  ganhos: {
    totalCentavos: number;
    pendenteCentavos: number;
    disponivelCentavos: number;
    pagaCentavos: number;
    lancamentos: number;
  };
  equipe: MembroEquipe[];
  agregado: {
    membros: number;
    indicadosDaEquipe: number;
    vendas: number;
    volumeCentavos: number;
  };
  saquesDaEquipe: { status: StatusSaque; quantidade: number; totalCentavos: number }[];
  convites: ConviteEnviado[];
  diasDeConvite: number;
};

export async function painelDoGerente(perfilId: string): Promise<PainelGerente> {
  return comDemo<PainelGerente>(
    () => ({
      taxa: demoTaxa("gerente"),
      baseDaComissao: "nivel_1",
      saldo: DEMO_SALDO,
      ganhos: {
        totalCentavos: 214_600,
        pendenteCentavos: 48_700,
        disponivelCentavos: 96_900,
        pagaCentavos: 69_000,
        lancamentos: 12,
      },
      equipe: [
        {
          id: "demo-a",
          nome: "Bruno Afiliado",
          papel: "affiliate",
          desde: new Date(Date.now() - 120 * 86_400_000).toISOString(),
          indicadosDiretos: 7,
          podePromover: false,
        },
        {
          id: "demo-b",
          nome: "Marina Prado",
          papel: "user",
          desde: new Date(Date.now() - 30 * 86_400_000).toISOString(),
          indicadosDiretos: 2,
          podePromover: true,
        },
      ],
      agregado: {
        membros: 2,
        indicadosDaEquipe: 9,
        vendas: 14,
        volumeCentavos: 1_386_000,
      },
      saquesDaEquipe: [
        { status: "solicitado", quantidade: 1, totalCentavos: 86_000 },
        { status: "pago", quantidade: 3, totalCentavos: 412_000 },
      ],
      convites: [
        {
          id: "demo-c1",
          nome: "Tiago Nunes",
          status: "pendente",
          criadoEm: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          expiraEm: new Date(Date.now() + 5 * 86_400_000).toISOString(),
          respondidoEm: null,
        },
      ],
      diasDeConvite: 7,
    }),
    async () => {
      const taxas = await lerTaxas();

      const configBase = await bd()<{ valor: string | null }[]>`
        select valor #>> '{}' as valor
          from configuracoes
         where chave = 'comissao.gerente_base'
      `;

      const ganhosLinhas = await bd()<
        {
          total: string;
          pendente: string;
          disponivel: string;
          paga: string;
          lancamentos: number;
        }[]
      >`
        select coalesce(sum(valor_centavos), 0) as total,
               coalesce(sum(valor_centavos) filter (where status = 'pendente'), 0) as pendente,
               coalesce(sum(valor_centavos) filter (where status = 'disponivel'), 0) as disponivel,
               coalesce(sum(valor_centavos) filter (where status = 'paga'), 0) as paga,
               (count(*))::int as lancamentos
          from comissoes
         where perfil_id = ${perfilId}
           and origem = 'gerente'
           and status <> 'estornada'
      `;

      // Nome de exibição e CONTAGEM de indicados. Nada de dinheiro por pessoa:
      // o faturamento do membro é dado dele, não do gerente (PLANO.md §7).
      const equipeLinhas = await bd()<
        { id: string; nome: string; papel: Papel; desde: Date | null; indicados: number }[]
      >`
        select p.id,
               coalesce(nullif(btrim(p.nome), ''), '@' || p.usuario) as nome,
               p.papel,
               cg.respondido_em as desde,
               (select count(*) from indicacoes i
                 where i.ancestral_id = p.id and i.nivel = 1)::int as indicados
          from convites_gerente cg
          join perfis p on p.id = cg.perfil_id
         where cg.gerente_id = ${perfilId} and cg.status = 'aceito'
         order by cg.respondido_em desc nulls last
         limit 200
      `;

      const agregadoLinhas = await bd()<
        { membros: number; indicados: number; vendas: number; volume: string }[]
      >`
        select
          (select count(*)::int
             from convites_gerente cg
            where cg.gerente_id = ${perfilId} and cg.status = 'aceito') as membros,
          (select count(*)::int
             from indicacoes i
             join convites_gerente cg
               on cg.perfil_id = i.ancestral_id
              and cg.gerente_id = ${perfilId}
              and cg.status = 'aceito'
            where i.nivel = 1) as indicados,
          (select (count(distinct c.pagamento_ref))::int
             from comissoes c
             join convites_gerente cg
               on cg.perfil_id = c.perfil_id
              and cg.gerente_id = ${perfilId}
              and cg.status = 'aceito'
            where c.origem = 'nivel_1' and c.status <> 'estornada') as vendas,
          (select coalesce(sum(c.base_centavos), 0)
             from comissoes c
             join convites_gerente cg
               on cg.perfil_id = c.perfil_id
              and cg.gerente_id = ${perfilId}
              and cg.status = 'aceito'
            where c.origem = 'nivel_1' and c.status <> 'estornada') as volume
      `;

      // Saque da equipe sai AGREGADO por estado. Quanto cada afiliado pediu é
      // dado financeiro dele; o gerente precisa do panorama, não do extrato.
      const saquesLinhas = await bd()<
        { status: StatusSaque; quantidade: number; total: string }[]
      >`
        select s.status,
               count(*)::int as quantidade,
               coalesce(sum(s.valor_centavos), 0) as total
          from saques s
          join convites_gerente cg
            on cg.perfil_id = s.perfil_id
           and cg.gerente_id = ${perfilId}
           and cg.status = 'aceito'
         group by s.status
         order by s.status
      `;

      const convitesLinhas = await bd()<
        {
          id: string;
          nome: string;
          status: StatusConvite;
          criado_em: Date;
          expira_em: Date;
          respondido_em: Date | null;
        }[]
      >`
        select cg.id,
               coalesce(nullif(btrim(p.nome), ''), '@' || p.usuario) as nome,
               cg.status, cg.criado_em, cg.expira_em, cg.respondido_em
          from convites_gerente cg
          join perfis p on p.id = cg.perfil_id
         where cg.gerente_id = ${perfilId}
         order by cg.criado_em desc
         limit 50
      `;

      const [saldo, diasDeConvite] = await Promise.all([
        lerSaldo(perfilId),
        configuracao("afiliado.convite_gerente_dias", 7),
      ]);

      const g = ganhosLinhas[0];
      const a = agregadoLinhas[0];

      return {
        taxa: taxas.find((t) => t.origem === "gerente") ?? null,
        baseDaComissao: configBase[0]?.valor === "pagamento" ? "pagamento" : "nivel_1",
        saldo,
        ganhos: {
          totalCentavos: numeroDe(g?.total),
          pendenteCentavos: numeroDe(g?.pendente),
          disponivelCentavos: numeroDe(g?.disponivel),
          pagaCentavos: numeroDe(g?.paga),
          lancamentos: g?.lancamentos ?? 0,
        },
        equipe: equipeLinhas.map((l) => ({
          id: l.id,
          nome: l.nome,
          papel: l.papel,
          desde: l.desde ? l.desde.toISOString() : null,
          indicadosDiretos: l.indicados,
          // Promover só faz sentido para quem ainda é 'user'. Rebaixar não é
          // operação de gerente, e subir para manager/admin muito menos.
          podePromover: l.papel === "user",
        })),
        agregado: {
          membros: a?.membros ?? 0,
          indicadosDaEquipe: a?.indicados ?? 0,
          vendas: a?.vendas ?? 0,
          volumeCentavos: numeroDe(a?.volume),
        },
        saquesDaEquipe: saquesLinhas.map((l) => ({
          status: l.status,
          quantidade: l.quantidade,
          totalCentavos: numeroDe(l.total),
        })),
        convites: convitesLinhas.map((l) => ({
          id: l.id,
          nome: l.nome,
          status: l.status,
          criadoEm: l.criado_em.toISOString(),
          expiraEm: l.expira_em.toISOString(),
          respondidoEm: l.respondido_em ? l.respondido_em.toISOString() : null,
        })),
        diasDeConvite: Math.round(diasDeConvite),
      };
    },
  );
}

export async function comissoesDe(perfilId: string, limite = 50): Promise<ComissaoExtrato[]> {
  return comDemo<ComissaoExtrato[]>(
    () => [
      {
        id: "demo-c-1",
        origem: "nivel_1",
        nivel: 1,
        status: "disponivel",
        valorCentavos: 29_700,
        baseCentavos: 99_000,
        percentual: 0.3,
        pagoEm: new Date(Date.now() - 44 * 86_400_000).toISOString(),
        liberadaEm: new Date(Date.now() - 14 * 86_400_000).toISOString(),
        estornadaEm: null,
        motivoEstorno: null,
        pagamentoRef: "pagamento:exemplo-1",
        origemNome: "Marina Prado",
      },
      {
        id: "demo-c-2",
        origem: "nivel_2",
        nivel: 2,
        status: "pendente",
        valorCentavos: 9_900,
        baseCentavos: 99_000,
        percentual: 0.1,
        pagoEm: new Date(Date.now() - 19 * 86_400_000).toISOString(),
        liberadaEm: new Date(Date.now() + 11 * 86_400_000).toISOString(),
        estornadaEm: null,
        motivoEstorno: null,
        pagamentoRef: "pagamento:exemplo-2",
        origemNome: "@juliacs",
      },
      {
        id: "demo-c-3",
        origem: "nivel_1",
        nivel: 1,
        status: "estornada",
        valorCentavos: 29_700,
        baseCentavos: 99_000,
        percentual: 0.3,
        pagoEm: new Date(Date.now() - 70 * 86_400_000).toISOString(),
        liberadaEm: new Date(Date.now() - 40 * 86_400_000).toISOString(),
        estornadaEm: new Date(Date.now() - 38 * 86_400_000).toISOString(),
        motivoEstorno: "estorno do pagamento pelo gateway",
        pagamentoRef: "pagamento:exemplo-3",
        origemNome: "Rafael Mendes",
      },
    ],
    async () => {
      const linhas = await bd()<
        {
          id: string;
          origem: OrigemComissao;
          nivel: number | null;
          status: StatusComissao;
          valor_centavos: number;
          base_centavos: number;
          percentual: string;
          pago_em: Date;
          liberada_em: Date;
          estornada_em: Date | null;
          motivo_estorno: string | null;
          pagamento_ref: string;
          origem_nome: string | null;
        }[]
      >`
        select c.id, c.origem, c.nivel::int as nivel, c.status,
               c.valor_centavos, c.base_centavos, c.percentual,
               c.pago_em, c.liberada_em, c.estornada_em, c.motivo_estorno,
               c.pagamento_ref,
               -- Só revela quem gerou a comissão quando essa pessoa está de
               -- fato na rede de quem lê. Na comissão de gerente a origem é um
               -- comprador de outra ponta da árvore: mostrar o nome dele aqui
               -- entregaria dado de terceiro que o gerente nunca cadastrou.
               case
                 when c.origem = 'gerente' then 'Equipe'
                 when exists (
                   select 1 from indicacoes i
                    where i.ancestral_id = ${perfilId}
                      and i.perfil_id = c.origem_perfil_id
                 )
                 then coalesce(nullif(btrim(o.nome), ''), '@' || o.usuario)
                 else 'Indicação'
               end as origem_nome
          from comissoes c
          left join perfis o on o.id = c.origem_perfil_id
         where c.perfil_id = ${perfilId}
         order by c.criado_em desc
         limit ${limite}
      `;

      return linhas.map((l) => ({
        id: l.id,
        origem: l.origem,
        nivel: l.nivel,
        status: l.status,
        valorCentavos: l.valor_centavos,
        baseCentavos: l.base_centavos,
        percentual: numeroDe(l.percentual),
        pagoEm: l.pago_em.toISOString(),
        liberadaEm: l.liberada_em.toISOString(),
        estornadaEm: l.estornada_em ? l.estornada_em.toISOString() : null,
        motivoEstorno: l.motivo_estorno,
        pagamentoRef: l.pagamento_ref,
        origemNome: l.origem_nome,
      }));
    },
  );
}

export async function lancamentosDe(perfilId: string, limite = 30): Promise<Lancamento[]> {
  return comDemo<Lancamento[]>(
    () => [
      {
        id: "demo-l-1",
        motivo: "liberacao",
        pendente: -29_700,
        disponivel: 29_700,
        bloqueado: 0,
        sacado: 0,
        criadoEm: new Date(Date.now() - 14 * 86_400_000).toISOString(),
      },
      {
        id: "demo-l-2",
        motivo: "credito",
        pendente: 9_900,
        disponivel: 0,
        bloqueado: 0,
        sacado: 0,
        criadoEm: new Date(Date.now() - 19 * 86_400_000).toISOString(),
      },
      {
        id: "demo-l-3",
        motivo: "clawback",
        pendente: 0,
        disponivel: -29_700,
        bloqueado: 0,
        sacado: 0,
        criadoEm: new Date(Date.now() - 38 * 86_400_000).toISOString(),
      },
    ],
    async () => {
      const linhas = await bd()<
        {
          id: string;
          motivo: MotivoLancamento;
          delta_pendente: string;
          delta_disponivel: string;
          delta_bloqueado: string;
          delta_sacado: string;
          criado_em: Date;
        }[]
      >`
        select id, motivo, delta_pendente, delta_disponivel,
               delta_bloqueado, delta_sacado, criado_em
          from comissoes_lancamentos
         where perfil_id = ${perfilId}
         order by criado_em desc
         limit ${limite}
      `;

      return linhas.map((l) => ({
        id: l.id,
        motivo: l.motivo,
        pendente: numeroDe(l.delta_pendente),
        disponivel: numeroDe(l.delta_disponivel),
        bloqueado: numeroDe(l.delta_bloqueado),
        sacado: numeroDe(l.delta_sacado),
        criadoEm: l.criado_em.toISOString(),
      }));
    },
  );
}

/** Descreve o destino sem repetir a chave inteira na tela. */
function descreverDestino(destino: Record<string, unknown>): string {
  const tipo = destino?.tipo === "conta" ? "conta" : "pix";

  if (tipo === "conta") {
    const banco = typeof destino?.banco_nome === "string" ? destino.banco_nome : "Conta bancária";
    const conta = typeof destino?.conta === "string" ? mascarar(destino.conta) : null;
    return conta ? `${banco} · ${conta}` : banco;
  }

  const chaveTipo = typeof destino?.chave_tipo === "string" ? destino.chave_tipo : null;
  const rotulo =
    chaveTipo && chaveTipo in ROTULO_CHAVE_PIX
      ? ROTULO_CHAVE_PIX[chaveTipo as TipoChavePix]
      : "PIX";
  const chave = typeof destino?.chave === "string" ? mascarar(destino.chave) : null;
  return chave ? `PIX ${rotulo} · ${chave}` : `PIX ${rotulo}`;
}

export async function saquesDe(perfilId: string, limite = 20): Promise<SaqueResumo[]> {
  return comDemo<SaqueResumo[]>(
    () => [
      {
        id: "demo-s-1",
        valorCentavos: 86_000,
        retencaoCentavos: 0,
        liquidoCentavos: 86_000,
        status: "solicitado",
        solicitadoEm: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        decididoEm: null,
        pagoEm: null,
        motivoRecusa: null,
        comprovanteRef: null,
        destino: "PIX CPF · ••••2233",
      },
      {
        id: "demo-s-2",
        valorCentavos: 224_000,
        retencaoCentavos: 0,
        liquidoCentavos: 224_000,
        status: "pago",
        solicitadoEm: new Date(Date.now() - 40 * 86_400_000).toISOString(),
        decididoEm: new Date(Date.now() - 38 * 86_400_000).toISOString(),
        pagoEm: new Date(Date.now() - 38 * 86_400_000).toISOString(),
        motivoRecusa: null,
        comprovanteRef: "E00038166202609101200",
        destino: "PIX CPF · ••••2233",
      },
    ],
    async () => {
      const linhas = await bd()<
        {
          id: string;
          valor_centavos: number;
          retencao_centavos: number;
          liquido_centavos: number;
          status: StatusSaque;
          solicitado_em: Date;
          decidido_em: Date | null;
          pago_em: Date | null;
          motivo_recusa: string | null;
          comprovante_ref: string | null;
          destino: Record<string, unknown>;
        }[]
      >`
        select id, valor_centavos, retencao_centavos, liquido_centavos, status,
               solicitado_em, decidido_em, pago_em, motivo_recusa,
               comprovante_ref, destino
          from saques
         where perfil_id = ${perfilId}
         order by solicitado_em desc
         limit ${limite}
      `;

      return linhas.map((l) => ({
        id: l.id,
        valorCentavos: l.valor_centavos,
        retencaoCentavos: l.retencao_centavos,
        liquidoCentavos: l.liquido_centavos,
        status: l.status,
        solicitadoEm: l.solicitado_em.toISOString(),
        decididoEm: l.decidido_em ? l.decidido_em.toISOString() : null,
        pagoEm: l.pago_em ? l.pago_em.toISOString() : null,
        motivoRecusa: l.motivo_recusa,
        comprovanteRef: l.comprovante_ref,
        destino: descreverDestino(l.destino ?? {}),
      }));
    },
  );
}

/**
 * Por que o saque está fechado.
 *
 * Código e texto andam juntos porque os dois têm consumidores diferentes: a
 * tela mostra o texto, e a Server Action devolve só o código na URL (frase
 * pronta vinda da query vira tela que diz o que o link mandar).
 */
export type ImpedimentoSaque =
  | "kyc_desligado"
  | "kyc_ausente"
  | "kyc_analise"
  | "kyc_recusado"
  | "sem_conta"
  | "abaixo_minimo"
  | "teto_periodo";

export type EstadoDeSaque = {
  kyc: Kyc | null;
  contas: ContaRecebimento[];
  disponivelCentavos: number;
  minimoCentavos: number;
  tetoCentavos: number;
  periodoDias: number;
  usadoNoPeriodoCentavos: number;
  restanteCentavos: number;
  /** true só quando TODAS as condições passam. A tela nunca decide sozinha. */
  podeSolicitar: boolean;
  /** O motivo exato de estar bloqueado, para a tela dizer o que fazer. */
  impedimento: { codigo: ImpedimentoSaque; texto: string } | null;
  kycConfigurado: boolean;
};

export async function estadoDeSaque(perfilId: string): Promise<EstadoDeSaque> {
  return comDemo<EstadoDeSaque>(
    () => ({
      kyc: {
        status: "verificado",
        nome: "Bruno Afiliado",
        cpfFinal: "33",
        verificadoEm: new Date(Date.now() - 90 * 86_400_000).toISOString(),
        motivoRecusa: null,
      },
      contas: [
        {
          id: "demo-conta-1",
          tipo: "pix",
          chaveTipo: "cpf",
          chaveMascarada: "••••2233",
          bancoNome: null,
          agencia: null,
          contaMascarada: null,
          titularNome: "Bruno Afiliado",
          principal: true,
        },
      ],
      disponivelCentavos: DEMO_SALDO.disponivel,
      minimoCentavos: 5_000,
      tetoCentavos: 500_000,
      periodoDias: 30,
      usadoNoPeriodoCentavos: 86_000,
      restanteCentavos: 414_000,
      podeSolicitar: true,
      impedimento: null,
      // O exemplo mostra a tela de uma conta JÁ configurada — é para isso que o
      // modo demo existe. A sessão inteira já está rotulada como exemplo no
      // topo da página; misturar aqui o estado real do ambiente (sem pepper)
      // faria a mesma tela dizer "verificado" e "verificação desligada".
      kycConfigurado: true,
    }),
    async () => {
      const kycLinhas = await bd()<
        {
          status: StatusKyc;
          nome: string;
          cpf_final: string | null;
          verificado_em: Date | null;
          motivo_recusa: string | null;
        }[]
      >`
        select status, nome, cpf_final, verificado_em, motivo_recusa
          from kyc_dados
         where perfil_id = ${perfilId}
      `;

      const contasLinhas = await bd()<
        {
          id: string;
          tipo: TipoConta;
          chave_tipo: TipoChavePix | null;
          chave: string | null;
          banco_nome: string | null;
          agencia: string | null;
          conta: string | null;
          titular_nome: string;
          principal: boolean;
        }[]
      >`
        select id, tipo, chave_tipo, chave, banco_nome, agencia, conta,
               titular_nome, principal
          from dados_bancarios
         where perfil_id = ${perfilId}
         order by principal desc, criado_em desc
      `;

      const [saldo, minimo, teto, periodo] = await Promise.all([
        lerSaldo(perfilId),
        configuracao("saque.minimo_centavos", 5_000),
        configuracao("saque.teto_periodo_centavos", 500_000),
        configuracao("saque.periodo_dias", 30),
      ]);

      const periodoDias = Math.round(periodo);
      const usadoLinhas = await bd()<{ usado: string }[]>`
        select coalesce(sum(valor_centavos), 0) as usado
          from saques
         where perfil_id = ${perfilId}
           and status in ('solicitado', 'aprovado', 'pago')
           and solicitado_em > now() - make_interval(days => ${periodoDias}::int)
      `;

      const kycLinha = kycLinhas[0];
      const kyc: Kyc | null = kycLinha
        ? {
            status: kycLinha.status,
            nome: kycLinha.nome,
            cpfFinal: kycLinha.cpf_final,
            verificadoEm: kycLinha.verificado_em
              ? kycLinha.verificado_em.toISOString()
              : null,
            motivoRecusa: kycLinha.motivo_recusa,
          }
        : null;

      const contas = contasLinhas.map<ContaRecebimento>((l) => ({
        id: l.id,
        tipo: l.tipo,
        chaveTipo: l.chave_tipo,
        chaveMascarada: mascarar(l.chave),
        bancoNome: l.banco_nome,
        agencia: l.agencia,
        contaMascarada: mascarar(l.conta),
        titularNome: l.titular_nome,
        principal: l.principal,
      }));

      const minimoCentavos = Math.round(minimo);
      const tetoCentavos = Math.round(teto);
      const usado = numeroDe(usadoLinhas[0]?.usado);
      const restante = Math.max(0, tetoCentavos - usado);

      // A ordem importa: a tela deve mostrar o PRIMEIRO passo que falta, não a
      // lista inteira de tudo que ainda não foi feito.
      let impedimento: { codigo: ImpedimentoSaque; texto: string } | null = null;
      if (!servicos.kyc) {
        impedimento = {
          codigo: "kyc_desligado",
          texto:
            "A verificação de identidade está desligada neste ambiente (falta KYC_PEPPER). Sem o segredo, o CPF não pode ser guardado com segurança — e o saque fica indisponível em vez de fingir que funciona.",
        };
      } else if (!kyc) {
        impedimento = {
          codigo: "kyc_ausente",
          texto: "Envie seus dados de identidade para liberar o saque.",
        };
      } else if (kyc.status === "pendente") {
        impedimento = {
          codigo: "kyc_analise",
          texto:
            "Sua identidade está em análise. O saque abre quando a verificação terminar — quem confere é uma pessoa, não o formulário.",
        };
      } else if (kyc.status === "recusado") {
        impedimento = {
          codigo: "kyc_recusado",
          texto: "A verificação de identidade foi recusada. Corrija os dados e envie de novo.",
        };
      } else if (contas.length === 0) {
        impedimento = {
          codigo: "sem_conta",
          texto: "Cadastre uma conta de recebimento no mesmo titular da verificação.",
        };
      } else if (saldo.disponivel < minimoCentavos) {
        impedimento = {
          codigo: "abaixo_minimo",
          texto: `O saldo disponível ainda não chegou ao mínimo de ${dinheiro(minimoCentavos)}.`,
        };
      } else if (restante < minimoCentavos) {
        impedimento = {
          codigo: "teto_periodo",
          texto: `O teto de ${dinheiro(tetoCentavos)} a cada ${periodoDias} dias já foi usado neste período.`,
        };
      }

      return {
        kyc,
        contas,
        disponivelCentavos: saldo.disponivel,
        minimoCentavos,
        tetoCentavos,
        periodoDias,
        usadoNoPeriodoCentavos: usado,
        restanteCentavos: restante,
        podeSolicitar: impedimento === null,
        impedimento,
        kycConfigurado: servicos.kyc,
      };
    },
  );
}

export async function convitesRecebidos(perfilId: string): Promise<ConviteRecebido[]> {
  return comDemo<ConviteRecebido[]>(
    () => [
      {
        id: "demo-cr-1",
        gerente: "Carla Gerente",
        mensagem: "Entra no meu time que eu te ajudo a montar a primeira live.",
        criadoEm: new Date(Date.now() - 86_400_000).toISOString(),
        expiraEm: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      },
    ],
    async () => {
      const linhas = await bd()<
        {
          id: string;
          gerente: string;
          mensagem: string | null;
          criado_em: Date;
          expira_em: Date;
        }[]
      >`
        select cg.id,
               coalesce(nullif(btrim(g.nome), ''), '@' || g.usuario) as gerente,
               cg.mensagem, cg.criado_em, cg.expira_em
          from convites_gerente cg
          join perfis g on g.id = cg.gerente_id
         where cg.perfil_id = ${perfilId}
           and cg.status = 'pendente'
           and cg.expira_em > now()
         order by cg.criado_em desc
         limit 10
      `;

      return linhas.map((l) => ({
        id: l.id,
        gerente: l.gerente,
        mensagem: l.mensagem,
        criadoEm: l.criado_em.toISOString(),
        expiraEm: l.expira_em.toISOString(),
      }));
    },
  );
}

// -----------------------------------------------------------------------------
// Operações.
//
// Nenhuma delas move dinheiro para fora: `solicitar_saque` abre um pedido
// PENDENTE DE APROVAÇÃO e reserva as comissões. Não existe gateway de
// transferência neste projeto, e fingir que existe seria fraude — quem marca um
// saque como pago é a função `pagar_saque`, que exige comprovante de uma
// transferência que aconteceu de verdade, fora daqui.
// -----------------------------------------------------------------------------

export type DadosKyc = {
  nome: string;
  nascimento: string;
  cpf: string;
};

export async function registrarKyc(perfilId: string, dados: DadosKyc): Promise<void> {
  const nome = dados.nome.trim();
  // `contarCaracteres` e não `.length`: o CHECK da tabela usa `length()` do
  // Postgres, que conta code points. Medir com unidade UTF-16 aqui deixaria
  // passar um nome que o banco recusa (ou barraria um que ele aceita).
  const tamanhoNome = contarCaracteres(nome);
  if (tamanhoNome < 3 || tamanhoNome > 160) {
    throw new ErroDominio(
      "dado_invalido",
      "Informe o nome completo como está no documento (de 3 a 160 caracteres).",
    );
  }

  const cpf = somenteDigitos(dados.cpf);
  if (!cpfValido(cpf)) {
    throw new ErroDominio("dado_invalido", "CPF inválido. Confira os números.");
  }

  const nascimento = new Date(`${dados.nascimento}T12:00:00`);
  if (Number.isNaN(nascimento.getTime())) {
    throw new ErroDominio("dado_invalido", "Data de nascimento inválida.");
  }

  // Maioridade é regra de aplicação: `current_date` não é imutável e não cabe
  // num CHECK do banco (ver o comentário da tabela em 0008).
  const idade = (Date.now() - nascimento.getTime()) / (365.2425 * 86_400_000);
  if (idade < 18) {
    throw new ErroDominio(
      "dado_invalido",
      "O titular precisa ter 18 anos ou mais para receber comissão.",
    );
  }

  const hash = hashDeCpf(cpf);

  await comTraducaoDeAfiliado(async () => {
    // Identidade já verificada não se reescreve por formulário: trocar o CPF
    // depois da conferência é o caminho de "verifico com um documento, recebo
    // no CPF de outro". A troca existe, mas passa por gente.
    const atual = await bd()<{ status: StatusKyc }[]>`
      select status from kyc_dados where perfil_id = ${perfilId}
    `;
    if (atual[0]?.status === "verificado") {
      throw new ErroDominio(
        "conflito",
        "Sua identidade já foi verificada. Para trocar o titular, fale com o suporte.",
      );
    }

    // O status volta para 'pendente' a cada reenvio, e nunca para 'verificado':
    // quem verifica identidade é uma pessoa, não o formulário de quem se
    // cadastra. `verificado_em` zera junto por causa do CHECK de coerência.
    await bd()`
      insert into kyc_dados (perfil_id, nome, nascimento, cpf_hash, cpf_final, status)
      values (
        ${perfilId}, ${nome}, ${dados.nascimento}::date,
        ${hash}, ${cpf.slice(-2)}, 'pendente'
      )
      on conflict (perfil_id) do update
         set nome = excluded.nome,
             nascimento = excluded.nascimento,
             cpf_hash = excluded.cpf_hash,
             cpf_final = excluded.cpf_final,
             status = 'pendente',
             verificado_em = null,
             verificado_por = null,
             motivo_recusa = null
    `;
  });
}

export type DadosConta = {
  tipo: TipoConta;
  chaveTipo?: TipoChavePix | null;
  chave?: string | null;
  bancoIspb?: string | null;
  bancoNome?: string | null;
  agencia?: string | null;
  conta?: string | null;
  contaDigito?: string | null;
  titularNome: string;
  titularCpf: string;
};

export async function salvarContaDeRecebimento(
  perfilId: string,
  dados: DadosConta,
): Promise<void> {
  // Para chave PIX do tipo CPF, o titular é a própria chave: aceitar dois
  // números diferentes aqui abriria a porta para pagar no CPF de outra pessoa.
  const cpfDoTitular =
    dados.tipo === "pix" && dados.chaveTipo === "cpf"
      ? somenteDigitos(dados.chave ?? "")
      : somenteDigitos(dados.titularCpf);

  if (!cpfValido(cpfDoTitular)) {
    throw new ErroDominio(
      "dado_invalido",
      "CPF do titular inválido. Precisa ser o mesmo CPF da verificação de identidade.",
    );
  }

  const titular = dados.titularNome.trim();
  const tamanhoTitular = contarCaracteres(titular);
  if (tamanhoTitular < 3 || tamanhoTitular > 160) {
    throw new ErroDominio(
      "dado_invalido",
      "Informe o nome do titular como está no banco (de 3 a 160 caracteres).",
    );
  }

  if (dados.tipo === "pix" && !(dados.chaveTipo && dados.chave?.trim())) {
    throw new ErroDominio("dado_invalido", "Informe o tipo e a chave PIX.");
  }

  if (
    dados.tipo === "conta" &&
    !(dados.bancoIspb?.trim() && dados.agencia?.trim() && dados.conta?.trim())
  ) {
    throw new ErroDominio("dado_invalido", "Informe ISPB do banco, agência e conta.");
  }

  const hash = hashDeCpf(cpfDoTitular);

  await comTraducaoDeAfiliado(async () => {
    const sql = bd();
    // Uma conta principal por perfil (índice parcial único): a antiga sai de
    // principal antes de a nova entrar, no mesmo commit.
    await sql.begin(async (tx) => {
      await tx`
        update dados_bancarios set principal = false
         where perfil_id = ${perfilId} and principal
      `;
      await tx`
        insert into dados_bancarios (
          perfil_id, tipo, chave_tipo, chave, banco_ispb, banco_nome,
          agencia, conta, conta_digito, titular_nome, titular_cpf_hash, principal
        ) values (
          ${perfilId},
          ${dados.tipo},
          ${dados.tipo === "pix" ? (dados.chaveTipo ?? null) : null},
          ${dados.tipo === "pix" ? (dados.chave?.trim() ?? null) : null},
          ${dados.bancoIspb?.trim() || null},
          ${dados.bancoNome?.trim() || null},
          ${dados.agencia?.trim() || null},
          ${dados.conta?.trim() || null},
          ${dados.contaDigito?.trim() || null},
          ${titular},
          ${hash},
          true
        )
      `;
    });
  });
}

/**
 * Abre o pedido de saque.
 *
 * `referencia` vem do formulário (gerada no RENDER da tela, num input oculto):
 * é ela que faz o duplo clique devolver o MESMO saque em vez de abrir dois.
 * Chave criada aqui dentro mudaria a cada clique e não protegeria de nada.
 */
export async function solicitarSaque(
  perfilId: string,
  opcoes: { contaId: string; referencia: string },
): Promise<SaqueResumo> {
  if (!opcoes.referencia.trim()) {
    throw new ErroDominio(
      "dado_invalido",
      "Recarregue a página: o formulário perdeu a chave que impede um saque duplicado.",
    );
  }

  return comTraducaoDeAfiliado(async () => {
    const linhas = await bd()<
      {
        id: string;
        valor_centavos: number;
        retencao_centavos: number;
        liquido_centavos: number;
        status: StatusSaque;
        solicitado_em: Date;
        destino: Record<string, unknown>;
      }[]
    >`
      select id, valor_centavos, retencao_centavos, liquido_centavos, status,
             solicitado_em, destino
        from solicitar_saque(
               ${perfilId}::uuid,
               ${opcoes.contaId}::uuid,
               ${opcoes.referencia.trim()}::text
             )
    `;

    const l = linhas[0];
    if (!l) throw new ErroDominio("desconhecido", "O pedido de saque não foi criado.");

    return {
      id: l.id,
      valorCentavos: l.valor_centavos,
      retencaoCentavos: l.retencao_centavos,
      liquidoCentavos: l.liquido_centavos,
      status: l.status,
      solicitadoEm: l.solicitado_em.toISOString(),
      decididoEm: null,
      pagoEm: null,
      motivoRecusa: null,
      comprovanteRef: null,
      destino: descreverDestino(l.destino ?? {}),
    };
  });
}

/** Desistir de um pedido ainda não decidido. O gatilho devolve as comissões. */
export async function cancelarSaque(perfilId: string, saqueId: string): Promise<void> {
  await comTraducaoDeAfiliado(async () => {
    const linhas = await bd()<{ id: string }[]>`
      update saques
         set status = 'cancelado',
             decidido_em = now(),
             motivo_recusa = 'cancelado pelo próprio afiliado'
       where id = ${saqueId}
         and perfil_id = ${perfilId}
         and status = 'solicitado'
      returning id
    `;

    if (!linhas[0]) {
      throw new ErroDominio(
        "nao_encontrado",
        "Este saque não é seu ou já saiu da análise.",
      );
    }
  });
}

/**
 * Convite de gerente, pelo CÓDIGO DE INDICAÇÃO da pessoa.
 *
 * É de propósito que não se convide por e-mail nem por @usuario: qualquer um
 * desses transformaria o formulário num oráculo de "esta pessoa é cliente" —
 * digita e-mail, lê a resposta, repete. O código é um dado que a própria pessoa
 * entrega a quem ela quer.
 */
export async function convidarParaEquipe(
  perfilId: string,
  opcoes: { codigo: string; mensagem?: string },
): Promise<void> {
  const codigo = opcoes.codigo.trim();
  if (!codigo) {
    throw new ErroDominio("dado_invalido", "Informe o código de indicação da pessoa.");
  }

  const dias = Math.round(await configuracao("afiliado.convite_gerente_dias", 7));
  // Corte por CODE POINT, não por `.slice`: cortar em unidade UTF-16 parte um
  // emoji ao meio e o que sobra é meia surrogate — que o Postgres recusa como
  // sequência UTF-8 inválida, derrubando o convite inteiro por um coração.
  const mensagem = recortar(opcoes.mensagem?.trim() ?? "", 400) || null;

  await comTraducaoDeAfiliado(async () => {
    // Não se checa aqui se a pessoa já tem gerente: responder isso a quem só
    // digitou um código entregaria o estado da conta dela. O índice parcial
    // `convites_gerente_equipe_idx` barra na HORA DE ACEITAR, e aí quem lê a
    // recusa é a própria pessoa, sobre a própria conta.
    const linhas = await bd()<{ id: string }[]>`
      insert into convites_gerente (gerente_id, perfil_id, mensagem, expira_em)
      select ${perfilId}::uuid, p.id, ${mensagem}::text,
             now() + make_interval(days => ${dias}::int)
        from perfis p
       where upper(p.codigo_ref) = upper(${codigo})
         and p.id <> ${perfilId}
      returning id
    `;

    if (!linhas[0]) {
      throw new ErroDominio(
        "nao_encontrado",
        "Nenhuma conta com esse código de indicação. Confira com a pessoa.",
      );
    }
  });
}

/** Convite pendente ainda não é vínculo nem dinheiro: apagar é limpo. */
export async function cancelarConvite(perfilId: string, conviteId: string): Promise<void> {
  await comTraducaoDeAfiliado(async () => {
    const linhas = await bd()<{ id: string }[]>`
      delete from convites_gerente
       where id = ${conviteId}
         and gerente_id = ${perfilId}
         and status = 'pendente'
      returning id
    `;

    if (!linhas[0]) {
      throw new ErroDominio("nao_encontrado", "Convite não encontrado ou já respondido.");
    }
  });
}

export async function responderConvite(
  perfilId: string,
  conviteId: string,
  aceitar: boolean,
): Promise<void> {
  await comTraducaoDeAfiliado(async () => {
    // `perfil_id = perfilId` no where é a checagem de dono: o id do convite vem
    // da URL do formulário e não vale nada sozinho.
    const linhas = await bd()<{ id: string }[]>`
      update convites_gerente
         set status = ${aceitar ? "aceito" : "recusado"},
             respondido_em = now()
       where id = ${conviteId}
         and perfil_id = ${perfilId}
         and status = 'pendente'
         and expira_em > now()
      returning id
    `;

    if (!linhas[0]) {
      throw new ErroDominio(
        "nao_encontrado",
        "Este convite não é seu, já foi respondido ou expirou.",
      );
    }
  });
}

/**
 * Promove um membro da equipe a Afiliado PRO.
 *
 * As três condições ficam no `where`, não numa checagem em TypeScript antes do
 * update: o alvo precisa ser da equipe ACEITA deste gerente, e precisa ser
 * 'user'. Assim o pior caso de um id adulterado no formulário é zero linha
 * afetada. O caminho só sobe 'user' -> 'affiliate': rebaixar não é operação de
 * gerente, e promover a manager ou admin, muito menos.
 */
export async function promoverAfiliado(perfilId: string, alvoId: string): Promise<string> {
  return comTraducaoDeAfiliado(async () => {
    const linhas = await bd()<{ id: string; nome: string }[]>`
      update perfis p
         set papel = 'affiliate'
       where p.id = ${alvoId}
         and p.papel = 'user'
         and exists (
           select 1 from convites_gerente cg
            where cg.perfil_id = p.id
              and cg.gerente_id = ${perfilId}
              and cg.status = 'aceito'
         )
      returning p.id, coalesce(nullif(btrim(p.nome), ''), '@' || p.usuario) as nome
    `;

    const l = linhas[0];
    if (!l) {
      throw new ErroDominio(
        "sem_permissao",
        "Só dá para promover quem já aceitou o seu convite e ainda não é afiliado.",
      );
    }

    // Mudança de papel é exatamente o que uma disputa pergunta seis meses
    // depois: quem promoveu quem, e quando.
    await bd()`
      insert into auditoria (perfil_id, ator_id, acao, entidade, entidade_id, depois)
      values (
        ${alvoId}, ${perfilId}, 'papel.promovido', 'perfis', ${alvoId},
        jsonb_build_object('papel', 'affiliate', 'por', 'gerente')
      )
    `;

    return l.nome;
  });
}
