import { Circle } from "lucide-react";
import { PageHeader } from "./layout/page-header";
import { Badge } from "./ui/badge";
import { Card, CardTitulo } from "./ui/card";
import { PAGINAS, type EspecPagina, type RotaEspecificada } from "@/lib/paginas";

const FASES: Record<number, string> = {
  1: "Núcleo de IA",
  2: "Áudio da live",
  3: "Monetização",
  4: "Dados",
  5: "Extensão",
  6: "Afiliados",
  7: "Conteúdo",
};

/**
 * Tela ainda não construída — mostrando o que ela vai ser, não um "em breve".
 * Sai daqui assim que a fase correspondente for feita.
 */
export function EmConstrucao({ rota }: { rota: RotaEspecificada }) {
  // Alarga o literal de PAGINAS para o tipo comum — sem isto, as rotas
  // sem `api` não têm a propriedade e o acesso não compila.
  const pagina: EspecPagina = PAGINAS[rota];

  return (
    <>
      <PageHeader
        titulo={pagina.titulo}
        descricao={pagina.descricao}
        acoes={
          <Badge tom="marca">
            Fase {pagina.fase} · {FASES[pagina.fase]}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardTitulo>O que esta tela vai fazer</CardTitulo>
          <ul className="mt-4 space-y-3">
            {pagina.entrega.map((item) => (
              <li key={item} className="flex gap-3 text-sm text-fg-muted">
                <Circle
                  className="mt-1 size-3.5 shrink-0 text-border-strong"
                  aria-hidden
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-4">
          {pagina.api && (
            <Card>
              <CardTitulo>Endpoints previstos</CardTitulo>
              <ul className="mt-3 space-y-1.5">
                {pagina.api.map((endpoint) => (
                  <li
                    key={endpoint}
                    className="rounded-sm bg-bg-subtle px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-xs text-fg-muted"
                  >
                    {endpoint}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="bg-bg-subtle shadow-none">
            <p className="text-sm text-fg-muted">
              A navegação, o tema e a sessão já são os definitivos. O conteúdo
              desta tela entra na fase {pagina.fase} — ver{" "}
              <code className="font-[family-name:var(--font-mono)] text-xs">
                docs/PLANO.md
              </code>
              .
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
