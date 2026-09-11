import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * O cabecalho ja e o definitivo: titulo e descricao nao dependem do banco, e
 * piscar um bloco cinza no lugar deles so faria a tela pular quando os dados
 * chegassem.
 */
export default function CarregandoCreditos() {
  return (
    <>
      <PageHeader
        titulo="Créditos"
        descricao="Saldo, para onde ele foi e quanto ele ainda dura. Tudo medido em caracteres."
      />

      <RegiaoCarregando carregando rotulo="Carregando saldo e extrato">
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <Card key={i}>
              <Esqueleto className="h-5 w-28" />
              <EsqueletoTexto className="mt-3" linhas={2} />
              <Esqueleto className="mt-5 h-10 w-44" />
              <EsqueletoTexto className="mt-4" linhas={2} />
            </Card>
          ))}
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i}>
              <Esqueleto className="h-4 w-24" />
              <Esqueleto className="mt-4 h-7 w-28" />
              <Esqueleto className="mt-2 h-3 w-32" />
              <Esqueleto className="mt-5 h-5 w-20" />
              <Esqueleto className="mt-5 h-10 w-full" />
            </Card>
          ))}
        </div>

        <Card className="mt-8">
          <Esqueleto className="h-4 w-full" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Esqueleto key={i} className="h-4 w-full" />
            ))}
          </div>
        </Card>
      </RegiaoCarregando>
    </>
  );
}
