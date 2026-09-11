import Link from "next/link";
import {
  ArrowRight,
  AudioLines,
  ChartColumn,
  FileText,
  Mic,
  Moon,
  Puzzle,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { obterUsuario } from "@/lib/sessao";

const PIPELINE = [
  {
    Icone: FileText,
    titulo: "A IA escreve o roteiro",
    texto: "Gancho, oferta, prova, objeções e CTA, a partir do seu produto.",
  },
  {
    Icone: Mic,
    titulo: "A voz é sintetizada",
    texto: "Voz premium de catálogo ou a sua, clonada a partir de uma amostra.",
  },
  {
    Icone: AudioLines,
    titulo: "O áudio vira loop",
    texto: "Até 3 horas contínuas. Repetir não gasta crédito de novo.",
  },
  {
    Icone: Puzzle,
    titulo: "A extensão põe no ar",
    texto: "O áudio entra no LIVE Studio como se fosse um microfone.",
  },
] as const;

const DIFERENCIAIS = [
  {
    Icone: Moon,
    titulo: "Vende enquanto você dorme",
    texto:
      "A apresentadora narra em loop, dá boas-vindas pelo nome e responde preço, frete e cupom no chat.",
  },
  {
    Icone: ChartColumn,
    titulo: "Venda que você enxerga",
    texto:
      "Faturamento, GMV e espectadores por evento, em tempo real, com push no celular a cada venda.",
  },
] as const;

export default async function LandingPage() {
  const usuario = await obterUsuario();

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href={usuario ? "/inicio" : "/login"}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
          >
            {usuario ? "Ir para o app" : "Entrar"}
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 pt-12 pb-16 sm:pt-20 sm:pb-24">
          <p className="inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary-soft px-3 py-1 text-xs font-medium text-primary-soft-fg">
            Live commerce com IA
          </p>

          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold sm:text-6xl">
            Sua apresentadora de IA que vende ao vivo.
          </h1>

          <p className="mt-5 max-w-xl text-lg text-fg-muted">
            A Shopia escreve o roteiro, dá voz a ele e monta o áudio contínuo da
            live. Você acompanha as vendas — sem aparecer, sem narrar por horas.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={usuario ? "/inicio" : "/cadastro"}
              className="inline-flex h-12 items-center gap-2 rounded-md px-6 text-base font-medium text-white shadow-md"
              style={{ background: "var(--brand-gradient)" }}
            >
              {usuario ? "Abrir o estúdio" : "Criar conta"}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/planos"
              className="inline-flex h-12 items-center rounded-md border border-border bg-surface px-6 text-base font-medium hover:bg-surface-hover"
            >
              Ver planos
            </Link>
          </div>
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="text-2xl font-bold sm:text-3xl">Como funciona</h2>
            <p className="mt-2 max-w-xl text-fg-muted">
              Quatro etapas entre o produto cadastrado e a live no ar.
            </p>

            <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {PIPELINE.map(({ Icone, titulo, texto }, indice) => (
                <li key={titulo}>
                  <span className="grid size-10 place-items-center rounded-md bg-primary-soft text-primary-soft-fg">
                    <Icone className="size-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">
                    <span className="num mr-1.5 text-fg-subtle">
                      {String(indice + 1).padStart(2, "0")}
                    </span>
                    {titulo}
                  </h3>
                  <p className="mt-1.5 text-sm text-fg-muted">{texto}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="grid gap-6 sm:grid-cols-2">
            {DIFERENCIAIS.map(({ Icone, titulo, texto }) => (
              <div
                key={titulo}
                className="rounded-lg border border-border bg-surface p-6"
              >
                <Icone className="size-6 text-primary" aria-hidden />
                <h3 className="mt-4 text-lg font-semibold">{titulo}</h3>
                <p className="mt-1.5 text-sm text-fg-muted">{texto}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-20">
          <div
            className="rounded-xl p-8 text-white sm:p-12"
            style={{ background: "var(--brand-gradient)" }}
          >
            <h2 className="max-w-lg text-3xl font-extrabold">
              Coloque a primeira live no ar hoje.
            </h2>
            <p className="mt-3 max-w-lg text-white/80">
              Cadastre o produto, gere o roteiro e escolha a voz. O resto é a
              Shopia que faz.
            </p>
            <Link
              href={usuario ? "/inicio" : "/cadastro"}
              className="mt-7 inline-flex h-12 items-center gap-2 rounded-md bg-white px-6 text-base font-semibold text-[color:var(--green-800)]"
            >
              {usuario ? "Abrir o estúdio" : "Começar agora"}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <p>Shopia © {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
}
