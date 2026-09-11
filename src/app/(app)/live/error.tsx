"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";

/**
 * Erro da sala de live.
 *
 * A mensagem diz o que continua valendo: uma falha ao MONTAR a tela não tira do
 * ar uma live que já está rodando — quem transmite é a extensão, no navegador,
 * e ela não depende desta página estar aberta.
 */
export default function ErroLive({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[live]", error);
  }, [error]);

  return (
    <>
      <PageHeader titulo="Live IA" />

      <Card className="border-danger">
        <div className="flex gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger"
            aria-hidden
          >
            <TriangleAlert className="size-4" />
          </span>

          <div className="min-w-0">
            <CardTitulo>Não foi possível carregar a sala de live</CardTitulo>
            <CardDescricao>
              Se a sua live já estava no ar, ela continua: quem transmite é a
              extensão no seu navegador, não esta tela. Recarregue para voltar ao
              controle.
            </CardDescricao>

            {error.digest && (
              <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
                {error.digest}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={reset}>Tentar de novo</Button>
              <Link
                href="/painel"
                className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
              >
                Abrir o painel ao vivo
              </Link>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
