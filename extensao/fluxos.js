// Fluxos de resposta: "quando comentarem X, responda Y".
//
// Este arquivo é a regra do casamento, e é o MESMO para a extensão e para o
// app (src/lib/fluxos.ts repete a lógica e o teste roda os dois contra os
// mesmos casos): o que a tela do app promete é o que a aba faz.

/** Minúsculas, sem acento, só letras/números/@ separados por um espaço. */
export function normalizar(texto) {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9@]+/g, " ")
    .trim();
}

/**
 * O gatilho que casa com o texto, ou null.
 *
 * - "exato": a mensagem inteira é o gatilho ("frete" casa "Frete?" e
 *   "FRETE!!", não "qual o frete").
 * - "contem": o gatilho aparece como palavra(s) inteira(s) ("frete" casa
 *   "qual o frete?", não "fretes" nem "desfrete").
 */
export function gatilhoQueCasa(fluxo, texto) {
  const t = normalizar(texto);
  if (!t) return null;
  for (const g of fluxo?.gatilhos ?? []) {
    const n = normalizar(g);
    if (!n) continue;
    if (fluxo.modo === "exato" ? t === n : ` ${t} `.includes(` ${n} `)) return String(g).trim();
  }
  return null;
}

/** O primeiro fluxo ativo (na ordem) que casa com o texto. */
export function fluxoQueCasa(fluxos, texto) {
  for (const f of fluxos ?? []) {
    if (f?.ativo === false) continue;
    const gatilho = gatilhoQueCasa(f, texto);
    if (gatilho) return { fluxo: f, gatilho };
  }
  return null;
}

/** A resposta pronta: sorteada entre as do fluxo, com "@nome, " se marcar. */
export function montarResposta(fluxo, nome, sorteio = Math.random()) {
  const lista = (fluxo?.respostas ?? []).map((r) => String(r).trim()).filter(Boolean);
  if (!lista.length) return null;
  let texto = lista[Math.min(lista.length - 1, Math.floor(sorteio * lista.length))];
  const quem = String(nome ?? "").trim();
  texto = texto.replaceAll("{nome}", quem || "");
  if (fluxo.marcar && quem && !texto.includes(`@${quem}`)) texto = `@${quem} ${texto}`;
  return texto.replace(/\s+/g, " ").replace(/^[\s,]+/, "").trim().slice(0, 150);
}

/**
 * Parece pergunta? Para a lista "perguntas sem resposta": comentário solto
 * ("lindo!", "kkkk") não é algo que faltou responder.
 */
export function parecePergunta(texto) {
  const t = normalizar(texto);
  if (t.length < 3) return false;
  if (String(texto).includes("?")) return true;
  return /^(quanto|quanta|qual|quais|como|onde|quando|porque|por que|tem|ten|serve|pode|posso|vai|vem|faz|aceita|entrega|envia|manda|da pra|e original|e bom|funciona|precisa|qto|qnto|q tamanho|que tamanho|que cor|ainda tem)\b/.test(t);
}
