import { test } from "node:test";
import assert from "node:assert/strict";
import { comPausas } from "./pausas.ts";
import { fatiarEmBlocos } from "./caracteres.ts";

test("troca de parágrafo vira pausa, com duração que varia", () => {
  const saida = comPausas("Para tudo!\n\nHoje tem oferta.\n\nToca no carrinho.", () => 0.5);
  assert.equal(saida, 'Para tudo! <break time="0.9s" /> Hoje tem oferta. <break time="0.9s" /> Toca no carrinho.');
  assert.match(comPausas("a\n\nb", () => 0), /time="0.6s"/);
  assert.match(comPausas("a\n\nb", () => 0.999), /time="1.2s"/);
});

test("texto sem parágrafo passa igual", () => {
  assert.equal(comPausas("Uma frase só. Outra frase."), "Uma frase só. Outra frase.");
});

test("fatiar texto longo preserva as quebras de parágrafo", () => {
  const paragrafo = "Frase de venda bem comprida para encher o bloco. ".repeat(20).trim();
  const blocos = fatiarEmBlocos(`${paragrafo}\n\n${paragrafo}\n\n${paragrafo}`, 1200);
  assert.ok(blocos.length > 1);
  assert.ok(blocos.some((b) => b.includes("\n\n")), "alguma quebra sobreviveu ao fatiamento");
});
