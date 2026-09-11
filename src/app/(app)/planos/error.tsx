"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";

/**
 * Erro desta tela, dentro da casca do app — o usuario continua com menu e
 * sessao, em vez de cair na pagina de erro de tela cheia.
 *
 * A mensagem do erro nao e exibida de proposito: em producao o Next so entrega
 * o `digest`, e inventar um texto explicativo daria diagnostico errado. O que
 * vale dizer com certeza e o que NAO aconteceu — nenhuma cobranca foi aberta.
 */
export default function ErroPlanos({
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
      <PageHeader titulo="Planos" />

      <Card>
        <CardTitulo>Não deu para carregar os planos</CardTitulo>
        <CardDescricao>
          O catálogo e o estado da sua assinatura vêm do banco, e a leitura
          falhou agora.
        </CardDescricao>

        <Alerta tom="info" className="mt-4">
          Nenhuma cobrança foi aberta e a sua assinatura não mudou. Este erro é
          de leitura.
        </Alerta>

        {error.digest && (
          <p className="mt-4 font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
            {error.digest}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={reset}>Tentar de novo</Button>
          <Link
            href="/inicio"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Voltar ao início
          </Link>
        </div>
      </Card>
    </>
  );
}
