// Resolvedor de âncoras do DOM do TikTok.
//
// A extensão não compila NENHUM seletor. Ela pede o mapa ao servidor e resolve
// por nome de âncora — "chat.item", "chat.campo". Quando o TikTok muda o
// layout, o conserto é publicar um mapa novo: a base inteira volta a funcionar
// no próximo batimento, sem republicar extensão e sem pedir reinstalação.
// É a diferença entre dez minutos e três dias com todo mundo parado.
//
// FORMATO DO MAPA
//   { "<ancora>": ["<estrategia>=<valor>", ...] }
// Estratégias: css=, aria=, texto=, papel=
//
// A cascata é tentada em ordem e a primeira que casar vence. Por isso a ordem
// no mapa importa: seletor específico primeiro, âncora estrutural por último.

const ESTRATEGIAS = ["css", "aria", "texto", "papel"];

function separar(entrada) {
  const corte = entrada.indexOf("=");
  if (corte < 0) return null;
  const estrategia = entrada.slice(0, corte).trim();
  const valor = entrada.slice(corte + 1).trim();
  if (!ESTRATEGIAS.includes(estrategia) || !valor) return null;
  return { estrategia, valor };
}

function textoVisivel(no) {
  return (no.textContent || "").trim().replace(/\s+/g, " ");
}

function porCss(raiz, valor, todos) {
  try {
    if (todos) return [...raiz.querySelectorAll(valor)];
    // O MutationObserver entrega o nó que ENTROU. Quando o próprio nó é a
    // âncora (a mensagem de "entrou na live", por exemplo), querySelector só
    // olharia os filhos e nunca o acharia.
    if (raiz.nodeType === Node.ELEMENT_NODE && raiz.matches(valor)) return raiz;
    return raiz.querySelector(valor);
  } catch {
    // Seletor malformado no mapa não pode derrubar a leitura inteira do chat.
    return todos ? [] : null;
  }
}

function porAria(raiz, valor, todos) {
  const candidatos = [...raiz.querySelectorAll("[aria-label]")].filter((n) => {
    const r = (n.getAttribute("aria-label") || "").trim().toLowerCase();
    return r === valor.toLowerCase() || r.includes(valor.toLowerCase());
  });
  return todos ? candidatos : (candidatos[0] ?? null);
}

function porTexto(raiz, valor, todos) {
  const alvo = valor.toLowerCase();
  const candidatos = [...raiz.querySelectorAll("button, a, span, div, [role]")].filter((n) => {
    const t = textoVisivel(n).toLowerCase();
    // Só nós folha: sem isto, o <body> casa com qualquer texto da página.
    return t === alvo && n.children.length === 0;
  });
  return todos ? candidatos : (candidatos[0] ?? null);
}

function porPapel(raiz, valor, todos) {
  const [papel, nome] = valor.split("|").map((p) => p?.trim());
  let candidatos = [...raiz.querySelectorAll(`[role="${CSS.escape(papel)}"]`)];
  if (nome) {
    const alvo = nome.toLowerCase();
    candidatos = candidatos.filter((n) => {
      const rotulo = (n.getAttribute("aria-label") || textoVisivel(n)).toLowerCase();
      return rotulo.includes(alvo);
    });
  }
  return todos ? candidatos : (candidatos[0] ?? null);
}

const EXECUTORES = {
  css: porCss,
  aria: porAria,
  texto: porTexto,
  papel: porPapel,
};

export class Mapa {
  /**
   * @param mapa    o mapa publicado pelo servidor, igual para toda a base
   * @param versao  versão do mapa, para a telemetria dizer o que quebrou
   * @param locais  âncoras aprendidas NESTA instalação, apontando na tela
   */
  constructor(mapa, versao, locais = null) {
    this.mapa = mapa ?? {};
    this.versao = versao ?? null;
    this.locais = locais ?? {};
    /** Âncoras que falharam desde o último relatório, com a contagem. */
    this.falhas = new Map();
  }

  get ancoras() {
    return [...new Set([...Object.keys(this.mapa), ...Object.keys(this.locais)])];
  }

