import { Card } from "@/components/ui/card";
import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/** O esqueleto imita o tour: barra, trilha de passos e o corpo do texto. */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando o tour de boas-vindas">
      <div className="mb-6">
        <Esqueleto className="h-8 w-64" />
        <Esqueleto className="mt-3 h-4 w-full max-w-xl" />
      </div>

      <Card className="p-0">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <Esqueleto className="h-1.5 w-full rounded-full" />
          <div className="mt-3 flex gap-1.5">
            {Array.from({ length: 6 }, (_, i) => (
              <Esqueleto key={i} className="size-8 rounded-full" />
            ))}
          </div>
        </div>

        <div className="px-5 py-6 sm:px-6">
          <Esqueleto className="h-6 w-2/3" />
          <EsqueletoTexto linhas={5} className="mt-4 max-w-2xl" />
        </div>

        <div className="flex justify-between border-t border-border bg-bg-subtle px-5 py-4 sm:px-6">
          <Esqueleto className="h-5 w-24" />
          <div className="flex gap-2">
            <Esqueleto className="h-10 w-28" />
            <Esqueleto className="h-10 w-28" />
          </div>
        </div>
      </Card>
    </RegiaoCarregando>
  );
}
