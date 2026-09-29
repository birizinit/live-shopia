// Testes da parte de produtos que NÃO depende do DOM real do TikTok.
//
// O que se testa aqui é a lógica de decisão: qual item é o da posição N, e
// qual motivo volta quando não dá para fixar. Os SELETORES não se testam aqui
// — eles vêm da tela da própria pessoa, e inventar um DOM de mentira para
// validá-los só provaria que o DOM de mentira casa com o seletor de mentira.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fixarProduto, itemNaPosicao, quantosProdutos, ANCORAS } from "./produtos.js";

/** Um mapa falso com a mesma interface do de verdade: `um`, `todos`, `ancoras`. */
function mapaFalso({ lista = "#lista", itens = [], fixar = () => null, ancoras = null } = {}) {
  return {
    ancoras: ancoras ?? Object.values(ANCORAS),
    um(ancora, raiz) {
      if (ancora === ANCORAS.lista) return lista;
      if (ancora === ANCORAS.fixar) return fixar(raiz);
      return null;
    },
    todos(ancora) {
      return ancora === ANCORAS.item ? itens : [];
    },
  };
}

const botao = () => ({ cliques: 0, disabled: false, click() { this.cliques += 1; } });

test("posição é 1-indexada, como o vendedor conta", () => {
  const itens = ["a", "b", "c"];
  const mapa = mapaFalso({ itens });
  assert.equal(itemNaPosicao(mapa, 1), "a");
  assert.equal(itemNaPosicao(mapa, 3), "c");
  assert.equal(itemNaPosicao(mapa, 0), null);
  assert.equal(itemNaPosicao(mapa, 4), null);
  assert.equal(quantosProdutos(mapa), 3);
});

test("clica no botão DENTRO do item pedido, não no primeiro da página", () => {
  const botoes = { a: botao(), b: botao() };
  const mapa = mapaFalso({
    itens: ["a", "b"],
    // O botão só é achado quando a raiz é o item — é o que prova que a busca
    // foi escopada. Se `fixarProduto` procurasse na página, viria null aqui.
    fixar: (raiz) => botoes[raiz] ?? null,
  });

  assert.deepEqual(fixarProduto(mapa, 2), { ok: true, posicao: 2 });
  assert.equal(botoes.b.cliques, 1);
  assert.equal(botoes.a.cliques, 0, "não pode ter clicado no produto 1");
});

test("sem a âncora aprendida, recusa antes de tocar em qualquer botão", () => {
  const alvo = botao();
  const mapa = mapaFalso({ itens: ["a"], fixar: () => alvo, ancoras: [ANCORAS.lista, ANCORAS.item] });

  assert.deepEqual(fixarProduto(mapa, 1), { ok: false, motivo: "sem_ancora" });
  assert.equal(alvo.cliques, 0, "não pode clicar sem a âncora ensinada");
});

test("cada jeito de falhar tem o seu próprio motivo", () => {
  assert.deepEqual(fixarProduto(mapaFalso({ itens: [] }), 1), { ok: false, motivo: "lista_vazia" });

  // Sem a lista à vista, recusa — nunca cai para a página inteira, onde a
  // contagem por posição apontaria para outro card qualquer.
  assert.deepEqual(fixarProduto(mapaFalso({ lista: null, itens: ["a"] }), 1), {
    ok: false,
    motivo: "lista_fechada",
  });

  assert.deepEqual(fixarProduto(mapaFalso({ itens: ["a", "b"] }), 5), {
    ok: false,
    motivo: "posicao_inexistente",
    total: 2,
  });

  assert.deepEqual(fixarProduto(mapaFalso({ itens: ["a"], fixar: () => null }), 1), {
    ok: false,
    motivo: "sem_botao",
  });

  const desligado = { ...botao(), disabled: true };
  assert.deepEqual(fixarProduto(mapaFalso({ itens: ["a"], fixar: () => desligado }), 1), {
    ok: false,
    motivo: "botao_desligado",
  });
});
