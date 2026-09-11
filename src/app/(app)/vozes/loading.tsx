import { Card } from "@/components/ui/card";
import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * Esqueleto com o MESMO desenho da tela pronta — cabeçalho, cartão da voz
 * ativa, filtros e grade de cartões. Esqueleto com outra forma faz o conteúdo
 * "pular" quando chega, e o olho lê isso como lentidão mesmo quando não é.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando o catálogo de vozes">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <Esqueleto className="h-8 w-36" />
          <Esqueleto className="h-4 w-full max-w-md" />
        </div>
        <Esqueleto className="h-10 w-48 shrink-0" />
      </div>

      <Card className="mb-6 flex items-center gap-4">
        <Esqueleto className="size-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Esqueleto className="h-3 w-28" />
          <Esqueleto className="h-5 w-40" />
        </div>
      </Card>

      <div className="flex gap-2 border-b border-border pb-2.5">
        <Esqueleto className="h-5 w-24" />
        <Esqueleto className="h-5 w-44" />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <Esqueleto className="h-4 w-20" />
            <Esqueleto className="h-10 w-full" />
          </div>
        ))}
      </div>

      <div className="mt-3 mb-4 flex items-center justify-between gap-3">
        <Esqueleto className="h-8 w-64 rounded-full" />
        <Esqueleto className="h-4 w-24" />
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <Esqueleto className="size-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Esqueleto className="h-4 w-24" />
                <Esqueleto className="h-3 w-32" />
              </div>
            </div>

            <EsqueletoTexto linhas={2} className="mt-3" />

            <div className="mt-3 flex gap-1.5">
              <Esqueleto className="h-5 w-16 rounded-full" />
              <Esqueleto className="h-5 w-20 rounded-full" />
              <Esqueleto className="h-5 w-14 rounded-full" />
            </div>

            <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
              <Esqueleto className="h-8 w-32" />
              <Esqueleto className="h-8 w-28" />
            </div>
          </li>
        ))}
      </ul>
    </RegiaoCarregando>
  );
}
