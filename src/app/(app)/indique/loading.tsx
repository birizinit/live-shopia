import { Card } from "@/components/ui/card";
import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * O esqueleto tem a MESMA silhueta da tela pronta — cabeçalho, convite, quatro
 * tiles de saldo e duas tabelas. Esqueleto genérico faz o conteúdo pular de
 * lugar quando chega, que é a troca ruim de mostrar algo antes da hora.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando o painel de indicação">
      <Esqueleto className="mb-6 h-16 w-full" />

      <div className="mb-6 space-y-2">
        <Esqueleto className="h-8 w-64" />
        <Esqueleto className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <Esqueleto className="h-5 w-32" />
          <div className="mt-4 space-y-3">
            <Esqueleto className="h-10 w-48" />
            <Esqueleto className="h-10 w-full" />
          </div>
        </Card>
        <Card>
          <Esqueleto className="h-5 w-40" />
          <EsqueletoTexto className="mt-4" linhas={3} />
        </Card>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="flex items-start gap-3">
            <Esqueleto className="size-10 shrink-0" />
            <div className="w-full space-y-2">
              <Esqueleto className="h-3 w-20" />
              <Esqueleto className="h-5 w-28" />
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <Esqueleto className="h-5 w-44" />
        <div className="mt-4 space-y-2.5">
          {Array.from({ length: 4 }, (_, i) => (
            <Esqueleto key={i} className="h-8 w-full" />
          ))}
        </div>
      </Card>
    </RegiaoCarregando>
  );
}
