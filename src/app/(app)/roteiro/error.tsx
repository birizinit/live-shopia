"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Limite de erro do segmento — cobre a lista e a tela de um roteiro.
 *
 * A casca do app (menu, tema, sessão) fica de pé: quem cair aqui continua
 * navegando em vez de encarar a página de erro da raiz. O texto do erro não vai
 * para a tela de propósito: mensagem de banco costuma vazar nome de tabela e
 * não ajuda quem está do outro lado.
 */
export default function ErroRoteiro({
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
        titulo="Roteiros"
        descricao="Alguma coisa quebrou ao carregar esta tela."
      />

      <Card>
        <Alerta tom="erro">
          Não foi possível carregar os roteiros agora. Nada do que estava salvo
          se perdeu — nenhuma versão é apagada por erro de tela.
        </Alerta>

        {error.digest && (
          <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
            {error.digest}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={reset}>Tentar de novo</Button>
          <Link
            href="/roteiro"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Voltar para a lista
          </Link>
        </div>
      </Card>
    </>
  );
}
