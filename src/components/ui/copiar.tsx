"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { cn } from "@/lib/utils";

/**
 * Botao de copiar com plano B.
 *
 * `navigator.clipboard` exige contexto seguro, permissao e documento em foco —
 * no WebView do app, em http e dentro de iframe ele simplesmente rejeita. Sem
 * caminho alternativo o botao diz "copiado" e nao copiou nada, que e pior do
 * que falhar. Aqui a queda e em tres degraus: API moderna, execCommand e, por
 * ultimo, o texto na tela ja selecionado para o Ctrl+C.
 */

export type BotaoCopiarProps = Omit<ButtonProps, "children" | "onClick"> & {
  texto: string;
  rotulo?: string;
  rotuloCopiado?: string;
  /** So o icone; o rotulo continua existindo para leitor de tela. */
  somenteIcone?: boolean;
  aoCopiar?: () => void;
};

type Estado = "ocioso" | "copiado" | "manual";

export function BotaoCopiar({
  texto,
  rotulo = "Copiar",
  rotuloCopiado = "Copiado!",
  somenteIcone,
  aoCopiar,
  variante = "secondary",
  tamanho = "sm",
  className,
  ...props
}: BotaoCopiarProps) {
  const [estado, setEstado] = useState<Estado>("ocioso");
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (estado !== "copiado") return;
    const relogio = setTimeout(() => setEstado("ocioso"), 2000);
    return () => clearTimeout(relogio);
  }, [estado]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setEstado("copiado");
      aoCopiar?.();
      return;
    } catch {
      /* cai para o degrau seguinte */
    }

    const el = campo.current;
    if (el) {
      const focoAnterior = document.activeElement;
      el.select();
      try {
        // Obsoleto, mas e o unico caminho quando a pagina nao esta em contexto
        // seguro. Copia a selecao do documento, entao o campo precisa existir
        // ANTES do clique — por isso ele fica sempre montado, so escondido.
        if (document.execCommand("copy")) {
          if (focoAnterior instanceof HTMLElement) focoAnterior.focus();
          setEstado("copiado");
          aoCopiar?.();
          return;
        }
      } catch {
        /* cai para o degrau seguinte */
      }
    }

    // Ultimo degrau: o campo aparece com o texto ja selecionado para o Ctrl+C.
    setEstado("manual");
  }

  const copiado = estado === "copiado";

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <Button
        variante={variante}
        tamanho={tamanho}
        onClick={copiar}
        aria-label={somenteIcone ? (copiado ? rotuloCopiado : rotulo) : undefined}
        {...props}
      >
        {copiado ? (
          <Check className="size-4 text-success" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        {!somenteIcone && <span>{copiado ? rotuloCopiado : rotulo}</span>}
      </Button>

      <input
        ref={campo}
        readOnly
        tabIndex={estado === "manual" ? 0 : -1}
        value={texto}
        aria-hidden={estado !== "manual"}
        aria-label="Selecione e copie com Ctrl+C"
        className={
          estado === "manual"
            ? "min-w-0 flex-1 rounded-md border border-warning bg-surface px-2 py-1 font-[family-name:var(--font-mono)] text-xs text-fg"
            : "sr-only"
        }
      />

      {/* Regiao presente desde o inicio: aria-live so anuncia o que muda dentro
          de um no que ja estava no DOM. */}
      <span aria-live="polite" className="sr-only">
        {copiado
          ? rotuloCopiado
          : estado === "manual"
            ? "Não foi possível copiar automaticamente. O texto está selecionado, use Ctrl+C."
            : ""}
      </span>
    </span>
  );
}
