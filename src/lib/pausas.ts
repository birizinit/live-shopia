/**
 * Respiro entre as partes do roteiro.
 *
 * O roteiro sai em parágrafos (gancho, oferta, prova…), mas a voz lia tudo
 * emendado, sem parar — o que mais soava robô. A ElevenLabs entende
 * `<break time="…" />`; cada troca de parágrafo vira uma pausa de 0,6 a 1,2 s,
 * com duração diferente a cada vez, porque gente não respira em intervalo fixo.
 *
 * Só no texto que vai para a síntese: o texto guardado, cobrado e revisado
 * continua sem marcação.
 */
export function comPausas(texto: string, sorteio: () => number = Math.random): string {
  return texto.replace(/\s*\n\s*\n\s*/g, () => {
    const segundos = (0.6 + sorteio() * 0.6).toFixed(1);
    return ` <break time="${segundos}s" /> `;
  });
}
