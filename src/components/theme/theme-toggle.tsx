"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "./theme-provider";
import type { Theme } from "./constants";

const OPCOES: { valor: Theme; rotulo: string; Icone: typeof Sun }[] = [
  { valor: "system", rotulo: "Sistema", Icone: Monitor },
  { valor: "light", rotulo: "Claro", Icone: Sun },
  { valor: "dark", rotulo: "Escuro", Icone: Moon },
];

/** Três estados, não dois — o padrão é seguir o sistema. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5",
        className,
      )}
    >
      {OPCOES.map(({ valor, rotulo, Icone }) => {
        const ativo = theme === valor;
        return (
          <button
            key={valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            aria-label={rotulo}
            title={rotulo}
            onClick={() => setTheme(valor)}
            className={cn(
              "grid size-7 place-items-center rounded-full transition-colors duration-[--dur-fast]",
              ativo
                ? "bg-primary-soft text-primary-soft-fg"
                : "text-fg-subtle hover:bg-surface-hover hover:text-fg",
            )}
          >
            <Icone className="size-4" strokeWidth={2} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
