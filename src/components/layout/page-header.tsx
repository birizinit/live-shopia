import { cn } from "@/lib/utils";

export function PageHeader({
  titulo,
  descricao,
  acoes,
  className,
}: {
  titulo: string;
  descricao?: string;
  acoes?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-bold sm:text-[32px] sm:leading-tight">
          {titulo}
        </h1>
        {descricao && (
          <p className="mt-1.5 max-w-2xl text-sm text-fg-muted">{descricao}</p>
        )}
      </div>
      {acoes && <div className="flex shrink-0 gap-2">{acoes}</div>}
    </div>
  );
}
