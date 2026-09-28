import { test } from "node:test";
import assert from "node:assert/strict";
import { politicaDeConteudo } from "./csp.ts";

function diretiva(politica: string, nome: string) {
  return politica.split("; ").find((d) => d.startsWith(`${nome} `)) ?? "";
}

test("script só roda com o nonce da requisição, nunca inline solto", () => {
  const politica = politicaDeConteudo("abc123", false);
  const script = diretiva(politica, "script-src");
  assert.match(script, /'nonce-abc123'/);
  assert.match(script, /'strict-dynamic'/);
  assert.doesNotMatch(script, /unsafe-inline/);
  assert.doesNotMatch(script, /unsafe-eval/);
});

test("produção fecha moldura, plugin e base, e força https", () => {
  const politica = politicaDeConteudo("n", false);
  assert.equal(diretiva(politica, "frame-ancestors"), "frame-ancestors 'none'");
  assert.equal(diretiva(politica, "object-src"), "object-src 'none'");
  assert.equal(diretiva(politica, "base-uri"), "base-uri 'self'");
  assert.ok(politica.includes("upgrade-insecure-requests"));
});

test("desenvolvimento libera eval para o React e não força https", () => {
  const politica = politicaDeConteudo("n", true);
  assert.match(diretiva(politica, "script-src"), /'unsafe-eval'/);
  assert.ok(!politica.includes("upgrade-insecure-requests"));
});

test("aulas em vídeo continuam abrindo", () => {
  assert.match(diretiva(politicaDeConteudo("n", false), "frame-src"), /youtube-nocookie\.com/);
});
