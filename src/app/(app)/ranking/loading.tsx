import { Card } from "@/components/ui/card";
import { Esqueleto, RegiaoCarregando } from "@/components/ui/esqueleto";

export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando o ranking">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Esqueleto className="h-8 w-40" />
          <Esqueleto className="mt-2 h-4 w-72 max-w-full" />
        </div>
        <Esqueleto className="h-9 w-64 rounded-full" />
      </div>

      <Card className="mb-4">
        <Esqueleto className="h-4 w-28" />
        <div className="mt-5 grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i}>
              <Esqueleto className="h-3 w-16" />
              <Esqueleto className="mt-2 h-7 w-20" />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="space-y-3">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Esqueleto className="size-7 shrink-0 rounded-full" />
              <Esqueleto className="h-4 flex-1" />
              <Esqueleto className="h-4 w-12 shrink-0" />
              <Esqueleto className="h-4 w-20 shrink-0" />
            </div>
          ))}
        </div>
      </Card>
    </RegiaoCarregando>
  );
}
