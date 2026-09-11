"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, User as UserIcon } from "lucide-react";
import { sair } from "@/app/(auth)/actions";
import { Badge } from "@/components/ui/badge";
import type { Papel } from "@/lib/roles";
import { cn } from "@/lib/utils";

const ROTULO_PAPEL: Record<Papel, string> = {
  user: "Usuário",
  affiliate: "Afiliado PRO",
  manager: "Gerente",
  admin: "Admin",
};

export function MenuUsuario({
  nome,
  usuario,
  papel,
  plano,
}: {
  nome: string;
  usuario: string;
  papel: Papel;
  plano: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const onClick = (e: MouseEvent) => {
      if (!container.current?.contains(e.target as Node)) setAberto(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [aberto]);

  const iniciais = nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className="flex items-center gap-2 rounded-full p-0.5 pr-2 text-sm hover:bg-surface-hover"
      >
        <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-fg">
          {iniciais || "?"}
        </span>
        <span className="hidden max-w-32 truncate font-medium sm:block">{nome}</span>
        <ChevronDown
          className={cn(
            "size-4 text-fg-subtle transition-transform duration-[--dur-fast]",
            aberto && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-medium">{nome}</p>
            <p className="truncate font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
              @{usuario}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tom="marca">{ROTULO_PAPEL[papel]}</Badge>
              {plano && <Badge>{plano}</Badge>}
            </div>
          </div>

          <Link
            href="/perfil"
            role="menuitem"
            onClick={() => setAberto(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <UserIcon className="size-4" aria-hidden />
            Perfil
          </Link>

          <form action={sair}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-danger hover:bg-surface-hover"
            >
              <LogOut className="size-4" aria-hidden />
              Sair
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
