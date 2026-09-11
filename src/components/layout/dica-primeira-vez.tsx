import { Lightbulb } from "lucide-react";
import { dispensarDica } from "@/app/(app)/bem-vindo/actions";
import { dicaJaVista } from "@/lib/dados/onboarding";
import { obterUsuario } from "@/lib/sessao";
import { cn } from "@/lib/utils";

/**
 * Dica contextual de primeira visita.
 *
 * Explica a tela onde ela esta, uma vez, e some quando a pessoa diz que
 * entendeu. O "vi esta dica" mora em `dicas_vistas`, com perfil_id: guardar em
 * `localStorage` faria a mesma dica reaparecer no celular de quem ja leu no
 * computador, que e exatamente o defeito que o tour corrige.
 *
 * E Server Component de proposito. Fechar e um `<form>` com Server Action —
 * funciona sem JavaScript, nao precisa de estado no cliente e o cartao some no
 * mesmo roundtrip em que a linha e gravada.
 *
 * Uso numa tela do estudio:
 *
 * ```tsx
 * <DicaPrimeiraVez
 *   chave="estudio.custo-antes"
 *   caminho="/estudio"
 *   titulo="O custo aparece antes de confirmar"
 * >
 *   A estimativa mostra caracteres, duração e quanto sobra de saldo. O débito
 *   só acontece quando você confirma.
 * </DicaPrimeiraVez>
 * ```
 */
export type DicaPrimeiraVezProps = {
  /**
   * Identificador da dica em `dicas_vistas`. Use o prefixo da tela
   * ("estudio.custo-antes"): aceita `a-z 0-9 . _ -`, de 3 a 60 caracteres.
   */
  chave: string;
  /** Rota da tela, para o cartao sumir sem recarregar o resto do app. */
  caminho: string;
  titulo: string;
  children: React.ReactNode;
  className?: string;
};

export async function DicaPrimeiraVez({
  chave,
  caminho,
  titulo,
  children,
  className,
}: DicaPrimeiraVezProps) {
  const usuario = await obterUsuario();
  // Sem sessao nao ha onde registrar que a dica foi lida; melhor nao mostrar do
  // que mostrar um cartao que nunca fecha.
  if (!usuario) return null;
  if (await dicaJaVista(usuario.id, chave)) return null;

  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-start gap-3 rounded-lg border border-primary-border bg-primary-soft p-4",
        className,
      )}
    >
      <Lightbulb className="mt-0.5 size-5 shrink-0 text-primary-soft-fg" aria-hidden />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{titulo}</p>
        <div className="mt-1 text-sm text-fg-muted">{children}</div>
      </div>

      <form action={dispensarDica} className="shrink-0">
        <input type="hidden" name="chave" value={chave} />
        <input type="hidden" name="caminho" value={caminho} />
        <button
          type="submit"
          aria-label={`Entendi a dica: ${titulo}`}
          className="inline-flex h-8 items-center rounded-md border border-primary-border px-3 text-sm font-medium text-primary-soft-fg transition-colors duration-[--dur-fast] hover:bg-surface"
        >
          Entendi
        </button>
      </form>
    </div>
  );
}
