import { test } from "node:test";
import assert from "node:assert/strict";
import { encerramentoNormal, normalizarCorpoTelemetria } from "./telemetria-legado.ts";

test("converte o formato que a extensão 1.2.0 envia", () => {
  const corpo = normalizarCorpoTelemetria(
    {
      instalacao: "abc-123-instalacao",
      falhas: [
        { ancora: "chat.lista", motivo: "cascata_esgotada", vezes: 6, mapaVersao: 3 },
        { ancora: "chat.item_texto", motivo: "ultimo_recurso", vezes: 2, mapaVersao: 3 },
      ],
    },
    "1.2.0",
  ) as { versao: string; falhas: Record<string, unknown>[] };

  assert.equal(corpo.versao, "1.2.0");
  assert.deepEqual(corpo.falhas[0], {
    seletor: "chat.lista",
    candidato: null,
    versao: "1.2.0",
    mapaVersao: 3,
    ocorrencias: 6,
    modulo: "chat",
    contexto: { motivo: "cascata_esgotada" },
  });
  assert.equal(corpo.falhas[1]!.candidato, 0);
});

test("corpo já no formato novo passa intacto", () => {
  const novo = { instalacao: "x".repeat(10), versao: "1.3.0", falhas: [{ seletor: "chat.lista", versao: "1.3.0" }] };
  assert.deepEqual(normalizarCorpoTelemetria(novo, null), novo);
});

test("encerramento pedido pela pessoa não é queda", () => {
  for (const motivo of ["encerrada pelo usuário", "tempo programado encerrado", "painel fechado", "desconectado"]) {
    assert.equal(encerramentoNormal(motivo), true, motivo);
  }
  assert.equal(encerramentoNormal("O Chrome recusou mandar o áudio"), false);
  assert.equal(encerramentoNormal(null), true);
});
