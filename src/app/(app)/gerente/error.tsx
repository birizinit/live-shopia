"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";

/**
 * Erro desta tela, e não da aplicação inteira: a casca continua de pé.
 *
 * Diz o que NÃO aconteceu — nenhum convite se perdeu, nenhuma promoção foi
 * desfeita — porque numa tela que muda o papel de outra pessoa a dúvida
 * "será que promovi e deu errado?" é o que gera a ligação para o suporte.
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
      <PageHeader titulo="Gerente" />

      <Card>
        <CardTitulo>Não deu para carregar o painel do gerente</CardTitulo>
        <CardDescricao>
          Falhou a leitura. Sua equipe, os convites enviados e as comissões
          continuam como estavam: nenhum vínculo foi criado ou desfeito, e nenhum
          papel mudou por causa deste erro.
        </CardDescricao>

        {error.digest && (
          <Alerta tom="info" className="mt-4">
            Código para o suporte:{" "}
            <code className="font-[family-name:var(--font-mono)] text-xs">
              {error.digest}
            </code>
          </Alerta>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={reset}>Tentar de novo</Button>
          <Link
            href="/afiliado"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Ir para o meu painel
          </Link>
        </div>
      </Card>
    </>
  );
}
