import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Onde a pessoa está no caminho. Três passos: o que vender, o que a Shopia
 * sabe responder sobre isso, e ligar na live. O resto é consequência.
 */

const PASSOS = ["O que vender", "O manual", "Ligar na live"] as const;

export function Passos({ atual }: { atual: 1 | 2 | 3 }) {
  return (
    <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Passos para criar a live">
      {PASSOS.map((rotulo, indice) => {
        const numero = indice + 1;
        const feito = numero < atual;
        const agora = numero === atual;

        return (
          <li
            key={rotulo}
            aria-current={agora ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-xs sm:text-sm",
              agora && "border-primary-border bg-primary-soft font-semibold text-primary-soft-fg",
              feito && "border-border bg-surface text-fg-muted",
              !agora && !feito && "border-dashed border-border text-fg-subtle",
            )}
          >
            <span
              className={cn(
                "num grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                agora && "bg-primary text-primary-fg",
                feito && "bg-success-soft text-success",
                !agora && !feito && "border border-border",
              )}
              aria-hidden
            >
              {feito ? <Check className="size-3" /> : numero}
            </span>
            <span className="min-w-0 truncate">{rotulo}</span>
          </li>
        );
      })}
    </ol>
  );
}
