import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  MessagesSquare,
  Puzzle,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { obterUsuario } from "@/lib/sessao";

const PIPELINE = [
  {
    Icone: ShoppingBag,
    titulo: "Você cadastra o produto",
    texto: "Nome, preço, cupom e prazo — o que a audiência pergunta em toda live.",
  },
  {
    Icone: BookOpenCheck,
    titulo: "Escreve o manual",
    texto:
      "Cada linha é uma pergunta, as palavras que a disparam e a resposta no seu jeito de falar.",
  },
  {
    Icone: Puzzle,
    titulo: "Liga a extensão no Chrome",
    texto: "Só o navegador: nada para instalar no sistema operacional.",
  },
  {
    Icone: MessagesSquare,
    titulo: "Ela assume o chat",
    texto: "Responde, chama quem entra pelo nome e fixa o produto na tela.",
  },
] as const;

const DIFERENCIAIS = [
  {
    Icone: BadgeCheck,
    titulo: "Não inventa resposta",
    texto:
      "A Shopia devolve o que está no seu manual, palavra por palavra. Pergunta que não está lá ela deixa passar em silêncio — e anota, para você cadastrar antes da próxima live.",
  },
  {
    Icone: ShieldCheck,
    titulo: "Cuida da sua conta",
    texto:
      "Antes de subir, ela revisa o manual e aponta as frases que costumam fazer o TikTok restringir a live. No chat, responde com espera sorteada e teto por minuto — rajada de resposta idêntica é a assinatura mais óbvia de automação.",
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
            Moderação de live com IA
          </p>

          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold sm:text-6xl">
            A Shopia responde o chat da sua live.
          </h1>

          <p className="mt-5 max-w-xl text-lg text-fg-muted">
            Você escreve as respostas uma vez, no manual do produto. Na live, quem
            pergunta preço, frete ou cupom recebe o que você escreveu — na hora, e
            sem você digitar.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={usuario ? "/inicio" : "/cadastro"}
              className="inline-flex h-12 items-center gap-2 rounded-md px-6 text-base font-medium text-white shadow-md"
              style={{ background: "var(--brand-gradient)" }}
            >
              {usuario ? "Abrir o app" : "Criar conta"}
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
              Quatro etapas entre o produto cadastrado e a Shopia respondendo no
              chat.
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
              Deixe a Shopia cuidar do chat da próxima live.
            </h2>
            <p className="mt-3 max-w-lg text-white/80">
              Cadastre o produto, escreva as respostas e ligue a extensão. O chat
              passa a ser dela.
            </p>
            <Link
              href={usuario ? "/inicio" : "/cadastro"}
              className="mt-7 inline-flex h-12 items-center gap-2 rounded-md bg-white px-6 text-base font-semibold text-[color:var(--green-800)]"
            >
              {usuario ? "Abrir o app" : "Começar agora"}
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
