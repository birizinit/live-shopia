import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { modoDemo } from "@/lib/env";

const ARGUMENTOS = [
  "Responde o chat com as suas respostas — marcando a pessoa, no tempo que você escolher.",
  "Fixa o produto, avisa quem pôs no carrinho e cada venda no seu celular.",
  "Encerra a live no horário ou ao primeiro aviso de violação do TikTok.",
  "Só o Chrome: nada para instalar no computador.",
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,520px)]">
      {/* Painel de marca — só no desktop, onde sobra espaço para ele. */}
      <aside className="relative hidden overflow-hidden p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 -z-10 bg-[#121212]" aria-hidden />
        <div
          className="absolute -top-32 -left-24 -z-10 size-[420px] rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, #25F4EE 0%, transparent 65%)" }}
          aria-hidden
        />
        <div
          className="absolute -right-24 -bottom-32 -z-10 size-[460px] rounded-full opacity-45 blur-3xl"
          style={{ background: "radial-gradient(circle, #FE2C55 0%, transparent 65%)" }}
          aria-hidden
        />
        <Link href="/" className="relative inline-flex items-center gap-2 text-white">
          <Logo comTexto={false} className="[&_svg]:size-8" />
          <span className="text-xl font-bold">Shopia</span>
        </Link>

        <div className="relative max-w-md">
          <h2 className="font-[family-name:var(--font-display)] text-4xl font-extrabold text-white">
            Quem responde o chat da sua live.
          </h2>
          <ul className="mt-8 space-y-3">
            {ARGUMENTOS.map((texto) => (
              <li key={texto} className="flex gap-3 text-sm text-white/85">
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#FE2C55]"
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
                <strong>Modo demo.</strong> Sem banco configurado: qualquer
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
