import { Card } from "@/components/ui/card";
import { Esqueleto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * Esqueleto no formato do que vai chegar: cabecalho, barra de progresso e os
 * cartoes de aula em duas colunas. Bloco generico no lugar errado faz a tela
 * "pular" quando o conteudo entra.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando as aulas">
      <div className="mb-6 space-y-2">
        <Esqueleto className="h-8 w-40" />
        <Esqueleto className="h-4 w-80 max-w-full" />
      </div>

      <Card>
        <Esqueleto className="h-3.5 w-36" />
        <Esqueleto className="mt-3 h-2.5 w-full rounded-full" />
      </Card>

      {[0, 1].map((modulo) => (
        <section key={modulo} className="mt-8">
          <div className="mb-3 space-y-2">
            <Esqueleto className="h-5 w-48" />
            <Esqueleto className="h-4 w-72 max-w-full" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((aula) => (
              <div
                key={aula}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4"
              >
                <Esqueleto className="size-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Esqueleto className="h-4 w-3/4" />
                  <Esqueleto className="h-3.5 w-full" />
                  <Esqueleto className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </RegiaoCarregando>
  );
}
