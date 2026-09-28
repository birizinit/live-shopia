/**
 * Para onde mandar depois do login, sem virar redirect aberto.
 *
 * `startsWith("/") && !startsWith("//")` não basta: o navegador lê "\" como
 * "/", então "/\evil.com" passa nesse teste e vira "https://evil.com/". Por
 * isso barra invertida e caractere de controle são recusados ANTES do parse,
 * e o que sobra ainda precisa resolver para a mesma origem.
 */

const ORIGEM_FICTICIA = "http://shopia.invalid";

export function destinoSeguro(bruto: unknown, padrao: string): string {
  if (typeof bruto !== "string") return padrao;
  if (!bruto.startsWith("/") || bruto.startsWith("//")) return padrao;
  if (/[\\\u0000-\u001f\u007f]/.test(bruto)) return padrao;

  let url: URL;
  try {
    url = new URL(bruto, ORIGEM_FICTICIA);
  } catch {
    return padrao;
  }

  if (url.origin !== ORIGEM_FICTICIA) return padrao;
  return `${url.pathname}${url.search}${url.hash}`;
}
