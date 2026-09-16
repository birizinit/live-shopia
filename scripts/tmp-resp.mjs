import postgres from "postgres";
import { readFileSync } from "node:fs";

const BASE = "https://liveshopia.up.railway.app";
const TOKEN = "shpx_VFTB1JglVUB_SnBDYQHXBFd7kBvG7HUC6seWBdhpESo";
const PERFIL = "242f1f49-88f0-442e-a167-ca3890295302";

const chave = "DATABASE" + "_URL";
const linhas = readFileSync(".env.local", "utf8").split(/\r?\n/);
const url = linhas.find((l) => l.startsWith(chave)).split("=").slice(1).join("=").trim();
const sql = postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} });

await sql`insert into live_config (perfil_id) values (${PERFIL}) on conflict do nothing`;
await sql`select criar_temas_padrao(${PERFIL})`;

const h = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const post = async (rota, corpo) =>
  (await fetch(`${BASE}${rota}`, { method: "POST", headers: h, body: JSON.stringify(corpo) })).json();

const sessao = await post("/api/ext/sessao", { acao: "abrir" });
console.log("sessao aberta\n");

const casos = [
  ["comentario", null, "quanto custa?"],
  ["entrada", "ana_shop", null],
  ["comentario", null, "tem frete gratis?"],
  ["comentario", null, "oi gente tudo bem"],
];

for (const [tipo, apelido, texto] of casos) {
  const r = await post("/api/ext/responder", { sessaoId: sessao.sessaoId, tipo, apelido, texto });
  console.log(JSON.stringify(texto ?? `(entrada de ${apelido})`));
  console.log(`   -> ${r.acao}${r.motivo ? " (" + r.motivo + ")" : ""}${r.tema ? "  tema=" + r.tema : ""}`);
  if (r.texto) console.log(`      "${r.texto}"   espera ${Math.round((r.esperarMs ?? 0) / 1000)}s`);
  if (r.acao === "escrever") {
    await post("/api/ext/responder", { acao: "registrar", sessaoId: sessao.sessaoId, texto: r.texto, tema: r.tema });
  }
}

console.log("\nteto por minuto (padrao 3) — as proximas devem ser barradas:");
for (let i = 1; i <= 3; i++) {
  const r = await post("/api/ext/responder", { sessaoId: sessao.sessaoId, tipo: "comentario", texto: "tem cupom?" });
  console.log(`   tentativa ${i}: ${r.acao}${r.motivo ? " (" + r.motivo + ")" : ""}`);
  if (r.acao === "escrever") {
    await post("/api/ext/responder", { acao: "registrar", sessaoId: sessao.sessaoId, texto: r.texto, tema: r.tema });
  }
}

const ev = await sql`select texto, dados->>'tema' as tema from live_eventos
                      where perfil_id=${PERFIL} and tipo='resposta_ia' order by criado_em`;
console.log("\nrespostas no historico da live:", ev.length);
for (const x of ev) console.log(`   [${x.tema}] ${x.texto.slice(0, 55)}...`);

await post("/api/ext/sessao", { acao: "fechar", sessaoId: sessao.sessaoId });
await sql`delete from perfis where email = 'freio@shopia.dev'`;
console.log("\nlimpeza feita.");
await sql.end();
