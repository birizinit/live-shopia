"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";

/**
 * Erro só desta tela: a casca do app (menu, tema, sessão) continua de pé, e
 * quem chegou aqui querendo clonar uma voz sai com um caminho, não com uma
 * página em branco.
 */
export default function ErroClonagem({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[clonar]", error);
  }, [error]);

  return (
    <>
      <PageHeader
        titulo="Clonagem de voz"
        descricao="Alguma coisa quebrou ao carregar esta tela."
      />

      <Card className="max-w-xl">
        <CardTitulo className="flex items-center gap-2">
          <TriangleAlert className="size-4 text-danger" aria-hidden />
          Não deu para abrir a clonagem
        </CardTitulo>
        <CardDescricao>
          Nenhuma amostra foi perdida: o que já estava enviado continua na fila e
          o consentimento registrado permanece guardado. Tente de novo — se
          insistir, é bug nosso.
        </CardDescricao>

        {error.digest && (
          <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
            {error.digest}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={reset}>Tentar de novo</Button>
          <Link
            href="/vozes"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Ir para as vozes
          </Link>
        </div>
      </Card>
    </>
  );
}
