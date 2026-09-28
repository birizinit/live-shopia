import { test } from "node:test";
import assert from "node:assert/strict";
import { centavosDe } from "./dinheiro.ts";

test("aceita os jeitos que as pessoas escrevem preço", () => {
  assert.equal(centavosDe("R$ 1.234,56"), 123456);
  assert.equal(centavosDe("89,90"), 8990);
  assert.equal(centavosDe("89.90"), 8990);
  assert.equal(centavosDe("1.234"), 123400);
  assert.equal(centavosDe("50"), 5000);
});

test("vazio é ausência, não zero", () => {
  assert.equal(centavosDe(""), null);
  assert.equal(centavosDe("R$ "), null);
});

test("negativo e acima do teto da coluna são inválidos", () => {
  assert.equal(centavosDe("-10"), "invalido");
  assert.equal(centavosDe("99999999999"), "invalido");
});
