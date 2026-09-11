import "server-only";

/**
 * IP de quem fez o pedido, para rate limit e auditoria.
 *
 * `X-Forwarded-For` e uma LISTA que cada salto acrescenta a direita. A entrada
 * mais a ESQUERDA e escrita pelo cliente e ele pode inventar o que quiser —
 * usar a primeira entrega ao atacante a chave do proprio limite: basta mandar
 * um IP diferente a cada tentativa e o teto nunca fecha.
 *
 * A ponta confiavel e a ULTIMA, escrita pelo proxy da Railway.
 */
export function ipDoPedido(cabecalhos: Headers): string | null {
  const bruto =
    cabecalhos.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    cabecalhos.get("x-real-ip")?.trim();

  if (!bruto) return null;
  return ehIp(bruto) ? bruto : null;
}

export function ehIp(valor: string) {
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(valor);
  const ipv6 = valor.includes(":") && /^[0-9a-f:%.]+$/i.test(valor);
  return ipv4 || ipv6;
}
