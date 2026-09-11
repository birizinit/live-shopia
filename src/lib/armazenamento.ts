import "server-only";
import { createHash } from "node:crypto";
import { bd } from "./db";
import { comoJson } from "./dados/comum";
import { env } from "./env";

/**
 * Armazenamento de binario atras de UMA interface.
 *
 * Implementacao do dia 1: o proprio Postgres (bytea). Isso so e defensavel
 * porque nada aqui e grande — o audio da live nasce em blocos de ~2 MB, e o
 * arquivo continuo de 3h NUNCA e materializado: o player e a extensao tocam a
 * lista de blocos em ordem.
 *
 * Foi essa decisao que eliminou tres problemas de uma vez: volume da Railway
 * (que impede replica e da downtime em deploy), ffmpeg (que a imagem do
 * Nixpacks nao traz) e a conta do R2, que ainda nao existe.
 *
 * Trocar para R2 e implementar a mesma interface e mudar `arquivos.provedor`.
 * Nenhuma tela chama `fs` nem `bd()` para binario — so isto aqui.
 */

export type Arquivo = {
  id: string;
  mime: string;
  bytes: number;
  duracaoMs: number | null;
};

const TETO_BYTES = 8 * 1024 * 1024;

export async function guardar(
  perfilId: string | null,
  conteudo: Buffer,
  opcoes: { mime: string; duracaoMs?: number; metadados?: Record<string, unknown> },
): Promise<Arquivo> {
  if (conteudo.byteLength > TETO_BYTES) {
    throw new Error(
      `Bloco de ${Math.round(conteudo.byteLength / 1024 / 1024)}MB excede o teto de 8MB. ` +
        "Áudio contínuo não deve ser materializado num arquivo só.",
    );
  }

  const sql = bd();
  const sha = createHash("sha256").update(conteudo).digest();

  const linhas = await sql<{ id: string; bytes: string; duracao_ms: number | null }[]>`
    insert into arquivos (perfil_id, provedor, conteudo, mime, bytes, sha256, duracao_ms, estado, metadados)
    values (
      ${perfilId}, 'postgres', ${conteudo}, ${opcoes.mime}, ${conteudo.byteLength},
      ${sha}, ${opcoes.duracaoMs ?? null}, 'pronto', ${comoJson(opcoes.metadados ?? {})}
    )
    returning id, bytes, duracao_ms
  `;

  const l = linhas[0]!;
  return { id: l.id, mime: opcoes.mime, bytes: Number(l.bytes), duracaoMs: l.duracao_ms };
}

/**
 * Le um arquivo. `perfilId` nao e opcional por descuido: sem RLS, e a checagem
 * de dono que impede um id adivinhado servir o audio de outra pessoa. Arquivo
 * global (catalogo, previa de voz) tem perfil_id nulo e e legivel por todos.
 */
export async function ler(
  perfilId: string,
  arquivoId: string,
): Promise<{ conteudo: Buffer; mime: string; bytes: number } | null> {
  const linhas = await bd()<
    { conteudo: Buffer | null; mime: string; bytes: string; url_publica: string | null }[]
  >`
    select conteudo, mime, bytes, url_publica
      from arquivos
     where id = ${arquivoId}
       and estado = 'pronto'
       and (perfil_id is null or perfil_id = ${perfilId})
  `;

  const l = linhas[0];
  if (!l?.conteudo) return null;
  return { conteudo: l.conteudo, mime: l.mime, bytes: Number(l.bytes) };
}

export async function remover(arquivoId: string) {
  await bd()`
    update arquivos
       set estado = 'removido', removido_em = now(), conteudo = null
     where id = ${arquivoId} and removido_em is null
  `;
}

/** Total ocupado por um perfil — base do teto por plano. */
export async function bytesDoPerfil(perfilId: string): Promise<number> {
  const linhas = await bd()<{ total: string }[]>`
    select coalesce(sum(bytes), 0) as total
      from arquivos
     where perfil_id = ${perfilId} and removido_em is null
  `;
  return Number(linhas[0]?.total ?? 0);
}

export const armazenamentoEmR2 = Boolean(env.r2Bucket);
