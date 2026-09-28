import { test } from "node:test";
import assert from "node:assert/strict";
import { revisarTexto } from "./termos-restritos.ts";

const categorias = (texto: string) => revisarTexto(texto).map((a) => a.categoria);

test("roteiro de venda comum passa limpo", () => {
  const texto =
    "Para tudo! Esse fone tem bateria de 30 horas e garantia de 90 dias. " +
    "Hoje sai por R$ 89,90 com o cupom LIVE10. Toca no carrinho laranja e garante o seu.";
  assert.deepEqual(revisarTexto(texto), []);
});

test("contato fora do TikTok é sinalizado, com trecho e sugestão", () => {
  const alertas = revisarTexto("Chama no WhatsApp 11 99999-8888 que eu te passo o link na bio.");
  assert.deepEqual(
    alertas.map((a) => a.trecho),
    ["WhatsApp", "11 99999-8888", "link na bio"],
  );
  assert.ok(alertas.every((a) => a.categoria === "contato_externo"));
  assert.ok(alertas.every((a) => a.sugestao.length > 0 && a.motivo.length > 0));
});

test("pagamento fora do TikTok Shop é sinalizado", () => {
  assert.deepEqual(categorias("Paga no Pix ou por transferência que eu separo."), [
    "pagamento_externo",
    "pagamento_externo",
  ]);
});

test("promessa de resultado e alegação de saúde são sinalizadas", () => {
  assert.deepEqual(categorias("Esse chá cura a ansiedade e emagrece rápido. Resultado garantido!"), [
    "promessa_proibida",
    "promessa_proibida",
    "promessa_proibida",
  ]);
});

test("outros marketplaces e endereços de site são sinalizados", () => {
  assert.deepEqual(categorias("Tá mais caro na Shopee, confere em loja.com.br"), [
    "contato_externo",
    "contato_externo",
  ]);
});

test("palavras que só contêm o termo não disparam", () => {
  assert.deepEqual(
    revisarTexto("Procura um presente? Num instante chega, com o alfabeto de brinde e garantia."),
    [],
  );
});

test("posição aponta para o trecho no texto original", () => {
  const texto = "Oferta boa. Chama no zap!";
  const [alerta] = revisarTexto(texto);
  assert.equal(texto.slice(alerta!.inicio, alerta!.inicio + alerta!.trecho.length), alerta!.trecho);
});
