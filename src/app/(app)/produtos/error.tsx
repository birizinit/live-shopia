"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PackageX } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/estado-vazio";

/**
 * Erro da tela de produtos.
 *
 * Fica dentro da casca do app de proposito: o menu continua no lugar e a
 * pessoa nao precisa recarregar a aplicacao inteira para sair daqui. `reset`
 * so refaz este segmento.
 */
export default function ErroProdutos({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sem observabilidade ainda; o console e o que existe. O digest e o unico
    // fio que liga o que a pessoa viu ao que o servidor registrou.
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader titulo="Produtos" descricao="O que vai ser vendido na live." />

      <EstadoVazio
        icone={PackageX}
        titulo="Não deu para carregar seus produtos"
        texto={
          "A falha foi ao buscar o catálogo, não ao gravar: nenhum produto seu foi " +
          "alterado. Tente de novo — se insistir, é bug nosso."
        }
        acao={
          <>
            <Button onClick={reset}>Tentar de novo</Button>
            <Link
              href="/inicio"
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
            >
              Voltar ao início
            </Link>
          </>
        }
      />

      {error.digest && (
        <p className="mt-4 text-center font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
          {error.digest}
        </p>
      )}
    </>
  );
}
