/**
 * Comentário que é só um cumprimento — "oi", "olá", "boa noite".
 *
 * Não casa com tema nenhum, mas pede resposta: quem cumprimenta a
 * Shopia e é ignorado vai embora. Sem `\b` de propósito: em JavaScript
 * "á" não conta como letra, e "olá" nunca casaria.
 */
const CUMPRIMENTO =
  /^(oi+e?|ol[aá]+|opa+|eai|e a[ií]|salve|bom dia|boa tarde|boa noite|boa madrugada|hello|hi)(?=$|[\s!.,;:)…]|\p{Extended_Pictographic})/iu;

export function ehCumprimento(texto: string): boolean {
  const limpo = texto.trim();
  return limpo.length <= 30 && !limpo.includes("?") && CUMPRIMENTO.test(limpo);
}
