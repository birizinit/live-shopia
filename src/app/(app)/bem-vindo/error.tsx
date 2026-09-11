"use client";

import Link from "next/link";
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/estado-vazio";

/**
 * O tour quebrar nao pode virar beco sem saida: quem acabou de se cadastrar
 * precisa de um caminho para o app, mesmo sem o tour.
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
    <EstadoVazio
      icone={TriangleAlert}
      titulo="Não foi possível carregar o tour"
      texto="O conteúdo dos passos vem do banco. Tente de novo — e, se insistir, siga para o início: o tour continua aqui quando voltar."
      acao={
        <>
          <Button onClick={reset}>Tentar de novo</Button>
          <Link
            href="/inicio"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Ir para o início
          </Link>
        </>
      }
    />
  );
}
