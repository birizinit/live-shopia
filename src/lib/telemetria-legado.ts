/**
 * Compatibilidade com o que a extensão JÁ instalada envia.
 *
 * Até a 1.2.0 a extensão mandava a quebra como `{ ancora, motivo, vezes }`,
 * sem versão, e a rota esperava `{ seletor, versao, ocorrencias }`. A
 * validação recusava tudo e a extensão engole erro de telemetria de propósito
 * — então o alerta de quebra de seletor nunca recebeu nada, justamente na
 * primeira live real, em que o chat não foi lido. Consertar do lado do
 * servidor faz valer para quem já instalou, sem reinstalação.
 */

type Bruto = Record<string, unknown>;

function ehObjeto(valor: unknown): valor is Bruto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function moduloDaAncora(ancora: string) {
  return ancora.startsWith("chat.") ? "chat" : "nucleo";
}

export function normalizarCorpoTelemetria(json: unknown, versaoConhecida: string | null): unknown {
  if (!ehObjeto(json) || !Array.isArray(json.falhas)) return json;
  const legado = json.falhas.some((f) => ehObjeto(f) && "ancora" in f && !("seletor" in f));
  if (!legado) return json;

  const versao = typeof json.versao === "string" ? json.versao : (versaoConhecida ?? "0.0.0");

  return {
    ...json,
    versao,
    falhas: json.falhas.map((f) => {
      if (!ehObjeto(f) || typeof f.ancora !== "string") return f;
      return {
        seletor: f.ancora,
        // "cascata_esgotada" = nenhum candidato casou; "ultimo_recurso" = só o
        // último casou. O formato antigo não diz qual índice, então fica o 0.
        candidato: f.motivo === "cascata_esgotada" ? null : 0,
        versao,
        mapaVersao: typeof f.mapaVersao === "number" ? f.mapaVersao : null,
        ocorrencias: typeof f.vezes === "number" && f.vezes > 0 ? f.vezes : 1,
        modulo: moduloDaAncora(f.ancora),
        contexto: typeof f.motivo === "string" ? { motivo: f.motivo } : {},
      };
    }),
  };
}

/**
 * A extensão manda o MOTIVO do encerramento no campo de erro. "Você clicou em
 * Encerrar" não é a live ter caído — registrar como queda distorcia o
 * histórico (3 das 4 primeiras sessões reais apareceram como "caiu").
 */
const ENCERRAMENTOS_NORMAIS = [
  "encerrada pelo usuário",
  "encerrada pelo painel",
  "tempo programado encerrado",
  "painel fechado",
  "desconectado",
  "suspensa pelo painel",
];

export function encerramentoNormal(motivo: string | null): boolean {
  if (!motivo) return true;
  const texto = motivo.trim().toLowerCase();
  return ENCERRAMENTOS_NORMAIS.some((normal) => texto === normal);
}
