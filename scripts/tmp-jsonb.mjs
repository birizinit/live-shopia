import postgres from "postgres";
import { readFileSync } from "node:fs";

const chave = "DATABASE" + "_URL";
const linhas = readFileSync(".env.local", "utf8").split(/\r?\n/);
const url = linhas.find((l) => l.startsWith(chave)).split("=").slice(1).join("=").trim();
const sql = postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} });

const obj = { tema: "preco" };

console.log("como cada forma chega no jsonb:\n");

const a = (await sql`select ${JSON.stringify(obj)}::jsonb as v`)[0].v;
console.log("  JSON.stringify(obj)::jsonb  ->", JSON.stringify(a), " tipo:", typeof a);

const b = (await sql`select ${sql.json(obj)}::jsonb as v`)[0].v;
console.log("  sql.json(obj)::jsonb        ->", JSON.stringify(b), " tipo:", typeof b);

const c = (await sql`select ${sql.json(obj)} as v`)[0].v;
console.log("  sql.json(obj) sem cast      ->", JSON.stringify(c), " tipo:", typeof c);

console.log("\nleitura com ->> 'tema':");
for (const [rotulo, expr] of [["stringify", sql`${JSON.stringify(obj)}::jsonb`], ["sql.json", sql`${sql.json(obj)}::jsonb`]]) {
  const r = (await sql`select (${expr})->>'tema' as t`)[0];
  console.log("  " + rotulo.padEnd(10) + " ->", JSON.stringify(r.t));
}

await sql.end();
