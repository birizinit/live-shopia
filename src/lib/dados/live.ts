import "server-only";
import { bd } from "@/lib/db";
import { modoDemo } from "@/lib/env";
import { comDemo, configuracao, numeroDe } from "./comum";
import { comTraducao, ErroDominio } from "./erros";
import type { EstadoAudio } from "./tipos";

/**
 * Id vindo da URL chega como texto qualquer. Sem esta peneira, "abc" vira
 * 22P02 no Postgres e a tela responde 500 em vez de "não encontrado".
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dados da sala de live e do painel ao vivo.
 *
 * Duas regras atravessam o arquivo inteiro:
 *
 * 1. `perfilId` e o PRIMEIRO argumento de tudo e entra no `where` de tudo. Nao
 *    ha RLS aqui; id que chega da URL ou do formulario e sempre confrontado com
 *    o dono antes de virar escrita.
 * 2. Nenhuma leitura toca o banco em modo demo (`comDemo`). A sessao demo nao
 *    tem linha em `perfis`, entao `where perfil_id = $1` com o uuid falso
 *    devolveria vazio — e a tela que existe para ser vista sem banco ficaria
 *    vazia justamente no modo em que ela precisa aparecer.
 */

export type EstadoLive = "iniciando" | "ativa" | "caiu" | "encerrada";

export type TipoEventoLive =
  | "inicio"
  | "entrada"
  | "seguidor"
  | "comentario"
  | "resposta_ia"
  | "venda"
  | "queda"
  | "fim"
  | "erro";

export type ContaTikTok = {
  id: string;
  usuario: string;
  apelido: string | null;
  verificadaEm: string | null;
  ativa: boolean;
  criadoEm: string;
};

export type VozOpcao = {
  id: string;
  nome: string;
  premium: boolean;
  /** Clonada pelo proprio usuario, por oposicao a voz de catalogo. */
  propria: boolean;
  idioma: string;
};

export type MontagemOpcao = {
  id: string;
  nome: string;
  ativa: boolean;
  itens: number;
  duracaoMs: number;
};

export type CadenciaChat = {
  responderChat: boolean;
  saudarEntrada: boolean;
  intervaloMinS: number;
  intervaloMaxS: number;
  tetoPorMinuto: number;
};

export type ConfigLive = CadenciaChat & {
  vozId: string | null;
  montagemId: string | null;
  contaId: string | null;
  riscoAceitoEm: string | null;
  riscoAceitoVersao: number | null;
};

export type SessaoLive = {
  id: string;
  estado: EstadoLive;
  contaId: string | null;
  montagemId: string | null;
  inicio: string;
  fim: string | null;
  /** Ultimo batimento da extensao. Separa "no ar" de "a aba foi fechada". */
  vistoEm: string;
  espectadoresPico: number;
  erro: string | null;
};

export type EventoLive = {
  id: number;
  tipo: TipoEventoLive;
  rotulo: string;
  apelido: string | null;
  texto: string | null;
  espectadores: number | null;
  dados: Record<string, unknown>;
  criadoEm: string;
};

export type ItemChecklist = {
  chave: string;
  rotulo: string;
  detalhe: string;
  ok: boolean;
  href: string;
  rotuloHref: string;
};

export type EstadoExtensao = {
  licenciada: boolean;
  /** Mixer de audio ligado NESTA conta. */
  mixer: boolean;
  /** Automacao de chat ligada NESTA conta. */
  chat: boolean;
  /** Chat desligado na base inteira por configuracao (`ext.chat_desligado`). */
  chatDesligadoNaBase: boolean;
  revogadaEm: string | null;
  ultimoContato: string | null;
  versao: string | null;
  instalacoes: number;
};

export type FalaDaFila = {
  id: string;
  ordem: number;
  titulo: string;
  duracaoMs: number;
  caracteres: number;
  estado: EstadoAudio;
};

export type SalaLive = {
  config: ConfigLive;
  contas: ContaTikTok[];
  limiteContas: number;
  vozes: VozOpcao[];
  montagens: MontagemOpcao[];
  sessao: SessaoLive | null;
  historico: SessaoLive[];
  checklist: ItemChecklist[];
  extensao: EstadoExtensao;
  versaoRisco: number;
  /** true quando falta aceitar (ou reaceitar) o aviso de automacao. */
  riscoPendente: boolean;
};

export type ConsoleLive = {
  sessao: SessaoLive | null;
  conta: ContaTikTok | null;
  cadencia: CadenciaChat;
  fila: FalaDaFila[];
  eventos: EventoLive[];
  extensao: EstadoExtensao;
};

/** Limites da cadencia, iguais aos CHECK de `live_config` (migracao 0004). */
export const CADENCIA_LIMITES = {
  intervaloMinimoS: 5,
  intervaloMaximoS: 600,
  tetoMinimo: 1,
  tetoMaximo: 20,
} as const;

const ROTULO_EVENTO: Record<TipoEventoLive, string> = {
  inicio: "Live iniciada",
  entrada: "Entrou na live",
  seguidor: "Novo seguidor",
  comentario: "Comentário",
  resposta_ia: "Resposta da IA",
  venda: "Venda",
  queda: "Live caiu",
  fim: "Live encerrada",
  erro: "Erro",
};

const CONFIG_PADRAO: ConfigLive = {
  vozId: null,
  montagemId: null,
  contaId: null,
  responderChat: true,
  saudarEntrada: true,
  intervaloMinS: 12,
  intervaloMaxS: 45,
  tetoPorMinuto: 3,
  riscoAceitoEm: null,
  riscoAceitoVersao: null,
};

/**
 * Escrita em modo demo para de pe aqui, com mensagem propria.
 *
 * Sem isto a acao iria ao banco com o uuid falso da sessao demo e voltaria erro
 * de chave estrangeira — que diz ao usuario exatamente nada.
 */
function exigirBanco(): void {
  if (modoDemo) {
    throw new ErroDominio(
      "servico_indisponivel",
      "Modo demonstração: a tela funciona, mas nada é gravado no banco.",
    );
  }
}

