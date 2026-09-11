import { cn } from "@/lib/utils";

export type TomBarra = "primaria" | "sucesso" | "alerta" | "perigo";

const TONS: Record<TomBarra, string> = {
  primaria: "bg-primary",
  sucesso: "bg-success",
  alerta: "bg-warning",
  perigo: "bg-danger",
};

export type BarraProgressoProps = {
  valor: number;
  maximo?: number;
  /** Obrigatorio: barra sem nome nao diz o que esta progredindo. */
  rotulo: string;
  rotuloVisivel?: boolean;
  /** Texto a direita. Ausente, mostra a porcentagem. */
  textoValor?: string;
  mostrarValor?: boolean;
  tom?: TomBarra;
  tamanho?: "sm" | "md";
  className?: string;
};

/**
 * A trilha usa `--border` porque e o unico token com contraste suficiente tanto
 * sobre `--surface` quanto sobre `--bg` nos dois temas.
 */
export function BarraProgresso({
  valor,
  maximo = 100,
  rotulo,
  rotuloVisivel,
  textoValor,
  mostrarValor = true,
  tom = "primaria",
  tamanho = "md",
  className,
}: BarraProgressoProps) {
  const teto = maximo > 0 ? maximo : 1;
  const preso = Math.min(Math.max(valor, 0), teto);
  const porcento = Math.round((preso / teto) * 100);
  const texto = textoValor ?? `${porcento}%`;

  return (
    <div className={className}>
      {(rotuloVisivel || mostrarValor) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
          <span className={cn("font-medium text-fg", !rotuloVisivel && "sr-only")}>
            {rotulo}
          </span>
          {mostrarValor && <span className="num text-fg-muted">{texto}</span>}
        </div>
      )}

      <div
        role="progressbar"
        aria-label={rotulo}
        aria-valuenow={preso}
        aria-valuemin={0}
        aria-valuemax={teto}
        aria-valuetext={texto}
        className={cn(
          "w-full overflow-hidden rounded-full bg-border",
          tamanho === "sm" ? "h-1.5" : "h-2.5",
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-[--dur-base] ease-[--ease-out]",
            TONS[tom],
          )}
          style={{ width: `${porcento}%` }}
        />
      </div>
    </div>
  );
}
