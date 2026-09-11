"use client";

import { useEffect } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Erro só desta tela: a casca do app (menu, tema, sessão) continua de pé, e
 * `reset` tenta renderizar de novo sem recarregar a página inteira.
 *
 * A inscrição do navegador não se perde aqui — ela vive no service worker e
 * no banco, não no estado desta página.
 */
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
      <PageHeader
        titulo="Notificações"
        descricao="Não deu para carregar as suas preferências agora."
      />

      <Card>
        <Alerta tom="erro">
          Algo quebrou ao ler os aparelhos inscritos. Nada foi alterado.
        </Alerta>

        {error.digest && (
          <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
            {error.digest}
          </p>
        )}

        <div className="mt-4">
          <Button onClick={reset}>Tentar de novo</Button>
        </div>
      </Card>
    </>
  );
}
