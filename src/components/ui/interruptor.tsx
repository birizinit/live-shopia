"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Interruptor (switch).
 *
 * E um <button role="switch">, nao um checkbox repintado: switch decide um
 * estado que vale na hora ("responder o chat: ligado"), checkbox marca uma
 * escolha que so vale no envio do formulario. O leitor de tela anuncia os dois
 * de forma diferente, e o usuario age conforme o que ouviu.
 */

export type InterruptorProps = {
  ligado: boolean;
  aoMudar: (ligado: boolean) => void;
  rotulo: string;
  descricao?: string;
  desabilitado?: boolean;
  /** Esconde o rotulo visualmente; ele continua existindo para leitor de tela. */
  rotuloOculto?: boolean;
  className?: string;
};

export function Interruptor({
  ligado,
  aoMudar,
  rotulo,
  descricao,
  desabilitado,
  rotuloOculto,
  className,
}: InterruptorProps) {
  const idDescricao = useId();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-describedby={descricao ? idDescricao : undefined}
      disabled={desabilitado}
      onClick={() => aoMudar(!ligado)}
      className={cn(
        "flex items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border",
          "transition-colors duration-[--dur-fast] ease-[--ease-out]",
          ligado ? "border-transparent bg-primary" : "border-border bg-bg-subtle",
        )}
      >
        <span
          className={cn(
            "size-[18px] rounded-full bg-surface shadow-sm",
            "transition-transform duration-[--dur-fast] ease-[--ease-out]",
            ligado ? "translate-x-[23px]" : "translate-x-[3px]",
          )}
        />
      </span>

      <span className={cn("min-w-0", rotuloOculto && "sr-only")}>
        <span className="block text-sm font-medium text-fg">{rotulo}</span>
        {descricao && (
          <span id={idDescricao} className="mt-0.5 block text-xs text-fg-muted">
            {descricao}
          </span>
        )}
      </span>
    </button>
  );
}
