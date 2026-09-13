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
    return todos ? [...raiz.querySelectorAll(valor)] : raiz.querySelector(valor);
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
  constructor(mapa, versao) {
    this.mapa = mapa ?? {};
    this.versao = versao ?? null;
    /** Âncoras que falharam desde o último relatório, com a contagem. */
    this.falhas = new Map();
  }

  get ancoras() {
    return Object.keys(this.mapa);
  }

  #resolver(ancora, raiz, todos) {
    const cascata = this.mapa[ancora];
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
