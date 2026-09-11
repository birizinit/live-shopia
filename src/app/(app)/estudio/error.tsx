"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";

/**
 * Erro do estúdio.
 *
 * A mensagem diz o que aconteceu com o dinheiro, porque é a primeira pergunta
 * de quem estava gerando: o débito e o enfileiramento acontecem no mesmo
 * commit (função debitar_e_enfileirar), então uma tela que quebrou ou não
 * cobrou nada, ou cobrou e o trabalho existe — nunca cobrou por nada.
 */
export default function ErroEstudio({
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
      <PageHeader titulo="Estúdio de voz" />

      <Card>
        <CardTitulo>Não deu para abrir o estúdio</CardTitulo>
        <CardDescricao>
          Nada foi cobrado por esta tentativa. Se você já tinha confirmado uma geração,
          ela continua na fila e aparece na lista de áudios recentes quando terminar.
        </CardDescricao>

        {error.digest && (
          <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
            {error.digest}
          </p>
        )}

        <Alerta tom="info" className="mt-4">
          Seus créditos e seus áudios ficam no servidor, não nesta página.
        </Alerta>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={reset}>Tentar de novo</Button>
          <Link
            href="/biblioteca"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Ver a biblioteca
          </Link>
        </div>
      </Card>
    </>
  );
}