function iso(valor: Date | string | null | undefined): string | null {
  if (!valor) return null;
  return valor instanceof Date ? valor.toISOString() : String(valor);
}

function prender(valor: number, minimo: number, maximo: number): number {
  if (!Number.isFinite(valor)) return minimo;
  return Math.min(Math.max(Math.trunc(valor), minimo), maximo);
}

/** Tira o "@" que todo mundo cola junto e confere o formato do CHECK da tabela. */
export function normalizarUsuarioTikTok(bruto: string): string {
  const limpo = bruto.trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9._]{2,24}$/.test(limpo)) {
    throw new ErroDominio(
      "dado_invalido",
      "O @ do TikTok aceita de 2 a 24 caracteres, entre letras, números, ponto e _.",
    );
  }
  return limpo;
}

// -----------------------------------------------------------------------------
// Exemplos do modo demo
// -----------------------------------------------------------------------------

const HA = (minutos: number) => new Date(Date.now() - minutos * 60_000).toISOString();

const CONTAS_EXEMPLO: ContaTikTok[] = [
  {
    id: "11111111-1111-4111-8111-000000000001",
    usuario: "loja.exemplo",
    apelido: "Loja Exemplo",
    verificadaEm: HA(60 * 24 * 3),
    ativa: true,
    criadoEm: HA(60 * 24 * 30),
  },
];

const VOZES_EXEMPLO: VozOpcao[] = [
  {
    id: "22222222-2222-4222-8222-000000000001",
    nome: "Amanda — vendedora",
    premium: true,
    propria: false,
    idioma: "pt-BR",
  },
  {
    id: "22222222-2222-4222-8222-000000000002",
    nome: "Rafa — descontraída",
    premium: false,
    propria: false,
    idioma: "pt-BR",
  },
  {
    id: "22222222-2222-4222-8222-000000000003",
    nome: "Minha voz clonada",
    premium: false,
    propria: true,
    idioma: "pt-BR",
  },
];

const MONTAGENS_EXEMPLO: MontagemOpcao[] = [
  {
    id: "33333333-3333-4333-8333-000000000001",
    nome: "Live de terça — kit verão",
    ativa: true,
    itens: 5,
    duracaoMs: 2 * 60 * 60_000 + 41 * 60_000,
  },
];

const SESSAO_EXEMPLO: SessaoLive = {
  id: "44444444-4444-4444-8444-000000000001",
  estado: "ativa",
  contaId: CONTAS_EXEMPLO[0]!.id,
  montagemId: MONTAGENS_EXEMPLO[0]!.id,
  inicio: HA(73),
  fim: null,
  vistoEm: HA(0),
  espectadoresPico: 412,
  erro: null,
};

const CONFIG_EXEMPLO: ConfigLive = {
  ...CONFIG_PADRAO,
  vozId: VOZES_EXEMPLO[0]!.id,
  montagemId: MONTAGENS_EXEMPLO[0]!.id,
  contaId: CONTAS_EXEMPLO[0]!.id,
  riscoAceitoEm: HA(60 * 24 * 12),
  riscoAceitoVersao: 1,
};

const EXTENSAO_EXEMPLO: EstadoExtensao = {
  licenciada: true,
  mixer: true,
  chat: true,
  chatDesligadoNaBase: false,
  revogadaEm: null,
  ultimoContato: HA(1),
  versao: "1.4.2",
  instalacoes: 2,
};

const FILA_EXEMPLO: FalaDaFila[] = [
  {
    id: "55555555-5555-4555-8555-000000000001",
    ordem: 1,
    titulo: "Gancho — abre a live",
    duracaoMs: 96_000,
    caracteres: 960,
    estado: "pronto",
  },
  {
    id: "55555555-5555-4555-8555-000000000002",
    ordem: 2,
    titulo: "Oferta — kit verão 3 peças",
    duracaoMs: 184_000,
    caracteres: 1_840,
    estado: "pronto",
  },
  {
    id: "55555555-5555-4555-8555-000000000003",
    ordem: 3,
    titulo: "Prova — depoimentos",
    duracaoMs: 142_000,
    caracteres: 1_420,
    estado: "pronto",
  },
  {
    id: "55555555-5555-4555-8555-000000000004",
    ordem: 4,
    titulo: "Objeções — frete e troca",
    duracaoMs: 158_000,
    caracteres: 1_580,
    estado: "pronto",
  },
  {
    id: "55555555-5555-4555-8555-000000000005",
    ordem: 5,
    titulo: "CTA — cupom LIVE10",
    duracaoMs: 74_000,
    caracteres: 740,
    estado: "pronto",
  },
];

function eventosExemplo(): EventoLive[] {
  const base: Array<Omit<EventoLive, "id" | "rotulo" | "criadoEm"> & { minutos: number }> = [
    { tipo: "inicio", apelido: null, texto: "Sessão aberta pelo painel.", espectadores: 0, dados: {}, minutos: 73 },
    { tipo: "entrada", apelido: "@carol.silva", texto: null, espectadores: 84, dados: {}, minutos: 71 },
    { tipo: "comentario", apelido: "@carol.silva", texto: "esse kit serve pra pele oleosa?", espectadores: 96, dados: {}, minutos: 70 },
    { tipo: "resposta_ia", apelido: null, texto: "Serve sim, Carol! A linha toda é oil free — e hoje está com o cupom LIVE10.", espectadores: 96, dados: { atraso_s: 19 }, minutos: 69 },
    { tipo: "seguidor", apelido: "@joao.p", texto: null, espectadores: 130, dados: {}, minutos: 58 },
    { tipo: "venda", apelido: "@joao.p", texto: null, espectadores: 133, dados: { valor_centavos: 8_990, quantidade: 1 }, minutos: 57 },
    { tipo: "comentario", apelido: "@bia_", texto: "manda o link do cupom de novo", espectadores: 210, dados: {}, minutos: 31 },
    { tipo: "resposta_ia", apelido: null, texto: "Está fixado aqui embaixo, Bia: cupom LIVE10 no carrinho.", espectadores: 210, dados: { atraso_s: 27 }, minutos: 30 },
    { tipo: "venda", apelido: "@bia_", texto: null, espectadores: 240, dados: { valor_centavos: 17_980, quantidade: 2 }, minutos: 28 },
    { tipo: "comentario", apelido: "@marcos.oli", texto: "chega hoje em SP?", espectadores: 388, dados: {}, minutos: 6 },
    { tipo: "resposta_ia", apelido: null, texto: "Em SP capital o prazo é de 2 a 4 dias úteis, Marcos.", espectadores: 402, dados: { atraso_s: 33 }, minutos: 5 },
  ];

  return base.map((evento, indice) => ({
    id: indice + 1,
    tipo: evento.tipo,
    rotulo: ROTULO_EVENTO[evento.tipo],
    apelido: evento.apelido,
    texto: evento.texto,
    espectadores: evento.espectadores,
    dados: evento.dados,
    criadoEm: HA(evento.minutos),
  }));
}

