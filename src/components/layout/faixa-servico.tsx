import { FlaskConical } from "lucide-react";
import { modoDemo } from "@/lib/env";

/**
 * Faixa do modo demonstração: a sessão é falsa e nada é salvo, e quem está na
 * tela precisa saber disso antes de contar com qualquer coisa.
 *
 * "Compra desligada" saiu daqui: Planos e Créditos já dizem isso no lugar
 * certo, e nas outras telas era uma tarja permanente sobre algo que a pessoa
 * não estava tentando fazer.
 */
export function FaixaServico() {
  if (!modoDemo) return null;
  return (
    <div role="status" className="flex items-center gap-2.5 border-b border-border bg-warning-soft px-4 py-2 text-xs lg:px-8">
      <FlaskConical className="size-3.5 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1 text-fg-muted">
        <span className="font-semibold text-fg">Modo demonstração.</span> A sessão é falsa e os dados são de
        exemplo. Nada do que você fizer aqui é salvo.
      </p>
    </div>
  );
}
