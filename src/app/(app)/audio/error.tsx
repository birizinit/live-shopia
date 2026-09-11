"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";

/**
 * Erro desta tela, e não da aplicação inteira: a casca, o menu e a sessão
 * continuam de pé, então o caminho de saída é tentar de novo ou ir gerar áudio.
 */
export default function ErroAudio({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Ainda não há observabilidade (docs/PLANO.md): o console é o que existe.
    console.error("[audio]", error);
  }, [error]);

  return (
    <>
      <PageHeader
        titulo="Áudio da live"
        descricao="A montagem não carregou desta vez."
      />

      <Card>
        <CardTitulo>Não deu para abrir a montagem</CardTitulo>
        <CardDescricao>
          Nada foi perdido: a lista, os áudios e os créditos continuam onde estavam.
          Esta tela não gasta crédito, então tentar de novo é seguro.
        </CardDescricao>

        {error.digest && (
          <Alerta tom="info" className="mt-4">
            Código do erro:{" "}
            <span className="font-[family-name:var(--font-mono)]">{error.digest}</span>
          </Alerta>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={reset}>Tentar de novo</Button>
          <Link
            href="/estudio"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Ir para o estúdio
          </Link>
        </div>
      </Card>
    </>
  );
}
