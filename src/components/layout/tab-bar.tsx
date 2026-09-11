"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { ABAS_MOBILE, itemAtivo } from "@/lib/nav";
import type { Papel } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { MenuCompleto } from "./menu-completo";

export function TabBar({ papel }: { papel: Papel | null }) {
  const caminho = usePathname();
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Navegação"
      >
        <ul className="flex items-stretch">
          {ABAS_MOBILE.map((item) => {
            const ativo = itemAtivo(item.href, caminho);
            const Icone = item.icone;

            if (item.destaque) {
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={ativo ? "page" : undefined}
                    className="flex flex-col items-center pt-1.5 pb-2"
                  >
                    <span
                      className={cn(
                        "grid size-11 -translate-y-3 place-items-center rounded-full bg-primary text-primary-fg shadow-md transition-opacity duration-[--dur-fast]",
                        ativo ? "opacity-100" : "opacity-90",
                      )}
                    >
                      <Icone className="size-5" aria-hidden />
                    </span>
                    <span
                      className={cn(
                        "-mt-2 text-[10px] font-medium",
                        ativo ? "text-primary" : "text-fg-subtle",
                      )}
                    >
                      {item.rotulo}
                    </span>
                  </Link>
                </li>
              );
            }

            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={ativo ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors duration-[--dur-fast]",
                    ativo ? "text-primary" : "text-fg-subtle",
                  )}
                >
                  <Icone className="size-5" aria-hidden />
                  {item.rotulo}
                </Link>
              </li>
            );
          })}

          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMenuAberto(true)}
              aria-haspopup="dialog"
              aria-expanded={menuAberto}
              className="flex w-full flex-col items-center gap-1 py-2 text-[10px] font-medium text-fg-subtle"
            >
              <Menu className="size-5" aria-hidden />
              Mais
            </button>
          </li>
        </ul>
      </nav>

      <MenuCompleto
        aberto={menuAberto}
        aoFechar={() => setMenuAberto(false)}
        papel={papel}
      />
    </>
  );
}