// -----------------------------------------------------------------------------
// Leituras
// -----------------------------------------------------------------------------

export async function contasTikTok(perfilId: string): Promise<ContaTikTok[]> {
  return comDemo(
    () => CONTAS_EXEMPLO,
    async () => {
      const linhas = await bd()<
        {
          id: string;
          usuario_tiktok: string;
          apelido: string | null;
          verificada_em: Date | null;
          ativa: boolean;
          criado_em: Date;
        }[]
      >`
        select id, usuario_tiktok, apelido, verificada_em, ativa, criado_em
          from contas_tiktok
         where perfil_id = ${perfilId}
         order by criado_em
      `;

      return linhas.map((l) => ({
        id: l.id,
        usuario: l.usuario_tiktok,
        apelido: l.apelido,
        verificadaEm: iso(l.verificada_em),
        ativa: l.ativa,
        criadoEm: iso(l.criado_em)!,
      }));
    },
  );
}

/** Quantas contas o plano vigente libera. Sem assinatura ativa, uma. */
export async function limiteDeContas(perfilId: string): Promise<number> {
  return comDemo(
    () => 3,
    async () => {
      const linhas = await bd()<{ contas: number }[]>`
        select p.contas_tiktok as contas
          from assinaturas a
          join planos p on p.id = a.plano_id
         where a.perfil_id = ${perfilId} and a.status = 'ativa'
         limit 1
      `;
      return Math.max(1, numeroDe(linhas[0]?.contas, 1));
    },
  );
}

export async function configuracaoLive(perfilId: string): Promise<ConfigLive> {
  return comDemo(
    () => CONFIG_EXEMPLO,
    async () => {
      const linhas = await bd()<
        {
          voz_id: string | null;
          montagem_id: string | null;
          conta_tiktok_id: string | null;
          responder_chat: boolean;
          saudar_entrada: boolean;
          chat_intervalo_min_s: number;
          chat_intervalo_max_s: number;
          chat_teto_por_minuto: number;
          risco_aceito_em: Date | null;
          risco_aceito_versao: number | null;
        }[]
      >`
        select voz_id, montagem_id, conta_tiktok_id, responder_chat, saudar_entrada,
               chat_intervalo_min_s, chat_intervalo_max_s, chat_teto_por_minuto,
               risco_aceito_em, risco_aceito_versao
          from live_config
         where perfil_id = ${perfilId}
      `;

      const l = linhas[0];
      // Linha ausente e o estado normal de quem nunca abriu a tela. Os padroes
      // repetem os DEFAULT da tabela para a tela nao mostrar um numero e o
      // banco gravar outro no primeiro salvamento.
      if (!l) return CONFIG_PADRAO;

      return {
        vozId: l.voz_id,
        montagemId: l.montagem_id,
        contaId: l.conta_tiktok_id,
        responderChat: l.responder_chat,
        saudarEntrada: l.saudar_entrada,
        intervaloMinS: numeroDe(l.chat_intervalo_min_s, CONFIG_PADRAO.intervaloMinS),
        intervaloMaxS: numeroDe(l.chat_intervalo_max_s, CONFIG_PADRAO.intervaloMaxS),
        tetoPorMinuto: numeroDe(l.chat_teto_por_minuto, CONFIG_PADRAO.tetoPorMinuto),
        riscoAceitoEm: iso(l.risco_aceito_em),
        riscoAceitoVersao: l.risco_aceito_versao,
      };
    },
  );
}

export async function vozesDisponiveis(perfilId: string): Promise<VozOpcao[]> {
  return comDemo(
    () => VOZES_EXEMPLO,
    async () => {
      const linhas = await bd()<
        { id: string; nome: string; premium: boolean; perfil_id: string | null; idioma: string }[]
      >`
        select id, nome, premium, perfil_id, idioma
          from vozes
         where ativa
           and estado = 'pronta'
           and (perfil_id is null or perfil_id = ${perfilId})
         order by (perfil_id is null), ordem, nome
      `;

      return linhas.map((l) => ({
        id: l.id,
        nome: l.nome,
        premium: l.premium,
        propria: l.perfil_id !== null,
        idioma: l.idioma,
      }));
    },
  );
}

export async function montagensDisponiveis(perfilId: string): Promise<MontagemOpcao[]> {
  return comDemo(
    () => MONTAGENS_EXEMPLO,
    async () => {
      const linhas = await bd()<
        { id: string; nome: string; ativa: boolean; duracao_ms: number; itens: string }[]
      >`
        select m.id, m.nome, m.ativa, m.duracao_ms,
               (select count(*) from montagem_itens i where i.montagem_id = m.id) as itens
          from montagens m
         where m.perfil_id = ${perfilId}
         order by m.ativa desc, m.atualizado_em desc
      `;

      return linhas.map((l) => ({
        id: l.id,
        nome: l.nome,
        ativa: l.ativa,
        itens: numeroDe(l.itens),
        duracaoMs: numeroDe(l.duracao_ms),
      }));
    },
  );
}

