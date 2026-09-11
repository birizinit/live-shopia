"use client";

import { useEffect } from "react";
import { Trophy } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/estado-vazio";

export default function Erro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader titulo="Ranking" descricao="Placar de vendedores por período." />

      <EstadoVazio
        icone={Trophy}
        titulo="Não deu para montar o placar"
        texto="A consulta ao banco falhou. Tente de novo; se insistir, é bug nosso."
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
