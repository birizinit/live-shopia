"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";

/**
 * A biblioteca é só leitura: um erro aqui não perdeu trabalho nenhum, e o
 * caminho de volta é tentar de novo ou ir direto à tela dona do item. É isso
 * que a tela diz — em vez de um "algo deu errado" que não ajuda ninguém.
 */
export default function ErroBiblioteca({
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
      <PageHeader titulo="Biblioteca" descricao="Áudios e roteiros salvos num lugar só." />

      <Card className="max-w-2xl">
        <CardTitulo>Não deu para listar a biblioteca</CardTitulo>
        <CardDescricao>
          Nada foi perdido: esta tela só lê. Seus áudios e roteiros continuam salvos.
        </CardDescricao>

        <div className="mt-4 space-y-4">
          <Alerta tom="erro">
            A consulta falhou. Se insistir com o filtro atual, tente limpar o filtro —
            uma busca muito longa também pode estourar o tempo da consulta.
          </Alerta>

          {error.digest && (
            <p className="font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
              {error.digest}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={reset}>Tentar de novo</Button>
            <Link
              href="/biblioteca"
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
            >
              Abrir sem filtro
            </Link>
            <Link
              href="/estudio"
              className="inline-flex h-10 items-center rounded-md px-4 text-sm font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              Ir para o estúdio
            </Link>
          </div>
        </div>
      </Card>
    </>
  );
}
