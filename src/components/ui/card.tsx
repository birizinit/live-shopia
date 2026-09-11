import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface p-5 shadow-sm sm:p-6",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitulo({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3 className={cn("text-base font-semibold text-fg", className)} {...props} />
  );
}

export function CardDescricao({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p className={cn("mt-1 text-sm text-fg-muted", className)} {...props} />
  );
}
