/**
 * Fluxos de resposta — a regra do casamento, no lado do app.
 *
 * Espelho de extensao/fluxos.js (a extensão é quem executa). O teste
 * src/lib/fluxos.test.ts roda os dois contra os mesmos casos: se um mudar e o
 * outro não, o teste quebra antes de a tela prometer uma coisa e a aba fazer
 * outra.
 */

export type ModoFluxo = "contem" | "exato";

export type RegraFluxo = {
  modo: ModoFluxo;
  gatilhos: readonly string[];
  respostas: readonly string[];
  marcar: boolean;
  ativo?: boolean;
};

export function normalizar(texto: string | null | undefined): string {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9@]+/g, " ")
    .trim();
}

export function gatilhoQueCasa(fluxo: RegraFluxo, texto: string): string | null {
  const t = normalizar(texto);
  if (!t) return null;
  for (const g of fluxo.gatilhos) {
    const n = normalizar(g);
    if (!n) continue;
    if (fluxo.modo === "exato" ? t === n : ` ${t} `.includes(` ${n} `)) return g.trim();
  }
  return null;
}

export function fluxoQueCasa<T extends RegraFluxo>(
  fluxos: readonly T[],
  texto: string,
): { fluxo: T; gatilho: string } | null {
  for (const f of fluxos) {
    if (f.ativo === false) continue;
    const gatilho = gatilhoQueCasa(f, texto);
    if (gatilho) return { fluxo: f, gatilho };
  }
  return null;
}

export function montarResposta(fluxo: RegraFluxo, nome: string | null, sorteio = Math.random()) {
  const lista = fluxo.respostas.map((r) => r.trim()).filter(Boolean);
  if (!lista.length) return null;
  let texto = lista[Math.min(lista.length - 1, Math.floor(sorteio * lista.length))]!;
  const quem = (nome ?? "").trim();
  texto = texto.replaceAll("{nome}", quem);
  if (fluxo.marcar && quem && !texto.includes(`@${quem}`)) texto = `@${quem} ${texto}`;
  return texto.replace(/\s+/g, " ").replace(/^[\s,]+/, "").trim().slice(0, 150);
}
