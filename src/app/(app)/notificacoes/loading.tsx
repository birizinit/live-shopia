import { Card } from "@/components/ui/card";
import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * Esqueleto no formato da tela pronta — mesmo cabeçalho, mesmos três cartões.
 * Esqueleto de outro formato move o conteúdo quando os dados chegam.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando as notificações">
      <div className="mb-6 space-y-3">
        <Esqueleto className="h-8 w-56 sm:h-10" />
        <Esqueleto className="h-4 w-full max-w-2xl" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Esqueleto className="h-5 w-40" />
          <EsqueletoTexto className="mt-3" linhas={2} />
          <Esqueleto className="mt-5 h-10 w-56" />
        </Card>

        <Card>
          <Esqueleto className="h-5 w-44" />
          <EsqueletoTexto className="mt-3" linhas={1} />
          <div className="mt-5 space-y-4">
            {[0, 1, 2].map((linha) => (
              <div key={linha} className="flex items-center gap-3">
                <Esqueleto className="h-6 w-11 rounded-full" />
                <Esqueleto className="h-4 w-48" />
              </div>
            ))}
          </div>
          <Esqueleto className="mt-5 h-10 w-44" />
        </Card>

        <Card className="lg:col-span-2">
          <Esqueleto className="h-5 w-48" />
          <EsqueletoTexto className="mt-3" linhas={2} />
          <div className="mt-4 space-y-3">
            {[0, 1].map((linha) => (
              <Esqueleto key={linha} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      </div>
    </RegiaoCarregando>
  );
}
