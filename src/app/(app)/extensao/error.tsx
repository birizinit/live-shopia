"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";

/**
 * Erro desta tela, e não da casca inteira.
 *
 * A distinção importa aqui: quando esta página cai, quem já está com a extensão
 * instalada continua transmitindo — quem fala com ela é a API, não este render.
 * Dizer isso evita o telefonema de "a live vai cair?".
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
        titulo="Extensão"
        descricao="Não deu para carregar o estado da licença e das instalações."
      />

      <Card>
        <CardTitulo>Esta tela não abriu</CardTitulo>
        <CardDescricao>
          A extensão já instalada continua funcionando: ela fala com a nossa API, não
          com esta página. O que falhou foi mostrar o estado dela aqui.
        </CardDescricao>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={reset}>Tentar de novo</Button>
          <Link
            href="/inicio"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Voltar ao início
          </Link>
        </div>

        {error.digest && (
          <Alerta tom="info" className="mt-4">
            Se precisar falar com o suporte, cite este código:{" "}
            <span className="num font-[family-name:var(--font-mono)]">{error.digest}</span>
          </Alerta>
        )}
      </Card>
    </>
  );
}
