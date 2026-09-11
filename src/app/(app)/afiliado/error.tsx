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
 * O texto diz explicitamente que dinheiro nenhum se moveu. Numa tela de saldo e
 * saque, "algo deu errado" sem essa frase deixa a pessoa achando que perdeu
 * comissão — e o suporte recebe a ligação.
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
      <PageHeader titulo="Afiliado PRO" />

      <Card>
        <CardTitulo>Não deu para carregar o painel do afiliado</CardTitulo>
        <CardDescricao>
          Falhou a leitura, não o dinheiro. Seu saldo, suas comissões e qualquer
          pedido de saque em análise continuam exatamente como estavam: nada foi
          debitado, liberado ou pago por causa deste erro.
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
            href="/indique"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Ir para Indique e ganhe
          </Link>
        </div>
      </Card>
    </>
  );
}
