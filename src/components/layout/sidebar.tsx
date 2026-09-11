"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { NAVEGACAO, itemAtivo, visivelPara } from "@/lib/nav";
import type { Papel } from "@/lib/roles";
import { cn } from "@/lib/utils";

export function Sidebar({ papel }: { papel: Papel | null }) {
  const caminho = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh shrink-0 border-r border-border bg-surface lg:block">
      <div className="flex h-full w-[264px] flex-col">
        <div className="flex h-16 items-center px-5">
          <Link href="/inicio" aria-label="Shopia, ir para o início">
            <Logo />
          </Link>
        </div>

        <nav
          className="no-scrollbar flex-1 overflow-y-auto px-3 pb-6"
          aria-label="Navegação principal"
        >
          {NAVEGACAO.map((grupo) => {
            const itens = grupo.itens.filter((item) => visivelPara(item, papel));
            if (itens.length === 0) return null;

            return (
              <div key={grupo.titulo} className="mb-5">
                <h2 className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
                  {grupo.titulo}
                </h2>
                <ul className="space-y-0.5">
                  {itens.map((item) => {
                    const ativo = itemAtivo(item.href, caminho);
                    const Icone = item.icone;

                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={ativo ? "page" : undefined}
                          aria-disabled={item.emBreve || undefined}
                          className={cn(
                            "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-[--dur-fast]",
                            ativo
                              ? "bg-primary-soft font-medium text-primary-soft-fg"
                              : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                            item.emBreve && "pointer-events-none opacity-45",
                          )}
                        >
                          <Icone className="size-4 shrink-0" aria-hidden />
                          <span className="truncate">{item.rotulo}</span>
                          {item.emBreve && (
                            <span className="ml-auto text-[10px] font-medium tracking-wide text-fg-subtle uppercase">
                              em breve
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
