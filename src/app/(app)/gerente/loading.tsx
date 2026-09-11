import { Card } from "@/components/ui/card";
import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/** Mesma silhueta da tela pronta, para o conteúdo não pular quando chegar. */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando o painel do gerente">
      <div className="mb-6 space-y-2">
        <Esqueleto className="h-8 w-40" />
        <Esqueleto className="h-4 w-[30rem] max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="flex items-start gap-3">
            <Esqueleto className="size-10 shrink-0" />
            <div className="w-full space-y-2">
              <Esqueleto className="h-3 w-24" />
              <Esqueleto className="h-5 w-28" />
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <Esqueleto className="h-5 w-52" />
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Esqueleto key={i} className="h-7 w-full" />
            ))}
          </div>
        </Card>
        <Card>
          <Esqueleto className="h-5 w-48" />
          <EsqueletoTexto className="mt-3" linhas={3} />
          <Esqueleto className="mt-4 h-10 w-full" />
          <Esqueleto className="mt-3 h-20 w-full" />
        </Card>
      </div>

      {[0, 1].map((bloco) => (
        <Card key={bloco} className="mt-6">
          <Esqueleto className="h-5 w-32" />
          <div className="mt-4 space-y-2.5">
            {Array.from({ length: 4 }, (_, i) => (
              <Esqueleto key={i} className="h-8 w-full" />
            ))}
          </div>
        </Card>
      ))}
    </RegiaoCarregando>
  );
}
