import { Card } from "@/components/ui/card";
import { Esqueleto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * O esqueleto imita o ESQUELETO da tela pronta — quatro cartões, dois painéis
 * de gráfico e a tabela. Bloco genérico no lugar errado faz o conteúdo pular
 * quando chega, que é o que o esqueleto existe para evitar.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando o dashboard de vendas">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Esqueleto className="h-8 w-64" />
          <Esqueleto className="mt-2 h-4 w-80 max-w-full" />
        </div>
        <Esqueleto className="h-9 w-64 rounded-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="flex items-start gap-3">
            <Esqueleto className="size-10 shrink-0" />
            <div className="min-w-0 flex-1">
              <Esqueleto className="h-3 w-20" />
              <Esqueleto className="mt-2 h-5 w-28" />
              <Esqueleto className="mt-2 h-3 w-24" />
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <Esqueleto className="h-4 w-40" />
          <Esqueleto className="mt-2 h-3 w-56" />
          <Esqueleto className="mt-5 h-[224px] w-full" />
        </Card>

        <Card className="lg:col-span-2">
          <Esqueleto className="h-4 w-28" />
          <Esqueleto className="mt-2 h-3 w-48" />
          <div className="mt-5 space-y-4">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i}>
                <Esqueleto className="h-3 w-40" />
                <Esqueleto className="mt-2 h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <Esqueleto className="h-4 w-36" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Esqueleto key={i} className="h-8 w-full" />
          ))}
        </div>
      </Card>
    </RegiaoCarregando>
  );
}
