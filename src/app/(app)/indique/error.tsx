"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";

/**
 * Erro desta tela, e não da aplicação inteira: a casca (menu, tema, sessão)
 * continua de pé e dá para sair daqui sem recarregar tudo.
 *
 * O texto não promete que "já vamos corrigir" e não mostra a mensagem crua do
 * erro — mensagem de banco na tela é dica de estrutura para quem está
 * procurando. O `digest` é o que o suporte precisa para achar a linha no log.
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
      <PageHeader titulo="Indique e ganhe" />

      <Card>
        <CardTitulo>Não deu para carregar o painel de indicação</CardTitulo>
        <CardDescricao>
          Seus indicados, seu saldo e suas comissões continuam onde estavam — o
          que falhou foi esta leitura. Nada foi cobrado nem estornado por causa
          disto.
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
