"use client";

import { useEffect } from "react";
import { ChartColumn } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/estado-vazio";

/**
 * Erro da rota, não da aplicação inteira: a casca, o menu e a sessão continuam
 * de pé, e o usuário tenta de novo sem perder onde estava.
 */
export default function Erro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Ainda não há observabilidade (fase 0); o console é o que existe.
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader
        titulo="Dashboard de vendas"
        descricao="Faturamento, GMV e audiência da live."
      />

      <EstadoVazio
        icone={ChartColumn}
        titulo="Não deu para carregar as vendas"
        texto="A consulta ao banco falhou. Nenhum dado foi perdido — o painel só lê. Tente de novo; se insistir, é bug nosso."
        acao={
          <>
            <Button onClick={reset}>Tentar de novo</Button>
            {error.digest && (
              <span className="self-center font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
                {error.digest}
              </span>
            )}
          </>
        }
      />
    </>
  );
}
