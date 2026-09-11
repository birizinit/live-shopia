import { cn } from "@/lib/utils";

/**
 * Esqueleto de carregamento.
 *
 * `--border` e o unico token que tem contraste suficiente nos dois temas tanto
 * sobre `--surface` quanto sobre `--bg`: `--bg-subtle` no escuro e mais escuro
 * que o card e o bloco viraria buraco.
 */

export type EsqueletoProps = React.ComponentProps<"div">;

export function Esqueleto({ className, ...props }: EsqueletoProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-md bg-border motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export type EsqueletoTextoProps = {
  linhas?: number;
  className?: string;
};

export function EsqueletoTexto({ linhas = 3, className }: EsqueletoTextoProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: linhas }, (_, i) => (
        <Esqueleto
          key={i}
          className={cn("h-3.5", i === linhas - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

export type RegiaoCarregandoProps = {
  carregando: boolean;
  /** O que esta carregando, dito em voz alta uma vez. */
  rotulo?: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * Envolve o trecho que troca de conteudo. `aria-busy` avisa o leitor de tela
 * que o que esta na tela ainda nao e o resultado — sem isso ele anuncia os
 * esqueletos como se fossem dados.
 */
export function RegiaoCarregando({
  carregando,
  rotulo = "Carregando",
  children,
  className,
}: RegiaoCarregandoProps) {
  return (
    <div aria-busy={carregando || undefined} aria-live="polite" className={className}>
      {carregando && <span className="sr-only">{rotulo}</span>}
      {children}
    </div>
  );
}
