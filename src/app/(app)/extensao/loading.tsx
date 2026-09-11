import { Esqueleto, EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";

/**
 * Esqueleto com a MESMA silhueta da tela pronta: cabeçalho, duas colunas e os
 * quatro cartões da esquerda. Esqueleto de forma diferente faz o conteúdo
 * pular quando chega, e o olho lê o salto como se a página tivesse recarregado.
 */
export default function Carregando() {
  return (
    <RegiaoCarregando carregando rotulo="Carregando a extensão">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <Esqueleto className="h-8 w-48" />
          <Esqueleto className="mt-2.5 h-4 w-full max-w-xl" />
        </div>
        <Esqueleto className="h-6 w-24 rounded-full" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-4">
          <Cartao linhas={6} />
          <Cartao linhas={5} />
          <Cartao linhas={4} />
        </div>
        <div className="space-y-4">
          <Cartao linhas={3} />
          <Cartao linhas={2} />
        </div>
      </div>
    </RegiaoCarregando>
  );
}

function Cartao({ linhas }: { linhas: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-sm sm:p-6">
      <Esqueleto className="h-5 w-40" />
      <EsqueletoTexto linhas={linhas} className="mt-4" />
    </div>
  );
}
