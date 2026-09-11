import { Card } from "@/components/ui/card";
import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * O esqueleto copia a forma da tela pronta (aviso de crédito, lista, coluna de
 * cobertura). Esqueleto que não tem a forma do que vem depois faz o conteúdo
 * "pular" quando chega, e o pulo custa mais atenção do que a espera.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando a montagem da live">
      <div className="mb-6">
        <Esqueleto className="h-8 w-56 sm:h-9" />
        <Esqueleto className="mt-2 h-4 w-full max-w-2xl" />
      </div>

      <div className="space-y-4">
        <Card>
          <div className="flex gap-4">
            <Esqueleto className="size-10 shrink-0" />
            <div className="min-w-0 flex-1">
              <Esqueleto className="h-5 w-72 max-w-full" />
              <EsqueletoTexto className="mt-2" linhas={2} />
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((coluna) => (
                  <Esqueleto key={coluna} className="h-20" />
                ))}
              </div>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
          <div className="space-y-4">
            <Card>
              <Esqueleto className="h-5 w-48" />
              <Esqueleto className="mt-3 h-10 w-full max-w-md" />
              <div className="mt-4 space-y-2">
                {[0, 1, 2].map((linha) => (
                  <Esqueleto key={linha} className="h-16" />
                ))}
              </div>
            </Card>

            <Card>
              <Esqueleto className="h-5 w-40" />
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                {[0, 1, 2, 3].map((campo) => (
                  <Esqueleto key={campo} className="h-16" />
                ))}
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <Esqueleto className="h-5 w-44" />
              <Esqueleto className="mt-4 h-2.5 w-full" />
              <EsqueletoTexto className="mt-4" linhas={4} />
            </Card>
            <Card>
              <Esqueleto className="h-5 w-24" />
              <Esqueleto className="mt-4 h-10 w-full" />
            </Card>
          </div>
        </div>
      </div>
    </RegiaoCarregando>
  );
}
