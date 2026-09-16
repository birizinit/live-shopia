import postgres from "postgres";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const chave = "DATABASE" + "_URL";
const linhas = readFileSync(".env.local", "utf8").split(/\r?\n/);
const url = linhas.find((l) => l.startsWith(chave)).split("=").slice(1).join("=").trim();
const sql = postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} });

const EMAIL = "freio@shopia.dev";
await sql`delete from perfis where email = ${EMAIL}`;
const p = (await sql`select * from criar_perfil(${EMAIL},'h','Freio','freioteste')`)[0];
const plano = (await sql`select id, slug, recursos, contas_tiktok from planos where slug='mensal'`)[0];
await sql`insert into assinaturas (perfil_id, plano_id, status, inicio) values (${p.id}, ${plano.id}, 'ativa', now())`;

// Espelha o que src/lib/dados/extensao.ts faz em recursosDoPlano: os recursos
// da licença são DERIVADOS da lista de benefícios do plano.
const texto = plano.recursos.join(" | ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const recursos = {
  mixer: true,
  chat: texto.includes("respostas no chat"),
  camera_virtual: texto.includes("camera virtual"),
  sons_naturais: texto.includes("sons naturais"),
  analise_live: texto.includes("analise da live"),
  contas_tiktok: plano.contas_tiktok,
  plano: plano.slug,
};
console.log("recursos derivados do plano mensal:", JSON.stringify(recursos));

const token = "shpx_" + randomBytes(32).toString("base64url");
// objeto direto, sem JSON.stringify: postgres.js serializa para jsonb sozinho
await sql`select * from emitir_licenca_ext(${p.id}, ${createHash("sha256").update(token).digest()},
  ${token.slice(-4)}, ${plano.id}, ${recursos.chat}, ${sql.json(recursos)}, 7)`;

const r = await (await fetch("https://liveshopia.up.railway.app/api/ext/licenca", {
  headers: { authorization: `Bearer ${token}` },
})).json();
console.log("\n/api/ext/licenca devolve:");
console.log("  recursos:", JSON.stringify(r.recursos));
console.log("\nTOKEN=" + token);
console.log("PERFIL=" + p.id);
await sql.end();
