import "server-only";
import { createHash } from "node:crypto";
import { bd } from "@/lib/db";
import { comDemo, configuracao, numeroDe } from "./comum";
import { comTraducao } from "./erros";

/**
 * Web Push: inscricoes de navegador e o que vale a pena notificar.
 *
 * A chave natural da inscricao e o ENDPOINT — a URL unica que o servico de
 * push do navegador emite — e nao o par (perfil, aparelho). E o que o
 * comentario de `push_inscricoes` em db/migrations/0006_live_dados.sql manda
 * fazer, e e por isso que todo insert daqui termina em `on conflict
 * (endpoint)`: reinscrever o mesmo navegador atualiza a linha que ja existe em
 * vez de abrir a segunda e entregar a mesma notificacao duas vezes.
 */

/** Padrao de fabrica do aviso de credito, em CARACTERES. */
const LIMIAR_PADRAO = 5_000;

/** Teto do campo de limiar. Acima disto o aviso dispararia sempre. */
export const LIMIAR_MAXIMO = 1_000_000;

export type PreferenciasPush = {
  venda: boolean;
  quedaLive: boolean;
  creditosBaixos: boolean;
  /** Em CARACTERES, a mesma unidade de `perfis.creditos`. */
  creditosLimiar: number;
};

export type InscricaoPush = {
  id: string;
  /**
   * Hash curto do endpoint. O endpoint inteiro NAO desce para o navegador: ele
   * e uma credencial de envio, e a tela so precisa saber se a inscricao que
   * este navegador tem em maos e uma das que estao no banco.
   */
  marca: string;
  navegador: string;
  criadoEm: string;
  ultimoEnvioEm: string | null;
  /** false quando o servico de push devolveu 404/410 e o job desligou a linha. */
  ativa: boolean;
};

/**
 * O corpo que o worker de push criptografa e que o public/sw.js le.
 *
 * Mora aqui, e nao dentro do worker, porque os dois lados precisam concordar:
 * quem mudar o formato de um lado so descobriria no aparelho do usuario.
 */
export type CargaPush = {
  titulo: string;
  texto?: string;
  /** Para onde o clique leva. Caminho interno, sempre comecando com "/". */
  url?: string;
  /** Notificacao com a mesma tag substitui a anterior em vez de empilhar. */
  tag?: string;
};

export type DadosInscricao = {
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceId: string | null;
  userAgent: string | null;
};

/**
 * Identificador publico de uma inscricao, derivado do endpoint.
 *
 * SHA-256 truncado: o navegador recalcula o mesmo valor sobre o endpoint que
 * ele tem em maos (crypto.subtle) e descobre se esta ou nao na lista, sem que
 * a credencial precise trafegar de volta.
 */
export function marcaDoEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
}

/**
 * Nome legivel do aparelho, so para a pessoa reconhecer a linha na lista.
 *
 * A ordem dos testes e a parte que importa: o Edge se diz Chrome, e o Chrome
 * se diz Safari. Quem testar Safari primeiro rotula o celular inteiro errado.
 */
export function nomeDoNavegador(userAgent: string | null): string {
  if (!userAgent) return "Navegador desconhecido";

  const navegador = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/.test(userAgent)
      ? "Opera"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Navegador";

  const sistema = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent)
      ? "iPhone"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Macintosh|Mac OS X/.test(userAgent)
          ? "Mac"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;

  return sistema ? `${navegador} no ${sistema}` : navegador;
}

const PREFERENCIAS_EXEMPLO: PreferenciasPush = {
  venda: true,
  quedaLive: true,
  creditosBaixos: true,
  creditosLimiar: LIMIAR_PADRAO,
};

/** Aparelhos de exemplo do modo demo. A marca nao bate com navegador nenhum. */
const INSCRICOES_EXEMPLO: InscricaoPush[] = [
  {
    id: "00000000-0000-4000-8000-0000000000e1",
    marca: "exemplo-celular",
    navegador: "Chrome no Android",
    criadoEm: "2026-02-11T13:20:00.000Z",
    ultimoEnvioEm: "2026-02-18T22:05:00.000Z",
    ativa: true,
  },
  {
    id: "00000000-0000-4000-8000-0000000000e2",
    marca: "exemplo-desktop",
    navegador: "Chrome no Windows",
    criadoEm: "2026-01-30T09:02:00.000Z",
    ultimoEnvioEm: null,
    ativa: true,
  },
];

type LinhaPreferencias = {
  venda: boolean;
  queda_live: boolean;
  creditos_baixos: boolean;
  creditos_limiar: string;
};

export async function preferenciasDe(perfilId: string): Promise<PreferenciasPush> {
  return comDemo(
    () => ({ ...PREFERENCIAS_EXEMPLO }),
    async () => {
      const linhas = await bd()<LinhaPreferencias[]>`
        select venda, queda_live, creditos_baixos, creditos_limiar
          from push_preferencias
         where perfil_id = ${perfilId}
      `;

      const linha = linhas[0];
      if (!linha) {
        // Quem nunca abriu esta tela nao tem linha. O padrao vem de
        // `configuracoes`, que a operacao muda sem deploy (0006).
        const limiar = await configuracao("push.creditos_limiar", LIMIAR_PADRAO);
        return {
          venda: true,
          quedaLive: true,
          creditosBaixos: true,
          creditosLimiar: limiar,
        };
      }

      return {
        venda: linha.venda,
        quedaLive: linha.queda_live,
        creditosBaixos: linha.creditos_baixos,
        creditosLimiar: numeroDe(linha.creditos_limiar, LIMIAR_PADRAO),
      };
    },
  );
}

