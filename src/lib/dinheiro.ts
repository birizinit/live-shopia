/**
 * "R$ 1.234,56", "1234,56", "89.90" e "8990" — tudo vira centavos.
 *
 * Ponto sozinho com tres casas e separador de milhar ("1.234" = R$ 1.234,00):
 * preco de varejo em real nao tem milesimo de centavo, entao esta leitura
 * acerta muito mais vezes do que a alternativa.
 *
 * `null` e campo vazio; "invalido" e texto que nao da para ler como preco.
 */
export function centavosDe(bruto: string): number | null | "invalido" {
  if (!bruto) return null;

  const limpo = bruto.replace(/[^\d.,-]/g, "");
  if (!limpo) return null;
  if (limpo.includes("-")) return "invalido";

  let normalizado = limpo;
  if (limpo.includes(",")) {
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else {
    const partes = limpo.split(".");
    const ultima = partes.at(-1) ?? "";
    if (partes.length > 1 && ultima.length === 3) normalizado = partes.join("");
  }

  const valor = Number(normalizado);
  if (!Number.isFinite(valor) || valor < 0) return "invalido";

  const centavos = Math.round(valor * 100);
  // Teto do `integer` da coluna: R$ 21.474.836,47.
  if (centavos > 2_147_483_647) return "invalido";
  return centavos;
}