  /**
   * O que a pessoa apontou na própria tela vence o que publicamos.
   *
   * Sempre nessa ordem, e não o contrário: o mapa do servidor é o palpite bom
   * para a média, e a âncora local é fato observado naquela conta. Quando os
   * dois discordam, quem viu a tela tem razão.
   */
  #cascataDe(ancora) {
    const locais = this.locais[ancora];
    const publicada = this.mapa[ancora];
    return [
      ...(Array.isArray(locais) ? locais : []),
      ...(Array.isArray(publicada) ? publicada : []),
    ];
  }

  #resolver(ancora, raiz, todos) {
    const cascata = this.#cascataDe(ancora);
    if (!Array.isArray(cascata) || cascata.length === 0) {
      this.#anotarFalha(ancora, "ancora_ausente");
      return todos ? [] : null;
    }

    for (let i = 0; i < cascata.length; i++) {
      const passo = separar(String(cascata[i]));
      if (!passo) continue;

      const achado = EXECUTORES[passo.estrategia](raiz, passo.valor, todos);
      const casou = todos ? achado.length > 0 : achado !== null;

      if (casou) {
        // Casar só no último degrau da cascata é aviso de que os degraus de
        // cima morreram: o DOM mudou e ainda não quebrou. Vale relatar antes
        // de virar incidente.
        if (i === cascata.length - 1 && cascata.length > 1) {
          this.#anotarFalha(ancora, "ultimo_recurso");
        }
        return achado;
      }
    }

    this.#anotarFalha(ancora, "cascata_esgotada");
    return todos ? [] : null;
  }

  #anotarFalha(ancora, motivo) {
    const chave = `${ancora}|${motivo}`;
    this.falhas.set(chave, (this.falhas.get(chave) ?? 0) + 1);
  }

  um(ancora, raiz = document) {
    return this.#resolver(ancora, raiz, false);
  }

  todos(ancora, raiz = document) {
    return this.#resolver(ancora, raiz, true);
  }

  /**
   * Entrega as falhas acumuladas e zera o contador.
   *
   * Em lote, e não a cada falha: uma âncora quebrada numa live movimentada
   * falha centenas de vezes por minuto, e uma requisição por falha seria a
   * extensão derrubando o próprio servidor no dia em que o TikTok muda o DOM.
   */
  drenarFalhas() {
    if (this.falhas.size === 0) return [];
    const lista = [...this.falhas.entries()].map(([chave, vezes]) => {
      const [ancora, motivo] = chave.split("|");
      return { ancora, motivo, vezes, mapaVersao: this.versao };
    });
    this.falhas.clear();
    return lista;
  }
}

// -----------------------------------------------------------------------------
// APRENDER UMA ÂNCORA APONTANDO NA TELA
//
// O painel de produtos do LIVE Studio não é igual para todo mundo: muda por
// país, por tipo de conta e por teste A/B do TikTok. Publicar um seletor nosso
// para ele seria chute — e chute que clica em botão errado no meio de uma live
// de vendas é pior do que não clicar em nada.
//
// Então a pessoa aponta uma vez: clica no botão de fixar que ela já usa, e a
// extensão descreve aquele elemento. Deixa de ser palpite e vira observação.
// -----------------------------------------------------------------------------

/** Atributos que o TikTok usa para teste automatizado — os mais estáveis que existem na página. */
const ATRIBUTOS_ESTAVEIS = ["data-e2e", "data-testid", "data-tt"];

function escaparAtributo(valor) {
  return String(valor).replace(/["\\]/g, "\\$&");
}

/**
 * Descreve um elemento como uma CASCATA de candidatos, do mais estável para o
 * mais frágil — o mesmo formato que o mapa publicado usa.
 *
 * Cascata, e não um seletor só, porque o primeiro degrau pode morrer numa
 * atualização do TikTok sem que os de baixo morram junto. Um seletor único
 * transforma qualquer mudança de layout em quebra total.
 */
export function descrever(no) {
  if (!no || no.nodeType !== Node.ELEMENT_NODE) return [];

  const candidatos = [];
  const visto = new Set();
  const juntar = (entrada) => {
    if (entrada && !visto.has(entrada)) {
      visto.add(entrada);
      candidatos.push(entrada);
    }
  };

  // 1. Atributo de teste no próprio nó: é o que o TikTok mantém entre releases.
  for (const attr of ATRIBUTOS_ESTAVEIS) {
    const valor = no.getAttribute?.(attr);
    if (valor) juntar(`css=[${attr}="${escaparAtributo(valor)}"]`);
  }

  // 2. Atributo de teste num ancestral próximo + a tag daqui. Serve quando o
  //    botão em si é anônimo mas mora dentro de um bloco identificado.
  let pai = no.parentElement;
  for (let salto = 0; pai && salto < 4; salto++, pai = pai.parentElement) {
    for (const attr of ATRIBUTOS_ESTAVEIS) {
      const valor = pai.getAttribute?.(attr);
      if (!valor) continue;
      const alvo = no.tagName.toLowerCase();
      juntar(`css=[${attr}="${escaparAtributo(valor)}"] ${alvo}`);
    }
  }

  // 3. aria-label: sobrevive a troca de classe, e é o que a acessibilidade
  //    obriga a manter estável. Quebra se o TikTok traduzir a interface.
  const rotulo = no.getAttribute?.("aria-label")?.trim();
  if (rotulo) juntar(`aria=${rotulo}`);

  // 4. Texto visível, se o nó for folha. Mesma fragilidade do aria, e por isso
  //    vem depois dele.
  const texto = textoVisivel(no);
  if (texto && texto.length <= 40 && no.children.length === 0) juntar(`texto=${texto}`);

  return candidatos;
}

/**
 * Sobe do nó clicado até achar algo digno de virar âncora.
 *
 * Quem clica acerta o <svg> do ícone, ou o <span> do rótulo — quase nunca o
 * botão. Descrever o nó exato gravaria uma âncora que casa com o ícone e não
 * com a coisa clicável, e o clique programado não faria nada.
 */
export function alvoClicavel(no) {
  let atual = no;
  for (let salto = 0; atual && salto < 6; salto++, atual = atual.parentElement) {
    if (atual.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = atual.tagName.toLowerCase();
    const papel = atual.getAttribute("role");
    const temAtributo = ATRIBUTOS_ESTAVEIS.some((a) => atual.getAttribute(a));
    if (tag === "button" || tag === "a" || papel === "button" || temAtributo) return atual;
  }
  return no?.nodeType === Node.ELEMENT_NODE ? no : null;
}
