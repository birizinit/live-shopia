import { cn } from "@/lib/utils";

/**
 * Tabela do produto: lista densa que precisa caber num celular de 360px sem
 * empurrar a pagina inteira para o lado.
 *
 * Uso:
 *   <Tabela rotulo="Vendas da live" cabecalho={<Cabecalho colunas={[...]} />}>
 *     <Linha><Celula linha>Produto</Celula><Celula numerica>R$ 39,90</Celula></Linha>
 *   </Tabela>
 */

export type ColunaTabela = {
  rotulo: React.ReactNode;
  /** Coluna de numero: alinha a direita e entra em tabular-nums (.num). */
  numerica?: boolean;
  className?: string;
};

export type TabelaProps = {
  /** Vira <caption> so para leitor de tela. Tabela sem nome nao diz do que e. */
  rotulo: string;
  cabecalho?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  classNameTabela?: string;
};

export function Tabela({
  rotulo,
  cabecalho,
  children,
  className,
  classNameTabela,
}: TabelaProps) {
  return (
    // `min-w-0` e o que faz a rolagem acontecer AQUI: sem ele um filho de grid
    // ou flex cresce com o conteudo, e quem passa a rolar na horizontal e o
    // corpo da pagina inteira — que e exatamente o que nao pode acontecer.
    <div
      className={cn(
        "w-full min-w-0 overflow-x-auto overscroll-x-contain",
        className,
      )}
    >
      <table className={cn("w-full border-collapse text-sm", classNameTabela)}>
        <caption className="sr-only">{rotulo}</caption>
        {cabecalho}
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export type CabecalhoProps = {
  /** Caminho curto. Para cabecalho fora do comum, passe <Celula cabecalho> como children. */
  colunas?: (ColunaTabela | string)[];
  children?: React.ReactNode;
  className?: string;
};

export function Cabecalho({ colunas, children, className }: CabecalhoProps) {
  return (
    <thead className={cn("border-b border-border", className)}>
      <tr>
        {colunas
          ? colunas.map((coluna, i) => {
              const c = typeof coluna === "string" ? { rotulo: coluna } : coluna;
              return (
                <Celula
                  key={i}
                  cabecalho
                  numerica={c.numerica}
                  className={c.className}
                >
                  {c.rotulo}
                </Celula>
              );
            })
          : children}
      </tr>
    </thead>
  );
}

export type LinhaProps = React.ComponentProps<"tr"> & {
  destacada?: boolean;
  interativa?: boolean;
};

export function Linha({
  className,
  destacada,
  interativa,
  ...props
}: LinhaProps) {
  return (
    <tr
      className={cn(
        "border-b border-border last:border-0",
        interativa &&
          "cursor-pointer transition-colors duration-[--dur-fast] hover:bg-surface-hover",
        destacada && "bg-primary-soft",
        className,
      )}
      {...props}
    />
  );
}

export type CelulaProps = React.ComponentProps<"td"> & {
  /** Cabecalho de coluna (th scope="col"). */
  cabecalho?: boolean;
  /** Cabecalho de linha (th scope="row") — e o nome da linha no leitor de tela. */
  linha?: boolean;
  numerica?: boolean;
  /** Por padrao a celula nao quebra: e a largura que dispara a rolagem propria. */
  quebrar?: boolean;
};

export function Celula({
  cabecalho,
  linha,
  numerica,
  quebrar,
  className,
  ...props
}: CelulaProps) {
  const classe = cn(
    "px-3 py-2.5 align-middle first:pl-0 last:pr-0",
    cabecalho
      ? "text-xs font-semibold tracking-wider text-fg-subtle uppercase"
      : "text-fg",
    linha && "font-medium",
    numerica && "num text-right",
    quebrar ? "whitespace-normal" : "whitespace-nowrap",
    className,
  );

  if (cabecalho || linha) {
    return (
      <th
        scope={cabecalho ? "col" : "row"}
        className={classe}
        {...(props as React.ComponentProps<"th">)}
      />
    );
  }

  return <td className={classe} {...props} />;
}
