"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modal sobre <dialog> nativo.
 *
 * O elemento nativo ja entrega o que uma implementacao manual costuma errar:
 * prisao de foco, camada de topo acima de qualquer z-index e Esc. O que sobra
 * para nos e manter o DOM em sincronia com o estado do React e devolver o foco
 * para quem abriu.
 *
 * O fundo escuro e uma div dentro do dialogo, e nao "::backdrop": o pseudo so
 * herda variavel do elemento de origem em navegador recente, e var(--overlay)
 * sairia transparente nos outros.
 */

export type TamanhoModal = "sm" | "md" | "lg";

const LARGURAS: Record<TamanhoModal, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export type ModalProps = {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao?: string;
  children?: React.ReactNode;
  rodape?: React.ReactNode;
  tamanho?: TamanhoModal;
  /** Esconde o X e ignora clique no fundo: operacao que nao pode ser abandonada no meio. */
  travado?: boolean;
  className?: string;
};

export function Modal({
  aberto,
  aoFechar,
  titulo,
  descricao,
  children,
  rodape,
  tamanho = "md",
  travado,
  className,
}: ModalProps) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const abridor = useRef<Element | null>(null);
  const fundoRecebeuPonteiro = useRef(false);
  const idTitulo = useId();
  const idDescricao = useId();

  useEffect(() => {
    const el = dialogo.current;
    if (!el) return;

    if (aberto) {
      if (!el.open) {
        // Guardado ANTES de abrir: showModal joga o foco para dentro, e e para
        // este elemento que ele precisa voltar no fechamento.
        abridor.current = document.activeElement;
        el.showModal();
      }
      // O dialogo nativo nao trava a rolagem do fundo em nenhum navegador.
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }

    if (el.open) el.close();

    const alvo = abridor.current;
    // So devolve o foco se ninguem mais o tomou: fechar um modal as vezes
    // coloca outro campo em cena, e roubar o foco dele seria pior.
    if (alvo instanceof HTMLElement && document.activeElement === document.body) {
      alvo.focus();
    }
  }, [aberto]);

  return (
    <dialog
      ref={dialogo}
      aria-labelledby={idTitulo}
      aria-describedby={descricao ? idDescricao : undefined}
      onCancel={(evento) => {
        // Sem o preventDefault o Esc fecha o elemento por fora do React e
        // "aberto" fica true com o modal invisivel: o proximo clique no botao
        // que abre nao faz mais nada.
        evento.preventDefault();
        if (!travado) aoFechar();
      }}
      onClose={() => {
        if (aberto) aoFechar();
      }}
      className="fixed inset-0 m-0 h-full max-h-full w-full max-w-full bg-transparent p-0 text-fg [&::backdrop]:bg-transparent"
    >
      {aberto && (
        <div
          className="flex h-full w-full items-center justify-center overflow-y-auto p-4"
          style={{ background: "var(--overlay)" }}
          onPointerDown={(evento) => {
            // Arrastar de dentro para fora dispara clique no fundo. So conta
            // como clique no fundo o que comecou nele.
            fundoRecebeuPonteiro.current = evento.target === evento.currentTarget;
          }}
          onClick={(evento) => {
            if (travado) return;
            if (fundoRecebeuPonteiro.current && evento.target === evento.currentTarget) {
              aoFechar();
            }
          }}
        >
          <div
            className={cn(
              "flex max-h-[85dvh] w-full flex-col rounded-lg border border-border bg-surface-raised shadow-lg",
              LARGURAS[tamanho],
              className,
            )}
          >
            <div className="flex items-start gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 id={idTitulo} className="text-base font-semibold text-fg">
                  {titulo}
                </h2>
                {descricao && (
                  <p id={idDescricao} className="mt-1 text-sm text-fg-muted">
                    {descricao}
                  </p>
                )}
              </div>
              {!travado && (
                <button
                  type="button"
                  onClick={aoFechar}
                  aria-label="Fechar"
                  className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-full text-fg-muted transition-colors duration-[--dur-fast] hover:bg-surface-hover hover:text-fg"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>

            {children && (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm text-fg">
                {children}
              </div>
            )}

            {rodape && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4">
                {rodape}
              </div>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