type LinhaSessao = {
  id: string;
  estado: EstadoLive;
  conta_tiktok_id: string | null;
  montagem_id: string | null;
  inicio: Date;
  fim: Date | null;
  visto_em: Date;
  espectadores_pico: number;
  erro: string | null;
};

function montarSessao(l: LinhaSessao): SessaoLive {
  return {
    id: l.id,
    estado: l.estado,
    contaId: l.conta_tiktok_id,
    montagemId: l.montagem_id,
    inicio: iso(l.inicio)!,
    fim: iso(l.fim),
    vistoEm: iso(l.visto_em)!,
    espectadoresPico: numeroDe(l.espectadores_pico),
    erro: l.erro,
  };
}

export async function sessaoAtiva(perfilId: string): Promise<SessaoLive | null> {
  return comDemo(
    () => SESSAO_EXEMPLO,
    async () => {
      const linhas = await bd()<LinhaSessao[]>`
        select id, estado, conta_tiktok_id, montagem_id, inicio, fim, visto_em,
               espectadores_pico, erro
          from live_sessoes
         where perfil_id = ${perfilId} and estado in ('iniciando', 'ativa')
         order by inicio desc
         limit 1
      `;
      return linhas[0] ? montarSessao(linhas[0]) : null;
    },
  );
}

/** Sempre no escopo do dono: o id vem da URL e nunca vale sozinho. */
export async function sessaoDoPerfil(
  perfilId: string,
  sessaoId: string,
): Promise<SessaoLive | null> {
  return comDemo(
    () => (sessaoId === SESSAO_EXEMPLO.id ? SESSAO_EXEMPLO : null),
    async () => {
      if (!UUID.test(sessaoId)) return null;

      const linhas = await bd()<LinhaSessao[]>`
        select id, estado, conta_tiktok_id, montagem_id, inicio, fim, visto_em,
               espectadores_pico, erro
          from live_sessoes
         where id = ${sessaoId} and perfil_id = ${perfilId}
      `;
      return linhas[0] ? montarSessao(linhas[0]) : null;
    },
  );
}

export async function ultimasSessoes(perfilId: string, limite = 5): Promise<SessaoLive[]> {
  return comDemo(
    () => [
      {
        ...SESSAO_EXEMPLO,
        id: "44444444-4444-4444-8444-000000000002",
        estado: "encerrada" as const,
        inicio: HA(60 * 26),
        fim: HA(60 * 23),
        espectadoresPico: 356,
      },
      {
        ...SESSAO_EXEMPLO,
        id: "44444444-4444-4444-8444-000000000003",
        estado: "caiu" as const,
        inicio: HA(60 * 50),
        fim: HA(60 * 49),
        espectadoresPico: 88,
      },
    ],
    async () => {
      const linhas = await bd()<LinhaSessao[]>`
        select id, estado, conta_tiktok_id, montagem_id, inicio, fim, visto_em,
               espectadores_pico, erro
          from live_sessoes
         where perfil_id = ${perfilId} and estado in ('encerrada', 'caiu')
         order by inicio desc
         limit ${limite}
      `;
      return linhas.map(montarSessao);
    },
  );
}

export async function estadoExtensao(perfilId: string): Promise<EstadoExtensao> {
  return comDemo(
    () => EXTENSAO_EXEMPLO,
    async () => {
      const [licencas, globais] = await Promise.all([
        bd()<
          {
            mixer: boolean;
            chat: boolean;
            revogada_em: Date | null;
            expirada: boolean;
            ultimo_contato: Date | null;
            versao: string | null;
            instalacoes: string;
          }[]
        >`
          select l.mixer, l.chat, l.revogada_em,
                 (l.expira_em <= now()) as expirada,
                 (select max(i.ultimo_contato) from ext_instalacoes i
                   where i.licenca_id = l.id) as ultimo_contato,
                 (select i.versao from ext_instalacoes i where i.licenca_id = l.id
                   order by i.ultimo_contato desc limit 1) as versao,
                 (select count(*) from ext_instalacoes i where i.licenca_id = l.id)
                   as instalacoes
            from ext_licencas l
           where l.perfil_id = ${perfilId}
        `,
        bd()<{ desligado: boolean }[]>`
          select coalesce(
            (select valor = 'true'::jsonb from configuracoes where chave = 'ext.chat_desligado'),
            false
          ) as desligado
        `,
      ]);

      const l = licencas[0];
      const chatDesligadoNaBase = globais[0]?.desligado ?? false;

      if (!l) {
        return {
          licenciada: false,
          mixer: false,
          chat: false,
          chatDesligadoNaBase,
          revogadaEm: null,
          ultimoContato: null,
          versao: null,
          instalacoes: 0,
        };
      }

      return {
        // Licença expirada conta como não licenciada, igual a /extensao e às
        // rotas de /api/ext tratam. Olhar só `revogada_em` fazia esta tela
        // dizer "Ativa" para a licença que o servidor já estava recusando.
        licenciada: l.revogada_em === null && !l.expirada,
        mixer: l.mixer,
        chat: l.chat,
        chatDesligadoNaBase,
        revogadaEm: iso(l.revogada_em),
        ultimoContato: iso(l.ultimo_contato),
        versao: l.versao,
        instalacoes: numeroDe(l.instalacoes),
      };
    },
  );
}

/**
 * A fila de falas: os audios da montagem, na ordem em que a extensao toca.
 *
 * Nao existe arquivo continuo — a live e esta lista repetida em laco, e e isso
 * que faz o loop sair de graca (nenhuma escrita na razao de credito).
 */
