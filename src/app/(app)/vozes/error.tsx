"use client";

import { useEffect } from "react";
import Link from "next/link";
import { MicOff } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/estado-vazio";

/**
 * Erro da tela de vozes, dentro da casca do app.
 *
 * Fica no escopo da rota, e não no `error.tsx` da raiz, para que o menu, o tema
 * e a sessão continuem em pé: quem tomou o erro escolhendo uma voz precisa
 * conseguir ir para outro lugar sem recarregar o app inteiro.
 */
export default function ErroVozes({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Fase 1 ainda não tem observabilidade; o console é o que existe.
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader titulo="Vozes" descricao="O catálogo não carregou desta vez." />

      <EstadoVazio
        icone={MicOff}
        titulo="Não deu para ler as vozes"
        texto="Pode ter sido o banco ou o provedor de voz. Tentar de novo costuma resolver — se insistir, é bug nosso."
        acao={
          <>
            <Button onClick={reset}>Tentar de novo</Button>
            <Link
              href="/inicio"
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium transition-colors duration-[--dur-fast] hover:bg-surface-hover"
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
