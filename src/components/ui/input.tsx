import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg",
        "placeholder:text-fg-subtle",
        "transition-[border-color] duration-[--dur-fast]",
        "hover:border-border-strong",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("block text-sm font-medium text-fg", className)}
      {...props}
    />
  );
}

export function Campo({
  rotulo,
  dica,
  erro,
  children,
  htmlFor,
}: {
  rotulo: string;
  dica?: string;
  erro?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{rotulo}</Label>
      {children}
      {erro ? (
        <p className="text-xs text-danger">{erro}</p>
      ) : dica ? (
        <p className="text-xs text-fg-subtle">{dica}</p>
      ) : null}
    </div>
  );
}
