import { cn } from "@/lib/utils";

/**
 * Bolinha de estado com texto ao lado.
 *
 * O texto nao e opcional e nao e `title`: verde e vermelho sao a mesma bolinha
 * para quem tem daltonismo vermelho-verde, e a tela que diz "esta no ar" so
 * pela cor nao diz nada para essa pessoa.
 */

export type EstadoIndicador = "no_ar" | "fora_do_ar" | "erro" | "pendente";

const ESTADOS: Record<
  EstadoIndicador,
  { rotulo: string; ponto: string; texto: string; pulsa?: boolean }
> = {
  no_ar: { rotulo: "No ar", ponto: "bg-success", texto: "text-success", pulsa: true },
  fora_do_ar: {
    rotulo: "Fora do ar",
    ponto: "bg-border-strong",
    texto: "text-fg-muted",
  },
  erro: { rotulo: "Com erro", ponto: "bg-danger", texto: "text-danger" },
  pendente: { rotulo: "Na fila", ponto: "bg-warning", texto: "text-warning" },
};

export type IndicadorProps = {
  estado: EstadoIndicador;
  /** Troca o texto padrao do estado — mas nunca o remove. */
  texto?: string;
  className?: string;
};

export function Indicador({ estado, texto, className }: IndicadorProps) {
  const { rotulo, ponto, texto: corTexto, pulsa } = ESTADOS[estado];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap",
        corTexto,
        className,
      )}
    >
      <span className="relative grid size-2.5 shrink-0 place-items-center" aria-hidden>
        {pulsa && (
          <span
            className={cn(
              "absolute inline-flex size-2.5 animate-ping rounded-full opacity-70",
              "motion-reduce:hidden",
              ponto,
            )}
          />
        )}
        <span className={cn("size-2 rounded-full", ponto)} />
      </span>
      {texto ?? rotulo}
    </span>
  );
}
