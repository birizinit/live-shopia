// Fixar produto no LIVE Studio.
//
// -----------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO NÃO TRAZ NENHUM SELETOR PRONTO
//
// O chat do TikTok nós conseguimos mapear: a lista tem `data-e2e` estável, e o
// mapa publicado foi validado contra uma página real salva. O painel de
// produtos não. Ele muda por país, por tipo de conta de vendedor e por teste
// A/B do TikTok — e ninguém aqui tem uma live com produtos aberta para
// conferir.
//
// Publicar um palpite seria pior do que não ter o recurso. Um seletor errado
// não falha em silêncio numa lista de produtos: ele acha ALGUM botão e clica.
// Numa live de vendas, o botão ao lado pode ser arquivar o produto, tirar do
// ar, ou aplicar desconto. "Provavelmente é este aqui" não é engenharia; é
// apostar a loja de outra pessoa.
//
// Então a âncora é aprendida: a pessoa clica uma vez no botão de fixar que ela
// já usa, a extensão descreve aquele elemento e guarda. Deixa de ser palpite e
// vira observação — da tela daquela conta, que é a única que importa para ela.
// -----------------------------------------------------------------------------

/** Âncoras que o painel de produtos usa. Aprendidas, nunca publicadas por nós. */
export const ANCORAS = {
  lista: "produto.lista",
  item: "produto.item",
  fixar: "produto.fixar",
};

/**
 * O produto de número `posicao` (1 = o primeiro da lista).
 *
 * Por POSIÇÃO e não por nome: é assim que o LIVE Studio numera, é assim que o
 * vendedor fala ("fixa o 3") e é o único identificador que não depende de
 * casar o cadastro da Shopia com o cadastro do TikTok — dois catálogos que
 * ninguém garantiu que estão na mesma ordem, com os mesmos nomes.
 */
/**
 * A lista de produtos precisa RESOLVER para a busca acontecer.
 *
 * Sem ela não se cai para `document`: procurar "um produto" na página inteira
 * do LIVE Studio acha qualquer card parecido — no feed lateral, num modal, na
 * vitrine — e aí a contagem por posição aponta para outra coisa. Preferimos
 * dizer que a lista não está à vista a fixar o produto errado.
 */
function itensDaLista(mapa) {
  const raiz = mapa.um(ANCORAS.lista);
  if (!raiz) return null;
  const itens = mapa.todos(ANCORAS.item, raiz);
  return Array.isArray(itens) ? itens : [];
}

export function itemNaPosicao(mapa, posicao) {
  const itens = itensDaLista(mapa);
  if (!itens || itens.length === 0) return null;
  const indice = Math.trunc(posicao) - 1;
  return indice >= 0 && indice < itens.length ? itens[indice] : null;
}

export function quantosProdutos(mapa) {
  return itensDaLista(mapa)?.length ?? 0;
}

/**
 * Fixa o produto da posição pedida.
 *
 * Devolve o MOTIVO quando não dá, em vez de um `false` mudo: o painel precisa
 * dizer à pessoa se falta ensinar a âncora, se o painel de produtos está
 * fechado ou se aquele número não existe na lista dela. São três consertos
 * diferentes, e "não deu" não distingue nenhum.
 */
export function fixarProduto(mapa, posicao) {
  if (!mapa.ancoras.includes(ANCORAS.fixar)) {
    return { ok: false, motivo: "sem_ancora" };
  }

  const itens = itensDaLista(mapa);
  if (itens === null) return { ok: false, motivo: "lista_fechada" };
  if (itens.length === 0) return { ok: false, motivo: "lista_vazia" };

  const item = itemNaPosicao(mapa, posicao);
  if (!item) return { ok: false, motivo: "posicao_inexistente", total: itens.length };

  // O botão é procurado DENTRO do item, nunca na página: fora dele, o primeiro
  // "fixar" da tela é o do produto 1, e todo pedido fixaria o mesmo produto.
  const botao = mapa.um(ANCORAS.fixar, item);
  if (!botao) return { ok: false, motivo: "sem_botao" };
  if (botao.disabled) return { ok: false, motivo: "botao_desligado" };

  botao.click();
  return { ok: true, posicao };
}
