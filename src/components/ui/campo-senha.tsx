"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

/**
 * Senha com "mostrar". Ver o que digitou substitui o "confirmar senha": a
 * pessoa confere com os olhos em vez de digitar duas vezes — um campo a menos
 * no cadastro, e nenhum erro de digitação escondido atrás dos pontinhos.
 */
export function CampoSenha({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const [visivel, setVisivel] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visivel ? "text" : "password"} className={cn("pr-11", className)} />
      <button
        type="button"
        onClick={() => setVisivel((v) => !v)}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-fg-subtle transition-colors duration-[--dur-fast] hover:text-fg"
        aria-label={visivel ? "Esconder a senha" : "Mostrar a senha"}
        aria-pressed={visivel}
      >
        {visivel ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