export async function filaDeFalas(
  perfilId: string,
  montagemId: string | null,
): Promise<FalaDaFila[]> {
  return comDemo(
    () => FILA_EXEMPLO,
    async () => {
      if (!montagemId) return [];

      const linhas = await bd()<
        {
          id: string;
          ordem: number;
          titulo: string;
          duracao_ms: number | null;
          caracteres: number;
          estado: EstadoAudio;
        }[]
      >`
        select a.id, i.ordem, a.titulo, a.duracao_ms, a.caracteres, a.estado
          from montagem_itens i
          join audios a on a.id = i.audio_id
         where i.montagem_id = ${montagemId} and i.perfil_id = ${perfilId}
         order by i.ordem
      `;

      return linhas.map((l) => ({
        id: l.id,
        ordem: numeroDe(l.ordem),
        titulo: l.titulo,
        duracaoMs: numeroDe(l.duracao_ms),
        caracteres: numeroDe(l.caracteres),
        estado: l.estado,
      }));
    },
  );
}

type LinhaEvento = {
  id: string;
  tipo: TipoEventoLive;
  rotulo: string | null;
  apelido: string | null;
  texto: string | null;
  espectadores: number | null;
  dados: Record<string, unknown> | null;
  criado_em: Date;
};

function montarEvento(l: LinhaEvento): EventoLive {
  return {
    id: numeroDe(l.id),
    tipo: l.tipo,
    rotulo: l.rotulo ?? ROTULO_EVENTO[l.tipo],
    apelido: l.apelido,
    texto: l.texto,
    espectadores: l.espectadores === null ? null : numeroDe(l.espectadores),
    dados: l.dados ?? {},
    criadoEm: iso(l.criado_em)!,
  };
}

/**
 * Eventos da sessao.
 *
 * Com `desde` devolve o que veio DEPOIS daquele id, em ordem cronologica — e o
 * que o SSE e o polling consomem. Sem `desde` devolve a cauda mais recente, que
 * e o que o console mostra ao abrir.
 */
export async function eventosDaLive(
  perfilId: string,
  sessaoId: string,
  opcoes: { desde?: number | null; limite?: number } = {},
): Promise<EventoLive[]> {
  const limite = prender(opcoes.limite ?? 80, 1, 200);
  const desde = opcoes.desde ?? null;

  return comDemo(
    () => {
      const todos = eventosExemplo();
      return desde === null ? todos : todos.filter((evento) => evento.id > desde);
    },
    async () => {
      const sql = bd();

      if (desde !== null) {
        const linhas = await sql<LinhaEvento[]>`
          select e.id, e.tipo, t.rotulo, e.apelido, e.texto, e.espectadores,
                 e.dados, e.criado_em
            from live_eventos e
            join live_evento_tipos t on t.tipo = e.tipo
           where e.perfil_id = ${perfilId}
             and e.live_sessao_id = ${sessaoId}
             and e.id > ${desde}
           order by e.id
           limit ${limite}
        `;
        return linhas.map(montarEvento);
      }

      // A cauda vem decrescente, para o indice (live_sessao_id, criado_em desc)
      // servir, e e invertida aqui: a tela le de cima para baixo, do mais antigo
      // ao mais novo.
      const linhas = await sql<LinhaEvento[]>`
        select e.id, e.tipo, t.rotulo, e.apelido, e.texto, e.espectadores,
               e.dados, e.criado_em
          from live_eventos e
          join live_evento_tipos t on t.tipo = e.tipo
         where e.perfil_id = ${perfilId} and e.live_sessao_id = ${sessaoId}
         order by e.id desc
         limit ${limite}
      `;
      return linhas.map(montarEvento).reverse();
    },
  );
}

type Contagens = {
  produtos: number;
  roteiros: number;
  audios: number;
  itensMontagem: number;
};

async function contagensDoEstudio(perfilId: string): Promise<Contagens> {
  return comDemo(
    () => ({ produtos: 3, roteiros: 2, audios: 5, itensMontagem: 5 }),
    async () => {
      const linhas = await bd()<
        { produtos: string; roteiros: string; audios: string; itens: string }[]
      >`
        select
          (select count(*) from produtos
            where perfil_id = ${perfilId} and arquivado_em is null) as produtos,
          (select count(*) from roteiro_versoes
            where perfil_id = ${perfilId}) as roteiros,
          (select count(*) from audios
            where perfil_id = ${perfilId} and estado = 'pronto') as audios,
          (select count(*) from montagem_itens
            where perfil_id = ${perfilId}) as itens
      `;

      const l = linhas[0];
      return {
        produtos: numeroDe(l?.produtos),
        roteiros: numeroDe(l?.roteiros),
        audios: numeroDe(l?.audios),
        itensMontagem: numeroDe(l?.itens),
      };
    },
  );
}

/** Minutos desde o ultimo contato da extensao. `null` quando nunca houve. */
export function minutosDesde(instante: string | null): number | null {
  if (!instante) return null;
  const ms = Date.now() - new Date(instante).getTime();
  return Math.max(0, Math.round(ms / 60_000));
}

