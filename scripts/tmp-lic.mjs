import postgres from "postgres";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
const chave = "DATABASE" + "_URL";
const linhas = readFileSync(".env.local","utf8").split(/\r?\n/);
const url = linhas.find(l => l.startsWith(chave)).split("=").slice(1).join("=").trim();
const sql = postgres(url,{max:1,idle_timeout:5,onnotice:()=>{}});

await sql`delete from perfis where email = 'ext-teste@shopia.dev'`;
const p = (await sql`select * from criar_perfil('ext-teste@shopia.dev','h','Ext Teste','extteste')`)[0];

const plano = (await sql`select id, recursos, contas_tiktok from planos where slug='mensal'`)[0];
await sql`insert into assinaturas (perfil_id, plano_id, status, inicio) values (${p.id}, ${plano.id}, 'ativa', now())`;

const token = "shpx_" + randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest();
const recursos = { mixer: true, chat: true, nucleo: true, painel: true };

await sql`
  select * from emitir_licenca_ext(
    ${p.id}, ${hash}, ${token.slice(-4)}, ${plano.id}, true, ${JSON.stringify(recursos)}::jsonb, 7
  )`;

console.log("PERFIL=" + p.id);
console.log("TOKEN=" + token);
await sql.end();
