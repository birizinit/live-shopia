import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { modoDemo } from "@/lib/env";

const ARGUMENTOS = [
  "Roteiro de vendas escrito pela IA: gancho, oferta, prova, objeções e CTA.",
  "Voz de apresentadora ultrarrealista — de catálogo ou clonada da sua.",
  "Áudio contínuo de até 3 horas; o loop não gasta crédito de novo.",
  "Vendas e GMV da live acompanhados em tempo real.",
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,520px)]">
      {/* Painel de marca — só no desktop, onde sobra espaço para ele. */}
      <aside className="relative hidden overflow-hidden p-10 lg:flex lg:flex-col lg:justify-between">
        <div
          className="absolute inset-0 -z-10"
          style={{ background: "var(--brand-gradient)" }}
          aria-hidden
        />
        <Link href="/" className="relative">
          <span className="inline-flex items-center gap-2 text-white">
            <svg viewBox="0 0 512 512" className="size-8 rounded-[10px]" aria-hidden>
              <rect width="512" height="512" rx="116" fill="rgb(255 255 255 / 0.16)" />
              <g stroke="#fff" strokeWidth="34" strokeLinecap="round" fill="none">
                <path d="M146 216v80" />
                <path d="M212 168v176" />
                <path d="M278 136v240" />
                <path d="M344 192v128" />
              </g>
            </svg>
            <span className="font-[family-name:var(--font-display)] text-xl font-bold">
              Shopia
            </span>
          </span>
        </Link>

        <div className="relative max-w-md">
          <h2 className="font-[family-name:var(--font-display)] text-4xl font-extrabold text-white">
            Sua apresentadora de IA que vende ao vivo.
          </h2>
          <ul className="mt-8 space-y-3">
            {ARGUMENTOS.map((texto) => (
              <li key={texto} className="flex gap-3 text-sm text-white/85">
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-white/70"
                  aria-hidden
                />
                {texto}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">
          Shopia © {new Date().getFullYear()}
        </p>
      </aside>

      <main className="flex flex-col bg-bg">
        <header className="flex items-center justify-between p-5">
          <Link href="/" className="lg:invisible">
            <Logo />
          </Link>
          <ThemeToggle />
        </header>

        <div className="flex flex-1 items-center justify-center px-5 pb-12">
          <div className="w-full max-w-sm">
            {modoDemo && (
              <p className="mb-6 rounded-md border border-warning bg-warning-soft px-3 py-2 text-xs text-warning">
                <strong>Modo demo.</strong> Sem Supabase configurado: qualquer
                e-mail entra. Use <code className="font-[family-name:var(--font-mono)]">demo@</code>,{" "}
                <code className="font-[family-name:var(--font-mono)]">afiliado@</code> ou{" "}
                <code className="font-[family-name:var(--font-mono)]">gerente@</code> para
                ver cada papel.
              </p>
            )}
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
