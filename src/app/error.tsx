"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Fase 0 não tem observabilidade ainda; o console é o que existe.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-5 text-center">
      <Logo />
      <div className="max-w-md">
        <h1 className="text-3xl font-bold">Algo quebrou aqui</h1>
        <p className="mt-2 text-fg-muted">
          O erro foi registrado. Tente de novo — se insistir, é bug nosso.
        </p>
        {error.digest && (
          <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
            {error.digest}
          </p>
        )}
      </div>
      <Button onClick={reset}>Tentar de novo</Button>
    </div>
  );
}
