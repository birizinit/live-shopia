"use client";

import { createContext, useContext, useId, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Abas com o teclado que o padrao WAI-ARIA pede: Tab entra no grupo uma vez so
 * (tabindex rotativo) e as setas andam entre as abas, ativando cada uma.
 *
 * O par aba/painel conversa por contexto porque os dois precisam do MESMO
 * prefixo de id para o aria-controls e o aria-labelledby fecharem — passar isso
 * a mao em 19 telas e garantia de id repetido na pagina.
 */

export type ItemAba = {
  id: string;
  rotulo: string;
  icone?: React.ComponentType<{ className?: string }>;
  contagem?: number;
  desabilitada?: boolean;
};

export type AbasProps = {
  abas: ItemAba[];
  ativa: string;
  aoMudar: (id: string) => void;
  /** Nome do conjunto para leitor de tela ("Seções do roteiro"). */
  rotulo: string;
  children?: React.ReactNode;
  className?: string;
  classNameLista?: string;
};

type ContextoAbas = { ativa: string; prefixo: string };

const Contexto = createContext<ContextoAbas | null>(null);

export function Abas({
  abas,
  ativa,
  aoMudar,
  rotulo,
  children,
  className,
  classNameLista,
}: AbasProps) {
  const prefixo = useId();
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);

  const selecionada = abas.findIndex((aba) => aba.id === ativa);
  const focavel = selecionada >= 0 ? selecionada : 0;

  function mover(de: number, passo: number) {
    const total = abas.length;
    if (total === 0) return;

    // Da a volta e pula as desabilitadas; para se todas estiverem.
    for (let salto = 1; salto <= total; salto++) {
      const alvo = (((de + passo * salto) % total) + total) % total;
      const aba = abas[alvo];
      if (aba && !aba.desabilitada) {
        aoMudar(aba.id);
        botoes.current[alvo]?.focus();
        return;
      }
    }
  }

  function aoTeclar(evento: React.KeyboardEvent<HTMLButtonElement>, indice: number) {
    if (evento.key === "ArrowRight") {
      evento.preventDefault();
      mover(indice, 1);
    } else if (evento.key === "ArrowLeft") {
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
    <Contexto.Provider value={{ ativa, prefixo }}>
      <div className={className}>
        <div
          role="tablist"
          aria-label={rotulo}
          className={cn(
            "no-scrollbar flex min-w-0 gap-1 overflow-x-auto border-b border-border",
            classNameLista,
          )}
        >
          {abas.map((aba, indice) => {
            const selecionado = aba.id === ativa;
            const Icone = aba.icone;

            return (
              <button
                key={aba.id}
                type="button"
                role="tab"
                id={`${prefixo}-aba-${aba.id}`}
                aria-controls={`${prefixo}-painel-${aba.id}`}
                aria-selected={selecionado}
                tabIndex={indice === focavel ? 0 : -1}
                disabled={aba.desabilitada}
                ref={(el) => {
                  botoes.current[indice] = el;
                }}
                onClick={() => aoMudar(aba.id)}
                onKeyDown={(evento) => aoTeclar(evento, indice)}
                className={cn(
                  "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap",
                  "transition-colors duration-[--dur-fast] disabled:pointer-events-none disabled:opacity-45",
                  selecionado
                    ? "border-primary text-primary"
                    : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {Icone && <Icone className="size-4" aria-hidden />}
                {aba.rotulo}
                {aba.contagem !== undefined && (
                  <span
                    className={cn(
                      "num rounded-full px-1.5 py-0.5 text-[11px]",
                      selecionado
                        ? "bg-primary-soft text-primary-soft-fg"
                        : "bg-bg-subtle text-fg-subtle",
                    )}
                  >
                    {aba.contagem}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {children}
      </div>
    </Contexto.Provider>
  );
}

export type PainelAbaProps = {
  /** Mesmo id da aba correspondente. */
  id: string;
  children: React.ReactNode;
  className?: string;
};

export function PainelAba({ id, children, className }: PainelAbaProps) {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error("PainelAba precisa estar dentro de <Abas>.");
  }

  const ativo = contexto.ativa === id;

  return (
    <div
      role="tabpanel"
      id={`${contexto.prefixo}-painel-${id}`}
      aria-labelledby={`${contexto.prefixo}-aba-${id}`}
      hidden={!ativo}
      // Painel sem nada focavel dentro precisa ser focavel ele mesmo, senao o
      // teclado sai da aba e pula o conteudo que ela acabou de revelar.
      tabIndex={0}
      className={ativo ? className : undefined}
    >
      {ativo && children}
    </div>
  );
}
