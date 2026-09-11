/**
 * Aplicador de migrações.
 *
 * Roda os .sql de db/migrations em ordem, uma transação por arquivo, e anota
 * o que já foi em `_migracoes`. Rodar duas vezes não faz nada — é o que
 * permite pendurar isto no pre-deploy da Railway sem medo.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

// .env.local só existe no desenvolvimento; na Railway as variáveis já vêm
// injetadas no processo.
for (const arquivo of [".env.local", ".env"]) {
  const caminho = join(raiz, arquivo);
  if (!existsSync(caminho)) continue;
  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const par = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!par) continue;
    const [, chave, bruto] = par;
    if (process.env[chave] !== undefined) continue;
    process.env[chave] = bruto.trim().replace(/^["']|["']$/g, "");
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida.");
  process.exit(1);
}

const sql = postgres(url, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 30,
  ssl: process.env.DATABASE_SSL === "require" ? "require" : false,
  onnotice: () => {},
});

try {
  await sql`
    create table if not exists public._migracoes (
      nome        text primary key,
      aplicada_em timestamptz not null default now()
    )
  `;

  const aplicadas = new Set(
    (await sql`select nome from public._migracoes`).map((l) => l.nome),
  );

  const pasta = join(raiz, "db", "migrations");
  const arquivos = (await readdir(pasta)).filter((n) => n.endsWith(".sql")).sort();

  let novas = 0;
  for (const nome of arquivos) {
    if (aplicadas.has(nome)) {
      console.log(`  ·  ${nome} (já aplicada)`);
      continue;
    }

    const conteudo = await readFile(join(pasta, nome), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(conteudo).simple();
      await tx`insert into public._migracoes (nome) values (${nome})`;
    });

    novas += 1;
    console.log(`  ✓  ${nome}`);
  }

  console.log(
    novas === 0 ? "\nBanco já estava em dia." : `\n${novas} migração(ões) aplicada(s).`,
  );
} catch (erro) {
  console.error("\nFalhou:", erro.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
