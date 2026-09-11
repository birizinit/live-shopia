import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * O cabecalho ja e o definitivo: titulo e descricao nao dependem do banco, e
 * piscar um bloco cinza no lugar deles so faria a tela pular quando os dados
 * chegassem.
 */
export default function CarregandoPlanos() {
  return (
    <>
      <PageHeader
        titulo="Planos"
        descricao="O que cada plano libera, o estado da sua assinatura e o ciclo em curso."
      />

      <RegiaoCarregando carregando rotulo="Carregando planos e assinatura">
        <Card>
          <Esqueleto className="h-5 w-40" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Esqueleto key={i} className="h-4 w-full" />
            ))}
          </div>
        </Card>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <Card key={i}>
              <Esqueleto className="h-5 w-32" />
              <EsqueletoTexto className="mt-3" linhas={2} />
              <Esqueleto className="mt-5 h-9 w-28" />
              <Esqueleto className="mt-4 h-px w-full" />
              <EsqueletoTexto className="mt-4" linhas={4} />
              <Esqueleto className="mt-5 h-10 w-full" />
            </Card>
          ))}
        </div>

        <Card className="mt-8">
          <Esqueleto className="h-4 w-full" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Esqueleto key={i} className="h-4 w-full" />
            ))}
          </div>
        </Card>
      </RegiaoCarregando>
    </>
  );
}
