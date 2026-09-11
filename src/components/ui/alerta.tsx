import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Tom = "erro" | "sucesso" | "info";

const ESTILOS: Record<Tom, { classe: string; Icone: typeof Info }> = {
  erro: { classe: "bg-danger-soft text-danger", Icone: CircleAlert },
  sucesso: { classe: "bg-success-soft text-success", Icone: CircleCheck },
  info: { classe: "bg-info-soft text-info", Icone: Info },
};

export function Alerta({
  tom = "info",
  children,
  className,
}: {
  tom?: Tom;
  children: React.ReactNode;
  className?: string;
}) {
  const { classe, Icone } = ESTILOS[tom];
  return (
    <div
      role={tom === "erro" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md px-3 py-2.5 text-sm",
        classe,
        className,
      )}
    >
      <Icone className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
