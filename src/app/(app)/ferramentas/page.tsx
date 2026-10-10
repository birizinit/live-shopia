import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { FERRAMENTAS } from "@/lib/nav";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Ferramentas" };

/**
 * As telas de ajuste fino, reunidas num lugar só.
 *
 * Nada aqui é necessário para pôr a live no ar — o assistente "Criar live"
 * cuida disso. Esta página existe para quem quer mexer em um detalhe: editar
 * uma seção do roteiro, clonar a própria voz, trocar a ordem dos áudios.
 */
export default async function FerramentasPage() {
  await exigirUsuario("/ferramentas");

  return (
    <>
      <PageHeader
        titulo="Ferramentas"
        descricao="Ajustes finos para quando você quiser mexer em um detalhe."
      />

      <Link
        href="/criar"
        className="mb-6 flex items-center gap-3 rounded-lg border border-primary-border bg-primary-soft p-4 text-primary-soft-fg transition-colors duration-[--dur-fast] hover:bg-surface-hover"
      >
        <Sparkles className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">Só quer pôr a live no ar?</span> O assistente
          “Preparar live” faz produto, manual e conexão da extensão em 3 passos.
        </span>
        <ArrowRight className="size-4 shrink-0" aria-hidden />
      </Link>

      <div className="space-y-8">
        {FERRAMENTAS.map((grupo) => (
          <section key={grupo.titulo} aria-labelledby={`grupo-${grupo.titulo}`}>
            <h2 id={`grupo-${grupo.titulo}`} className="mb-3 text-sm font-semibold text-fg-muted">
              {grupo.titulo}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {grupo.itens.map((item) => {
                const Icone = item.icone;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="group flex h-full items-start gap-3 rounded-lg border border-border bg-surface p-4 transition-colors duration-[--dur-fast] hover:border-primary-border hover:bg-surface-hover"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-bg-subtle text-fg-muted group-hover:text-primary">
                        <Icone className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{item.rotulo}</span>
                        {item.descricao && (
                          <span className="mt-0.5 block text-sm text-fg-muted">{item.descricao}</span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