export async function salvarPreferencias(
  perfilId: string,
  preferencias: PreferenciasPush,
): Promise<void> {
  // O CHECK do banco exige `>= 0`; o teto e desta camada, porque limiar maior
  // que qualquer saldo faria o aviso de credito disparar todo dia.
  const limiar = Math.min(
    Math.max(0, Math.trunc(preferencias.creditosLimiar)),
    LIMIAR_MAXIMO,
  );

  await comTraducao(async () => {
    await bd()`
      insert into push_preferencias
        (perfil_id, venda, queda_live, creditos_baixos, creditos_limiar)
      values (
        ${perfilId},
        ${preferencias.venda},
        ${preferencias.quedaLive},
        ${preferencias.creditosBaixos},
        ${limiar}
      )
      on conflict (perfil_id) do update
        set venda           = excluded.venda,
            queda_live      = excluded.queda_live,
            creditos_baixos = excluded.creditos_baixos,
            creditos_limiar = excluded.creditos_limiar
    `;
  });
}

type LinhaInscricao = {
  id: string;
  endpoint: string;
  user_agent: string | null;
  criado_em: Date;
  ultimo_envio_em: Date | null;
  desativada_em: Date | null;
};

function montarInscricao(linha: LinhaInscricao): InscricaoPush {
  return {
    id: linha.id,
    marca: marcaDoEndpoint(linha.endpoint),
    navegador: nomeDoNavegador(linha.user_agent),
    criadoEm: linha.criado_em.toISOString(),
    ultimoEnvioEm: linha.ultimo_envio_em?.toISOString() ?? null,
    ativa: linha.desativada_em === null,
  };
}

export async function inscricoesDe(perfilId: string): Promise<InscricaoPush[]> {
  return comDemo(
    () => INSCRICOES_EXEMPLO.map((inscricao) => ({ ...inscricao })),
    async () => {
      const linhas = await bd()<LinhaInscricao[]>`
        select id, endpoint, user_agent, criado_em, ultimo_envio_em, desativada_em
          from push_inscricoes
         where perfil_id = ${perfilId}
         order by criado_em desc
         limit 20
      `;
      return linhas.map(montarInscricao);
    },
  );
}

/**
 * Grava a inscricao deste navegador.
 *
 * `on conflict (endpoint)` troca o dono da linha de proposito: quem entra com
 * outra conta no mesmo navegador precisa parar de receber o push da conta
 * anterior naquele aparelho. E a reinscricao zera `falhas` e `desativada_em`,
 * porque uma inscricao recem-nascida no navegador esta viva de novo mesmo que
 * a anterior tenha morrido com 410.
 */
export async function registrarInscricao(
  perfilId: string,
  dados: DadosInscricao,
): Promise<{ id: string; marca: string }> {
  return comTraducao(async () => {
    const linhas = await bd()<{ id: string }[]>`
      insert into push_inscricoes
        (perfil_id, endpoint, p256dh, auth, device_id, user_agent)
      values (
        ${perfilId},
        ${dados.endpoint},
        ${dados.p256dh},
        ${dados.auth},
        ${dados.deviceId},
        ${dados.userAgent}
      )
      on conflict (endpoint) do update
        set perfil_id     = excluded.perfil_id,
            p256dh        = excluded.p256dh,
            auth          = excluded.auth,
            device_id     = coalesce(excluded.device_id, push_inscricoes.device_id),
            user_agent    = coalesce(excluded.user_agent, push_inscricoes.user_agent),
            falhas        = 0,
            desativada_em = null
      returning id
    `;

    return { id: linhas[0]!.id, marca: marcaDoEndpoint(dados.endpoint) };
  });
}

/** Cancela a inscricao deste navegador. O dono entra no `where`, sempre. */
export async function removerInscricaoPorEndpoint(
  perfilId: string,
  endpoint: string,
): Promise<boolean> {
  return comTraducao(async () => {
    const linhas = await bd()<{ id: string }[]>`
      delete from push_inscricoes
       where perfil_id = ${perfilId} and endpoint = ${endpoint}
      returning id
    `;
    return linhas.length > 0;
  });
}

/**
 * Esquece um aparelho a partir da lista.
 *
 * O id vem da tela, entao o perfil entra no `where` ANTES dele — id de outra
 * pessoa simplesmente nao apaga nada, em vez de apagar o aparelho dela.
 */
export async function esquecerInscricao(perfilId: string, id: string): Promise<boolean> {
  return comTraducao(async () => {
    const linhas = await bd()<{ id: string }[]>`
      delete from push_inscricoes
       where perfil_id = ${perfilId} and id = ${id}
      returning id
    `;
    return linhas.length > 0;
  });
}
