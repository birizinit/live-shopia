import { Card } from "@/components/ui/card";
import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * O esqueleto imita o formulário e os dois cartões laterais — o salto de
 * layout quando os dados chegam é o que faz a tela parecer quebrada.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando a clonagem de voz">
      <div className="mb-6 space-y-2">
        <Esqueleto className="h-8 w-64" />
        <Esqueleto className="h-4 w-full max-w-xl" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="space-y-5">
          <div className="space-y-2">
            <Esqueleto className="h-4 w-28" />
            <Esqueleto className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Esqueleto className="h-4 w-36" />
            <Esqueleto className="h-9 w-48 rounded-full" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Esqueleto className="h-10 w-full" />
            <Esqueleto className="h-10 w-full" />
          </div>
          <Esqueleto className="h-10 w-full" />
          <div className="rounded-md border border-border p-3.5">
            <EsqueletoTexto linhas={4} />
          </div>
          <Esqueleto className="h-12 w-44" />
        </Card>

        <div className="space-y-4">
          <Card className="space-y-3">
            <Esqueleto className="h-4 w-40" />
            <Esqueleto className="h-14 w-full" />
          </Card>
          <Card className="space-y-3">
            <Esqueleto className="h-4 w-44" />
            <EsqueletoTexto linhas={4} />
          </Card>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <Esqueleto className="h-6 w-48" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Esqueleto className="h-44 w-full rounded-lg" />
          <Esqueleto className="h-44 w-full rounded-lg" />
        </div>
      </div>
    </RegiaoCarregando>
  );
}
