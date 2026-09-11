import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/** Três colunas do console e os dois cartões de baixo, no mesmo lugar do final. */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando o painel ao vivo">
      <div className="mb-6 space-y-2">
        <Esqueleto className="h-8 w-56" />
        <Esqueleto className="h-4 w-full max-w-xl" />
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap gap-6">
            <Esqueleto className="h-10 w-28" />
            <Esqueleto className="h-10 w-24" />
            <Esqueleto className="h-10 w-24" />
            <Esqueleto className="h-10 w-20" />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((coluna) => (
            <div key={coluna} className="rounded-lg border border-border bg-surface">
              <div className="border-b border-border px-4 py-3">
                <Esqueleto className="h-4 w-32" />
                <Esqueleto className="mt-2 h-3 w-44" />
              </div>
              <div className="px-4 py-3">
                <EsqueletoTexto linhas={6} />
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
            <Esqueleto className="h-5 w-40" />
            <EsqueletoTexto className="mt-4" linhas={5} />
          </div>
          <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
            <Esqueleto className="h-5 w-52" />
            <EsqueletoTexto className="mt-4" linhas={5} />
            <Esqueleto className="mt-5 h-10 w-full rounded-md" />
          </div>
        </div>
      </div>
    </RegiaoCarregando>
  );
}
