import { cn } from "@/lib/utils";

export type EstadoVazioProps = {
  /** Qualquer icone de `lucide-react` serve — ele so precisa aceitar className. */
  icone?: React.ComponentType<{ className?: string }>;
  titulo: string;
  texto?: string;
  /** O caminho de saida: botao ou link. Lista vazia sem acao vira beco sem saida. */
  acao?: React.ReactNode;
  className?: string;
};

export function EstadoVazio({
  icone: Icone,
  titulo,
  texto,
  acao,
  className,
}: EstadoVazioProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      {Icone && (
        <span
          className="mb-4 grid size-12 place-items-center rounded-full bg-bg-subtle text-fg-subtle"
          aria-hidden
        >
          <Icone className="size-6" />
        </span>
      )}
      <h3 className="text-base font-semibold text-fg">{titulo}</h3>
      {texto && (
        <p className="mt-1.5 max-w-sm text-sm text-fg-muted">{texto}</p>
      )}
      {acao && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">{acao}</div>
      )}
    </div>
  );
}
