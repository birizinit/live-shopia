"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";

/**
 * Erro do painel.
 *
 * O aviso importa mais aqui do que em qualquer outra tela: quem abre o painel
 * costuma estar com a live rodando, e precisa saber na primeira linha que o
 * problema é da JANELA, não da transmissão — e onde fica o botão de parar de
 * verdade, caso realmente queira parar.
 */
export default function ErroPainel({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[painel]", error);
  }, [error]);

  return (
    <>
      <PageHeader titulo="Painel ao vivo" />

      <Card className="border-danger">
        <div className="flex gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger"
            aria-hidden
          >
            <TriangleAlert className="size-4" />
          </span>

          <div className="min-w-0">
            <CardTitulo>O painel não carregou — a live não parou</CardTitulo>
            <CardDescricao>
              Quem transmite é a extensão no seu navegador. Esta tela só observa,
              então a falha dela não tira nada do ar. Recarregue para voltar a
              acompanhar; se quiser realmente parar, use a sala de live.
            </CardDescricao>

            {error.digest && (
              <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
                {error.digest}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={reset}>Tentar de novo</Button>
              <Link
                href="/live"
                className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
              >
                Ir para a sala de live
              </Link>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
