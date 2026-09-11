import { Card } from "@/components/ui/card";
import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * O esqueleto tem a MESMA forma da tela pronta — cabeçalho, os três números do
 * topo, a barra de filtros e a grade de cartões. Esqueleto com outro formato
 * empurra o conteúdo quando ele chega, e o salto é pior que a espera.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando a biblioteca">
      <div className="mb-6 space-y-2">
        <Esqueleto className="h-8 w-52" />
        <Esqueleto className="h-4 w-full max-w-xl" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} className="flex items-start gap-3">
            <Esqueleto className="size-10 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <Esqueleto className="h-3 w-24" />
              <Esqueleto className="h-5 w-20" />
              <Esqueleto className="h-3 w-28" />
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-6 space-y-3 p-4">
        <Esqueleto className="h-10 w-full" />
        <div className="flex gap-2">
          <Esqueleto className="h-8 w-40 rounded-full" />
          <Esqueleto className="h-8 w-56 rounded-full" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Esqueleto className="h-10 w-full" />
          <Esqueleto className="h-10 w-full" />
        </div>
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="space-y-3 p-4">
            <div className="flex items-start gap-3">
              <Esqueleto className="size-9 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Esqueleto className="h-4 w-32" />
                <EsqueletoTexto linhas={2} />
              </div>
            </div>
            <Esqueleto className="h-12 w-full" />
            <Esqueleto className="h-8 w-28" />
          </Card>
        ))}
      </div>
    </RegiaoCarregando>
  );
}
