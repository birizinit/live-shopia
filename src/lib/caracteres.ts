/**
 * A contagem canonica de caracteres. Uma funcao so, em todo o projeto.
 *
 * Credito e medido, cobrado e estimado em caracteres, entao a UI, a estimativa,
 * o debito e o CHECK do banco precisam contar a MESMA coisa. Tres definicoes
 * concorrem: unidades UTF-16 (`.length` do JS), code points e grafemas
 * (`Intl.Segmenter`). Para "Olá 🔥" elas dao 7, 6 e 6.
 *
 * Escolhemos CODE POINTS, porque e o que `length()` do Postgres conta — assim
 * a coluna gerada `caracteres` e o contador da tela nunca discordam. Um
 * roteiro de vendas com emoji de fogo e o caso normal, nao a exceção.
 *
 * Nao usar `.length` nem `Intl.Segmenter` para medir texto cobravel.
 */
export function contarCaracteres(texto: string): number {
  // O espalhamento percorre code points; `.length` contaria unidades UTF-16,
  // onde um emoji sozinho ja vale 2.
  return [...texto].length;
}

/** ~600 caracteres por minuto de fala (docs/PLANO.md §5). */
export const CHARS_POR_MINUTO = 600;

/** Teto por chamada de TTS — e o que define o tamanho do bloco. */
export const CHARS_POR_BLOCO = 2400;

export function duracaoEstimadaMs(caracteres: number): number {
  return Math.round((caracteres / CHARS_POR_MINUTO) * 60_000);
}

export function formatarDuracao(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}`;
  if (m > 0) return `${m}min${String(s).padStart(2, "0")}`;
  return `${s}s`;
}

/**
 * Fatia o texto em blocos de ate `CHARS_POR_BLOCO`, cortando em fronteira de
 * frase quando da. Cortar no meio da frase produz respiracao errada na fala —
 * o ouvinte percebe a emenda.
 */
export function fatiarEmBlocos(texto: string, teto = CHARS_POR_BLOCO): string[] {
  const limpo = texto.trim();
  if (!limpo) return [];
  if (contarCaracteres(limpo) <= teto) return [limpo];

  const frases = limpo.split(/(?<=[.!?…])\s+/);
  const blocos: string[] = [];
  let atual = "";

  const empurrar = () => {
    if (atual.trim()) blocos.push(atual.trim());
    atual = "";
  };

  for (const frase of frases) {
    if (contarCaracteres(frase) > teto) {
      // Frase sozinha maior que o teto: corta por palavra, ultimo recurso.
      empurrar();
      let pedaco = "";
      for (const palavra of frase.split(/\s+/)) {
        if (contarCaracteres(pedaco) + contarCaracteres(palavra) + 1 > teto) {
          if (pedaco) blocos.push(pedaco.trim());
          pedaco = palavra;
        } else {
          pedaco = pedaco ? `${pedaco} ${palavra}` : palavra;
        }
      }
      if (pedaco) atual = pedaco;
      continue;
    }

    if (contarCaracteres(atual) + contarCaracteres(frase) + 1 > teto) empurrar();
    atual = atual ? `${atual} ${frase}` : frase;
  }

  empurrar();
  return blocos;
}