function montarChecklist(
  contagens: Contagens,
  config: ConfigLive,
  contas: ContaTikTok[],
  montagens: MontagemOpcao[],
  extensao: EstadoExtensao,
  riscoPendente: boolean,
): ItemChecklist[] {
  const montagemEscolhida = montagens.find((m) => m.id === config.montagemId);
  const contatoMinutos = minutosDesde(extensao.ultimoContato);

  return [
    {
      chave: "produto",
      rotulo: "Produto cadastrado",
      detalhe:
        contagens.produtos > 0
          ? `${contagens.produtos} produto(s) ativo(s).`
          : "A live precisa saber o que está vendendo.",
      ok: contagens.produtos > 0,
      href: "/produtos",
      rotuloHref: "Produtos",
    },
    {
      chave: "roteiro",
      rotulo: "Roteiro escrito",
      detalhe:
        contagens.roteiros > 0
          ? `${contagens.roteiros} versão(ões) de roteiro salva(s).`
          : "Sem roteiro não há o que a apresentadora fale.",
      ok: contagens.roteiros > 0,
      href: "/roteiro",
      rotuloHref: "Roteiro",
    },
    {
      chave: "voz",
      rotulo: "Voz ativa escolhida",
      detalhe: config.vozId
        ? "A voz da apresentadora está definida."
        : "Escolha a voz antes de gerar o áudio da live.",
      ok: Boolean(config.vozId),
      href: "/vozes",
      rotuloHref: "Vozes",
    },
    {
      chave: "audio",
      rotulo: "Áudio gerado",
      detalhe:
        contagens.audios > 0
          ? `${contagens.audios} áudio(s) pronto(s) no estúdio.`
          : "Nenhum áudio pronto — o estúdio gera em blocos.",
      ok: contagens.audios > 0,
      href: "/estudio",
      rotuloHref: "Estúdio",
    },
    {
      chave: "montagem",
      rotulo: "Montagem ativa",
      detalhe: montagemEscolhida
        ? `${montagemEscolhida.nome} · ${montagemEscolhida.itens} bloco(s) em laço.`
        : contagens.itensMontagem > 0
          ? "Existe montagem, mas nenhuma foi escolhida para a live."
          : "A live toca a montagem em laço — sem ela não há fala contínua.",
      ok: Boolean(montagemEscolhida && montagemEscolhida.itens > 0),
      href: "/audio",
      rotuloHref: "Áudio da live",
    },
    {
      chave: "conta",
      rotulo: "Conta do TikTok escolhida",
      detalhe: config.contaId
        ? `Transmitindo por @${contas.find((c) => c.id === config.contaId)?.usuario ?? "—"}.`
        : contas.length > 0
          ? "Existe conta vinculada, mas nenhuma foi escolhida."
          : "Vincule o @ da conta que vai transmitir.",
      ok: Boolean(config.contaId),
      href: "/live",
      rotuloHref: "Aqui mesmo",
    },
    {
      chave: "extensao",
      rotulo: "Extensão instalada e viva",
      detalhe: !extensao.licenciada
        ? "Sem licença ativa da extensão nesta conta."
        : contatoMinutos === null
          ? "A extensão nunca deu sinal nesta conta."
          : contatoMinutos <= 15
            ? `Último contato há ${contatoMinutos} min · versão ${extensao.versao ?? "?"}.`
            : `Sem sinal há ${contatoMinutos} min — abra o LIVE Studio com a extensão ligada.`,
      ok: extensao.licenciada && contatoMinutos !== null && contatoMinutos <= 15,
      href: "/extensao",
      rotuloHref: "Extensão",
    },
    {
      chave: "risco",
      rotulo: "Aviso de automação aceito",
      detalhe: riscoPendente
        ? "Falta ler e aceitar o aviso de risco de conta."
        : `Aceito em ${new Date(config.riscoAceitoEm!).toLocaleDateString("pt-BR")}.`,
      ok: !riscoPendente,
      href: "/live",
      rotuloHref: "Aqui mesmo",
    },
  ];
}

export async function versaoDoRisco(): Promise<number> {
  return comDemo(
    () => 1,
    async () => Math.trunc(await configuracao("live.risco_aceito_versao", 1)),
  );
}

export async function salaLive(perfilId: string): Promise<SalaLive> {
  const [
    config,
    contas,
    limiteContas,
    vozes,
    montagens,
    sessao,
    historico,
    extensao,
    versaoRisco,
    contagens,
  ] = await Promise.all([
    configuracaoLive(perfilId),
    contasTikTok(perfilId),
    limiteDeContas(perfilId),
    vozesDisponiveis(perfilId),
    montagensDisponiveis(perfilId),
    sessaoAtiva(perfilId),
    ultimasSessoes(perfilId),
    estadoExtensao(perfilId),
    versaoDoRisco(),
    contagensDoEstudio(perfilId),
  ]);

  // Aceite vencido conta como pendente: subir a versao do aviso em
  // `configuracoes` reabre o passo para todo mundo, que e como um texto
  // reescrito volta a ser aceito em vez de valer calado sobre o antigo.
  const riscoPendente =
    config.riscoAceitoEm === null || (config.riscoAceitoVersao ?? 0) < versaoRisco;

  return {
    config,
    contas,
    limiteContas,
    vozes,
    montagens,
    sessao,
    historico,
    checklist: montarChecklist(contagens, config, contas, montagens, extensao, riscoPendente),
    extensao,
    versaoRisco,
    riscoPendente,
  };
}

export async function consoleLive(perfilId: string): Promise<ConsoleLive> {
  const [config, sessao, contas, extensao] = await Promise.all([
    configuracaoLive(perfilId),
    sessaoAtiva(perfilId),
    contasTikTok(perfilId),
    estadoExtensao(perfilId),
  ]);

  const montagemId = sessao?.montagemId ?? config.montagemId;
  const contaId = sessao?.contaId ?? config.contaId;

  const [fila, eventos] = await Promise.all([
    filaDeFalas(perfilId, montagemId),
    sessao ? eventosDaLive(perfilId, sessao.id) : Promise.resolve<EventoLive[]>([]),
  ]);

  return {
    sessao,
    conta: contas.find((c) => c.id === contaId) ?? null,
    cadencia: {
      responderChat: config.responderChat,
      saudarEntrada: config.saudarEntrada,
      intervaloMinS: config.intervaloMinS,
      intervaloMaxS: config.intervaloMaxS,
      tetoPorMinuto: config.tetoPorMinuto,
    },
    fila,
    eventos,
    extensao,
  };
}

// -----------------------------------------------------------------------------
// Escritas
// -----------------------------------------------------------------------------

