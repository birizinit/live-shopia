import "server-only";
import { cookies, headers } from "next/headers";
import { bd } from "@/lib/db";
import { modoDemo } from "@/lib/env";
import { comDemo, numeroDe } from "./comum";
import { comTraducao } from "./erros";
import { ipDoPedido } from "@/lib/rede";

/**
 * Onboarding: o tour guiado e as dicas de primeira visita.
 *
 * Duas decisoes vem do banco (db/migrations/0009) e nao se discutem aqui:
 *
 * 1. O TEXTO dos passos mora em `onboarding_passos`. Nada de copia dentro do
 *    componente: o dono do produto reescreve o aviso de risco sem deploy, e o
 *    aceite continua rastreavel porque a versao do texto vive em `live`.
 * 2. O PROGRESSO mora em `onboarding_progresso` e `dicas_vistas`, com
 *    `perfil_id`. O concorrente guarda em `localStorage`, e por isso o tour
 *    dele recomeca do zero em cada aparelho e some quando o usuario limpa o
 *    cache — inclusive o passo do aviso de risco, que e o unico com valor
 *    juridico. Aqui o estado segue a CONTA.
 */

export type PassoTour = {
  chave: string;
  titulo: string;
  corpo: string;
  /** Rota interna que o passo apresenta. Sempre relativa (CHECK no banco). */
  rotaAlvo: string | null;
  ordem: number;
  obrigatorio: boolean;
  exigeAceite: boolean;
  /** ISO do primeiro `visto_em`. `null` = a conta ainda nao passou por aqui. */
  vistoEm: string | null;
};

export type EstadoTour = {
  passos: PassoTour[];
  /** Onde o tour recomeca: o primeiro passo ainda pendente. */
  indiceInicial: number;
  pendentes: number;
  riscoAceitoEm: string | null;
  riscoAceitoVersao: number | null;
  /** Versao vigente do aviso, de `live.risco_aceito_versao`. */
  versaoRisco: number;
  /** Ha aceite E ele e da versao que esta no ar. */
  riscoEmDia: boolean;
};

export type ResumoTour = {
  pendente: boolean;
  pendentes: number;
  total: number;
  proximoTitulo: string | null;
  riscoEmDia: boolean;
  /** O cartao de retomada foi dispensado em /inicio. */
  cartaoDispensado: boolean;
};

/** Chave do cartao de retomada do tour em `dicas_vistas`. */
export const DICA_CARTAO_TOUR = "inicio.retomar-tour";

/** Mesmo CHECK da coluna `dicas_vistas.chave`. Barra lixo antes do banco. */
const FORMATO_CHAVE_DICA = /^[a-z0-9_.-]{3,60}$/;
/** Mesmo CHECK de `onboarding_passos.chave`. */
const FORMATO_CHAVE_PASSO = /^[a-z0-9-]{3,40}$/;

export function ehChaveDeDica(chave: string) {
  return FORMATO_CHAVE_DICA.test(chave);
}

/**
 * O passo de aceite volta a ficar pendente quando a VERSAO do aviso sobe.
 *
 * `marcar_passo_visto` e `on conflict do nothing` de proposito — a data do
 * primeiro aviso e prova e nao se reescreve. A consequencia e que subir
 * `live.risco_aceito_versao` nao apaga a linha de progresso, e sozinho o banco
 * nao reabriria o passo. Quem reabre e esta regra, comparando a versao aceita
 * com a vigente.
 */
function passoPendente(passo: PassoTour, riscoEmDia: boolean) {
  if (passo.exigeAceite) return !riscoEmDia;
  return passo.vistoEm === null;
}

type LinhaPasso = {
  chave: string;
  titulo: string;
  corpo: string;
  rota_alvo: string | null;
  ordem: number;
  obrigatorio: boolean;
  exige_aceite: boolean;
  visto_em: Date | null;
};

function montarPasso(linha: LinhaPasso): PassoTour {
  return {
    chave: linha.chave,
    titulo: linha.titulo,
    corpo: linha.corpo,
    rotaAlvo: linha.rota_alvo,
    ordem: numeroDe(linha.ordem),
    obrigatorio: linha.obrigatorio,
    exigeAceite: linha.exige_aceite,
    vistoEm: linha.visto_em ? linha.visto_em.toISOString() : null,
  };
}

