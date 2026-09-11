import { Esqueleto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * Esqueleto com a MESMA forma da lista: cabecalho, barra de busca e cartoes em
 * grade. Esqueleto que nao tem a forma do resultado empurra tudo de lugar
 * quando o dado chega, e o olho lê isso como uma segunda tela carregando.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando seus produtos">
      <div className="mb-6">
        <Esqueleto className="h-8 w-44 sm:h-10" />
        <Esqueleto className="mt-2.5 h-3.5 w-full max-w-2xl" />
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Esqueleto className="h-10 w-full sm:max-w-sm" />
        <div className="flex gap-2">
          <Esqueleto className="h-9 w-40 rounded-full" />
          <Esqueleto className="h-10 w-36" />
        </div>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <li
            key={i}
            className="rounded-lg border border-border bg-surface p-4 shadow-sm"
          >
            <div className="flex gap-3">
              <Esqueleto className="size-16 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <Esqueleto className="h-4 w-3/4" />
                <Esqueleto className="h-3.5 w-20" />
              </div>
            </div>

            <Esqueleto className="mt-3 h-3.5 w-full" />
            <Esqueleto className="mt-1.5 h-3.5 w-2/3" />

            <div className="mt-3 flex gap-1.5">
              <Esqueleto className="h-5 w-24 rounded-full" />
              <Esqueleto className="h-5 w-20 rounded-full" />
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
              <Esqueleto className="h-8 w-32" />
              <Esqueleto className="h-8 w-24" />
            </div>
          </li>
        ))}
      </ul>
    </RegiaoCarregando>
  );
}
