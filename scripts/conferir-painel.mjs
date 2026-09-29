/**
 * Confere que todo id procurado pelo painel existe no HTML dele.
 *
 * É o erro mais fácil de cometer e o mais difícil de ver: `$("botao-que-nao-
 * existe")` devolve null, e a extensão só quebra quando alguém clica — no meio
 * de uma live, na máquina do cliente, sem console aberto. Um teste de
 * carregamento não pega, porque o erro é de ligação entre dois arquivos.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "extensao");

const html = readFileSync(join(raiz, "painel.html"), "utf8");
const js = readFileSync(join(raiz, "painel.js"), "utf8");

const idsNoHtml = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const idsNoJs = new Set([...js.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]));

const faltando = [...idsNoJs].filter((id) => !idsNoHtml.has(id)).sort();

// O caminho inverso não é erro: o HTML pode ter id só para o <label for>, ou
// para a folha de estilo. Só relatamos para leitura humana.
const semUso = [...idsNoHtml].filter((id) => !idsNoJs.has(id)).sort();

console.log(`ids no HTML: ${idsNoHtml.size} · procurados pelo JS: ${idsNoJs.size}`);

if (semUso.length) console.log(`\nno HTML e nunca procurados (ok, informativo):\n  ${semUso.join(", ")}`);

if (faltando.length) {
  console.error(
    `\n✗ O painel.js procura ${faltando.length} id(s) que não existem no painel.html:\n` +
      faltando.map((id) => `      ${id}`).join("\n"),
  );
  process.exit(1);
}

console.log("\n✓ Todo id procurado pelo JS existe no HTML.");
