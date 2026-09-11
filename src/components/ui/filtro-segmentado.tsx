"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { Periodo } from "@/lib/dados/tipos";

/**
 * Filtro de um valor entre poucos, sempre visiveis.
 *
 * E radiogroup e nao grupo de botoes: o leitor de tela precisa anunciar "opcao
 * 3 de 5, selecionada", e o teclado precisa entrar no grupo uma vez so e andar
 * com as setas (tabindex rotativo) em vez de parar em cada segmento.
 */

export type OpcaoSegmento<T extends string> = {
  valor: T;
  rotulo: string;
  /** Nome completo quando o rotulo e abreviado ("7d" -> "Ultimos 7 dias"). */
  rotuloAcessivel?: string;
};

export type FiltroSegmentadoProps<T extends string> = {
  opcoes: OpcaoSegmento<T>[];
  valor: T;
  aoMudar: (valor: T) => void;
  rotulo: string;
  className?: string;
};

export function FiltroSegmentado<T extends string>({
  opcoes,
  valor,
  aoMudar,
  rotulo,
  className,
}: FiltroSegmentadoProps<T>) {
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);

  const selecionado = opcoes.findIndex((opcao) => opcao.valor === valor);
  const focavel = selecionado >= 0 ? selecionado : 0;

  function mover(de: number, passo: number) {
    const total = opcoes.length;
    if (total === 0) return;
    const alvo = (((de + passo) % total) + total) % total;
    const opcao = opcoes[alvo];
    if (!opcao) return;
    aoMudar(opcao.valor);
    botoes.current[alvo]?.focus();
  }

  function aoTeclar(evento: React.KeyboardEvent<HTMLButtonElement>, indice: number) {
    if (evento.key === "ArrowRight" || evento.key === "ArrowDown") {
      evento.preventDefault();
      mover(indice, 1);
    } else if (evento.key === "ArrowLeft" || evento.key === "ArrowUp") {
      evento.preventDefault();
      mover(indice, -1);
    } else if (evento.key === "Home") {
      evento.preventDefault();
      mover(-1, 1);
    } else if (evento.key === "End") {
      evento.preventDefault();
      mover(0, -1);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={rotulo}
      className={cn(
        "no-scrollbar inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-surface p-0.5",
        className,
      )}
    >
      {opcoes.map((opcao, indice) => {
        const ativo = opcao.valor === valor;

        return (
          <button
            key={opcao.valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            aria-label={opcao.rotuloAcessivel}
            tabIndex={indice === focavel ? 0 : -1}
            ref={(el) => {
              botoes.current[indice] = el;
            }}
            onClick={() => aoMudar(opcao.valor)}
            onKeyDown={(evento) => aoTeclar(evento, indice)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap",
              "transition-colors duration-[--dur-fast]",
              ativo
                ? "bg-primary-soft text-primary-soft-fg"
                : "text-fg-muted hover:bg-surface-hover hover:text-fg",
            )}
          >
            {opcao.rotulo}
          </button>
        );
      })}
    </div>
  );
}

/** Os mesmos cinco periodos do tipo `Periodo`, na ordem em que se le um recorte. */
export const PERIODOS: OpcaoSegmento<Periodo>[] = [
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "ontem", rotulo: "Ontem" },
  { valor: "7d", rotulo: "7d", rotuloAcessivel: "Últimos 7 dias" },
  { valor: "30d", rotulo: "30d", rotuloAcessivel: "Últimos 30 dias" },
  { valor: "total", rotulo: "Total", rotuloAcessivel: "Desde o início" },
];

export type FiltroPeriodoProps = {
  valor: Periodo;
  aoMudar: (valor: Periodo) => void;
  className?: string;
};

export function FiltroPeriodo({ valor, aoMudar, className }: FiltroPeriodoProps) {
  return (
    <FiltroSegmentado
      opcoes={PERIODOS}
      valor={valor}
      aoMudar={aoMudar}
      rotulo="Período"
      className={className}
    />
  );
}