export async function vincularConta(
  perfilId: string,
  bruto: string,
  apelido?: string | null,
): Promise<ContaTikTok> {
  exigirBanco();
  const usuario = normalizarUsuarioTikTok(bruto);

  const limite = await limiteDeContas(perfilId);

  return comTraducao(async () => {
    const sql = bd();

    const contagem = await sql<{ total: string }[]>`
      select count(*) as total
        from contas_tiktok
       where perfil_id = ${perfilId} and lower(usuario_tiktok) <> lower(${usuario})
    `;
    if (numeroDe(contagem[0]?.total) >= limite) {
      throw new ErroDominio(
        "sem_permissao",
        `Seu plano permite ${limite} conta(s) do TikTok. Remova uma ou troque de plano.`,
      );
    }

    // Nao existe trava GLOBAL por @, de proposito: sem prova de posse, uma
    // trava global deixaria qualquer um registrar o @ dos maiores vendedores e
    // bloquea-los. O unico e por perfil (migracao 0004).
    const linhas = await sql<
      {
        id: string;
        usuario_tiktok: string;
        apelido: string | null;
        verificada_em: Date | null;
        ativa: boolean;
        criado_em: Date;
      }[]
    >`
      insert into contas_tiktok (perfil_id, usuario_tiktok, apelido)
      values (${perfilId}, ${usuario}, ${apelido?.trim() || null})
      on conflict (perfil_id, lower(usuario_tiktok)) do update
         set apelido = coalesce(excluded.apelido, contas_tiktok.apelido),
             ativa = true
      returning id, usuario_tiktok, apelido, verificada_em, ativa, criado_em
    `;

    const l = linhas[0]!;
    return {
      id: l.id,
      usuario: l.usuario_tiktok,
      apelido: l.apelido,
      verificadaEm: iso(l.verificada_em),
      ativa: l.ativa,
      criadoEm: iso(l.criado_em)!,
    };
  });
}

export async function desvincularConta(perfilId: string, contaId: string): Promise<void> {
  exigirBanco();

  await comTraducao(async () => {
    const linhas = await bd()<{ id: string }[]>`
      delete from contas_tiktok
       where id = ${contaId} and perfil_id = ${perfilId}
      returning id
    `;
    if (linhas.length === 0) {
      throw new ErroDominio("nao_encontrado", "Essa conta não é sua ou já foi removida.");
    }
  });
}

/**
 * `live_config` nao tem gatilho de dono (a 0004 so protege `audios` e a 0006
 * `live_sessoes`). Sem esta conferencia, um id de voz, montagem ou conta colado
 * na requisicao apontaria para o registro de outra pessoa — e o unico lugar
 * onde isso apareceria seria em producao.
 */
async function conferirPropriedade(
  perfilId: string,
  alvos: { vozId?: string | null; montagemId?: string | null; contaId?: string | null },
): Promise<void> {
  const sql = bd();

  if (alvos.vozId) {
    const linhas = await sql<{ ok: boolean }[]>`
      select voz_acessivel(${alvos.vozId}, ${perfilId}) as ok
    `;
    if (!linhas[0]?.ok) {
      throw new ErroDominio("nao_encontrado", "Essa voz não é sua nem é do catálogo.");
    }
  }

  if (alvos.montagemId) {
    const linhas = await sql<{ id: string }[]>`
      select id from montagens where id = ${alvos.montagemId} and perfil_id = ${perfilId}
    `;
    if (linhas.length === 0) {
      throw new ErroDominio("nao_encontrado", "Essa montagem não é sua.");
    }
  }

  if (alvos.contaId) {
    const linhas = await sql<{ id: string }[]>`
      select id from contas_tiktok where id = ${alvos.contaId} and perfil_id = ${perfilId}
    `;
    if (linhas.length === 0) {
      throw new ErroDominio("nao_encontrado", "Essa conta do TikTok não é sua.");
    }
  }
}

export type PatchConfigLive = {
  vozId?: string | null;
  montagemId?: string | null;
  contaId?: string | null;
  responderChat?: boolean;
  saudarEntrada?: boolean;
  intervaloMinS?: number;
  intervaloMaxS?: number;
  tetoPorMinuto?: number;
};

export async function salvarConfiguracaoLive(
  perfilId: string,
  patch: PatchConfigLive,
): Promise<ConfigLive> {
  exigirBanco();

  const atual = await configuracaoLive(perfilId);
  const vozId = patch.vozId === undefined ? atual.vozId : patch.vozId || null;
  const montagemId = patch.montagemId === undefined ? atual.montagemId : patch.montagemId || null;
  const contaId = patch.contaId === undefined ? atual.contaId : patch.contaId || null;

  const minS = prender(
    patch.intervaloMinS ?? atual.intervaloMinS,
    CADENCIA_LIMITES.intervaloMinimoS,
    CADENCIA_LIMITES.intervaloMaximoS,
  );
  // O maximo nunca desce abaixo do minimo: o CHECK live_config_cadencia
  // recusaria a linha inteira, e o usuario perderia as outras mudancas do
  // formulario por causa de um campo.
  const maxS = Math.max(
    minS,
    prender(
      patch.intervaloMaxS ?? atual.intervaloMaxS,
      CADENCIA_LIMITES.intervaloMinimoS,
      CADENCIA_LIMITES.intervaloMaximoS,
    ),
  );
  const teto = prender(
    patch.tetoPorMinuto ?? atual.tetoPorMinuto,
    CADENCIA_LIMITES.tetoMinimo,
    CADENCIA_LIMITES.tetoMaximo,
  );

  await conferirPropriedade(perfilId, { vozId, montagemId, contaId });

  return comTraducao(async () => {
    await bd()`
      insert into live_config
        (perfil_id, voz_id, montagem_id, conta_tiktok_id, responder_chat, saudar_entrada,
         chat_intervalo_min_s, chat_intervalo_max_s, chat_teto_por_minuto)
      values
        (${perfilId}, ${vozId}, ${montagemId}, ${contaId},
         ${patch.responderChat ?? atual.responderChat},
         ${patch.saudarEntrada ?? atual.saudarEntrada},
         ${minS}, ${maxS}, ${teto})
      on conflict (perfil_id) do update
         set voz_id               = excluded.voz_id,
             montagem_id          = excluded.montagem_id,
             conta_tiktok_id      = excluded.conta_tiktok_id,
             responder_chat       = excluded.responder_chat,
             saudar_entrada       = excluded.saudar_entrada,
             chat_intervalo_min_s = excluded.chat_intervalo_min_s,
             chat_intervalo_max_s = excluded.chat_intervalo_max_s,
             chat_teto_por_minuto = excluded.chat_teto_por_minuto
    `;

    return configuracaoLive(perfilId);
  });
}

