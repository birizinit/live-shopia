import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * O esqueleto imita o layout final — cabeçalho, coluna principal e a coluna do
 * checklist. Bloco genérico no meio da tela faria o conteúdo saltar de lugar na
 * troca, que é o mesmo desconforto de não ter carregamento nenhum.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando a sala de live">
      <div className="mb-6 space-y-2">
        <Esqueleto className="h-8 w-48" />
        <Esqueleto className="h-4 w-full max-w-lg" />
      </div>

      <div className="space-y-4">
        <Esqueleto className="h-24 w-full rounded-lg" />

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-4">
            <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
              <Esqueleto className="h-5 w-40" />
              <EsqueletoTexto className="mt-4" linhas={4} />
              <Esqueleto className="mt-5 h-12 w-full rounded-md" />
            </div>

            <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
              <Esqueleto className="h-5 w-44" />
              <EsqueletoTexto className="mt-4" linhas={3} />
            </div>

            <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
              <Esqueleto className="h-5 w-56" />
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Esqueleto className="h-10" />
                <Esqueleto className="h-10" />
                <Esqueleto className="h-10" />
              </div>
              <Esqueleto className="mt-4 h-28 w-full rounded-lg" />
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
              <Esqueleto className="h-5 w-32" />
              <EsqueletoTexto className="mt-4" linhas={6} />
            </div>
            <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
              <Esqueleto className="h-5 w-24" />
              <EsqueletoTexto className="mt-4" linhas={3} />
            </div>
          </div>
        </div>
      </div>
    </RegiaoCarregando>
  );
}
