import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * O esqueleto tem a forma da tela final (formulário à esquerda, saldo e
 * recentes à direita) para o conteúdo não pular de lugar quando chegar.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando o estúdio de voz">
      <PageHeader
        titulo="Estúdio de voz"
        descricao="Transforma o roteiro em fala contínua, em blocos, com a voz da apresentadora."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="space-y-4">
          <Esqueleto className="h-5 w-40" />
          <EsqueletoTexto linhas={2} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Esqueleto className="h-16 w-full" />
            <Esqueleto className="h-16 w-full" />
          </div>
          <Esqueleto className="h-56 w-full" />
          <Esqueleto className="h-10 w-40" />
        </Card>

        <div className="space-y-4">
          <Card className="space-y-3">
            <Esqueleto className="h-4 w-24" />
            <Esqueleto className="h-9 w-32" />
            <Esqueleto className="h-9 w-full" />
          </Card>
          <Card className="space-y-2">
            <Esqueleto className="h-4 w-36" />
            {[0, 1, 2].map((i) => (
              <Esqueleto key={i} className="h-14 w-full" />
            ))}
          </Card>
        </div>
      </div>
    </RegiaoCarregando>
  );
}