/** Grava o aceite pela funcao do banco, que tambem deixa a trilha de auditoria. */
export async function aceitarRisco(
  perfilId: string,
  contexto: { ip?: string | null; userAgent?: string | null } = {},
): Promise<number> {
  exigirBanco();

  return comTraducao(async () => {
    const linhas = await bd()<{ versao: number }[]>`
      select aceitar_risco_automacao(
        ${perfilId},
        ${contexto.ip ?? null}::inet,
        ${contexto.userAgent ?? null}
      ) as versao
    `;
    return numeroDe(linhas[0]?.versao, 1);
  });
}

export async function iniciarLive(
  perfilId: string,
  opcoes: { contaId?: string | null; montagemId?: string | null } = {},
): Promise<SessaoLive> {
  exigirBanco();

  const [config, versaoRisco] = await Promise.all([
    configuracaoLive(perfilId),
    versaoDoRisco(),
  ]);

  // O aceite e conferido AQUI, e nao so na tela: a tela pode ser pulada, a
  // action nao.
  if (config.riscoAceitoEm === null || (config.riscoAceitoVersao ?? 0) < versaoRisco) {
    throw new ErroDominio(
      "sem_permissao",
      "Leia e aceite o aviso de risco de automação antes de subir a live.",
    );
  }

  const contaId = opcoes.contaId ?? config.contaId;
  if (!contaId) {
    throw new ErroDominio("dado_invalido", "Escolha a conta do TikTok que vai transmitir.");
  }

  const montagemId = opcoes.montagemId ?? config.montagemId;
  if (!montagemId) {
    throw new ErroDominio(
      "dado_invalido",
      "Escolha a montagem que a apresentadora vai narrar em laço.",
    );
  }

  await conferirPropriedade(perfilId, { montagemId, contaId });

  return comTraducao(async () => {
    const sql = bd();

    // Duplo clique e retry de rede caem aqui: a sessao que ja existe e
    // devolvida em vez de estourar no indice unico da conta ativa.
    const abertas = await sql<LinhaSessao[]>`
      select id, estado, conta_tiktok_id, montagem_id, inicio, fim, visto_em,
             espectadores_pico, erro
        from live_sessoes
       where perfil_id = ${perfilId}
         and conta_tiktok_id = ${contaId}
         and estado in ('iniciando', 'ativa')
       order by inicio desc
       limit 1
    `;
    if (abertas[0]) return montarSessao(abertas[0]);

    const linhas = await sql<LinhaSessao[]>`
      insert into live_sessoes (perfil_id, conta_tiktok_id, montagem_id, estado)
      values (${perfilId}, ${contaId}, ${montagemId}, 'iniciando')
      returning id, estado, conta_tiktok_id, montagem_id, inicio, fim, visto_em,
                espectadores_pico, erro
    `;

    const sessao = montarSessao(linhas[0]!);

    await sql`
      insert into live_eventos (live_sessao_id, perfil_id, tipo, texto)
      values (${sessao.id}, ${perfilId}, 'inicio',
              'Sessão aberta pelo painel. Aguardando a extensão assumir a transmissão.')
    `;

    return sessao;
  });
}

export async function pararLive(perfilId: string, sessaoId: string): Promise<SessaoLive> {
  exigirBanco();

  return comTraducao(async () => {
    const sql = bd();

    const linhas = await sql<LinhaSessao[]>`
      update live_sessoes
         set estado = 'encerrada', fim = now()
       where id = ${sessaoId}
         and perfil_id = ${perfilId}
         and estado in ('iniciando', 'ativa')
      returning id, estado, conta_tiktok_id, montagem_id, inicio, fim, visto_em,
                espectadores_pico, erro
    `;

    if (!linhas[0]) {
      throw new ErroDominio("nao_encontrado", "Essa live não é sua ou já estava fora do ar.");
    }

    await sql`
      insert into live_eventos (live_sessao_id, perfil_id, tipo, texto)
      values (${sessaoId}, ${perfilId}, 'fim', 'Transmissão encerrada pelo painel.')
    `;

    return montarSessao(linhas[0]);
  });
}

/**
 * Kill switch por cliente.
 *
 * Mexe nos DOIS modulos da licenca separadamente, como o schema os separou: o
 * chat pode morrer sem levar o mixer junto, e e isso que mantem o produto de pe
 * no dia em que a automacao de chat precisar parar. Nao revoga a licenca —
 * revogar exigiria emitir token novo, e botao de emergencia que cobra
 * reinstalacao nao e apertado na hora em que precisa.
 */
export async function ajustarModulosExtensao(
  perfilId: string,
  modulos: { mixer?: boolean; chat?: boolean },
): Promise<EstadoExtensao> {
  exigirBanco();

  await comTraducao(async () => {
    const linhas = await bd()<{ perfil_id: string }[]>`
      update ext_licencas
         set mixer = coalesce(${modulos.mixer ?? null}, mixer),
             chat  = coalesce(${modulos.chat ?? null}, chat)
       where perfil_id = ${perfilId}
      returning perfil_id
    `;
    if (linhas.length === 0) {
      throw new ErroDominio(
        "nao_encontrado",
        "Não há licença de extensão nesta conta. Instale a extensão primeiro.",
      );
    }
  });

  return estadoExtensao(perfilId);
}

/**
 * Parada de emergencia: desliga os dois modulos e fecha a sessao aberta.
 *
 * Uma acao so, porque no minuto em que isto e usado ninguem vai clicar em tres
 * botoes na ordem certa.
 */
export async function pararTudo(perfilId: string): Promise<EstadoExtensao> {
  exigirBanco();

  const sessao = await sessaoAtiva(perfilId);
  if (sessao) await pararLive(perfilId, sessao.id);

  return ajustarModulosExtensao(perfilId, { mixer: false, chat: false });
}
