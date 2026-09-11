import { Card } from "@/components/ui/card";
import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * Mesma silhueta da tela pronta: cabeçalho, quatro tiles de números, quatro de
 * saldo, os três cartões do saque e as tabelas. Esqueleto genérico faz o
 * conteúdo pular de lugar quando chega.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando o painel do afiliado">
      <div className="mb-6 space-y-2">
        <Esqueleto className="h-8 w-56" />
        <Esqueleto className="h-4 w-[28rem] max-w-full" />
      </div>

      {[0, 1].map((bloco) => (
        <div key={bloco} className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
      ))}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i}>
            <Esqueleto className="h-5 w-36" />
            <EsqueletoTexto className="mt-4" linhas={4} />
            <Esqueleto className="mt-4 h-10 w-full" />
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <Esqueleto className="h-5 w-48" />
        <div className="mt-4 space-y-2.5">
          {Array.from({ length: 6 }, (_, i) => (
            <Esqueleto key={i} className="h-8 w-full" />
          ))}
        </div>
      </Card>
    </RegiaoCarregando>
  );
}