export async function estadoDoTour(perfilId: string): Promise<EstadoTour> {
  return comDemo(exemploDoTour, async () => {
    const sql = bd();

    // Catalogo e progresso na MESMA consulta: em duas idas o tour poderia
    // desenhar um passo com o progresso de antes do ultimo clique.
    const linhas = await sql<LinhaPasso[]>`
      select p.chave,
             p.titulo,
             p.corpo,
             p.rota_alvo,
             p.ordem,
             p.obrigatorio,
             p.exige_aceite,
             g.visto_em
        from onboarding_passos p
        left join onboarding_progresso g
               on g.passo_chave = p.chave
              and g.perfil_id = ${perfilId}
       where p.ativo
       order by p.ordem, p.chave
    `;

    const config = await sql<
      {
        risco_aceito_em: Date | null;
        risco_aceito_versao: number | null;
        versao: string;
      }[]
    >`
      select (select risco_aceito_em from live_config
               where perfil_id = ${perfilId})                as risco_aceito_em,
             (select risco_aceito_versao from live_config
               where perfil_id = ${perfilId})                as risco_aceito_versao,
             config_num('live.risco_aceito_versao', 1)       as versao
    `;

    const versaoRisco = numeroDe(config[0]?.versao, 1);
    const bruta = config[0]?.risco_aceito_versao;
    const riscoAceitoVersao = bruta === null || bruta === undefined ? null : numeroDe(bruta);
    const riscoAceitoEm = config[0]?.risco_aceito_em?.toISOString() ?? null;
    const riscoEmDia = riscoAceitoEm !== null && riscoAceitoVersao === versaoRisco;

    const passos = linhas.map(montarPasso);
    const pendentes = passos.filter((passo) => passoPendente(passo, riscoEmDia));
    const primeiro = pendentes[0];
    const indiceInicial = primeiro
      ? passos.findIndex((passo) => passo.chave === primeiro.chave)
      : 0;

    return {
      passos,
      indiceInicial: Math.max(0, indiceInicial),
      pendentes: pendentes.length,
      riscoAceitoEm,
      riscoAceitoVersao,
      versaoRisco,
      riscoEmDia,
    };
  });
}

/**
 * O que /inicio precisa para decidir se mostra o cartao de retomada.
 *
 * A lista de pendentes sai de `tour_pendente()`, a mesma funcao que o banco
 * expoe — assim a tela e o banco nunca discordam sobre o que falta.
 */
export async function resumoTour(perfilId: string): Promise<ResumoTour> {
  return comDemo(
    () => {
      const exemplo = exemploDoTour();
      return {
        pendente: true,
        pendentes: exemplo.passos.length,
        total: exemplo.passos.length,
        proximoTitulo: exemplo.passos[0]?.titulo ?? null,
        riscoEmDia: false,
        cartaoDispensado: false,
      };
    },
    async () => {
      const linhas = await bd()<
        {
          total: string;
          pendentes: string;
          proximo_titulo: string | null;
          risco_versao: number | null;
          versao_vigente: string;
          cartao_dispensado: boolean;
        }[]
      >`
        with pendentes as (select * from tour_pendente(${perfilId}))
        select (select count(*) from onboarding_passos where ativo)        as total,
               (select count(*) from pendentes)                            as pendentes,
               (select titulo from pendentes order by ordem, chave limit 1) as proximo_titulo,
               (select risco_aceito_versao from live_config
                 where perfil_id = ${perfilId})                            as risco_versao,
               config_num('live.risco_aceito_versao', 1)                   as versao_vigente,
               exists (select 1 from dicas_vistas
                        where perfil_id = ${perfilId}
                          and chave = ${DICA_CARTAO_TOUR})                 as cartao_dispensado
      `;

      const linha = linhas[0];
      const versaoVigente = numeroDe(linha?.versao_vigente, 1);
      const aceita = linha?.risco_versao;
      const riscoEmDia =
        aceita !== null && aceita !== undefined && numeroDe(aceita) === versaoVigente;
      const pendentes = numeroDe(linha?.pendentes);

      return {
        pendente: pendentes > 0 || !riscoEmDia,
        pendentes,
        total: numeroDe(linha?.total),
        proximoTitulo: linha?.proximo_titulo ?? null,
        riscoEmDia,
        cartaoDispensado: Boolean(linha?.cartao_dispensado),
      };
    },
  );
}

