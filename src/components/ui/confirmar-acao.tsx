"use client";

import { useId, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "./button";
import { Input, Label } from "./input";
import { Modal } from "./modal";

/**
 * Confirmacao de acao destrutiva.
 *
 * "Tem certeza?" nao informa nada e por isso e confirmado no automatico. O que
 * segura o dedo e a lista do que some — por isso `perdas` e obrigatoria.
 *
 * Fechar apos o sucesso e do chamador: so ele sabe se a operacao foi.
 */

export type ConfirmarAcaoProps = {
  aberto: boolean;
  aoFechar: () => void;
  aoConfirmar: () => void | Promise<void>;
  titulo: string;
  /** Item a item, o que deixa de existir. Lista vazia aqui equivale a nao avisar. */
  perdas: string[];
  texto?: string;
  rotuloConfirmar?: string;
  rotuloCancelar?: string;
  /** Exige digitar este texto (o nome do item) para liberar o botao. */
  exigirTexto?: string;
};

export function ConfirmarAcao({
  aberto,
  aoFechar,
  aoConfirmar,
  titulo,
  perdas,
  texto,
  rotuloConfirmar = "Excluir",
  rotuloCancelar = "Cancelar",
  exigirTexto,
}: ConfirmarAcaoProps) {
  const [digitado, setDigitado] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [abertoAnterior, setAbertoAnterior] = useState(aberto);
  const idCampo = useId();

  // Limpa o texto digitado no proprio render em que a caixa abre ou fecha, e
  // nao num efeito: efeito so rodaria depois de pintar, e a confirmacao
  // anterior apareceria por um quadro — com o botao destrutivo ja liberado.
  if (aberto !== abertoAnterior) {
    setAbertoAnterior(aberto);
    setDigitado("");
  }

  const liberado = !exigirTexto || digitado.trim() === exigirTexto.trim();

  async function confirmar() {
    if (!liberado || enviando) return;
    setEnviando(true);
    try {
      await aoConfirmar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={titulo}
      tamanho="sm"
      travado={enviando}
      rodape={
        <>
          {/* O foco comeca no cancelar: numa caixa destrutiva o Enter distraido
              precisa cair no botao que nao destroi. */}
          <Button variante="secondary" onClick={aoFechar} disabled={enviando} autoFocus>
            {rotuloCancelar}
          </Button>
          <Button variante="danger" onClick={confirmar} disabled={!liberado || enviando}>
            {enviando ? "Executando…" : rotuloConfirmar}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger"
          aria-hidden
        >
          <TriangleAlert className="size-4" />
        </span>

        <div className="min-w-0 space-y-3">
          {texto && <p className="text-sm text-fg-muted">{texto}</p>}

          {perdas.length > 0 && (
            <div>
              <p className="text-sm font-medium text-fg">Isto apaga de vez:</p>
              <ul className="mt-1.5 space-y-1">
                {perdas.map((perda) => (
                  <li key={perda} className="flex gap-2 text-sm text-fg-muted">
                    <span aria-hidden className="text-danger">
                      •
                    </span>
                    <span>{perda}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {exigirTexto && (
            <div className="space-y-1.5">
              <Label htmlFor={idCampo}>
                Digite{" "}
                <span className="font-[family-name:var(--font-mono)] text-fg">
                  {exigirTexto}
                </span>{" "}
                para confirmar
              </Label>
              <Input
                id={idCampo}
                value={digitado}
                onChange={(evento) => setDigitado(evento.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
