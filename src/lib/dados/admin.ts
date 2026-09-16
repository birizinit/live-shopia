import "server-only";
import { bd } from "@/lib/db";
import { comoJson, numeroDe } from "./comum";
import { ErroDominio } from "./erros";
import type { Papel } from "@/lib/roles";

/**
 * Operação do negócio.
 *
 * Tudo aqui é feito POR um admin SOBRE outra conta, então toda função recebe
 * `atorId` além do alvo — e grava em `auditoria`. Ação de admin sem trilha é o
 * tipo de coisa que ninguém sente falta até o dia em que alguém pergunta quem
 * liberou o quê.
 *
 * A checagem de papel NÃO mora aqui: mora na página, com exigirPapel. Estas
 * funções assumem que quem chegou já passou por lá.
 */

export type ContaAdmin = {
  id: string;
  email: string;
  nome: string;
  usuario: string;
  papel: Papel;
  creditos: number;
  emailVerificado: boolean;
  plano: string | null;
  cortesia: boolean;
  planoAte: string | null;
  criadoEm: string;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function listarContas(busca: string | null, limite = 50): Promise<ContaAdmin[]> {
  const termo = busca?.trim() ? `%${busca.trim().toLowerCase()}%` : null;

  const linhas = await bd()<
    {
      id: string; email: string; nome: string; usuario: string; papel: Papel;
      creditos: string; email_verificado_em: Date | null; plano: string | null;
      gateway: string | null; fim: Date | null; criado_em: Date;
    }[]
  >`
    select p.id, p.email, p.nome, p.usuario, p.papel, p.creditos, p.email_verificado_em,
           pl.nome as plano, a.gateway, a.fim, p.criado_em
      from perfis p
      left join assinaturas a on a.perfil_id = p.id and a.status = 'ativa'
      left join planos pl on pl.id = a.plano_id
     where ${termo === null
       ? bd()`true`
       : bd()`(lower(p.email) like ${termo} or lower(p.usuario) like ${termo} or lower(p.nome) like ${termo})`}
     order by p.criado_em desc
     limit ${limite}
  `;

  return linhas.map((l) => ({
    id: l.id,
    email: l.email,
    nome: l.nome,
    usuario: l.usuario,
    papel: l.papel,
    creditos: numeroDe(l.creditos),
    emailVerificado: l.email_verificado_em !== null,
    plano: l.plano,
    cortesia: l.gateway === "cortesia",
    planoAte: iso(l.fim),
    criadoEm: l.criado_em.toISOString(),
  }));
}

export type PlanoSimples = { id: string; slug: string; nome: string; meses: number };

export async function planosAtivos(): Promise<PlanoSimples[]> {
  const linhas = await bd()<
    { id: string; slug: string; nome: string; meses: number }[]
  >`select id, slug, nome, meses from planos where ativo order by ordem`;
  return linhas.map((l) => ({ ...l, meses: numeroDe(l.meses, 1) }));
}

export async function concederCortesia(
  atorId: string,
  perfilId: string,
  planoId: string,
  dias: number,
  motivo: string,
): Promise<void> {
  if (dias < 1 || dias > 3650) {
    throw new ErroDominio("dado_invalido", "O prazo precisa ficar entre 1 e 3650 dias.");
  }
  await bd()`
    select conceder_cortesia(${perfilId}, ${planoId}, ${dias}, ${atorId}, ${motivo})
  `;
}

/**
 * Encerra o acesso de cortesia.
 *
 * Não apaga a assinatura: marca como cancelada. A linha continua respondendo
 * "esta conta teve acesso de tal a tal data", que é o que se pergunta depois.
 */
export async function encerrarCortesia(atorId: string, perfilId: string): Promise<boolean> {
  const sql = bd();

  const linhas = await sql<{ id: string }[]>`
    update assinaturas
       set status = 'cancelada', fim = least(coalesce(fim, now()), now())
     where perfil_id = ${perfilId} and status = 'ativa' and gateway = 'cortesia'
    returning id
  `;

  if (!linhas.length) return false;

  await sql`
    insert into auditoria (perfil_id, ator_id, acao, entidade, entidade_id)
    values (${perfilId}, ${atorId}, 'cortesia_encerrada', 'assinaturas', ${linhas[0].id})
  `;
  return true;
}

export async function mudarPapel(
  atorId: string,
  perfilId: string,
  papel: Papel,
): Promise<void> {
  const sql = bd();

  // O admin não se rebaixa por acidente: perder o próprio acesso é o jeito mais
  // fácil de ficar trancado para fora da operação.
  if (atorId === perfilId && papel !== "admin") {
    throw new ErroDominio("dado_invalido", "Você não pode tirar o próprio acesso de admin.");
  }

  const antes = await sql<{ papel: Papel }[]>`
    select papel from perfis where id = ${perfilId}
  `;
  if (!antes[0]) throw new ErroDominio("nao_encontrado", "Conta não encontrada.");

  await sql`update perfis set papel = ${papel} where id = ${perfilId}`;

  await sql`
    insert into auditoria (perfil_id, ator_id, acao, entidade, entidade_id, antes, depois)
    values (${perfilId}, ${atorId}, 'papel_alterado', 'perfis', ${perfilId},
            ${comoJson({ papel: antes[0].papel })}, ${comoJson({ papel })})
  `;
}

export async function ajustarCreditos(
  atorId: string,
  perfilId: string,
  delta: number,
  motivo: string,
): Promise<void> {
  if (!Number.isSafeInteger(delta) || delta === 0) {
    throw new ErroDominio("dado_invalido", "Informe um ajuste diferente de zero.");
  }

  const sql = bd();

  // Ajuste manual entra na razão como qualquer outro lançamento: o saldo
  // continua sendo consequência da razão, e não um número que alguém digitou
  // por cima. `ajuste` é o motivo previsto para isso desde a 0001.
  await sql`
    insert into creditos_lancamentos (perfil_id, delta, motivo, metadados)
    values (${perfilId}, ${delta}, 'ajuste', ${comoJson({ por: atorId, motivo })})
  `;

  await sql`
    insert into auditoria (perfil_id, ator_id, acao, entidade, entidade_id, depois)
    values (${perfilId}, ${atorId}, 'creditos_ajustados', 'perfis', ${perfilId},
            ${comoJson({ delta, motivo })})
  `;
}

// ------------------------------------------------------------------- convites

export type ConviteAdmin = {
  id: string;
  codigo: string;
  plano: string;
  dias: number;
  usos: number;
  usosMax: number;
  expiraEm: string;
  observacao: string | null;
  ativo: boolean;
  esgotado: boolean;
  vencido: boolean;
  criadoEm: string;
};

export async function listarConvites(limite = 50): Promise<ConviteAdmin[]> {
  const linhas = await bd()<
    {
      id: string; codigo: string; plano: string; dias: number; usos: number;
      usos_max: number; expira_em: Date; observacao: string | null;
      ativo: boolean; criado_em: Date;
    }[]
  >`
    select c.id, c.codigo, p.nome as plano, c.dias, c.usos, c.usos_max,
           c.expira_em, c.observacao, c.ativo, c.criado_em
      from convites_acesso c
      join planos p on p.id = c.plano_id
     order by c.criado_em desc
     limit ${limite}
  `;

  const agora = Date.now();
  return linhas.map((l) => ({
    id: l.id,
    codigo: l.codigo,
    plano: l.plano,
    dias: numeroDe(l.dias),
    usos: numeroDe(l.usos),
    usosMax: numeroDe(l.usos_max),
    expiraEm: l.expira_em.toISOString(),
    observacao: l.observacao,
    ativo: l.ativo,
    esgotado: numeroDe(l.usos) >= numeroDe(l.usos_max),
    vencido: l.expira_em.getTime() <= agora,
    criadoEm: l.criado_em.toISOString(),
  }));
}

export async function criarConvite(
  atorId: string,
  dados: { planoId: string; dias: number; usosMax: number; validadeDias: number; observacao: string | null },
): Promise<string> {
  const sql = bd();

  const codigo = (await sql<{ c: string }[]>`select gerar_codigo_convite(8) as c`)[0]!.c;

  const linhas = await sql<{ id: string }[]>`
    insert into convites_acesso (codigo, criado_por, plano_id, dias, usos_max, expira_em, observacao)
    values (${codigo}, ${atorId}, ${dados.planoId}, ${dados.dias}, ${dados.usosMax},
            now() + make_interval(days => ${dados.validadeDias}), ${dados.observacao})
    returning id
  `;

  await sql`
    insert into auditoria (ator_id, acao, entidade, entidade_id, depois)
    values (${atorId}, 'convite_criado', 'convites_acesso', ${linhas[0]!.id},
            ${comoJson({ codigo, ...dados })})
  `;

  return codigo;
}

export async function revogarConvite(atorId: string, conviteId: string): Promise<boolean> {
  const sql = bd();
  const linhas = await sql<{ codigo: string }[]>`
    update convites_acesso set ativo = false where id = ${conviteId} and ativo
    returning codigo
  `;
  if (!linhas.length) return false;

  await sql`
    insert into auditoria (ator_id, acao, entidade, entidade_id)
    values (${atorId}, 'convite_revogado', 'convites_acesso', ${conviteId})
  `;
  return true;
}

export type ResumoAdmin = {
  contas: number;
  comAcesso: number;
  cortesias: number;
  convitesAtivos: number;
};

export async function resumoAdmin(): Promise<ResumoAdmin> {
  const linhas = await bd()<
    { contas: number; com_acesso: number; cortesias: number; convites: number }[]
  >`
    select
      (select count(*)::int from perfis) as contas,
      (select count(*)::int from assinaturas where status = 'ativa') as com_acesso,
      (select count(*)::int from assinaturas where status = 'ativa' and gateway = 'cortesia') as cortesias,
      (select count(*)::int from convites_acesso
        where ativo and expira_em > now() and usos < usos_max) as convites
  `;
  const r = linhas[0]!;
  return {
    contas: numeroDe(r.contas),
    comAcesso: numeroDe(r.com_acesso),
    cortesias: numeroDe(r.cortesias),
    convitesAtivos: numeroDe(r.convites),
  };
}
