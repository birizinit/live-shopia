import { cn } from "@/lib/utils";

type Tom = "neutro" | "marca" | "sucesso" | "alerta" | "perigo" | "info";

const TONS: Record<Tom, string> = {
  neutro: "bg-bg-subtle text-fg-muted border-border",
  marca: "bg-primary-soft text-primary-soft-fg border-primary-border",
  sucesso: "bg-success-soft text-success border-transparent",
  alerta: "bg-warning-soft text-warning border-transparent",
  perigo: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
};

export function Badge({
  className,
  tom = "neutro",
  ...props
}: React.ComponentProps<"span"> & { tom?: Tom }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONS[tom],
        className,
      )}
      {...props}
    />
  );
}
