import { cn } from "@/lib/utils";

type Variante = "primary" | "secondary" | "ghost" | "danger";
type Tamanho = "sm" | "md" | "lg";

const VARIANTES: Record<Variante, string> = {
  primary:
    "bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-active shadow-sm",
  secondary:
    "bg-surface text-fg border border-border hover:bg-surface-hover hover:border-border-strong",
  ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
  danger: "bg-danger text-fg-inverse hover:brightness-110",
};

const TAMANHOS: Record<Tamanho, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

export type ButtonProps = React.ComponentProps<"button"> & {
  variante?: Variante;
  tamanho?: Tamanho;
  bloco?: boolean;
};

export function Button({
  className,
  variante = "primary",
  tamanho = "md",
  bloco,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap",
        "transition-[background-color,border-color,color,filter] duration-[--dur-fast] ease-[--ease-out]",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTES[variante],
        TAMANHOS[tamanho],
        bloco && "w-full",
        className,
      )}
      {...props}
    />
  );
}
