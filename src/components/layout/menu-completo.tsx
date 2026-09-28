"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { X } from "lucide-react";
import { NAVEGACAO, itemAtivo, visivelPara } from "@/lib/nav";
import type { Papel } from "@/lib/roles";
import { cn } from "@/lib/utils";

/**
 * O menu "Mais" do mobile: o mesmo menu curto da barra lateral. As
 * ferramentas de ajuste fino ficam atrás de um item só ("Ferramentas"), e não
 * despejadas aqui — vinte botões numa folha é o que fazia ninguém achar nada.
 */
export function MenuCompleto({
  aberto,
  aoFechar,
  papel,
}: {
  aberto: boolean;
  aoFechar: () => void;
  papel: Papel | null;
}) {
  const caminho = usePathname();

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-50 lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
    >
      <button
        type="button"
        className="absolute inset-0"
        style={{ background: "var(--overlay)" }}
        onClick={aoFechar}
        aria-label="Fechar menu"
      />

      <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-5 py-4">
          <h2 className="text-base font-semibold">Menu</h2>
          <button
            type="button"
            onClick={aoFechar}
            className="grid size-8 place-items-center rounded-full text-fg-muted hover:bg-surface-hover"
            aria-label="Fechar"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="px-4 py-4">
          {NAVEGACAO.map((grupo) => {
            const itens = grupo.itens.filter((item) => visivelPara(item, papel));
            if (itens.length === 0) return null;

            return (
              <section key={grupo.titulo || "principal"} className="mb-5">
                {grupo.titulo && (
                  <h3 className="px-1 pb-2 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
                    {grupo.titulo}
                  </h3>
                )}
                <ul className="grid grid-cols-2 gap-2">
                  {itens.map((item) => {
                    const Icone = item.icone;
                    const ativo = itemAtivo(item, caminho);

                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={aoFechar}
                          aria-current={ativo ? "page" : undefined}
                          className={cn(
                            "flex h-full items-center gap-2.5 rounded-md border border-border px-3 py-3 text-sm",
                            ativo
                              ? "border-primary-border bg-primary-soft font-medium text-primary-soft-fg"
                              : "bg-bg text-fg-muted",
                          )}
                        >
                          <Icone className="size-4 shrink-0" aria-hidden />
                          <span className="truncate">{item.rotulo}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
