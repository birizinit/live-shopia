import { test } from "node:test";
import assert from "node:assert/strict";
import * as app from "./fluxos.ts";
import * as ext from "../../extensao/fluxos.js";

const frete = { modo: "contem" as const, gatilhos: ["frete", "entrega grátis"], respostas: ["Frete grátis pra todo o Brasil!"], marcar: true };
const preco = { modo: "exato" as const, gatilhos: ["preço", "valor"], respostas: ["R$ 79,90 no produto fixado"], marcar: false };

const CASOS: [typeof frete | typeof preco, string, string | null][] = [
  [frete, "qual o FRETE?", "frete"],
  [frete, "tem frete pra SP", "frete"],
  [frete, "fretes", null],
  [frete, "desfrete", null],
  [frete, "é entrega gratis?", "entrega grátis"],
  [preco, "Preço?", "preço"],
  [preco, "PRECO!!", "preço"],
  [preco, "qual o preço", null],
  [preco, "valor", "valor"],
];

for (const [modulo, nome] of [[app, "app"], [ext, "extensão"]] as const) {
  test(`fluxos (${nome}): casamento contém/exato`, () => {
    for (const [fluxo, texto, esperado] of CASOS) {
      assert.equal(modulo.gatilhoQueCasa(fluxo, texto), esperado, `${fluxo.modo} "${texto}"`);
    }
  });

  test(`fluxos (${nome}): resposta marca a pessoa só quando pedido`, () => {
    assert.equal(modulo.montarResposta(frete, "Ana", 0), "@Ana Frete grátis pra todo o Brasil!");
    assert.equal(modulo.montarResposta(frete, null, 0), "Frete grátis pra todo o Brasil!");
    assert.equal(modulo.montarResposta(preco, "Ana", 0), "R$ 79,90 no produto fixado");
    assert.equal(
      modulo.montarResposta({ ...frete, respostas: ["{nome}, frete grátis!"] }, "", 0),
      "frete grátis!",
    );
  });

  test(`fluxos (${nome}): primeiro fluxo ativo vence`, () => {
    const lista = [{ ...preco, ativo: false, gatilhos: ["frete"] }, frete];
    assert.equal(modulo.fluxoQueCasa(lista, "frete")?.fluxo, frete);
    assert.equal(modulo.fluxoQueCasa(lista, "oi"), null);
  });
}

test("parece pergunta (extensão)", () => {
  assert.equal(ext.parecePergunta("tem tamanho P?"), true);
  assert.equal(ext.parecePergunta("quanto custa"), true);
  assert.equal(ext.parecePergunta("lindo demais"), false);
  assert.equal(ext.parecePergunta("kkk"), false);
});
