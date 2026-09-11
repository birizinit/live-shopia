import { Card } from "@/components/ui/card";
import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * Vale para /roteiro e para /roteiro/[id]: o limite de suspense de um segmento
 * cobre os filhos. Por isso o desenho é o esqueleto comum das duas — cabeçalho,
 * um cartão de formulário e uma lista.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando roteiros">
      <div className="mb-6 space-y-2.5">
        <Esqueleto className="h-8 w-56" />
        <Esqueleto className="h-4 w-full max-w-lg" />
      </div>

      <Card>
        <Esqueleto className="h-5 w-40" />
        <div className="mt-3">
          <EsqueletoTexto linhas={2} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Esqueleto className="h-10" />
          <Esqueleto className="h-10" />
          <Esqueleto className="h-10" />
        </div>
      </Card>

      <div className="mt-6 space-y-3">
        <Esqueleto className="h-5 w-32" />
        {Array.from({ length: 4 }, (_, indice) => (
          <div key={indice} className="flex items-center gap-4">
            <Esqueleto className="h-4 flex-1" />
            <Esqueleto className="h-4 w-20" />
            <Esqueleto className="h-4 w-16" />
          </div>
        ))}
      </div>
    </RegiaoCarregando>
  );
}