/**
 * Marca um passo como visto. Idempotente, e sem reescrever a data do primeiro
 * aviso — quem garante isso e `marcar_passo_visto` no banco.
 */
export async function marcarPassoVisto(perfilId: string, chave: string): Promise<void> {
  if (!FORMATO_CHAVE_PASSO.test(chave)) return;
  if (modoDemo) return;

  await comTraducao(async () => {
    await bd()`select marcar_passo_visto(${perfilId}::uuid, ${chave}::text)`;
  });
}

/**
 * Registra o aceite do aviso de risco e devolve a versao aceita.
 *
 * IP e user agent saem dos cabecalhos aqui dentro, nunca de um campo do
 * formulario: origem de aceite que o proprio cliente escolhe nao prova nada.
 */
export async function aceitarRiscoAutomacao(perfilId: string): Promise<number> {
  // A sessao demo nao tem linha em `perfis`, e `live_config` referencia perfil:
  // gravar aqui estouraria a FK. O tour segue, sem registro.
  if (modoDemo) return 1;

  const cabecalhos = await headers();
  const userAgent = cabecalhos.get("user-agent")?.slice(0, 500) ?? null;
  const ip = ipDoPedido(cabecalhos);

  return comTraducao(async () => {
    const linhas = await bd()<{ versao: number }[]>`
      select aceitar_risco_automacao(
        ${perfilId}::uuid, ${ip}::inet, ${userAgent}::text
      ) as versao
    `;
    return numeroDe(linhas[0]?.versao, 1);
  });
}

export async function dicaJaVista(perfilId: string, chave: string): Promise<boolean> {
  // Chave fora do formato nunca foi gravada e nunca vai ser: some a dica em
  // vez de deixar um cartao que nao se fecha.
  if (!ehChaveDeDica(chave)) return true;

  // `comDemo` nao cabe aqui: ele pede um exemplo SINCRONO, e ler o cookie do
  // modo demo e assincrono.
  if (modoDemo) return (await dicasDoDemo()).includes(chave);

  const linhas = await bd()<{ existe: boolean }[]>`
    select exists (
      select 1 from dicas_vistas where perfil_id = ${perfilId} and chave = ${chave}
    ) as existe
  `;
  return Boolean(linhas[0]?.existe);
}

export async function marcarDicaVista(perfilId: string, chave: string): Promise<void> {
  if (!ehChaveDeDica(chave)) return;

  if (modoDemo) {
    await guardarDicaNoDemo(chave);
    return;
  }

  await comTraducao(async () => {
    await bd()`select marcar_dica_vista(${perfilId}::uuid, ${chave}::text)`;
  });
}

/* -------------------------------------------------------------------------- */
/* Modo demo                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Dica dispensada no modo demo.
 *
 * O cookie existe SO aqui: a sessao demo nao tem linha em `perfis`, entao nao
 * ha onde gravar, e uma dica que volta no mesmo segundo em que foi fechada faz
 * a tela parecer quebrada. Em conta de verdade este caminho nunca roda — o
 * estado mora em `dicas_vistas`, com perfil_id, como manda a migracao 0009.
 */
const COOKIE_DICAS_DEMO = "shopia_dicas_demo";

async function dicasDoDemo(): Promise<string[]> {
  const bruto = (await cookies()).get(COOKIE_DICAS_DEMO)?.value ?? "";
  return bruto.split(",").filter(Boolean);
}

async function guardarDicaNoDemo(chave: string) {
  const jar = await cookies();
  const atuais = new Set(
    (jar.get(COOKIE_DICAS_DEMO)?.value ?? "").split(",").filter(Boolean),
  );
  atuais.add(chave);

  jar.set(COOKIE_DICAS_DEMO, [...atuais].slice(-20).join(","), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });
}

