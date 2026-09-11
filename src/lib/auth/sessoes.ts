import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { bd } from "../db";
import { env } from "../env";
import { ipDoPedido } from "../rede";
import type { Papel } from "../roles";
import type { Usuario } from "../sessao";

/**
 * Sessão opaca no banco, no lugar de JWT.
 *
 * O cookie carrega 32 bytes aleatórios; o banco guarda só o SHA-256 deles.
 * Dump vazado não vira sessão válida, e revogar é um UPDATE — que é uma
 * garantia mais forte do que a rotação de refresh token do plano original.
 * Rotação existe porque JWT não dá para revogar; aqui dá.
 */
export const COOKIE_SESSAO = "shopia_sessao";
export const COOKIE_DISPOSITIVO = "shopia_device";

/** Teto absoluto: passou disto, é login de novo mesmo em uso diário. */
const DIAS_ABSOLUTO = 30;
/** Janela de inatividade. */
const DIAS_INATIVIDADE = 7;
/** Não escrever no banco a cada page view só para mexer um timestamp. */
const MINUTOS_ENTRE_TOQUES = 10;

function hashDoToken(token: string) {
  return createHash("sha256").update(token).digest();
}

/** Id estável do navegador — é o que dá lastro à trava de dispositivo. */
async function idDoDispositivo() {
  const jar = await cookies();
  const existente = jar.get(COOKIE_DISPOSITIVO)?.value;
  if (existente) return existente;

  const novo = randomUUID();
  jar.set(COOKIE_DISPOSITIVO, novo, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.producao,
    maxAge: 60 * 60 * 24 * 400,
  });
  return novo;
}

export async function criarSessao(perfilId: string) {
  const sql = bd();
  const jar = await cookies();
  const cabecalhos = await headers();

  const token = randomBytes(32).toString("base64url");
  const userAgent = cabecalhos.get("user-agent")?.slice(0, 500) ?? null;
  const ip = ipDoPedido(cabecalhos);
  const deviceId = await idDoDispositivo();

  await sql`
    insert into sessoes (perfil_id, token_hash, expira_em, user_agent, ip, device_id)
    values (
      ${perfilId},
      ${hashDoToken(token)},
      now() + ${`${DIAS_ABSOLUTO} days`}::interval,
      ${userAgent},
      ${ip},
      ${deviceId}
    )
  `;

  await sql`
    insert into dispositivos (perfil_id, device_id, user_agent)
    values (${perfilId}, ${deviceId}, ${userAgent})
    on conflict (perfil_id, device_id)
      do update set ultimo_acesso = now(), user_agent = excluded.user_agent
  `;

  jar.set(COOKIE_SESSAO, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.producao,
    maxAge: 60 * 60 * 24 * DIAS_ABSOLUTO,
  });
}

type LinhaSessao = {
  perfil_id: string;
  email: string;
  nome: string;
  usuario: string;
  papel: Papel;
  creditos: string | number;
  email_verificado_em: Date | null;
  plano: string | null;
  precisa_tocar: boolean;
};

/** Valida o cookie e devolve quem é. Uma consulta, uma vez por render. */
export async function usuarioDaSessao(): Promise<Usuario | null> {
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  if (!token) return null;

  const sql = bd();
  const chave = hashDoToken(token);

  const linhas = await sql<LinhaSessao[]>`
    select p.id as perfil_id,
           p.email,
           p.nome,
           p.usuario,
           p.papel,
           p.creditos,
           p.email_verificado_em,
           pl.nome as plano,
           (s.ultima_atividade < now() - ${`${MINUTOS_ENTRE_TOQUES} minutes`}::interval)
             as precisa_tocar
      from sessoes s
      join perfis p on p.id = s.perfil_id
      left join assinaturas a on a.perfil_id = p.id and a.status = 'ativa'
      left join planos pl on pl.id = a.plano_id
     where s.token_hash = ${chave}
       and s.revogada_em is null
       and s.expira_em > now()
       and s.ultima_atividade > now() - ${`${DIAS_INATIVIDADE} days`}::interval
  `;

  const linha = linhas[0];
  if (!linha) return null;

  if (linha.precisa_tocar) {
    await sql`
      update sessoes set ultima_atividade = now() where token_hash = ${chave}
    `;
  }

  return {
    id: linha.perfil_id,
    email: linha.email,
    nome: linha.nome,
    usuario: linha.usuario,
    papel: linha.papel,
    plano: linha.plano,
    creditos: Number(linha.creditos),
    emailVerificado: linha.email_verificado_em !== null,
  };
}

export async function encerrarSessao() {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESSAO)?.value;

  if (token) {
    await bd()`
      update sessoes set revogada_em = now()
       where token_hash = ${hashDoToken(token)} and revogada_em is null
    `;
  }

  jar.delete(COOKIE_SESSAO);
}

/** Usado na troca de senha: quem roubou o cookie perde o acesso na hora. */
export async function encerrarTodasAsSessoes(perfilId: string) {
  await bd()`
    update sessoes set revogada_em = now()
     where perfil_id = ${perfilId} and revogada_em is null
  `;
}
