import { Button } from "./button";
import { cn, numero } from "@/lib/utils";
import type { Pagina } from "@/lib/dados/tipos";

/**
 * Paginacao por cursor, casada com `Pagina<T>` de @/lib/dados/tipos.
 *
 * Nao existe "pagina 3": o cursor e o par (instante, id) do ultimo item, e e a
 * unica forma estavel de continuar uma lista onde item novo entra no topo o
 * tempo todo — com offset, o dashboard relistaria o que ja passou.
 */

export type PaginacaoProps = {
  /** O campo `proximo` da ultima pagina recebida. `null` = acabou. */
  proximo: string | null;
  mostrados: number;
  total?: number;
  /** Recebe o cursor; quem chama consulta e junta com `juntarPaginas`. */
  aoCarregarMais: (cursor: string) => void;
  carregando?: boolean;
  /** Plural do que esta na lista: "produtos", "vendas", "áudios". */
  itens?: string;
  className?: string;
};

export function Paginacao({
  proximo,
  mostrados,
  total,
  aoCarregarMais,
  carregando,
  itens = "itens",
  className,
}: PaginacaoProps) {
  // Lista vazia e assunto do EstadoVazio; contagem "0 de 0" so ocupa espaco.
  if (mostrados === 0) return null;

  return (
    <div className={cn("flex flex-col items-center gap-3 py-6", className)}>
      <p className="text-xs text-fg-subtle" aria-live="polite">
        <span className="num">{numero(mostrados)}</span>
        {total !== undefined && (
          <>
            {" de "}
            <span className="num">{numero(total)}</span>
          </>
        )}{" "}
        {itens}
      </p>

      {proximo ? (
        <Button
          variante="secondary"
          onClick={() => aoCarregarMais(proximo)}
          disabled={carregando}
          aria-busy={carregando || undefined}
        >
          {carregando ? "Carregando…" : "Carregar mais"}
        </Button>
      ) : (
        <p className="text-xs text-fg-subtle">Fim da lista</p>
      )}
    </div>
  );
}

/**
 * Junta a pagina nova no que ja esta na tela.
 *
 * Descarta id repetido de proposito: entre duas consultas um item pode ter sido
 * atualizado e reaparecer na janela do cursor, e React quebra com key duplicada.
 */
export function juntarPaginas<T extends { id: string }>(
  atual: Pagina<T>,
  nova: Pagina<T>,
): Pagina<T> {
  const vistos = new Set(atual.itens.map((item) => item.id));

  return {
    itens: [...atual.itens, ...nova.itens.filter((item) => !vistos.has(item.id))],
    proximo: nova.proximo,
    total: nova.total ?? atual.total,
  };
}
