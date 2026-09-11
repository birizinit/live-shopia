import { cn } from "@/lib/utils";

/**
 * Lista rotulo/valor de painel de detalhe.
 *
 * E <dl> de verdade e nao duas colunas de <div>: o leitor de tela anuncia "voz,
 * Amanda; duracao, 2h41" em pares, e nao oito textos soltos em sequencia.
 */

export type ItemPropriedade = {
  rotulo: string;
  valor: React.ReactNode;
  /** Valor numerico entra em tabular-nums para as linhas alinharem. */
  numerica?: boolean;
};

export type PropriedadesProps = {
  itens?: ItemPropriedade[];
  children?: React.ReactNode;
  /** Duas colunas cabem em painel largo; uma e o padrao e o que serve no celular. */
  colunas?: 1 | 2;
  className?: string;
};

export function Propriedades({
  itens,
  children,
  colunas = 1,
  className,
}: PropriedadesProps) {
  return (
    <dl
      className={cn(
        colunas === 2 && "sm:grid sm:grid-cols-2 sm:gap-x-8",
        className,
      )}
    >
      {itens?.map((item) => (
        <Propriedade
          key={item.rotulo}
          rotulo={item.rotulo}
          valor={item.valor}
          numerica={item.numerica}
        />
      ))}
      {children}
    </dl>
  );
}

export type PropriedadeProps = {
  rotulo: string;
  valor?: React.ReactNode;
  numerica?: boolean;
  children?: React.ReactNode;
  className?: string;
};

export function Propriedade({
  rotulo,
  valor,
  numerica,
  children,
  className,
}: PropriedadeProps) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-0",
        className,
      )}
    >
      <dt className="shrink-0 text-sm text-fg-muted">{rotulo}</dt>
      <dd
        className={cn(
          "min-w-0 text-right text-sm font-medium text-fg",
          numerica && "num",
        )}
      >
        {valor ?? children}
      </dd>
    </div>
  );
}
