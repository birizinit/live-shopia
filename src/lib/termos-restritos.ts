/**
 * Revisão anti-restrição do que a apresentadora vai falar.
 *
 * O TikTok restringe (derruba o alcance ou encerra) a live que tira o
 * comprador da plataforma, pede pagamento por fora, promete resultado ou fala
 * de produto proibido. Esses são os motivos mais comuns de restrição em live
 * de venda — e todos estão no TEXTO, então dá para pegar antes de o áudio
 * ser gerado e pago.
 *
 * Isto NÃO esconde automação de ninguém: é a mesma regra que um vendedor
 * humano precisa seguir, conferida antes de a fala existir.
 *
 * Módulo puro, sem servidor: roda no assistente de criação, no editor e na
 * rota da extensão com a mesma lista.
 */

export type CategoriaRestricao =
  | "contato_externo"
  | "pagamento_externo"
  | "promessa_proibida"
  | "produto_restrito";

export type AlertaRestricao = {
  categoria: CategoriaRestricao;
  trecho: string;
  /** Posição do trecho no texto revisado. */
  inicio: number;
  motivo: string;
  sugestao: string;
};

type Regra = {
  categoria: CategoriaRestricao;
  padrao: RegExp;
  motivo: string;
  sugestao: string;
};

const FORA_DO_TIKTOK =
  "Mandar o comprador para fora do TikTok é o motivo mais comum de restrição da live.";

/** A ordem não importa: o resultado sai ordenado pela posição no texto. */
const REGRAS: Regra[] = [
  {
    categoria: "contato_externo",
    padrao:
      /\b(whats\s?app|whats|wpp|zap|telegram|instagram|insta|facebook|kwai|youtube|shopee|mercado\s+livre|amazon|magalu|shein)\b/gi,
    motivo: FORA_DO_TIKTOK,
    sugestao: "Troque por \"comenta aqui que eu respondo\" ou \"toca no carrinho\".",
  },
  {
    categoria: "contato_externo",
    padrao: /\b(link na bio|(me )?chama no (privado|direct|pv|dm))\b/gi,
    motivo: FORA_DO_TIKTOK,
    sugestao: "Troque por \"o link está no carrinho laranja da live\".",
  },
  {
    categoria: "contato_externo",
    padrao: /\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g,
    motivo: "Telefone na live é contato por fora da plataforma.",
    sugestao: "Tire o número e peça para a pessoa comentar a dúvida.",
  },
  {
    categoria: "contato_externo",
    padrao: /\b[\w.+-]+@[\w-]+\.[a-z]{2,}(\.[a-z]{2})?\b/gi,
    motivo: "E-mail na live é contato por fora da plataforma.",
    sugestao: "Tire o e-mail e peça para a pessoa comentar a dúvida.",
  },
  {
    categoria: "contato_externo",
    padrao: /\b(https?:\/\/\S+|www\.\S+|[\w-]+\.(com\.br|com|net|shop|store|site)\b)/gi,
    motivo: "Endereço de site na live leva o comprador para fora do TikTok Shop.",
    sugestao: "Tire o endereço; a compra acontece pelo carrinho da live.",
  },
  {
    categoria: "pagamento_externo",
    padrao: /\b(pix|transfer[êe]ncia|boleto|dep[óo]sito)\b/gi,
    motivo: "Pagamento fora do TikTok Shop é proibido na live de venda.",
    sugestao: "Diga \"compra direto no carrinho laranja, com o cupom da live\".",
  },
  {
    categoria: "promessa_proibida",
    padrao:
      /\b(cura|curar|milagr\w*|garantid[oa]s?|100\s?%\s?(eficaz|garantido)|sem efeitos? colaterais|resultado imediato)\b/gi,
    motivo: "Promessa de resultado e alegação de saúde levam à restrição da live.",
    sugestao: "Fale da experiência de uso, sem prometer resultado.",
  },
  {
    categoria: "promessa_proibida",
    padrao: /\b(emagre[cç]\w*|perca \d+\s?(kg|quilos))\b/gi,
    motivo: "Promessa de emagrecimento é alegação de saúde, restrita no TikTok.",
    sugestao: "Descreva o produto (textura, sabor, rotina) em vez do resultado no corpo.",
  },
  {
    categoria: "promessa_proibida",
    padrao: /\b(aprovad[oa]|recomendad[oa]) (pel[oa]s?|por) (anvisa|m[ée]dicos?|dermatologistas?)\b/gi,
    motivo: "Aval de órgão ou de médico só pode ser citado com prova — e na live não há como mostrar.",
    sugestao: "Tire o aval; se houver registro, mostre na descrição do produto.",
  },
  {
    categoria: "produto_restrito",
    padrao:
      /\b(cigarros?|vapes?|pod descart[áa]vel|narguil[ée]|armas?( de fogo)?|muni[cç][ãa]o|apostas?|bet|cassino)\b/gi,
    motivo: "Produto ou tema proibido no TikTok Shop.",
    sugestao: "Remova a menção; este produto não pode ser vendido na live.",
  },
];

export function revisarTexto(texto: string): AlertaRestricao[] {
  const achados: AlertaRestricao[] = [];

  for (const regra of REGRAS) {
    for (const casamento of texto.matchAll(regra.padrao)) {
      const trecho = casamento[0].trim();
      if (!trecho) continue;
      achados.push({
        categoria: regra.categoria,
        trecho,
        inicio: (casamento.index ?? 0) + casamento[0].indexOf(trecho),
        motivo: regra.motivo,
        sugestao: regra.sugestao,
      });
    }
  }

  achados.sort((a, b) => a.inicio - b.inicio);

  // Duas regras podem casar o mesmo pedaço (um site da Shopee, por exemplo).
  // Um aviso por trecho basta: repetir não ajuda ninguém a consertar.
  return achados.filter(
    (alerta, i) =>
      i === 0 || alerta.inicio >= achados[i - 1]!.inicio + achados[i - 1]!.trecho.length,
  );
}

export const ROTULO_CATEGORIA: Record<CategoriaRestricao, string> = {
  contato_externo: "Contato fora do TikTok",
  pagamento_externo: "Pagamento por fora",
  promessa_proibida: "Promessa de resultado",
  produto_restrito: "Produto proibido",
};
