import Link from "next/link";
import { Zap } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { numero } from "@/lib/utils";
import type { Usuario } from "@/lib/sessao";
import { MenuUsuario } from "./menu-usuario";

export function Topbar({ usuario }: { usuario: Usuario | null }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface/85 px-4 backdrop-blur lg:px-8">
      <Link href="/inicio" className="lg:hidden" aria-label="Shopia">
        <Logo comTexto={false} />
      </Link>

      <div className="ml-auto flex items-center gap-2 lg:gap-3">
        {usuario && (
          <Link
            href="/creditos"
            className="inline-flex items-center gap-1.5 rounded-full border border-primary-border bg-primary-soft px-3 py-1.5 text-xs font-medium text-primary-soft-fg transition-colors duration-[--dur-fast] hover:brightness-105"
            title="Créditos disponíveis"
          >
            <Zap className="size-3.5" aria-hidden />
            <span className="num">{numero(usuario.creditos)}</span>
            <span className="hidden sm:inline">créditos</span>
          </Link>
        )}

        <ThemeToggle />

        {usuario ? (
          <MenuUsuario
            nome={usuario.nome || usuario.usuario}
            usuario={usuario.usuario}
            papel={usuario.papel}
            plano={usuario.plano}
          />
        ) : (
          <Link
            href="/login"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
          >
            Entrar
          </Link>
        )}
      </div>
    </header>
  );
}
