import { test } from "node:test";
import assert from "node:assert/strict";
import { destinoSeguro } from "./destino-seguro.ts";

const PADRAO = "/inicio";

test("aceita caminho interno com busca e âncora", () => {
  assert.equal(destinoSeguro("/roteiro?id=1#topo", PADRAO), "/roteiro?id=1#topo");
  assert.equal(destinoSeguro("/planos", PADRAO), "/planos");
});

test("recusa host externo em todas as grafias que o navegador aceita", () => {
  for (const tentativa of [
    "//evil.com",
    "/\\evil.com",
    "/\\\\evil.com",
    "\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/\tevil.com",
    " //evil.com",
  ]) {
    assert.equal(destinoSeguro(tentativa, PADRAO), PADRAO, tentativa);
  }
});

test("recusa o que não é texto ou está vazio", () => {
  assert.equal(destinoSeguro(null, PADRAO), PADRAO);
  assert.equal(destinoSeguro(undefined, PADRAO), PADRAO);
  assert.equal(destinoSeguro(42, PADRAO), PADRAO);
  assert.equal(destinoSeguro("", PADRAO), PADRAO);
  assert.equal(destinoSeguro("inicio", PADRAO), PADRAO);
});

test("barra invertida codificada continua sendo caminho, não host", () => {
  assert.equal(destinoSeguro("/%5Cevil.com", PADRAO), "/%5Cevil.com");
});
