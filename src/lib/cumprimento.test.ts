import { test } from "node:test";
import assert from "node:assert/strict";
import { ehCumprimento } from "./cumprimento.ts";

test("reconhece cumprimento, com e sem acento", () => {
  for (const t of ["Olá", "olá!", "oi", "Oiii", "boa noite", "Bom dia gente", "e aí", "salve", "Opa"]) {
    assert.equal(ehCumprimento(t), true, t);
  }
});

test("pergunta ou frase longa não é só cumprimento", () => {
  for (const t of ["oi, quanto custa?", "olá, qual o frete pra SP e o prazo de entrega de vocês", "quero comprar", "oiticica"]) {
    assert.equal(ehCumprimento(t), false, t);
  }
});
