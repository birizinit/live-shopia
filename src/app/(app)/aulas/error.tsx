"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Erro das aulas. Fica dentro da casca do app de proposito: a barra lateral e o
 * menu continuam a mao, entao quem caiu aqui tem para onde ir sem voltar no
 * navegador.
 */
export default function ErroAulas({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Fase 7 ainda nao tem observabilidade; o console e o que existe.
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader
        titulo="Aulas"
        descricao="O passo a passo em vídeo: do cadastro do produto até a live no ar."
      />

      <Card>
        <Alerta tom="erro">
          Não deu para carregar o catálogo de aulas. O vídeo é do YouTube, mas a
          lista e o seu progresso vêm do nosso banco — e foi essa parte que
          falhou.
        </Alerta>

        {error.digest && (
          <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
            {error.digest}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={reset}>Tentar de novo</Button>
          <Link
            href="/inicio"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Voltar para o início
          </Link>
        </div>
      </Card>
    </>
  );
}