/**
 * O tour do modo demo.
 *
 * O texto que vale e o da semente em db/migrations/0009 — este resumo existe
 * porque o demo nao tem banco para consultar, e um tour que mostrasse "passo
 * de exemplo 1, passo de exemplo 2" nao demonstraria nada. A tela avisa, em
 * cima, que esta em modo demo e que nada e salvo.
 */
function exemploDoTour(): EstadoTour {
  const passos: PassoTour[] = [
    {
      chave: "boas-vindas",
      titulo: "O que a Shopia faz",
      corpo:
        "A Shopia é uma apresentadora de IA para o TikTok Shop: ela narra o seu roteiro de vendas com voz realista, sem parar, e responde os comentários do chat enquanto a live está no ar. Você não precisa aparecer, não precisa falar e não precisa ficar acordado.",
      rotaAlvo: "/inicio",
      ordem: 10,
      obrigatorio: false,
      exigeAceite: false,
      vistoEm: null,
    },
    {
      chave: "caminho",
      titulo: "O caminho: produto → roteiro → voz → áudio → extensão → live",
      corpo:
        "São seis etapas, sempre nessa ordem. Produto bem descrito alimenta o roteiro; o roteiro vira áudio na voz escolhida; a extensão entrega esse áudio ao LIVE Studio como se fosse o seu microfone. Vale gastar tempo na primeira etapa: sem produto bem descrito o roteiro sai genérico, e nenhuma voz salva roteiro genérico.",
      rotaAlvo: "/produtos",
      ordem: 20,
      obrigatorio: false,
      exigeAceite: false,
      vistoEm: null,
    },
    {
      chave: "loop-gratis",
      titulo: "Por que o loop é de graça",
      corpo:
        "O áudio é gerado UMA vez e repete por horas sem custar crédito de novo. O único jeito de queimar crédito à toa é mandar gerar de novo o que já está pronto: refazer o áudio para trocar uma palavra, gerar três versões para escolher uma. Gerou, ficou bom, deixa rodando.",
      rotaAlvo: "/audio",
      ordem: 30,
      obrigatorio: false,
      exigeAceite: false,
      vistoEm: null,
    },
    {
      chave: "creditos",
      titulo: "Crédito é caractere, não é minuto",
      corpo:
        "O provedor de voz cobra por caractere, então é assim que o crédito é medido aqui. Cerca de 600 caracteres viram 1 minuto de fala. O débito acontece ANTES da geração, com a estimativa na tela antes de você confirmar; se a geração falhar, o crédito volta por estorno.",
      rotaAlvo: "/creditos",
      ordem: 40,
      obrigatorio: false,
      exigeAceite: false,
      vistoEm: null,
    },
    {
      chave: "risco-automacao",
      titulo: "O aviso que a gente precisa dar antes de você ligar a extensão",
      corpo:
        "Automatizar o LIVE Studio tende a violar os Termos de Serviço do TikTok. Não existe modo oficial de fazer isso. O risco de restrição ou bloqueio recai sobre a SUA conta do TikTok, não sobre a Shopia. A gente reduz o que dá para reduzir — cadência variável no chat, áudio e chat em módulos separados —, mas reduzir não é eliminar.",
      rotaAlvo: "/extensao",
      ordem: 50,
      obrigatorio: true,
      exigeAceite: true,
      vistoEm: null,
    },
    {
      chave: "ajuda",
      titulo: "Onde pedir ajuda e como retomar este tour",
      corpo:
        "As Aulas trazem o passo a passo em vídeo, inclusive a instalação da extensão, que é onde mais gente trava. E este tour fica salvo na sua CONTA, não no navegador: dá para sair no meio e continuar amanhã, de outro aparelho, do ponto onde parou.",
      rotaAlvo: "/aulas",
      ordem: 60,
      obrigatorio: false,
      exigeAceite: false,
      vistoEm: null,
    },
  ];

  return {
    passos,
    indiceInicial: 0,
    pendentes: passos.length,
    riscoAceitoEm: null,
    riscoAceitoVersao: null,
    versaoRisco: 1,
    riscoEmDia: false,
  };
}

