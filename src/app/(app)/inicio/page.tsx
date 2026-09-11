import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Radio, Sparkles, Zap } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { exigirUsuario } from "@/lib/sessao";
import { numero } from "@/lib/utils";

export const metadata: Metadata = { title: "Início" };

/** A ordem em que uma live sai do zero. Cada passo é uma tela do estúdio. */
const PASSOS = [
  {
    href: "/produtos",
    titulo: "Cadastre o produto",
    resumo: "Nome, imagem, preço e cupom do que vai ser vendido.",
  },
  {
    href: "/roteiro",
    titulo: "Gere o roteiro",
    resumo: "Gancho, oferta, prova, objeções e CTA escritos pela IA.",
  },
  {
    href: "/vozes",
    titulo: "Escolha a voz",
    resumo: "Catálogo premium ou a sua própria voz clonada.",
  },
  {
    href: "/estudio",
    titulo: "Gere o áudio",
    resumo: "Até 3 horas de fala contínua. O loop depois é de graça.",
  },
  {
    href: "/extensao",
    titulo: "Instale a extensão",
    resumo: "É ela que joga o áudio no LIVE Studio e responde o chat.",
  },
  {
    href: "/live",
    titulo: "Suba a live",
    resumo: "A apresentadora entra no ar e as vendas começam a pingar.",
  },
] as const;

export default async function InicioPage() {
  const usuario = await exigirUsuario("/inicio");
  const primeiroNome = (usuario.nome || usuario.usuario).split(" ")[0];

  return (
    <>
      <PageHeader
        titulo={`Olá, ${primeiroNome}`}
        descricao="Monte a live em seis passos. Cada um leva alguns minutos."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-fg">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-fg-subtle">Plano</p>
            <p className="truncate font-semibold">{usuario.plano ?? "Sem plano"}</p>
          </div>
        </Card>

        <Card className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-fg">
            <Zap className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-fg-subtle">Créditos</p>
            <p className="num truncate font-semibold">{numero(usuario.creditos)}</p>
          </div>
        </Card>

        <Card className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-bg-subtle text-fg-subtle">
            <Radio className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-fg-subtle">Live</p>
            <p className="truncate font-semibold">Fora do ar</p>
          </div>
        </Card>
      </div>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Montar a live</h2>
          <Badge>0 de {PASSOS.length}</Badge>
        </div>

        <ol className="grid gap-3 sm:grid-cols-2">
          {PASSOS.map((passo, indice) => (
            <li key={passo.href}>
              <Link
                href={passo.href}
                className="group flex h-full items-start gap-3 rounded-lg border border-border bg-surface p-4 transition-colors duration-[--dur-fast] hover:border-primary-border hover:bg-surface-hover"
              >
                <span className="num grid size-7 shrink-0 place-items-center rounded-full border border-border text-xs font-semibold text-fg-subtle">
                  {indice + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{passo.titulo}</span>
                  <span className="mt-0.5 block text-sm text-fg-muted">
                    {passo.resumo}
                  </span>
                </span>
                <ArrowRight
                  className="mt-1 size-4 shrink-0 text-fg-subtle transition-transform duration-[--dur-fast] group-hover:translate-x-0.5 group-hover:text-primary"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
