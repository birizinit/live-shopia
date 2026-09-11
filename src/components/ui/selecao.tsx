"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { contarCaracteres } from "@/lib/caracteres";
import { cn, numero } from "@/lib/utils";

/**
 * Entradas de formulario que nao sao <input>.
 *
 * O arquivo inteiro e cliente porque AreaTexto conta a cada tecla; Selecao nao
 * tem estado proprio, mas Client Component renderiza dentro de Server Component
 * sem cerimonia, entao nao se perde nada mantendo os dois juntos.
 */

export type OpcaoSelecao = {
  valor: string;
  rotulo: string;
  desabilitada?: boolean;
};

export type SelecaoProps = Omit<React.ComponentProps<"select">, "children"> & {
  opcoes: OpcaoSelecao[];
  /** Primeira linha neutra e desabilitada — o "escolha uma opcao". */
  placeholder?: string;
};

/**
 * Select nativo, so repintado. Lista customizada teria que reimplementar
 * teclado, rolagem e o seletor de roda do celular — e sempre pior.
 */
export function Selecao({ opcoes, placeholder, className, ...props }: SelecaoProps) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-10 w-full appearance-none rounded-md border border-border bg-surface pr-9 pl-3 text-sm text-fg",
          "transition-[border-color] duration-[--dur-fast] hover:border-border-strong",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "aria-invalid:border-danger",
          className,
        )}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {opcoes.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor} disabled={opcao.desabilitada}>
            {opcao.rotulo}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-subtle"
        aria-hidden
      />
    </div>
  );
}

export type ContadorCaracteresProps = {
  /** O texto, nao a contagem: quem conta e esta funcao, com a regra do projeto. */
  texto: string;
  maximo?: number;
  className?: string;
};

/**
 * Contador de caracteres cobraveis.
 *
 * Recebe o TEXTO de proposito. Se recebesse um numero, a tela vizinha acabaria
 * passando `texto.length` — que conta unidades UTF-16 e diverge do `length()`
 * do Postgres em qualquer emoji, fazendo a estimativa mentir sobre o custo.
 */
export function ContadorCaracteres({ texto, maximo, className }: ContadorCaracteresProps) {
  const total = useMemo(() => contarCaracteres(texto), [texto]);
  const excedeu = maximo !== undefined && total > maximo;
  const perto = maximo !== undefined && !excedeu && total > maximo * 0.9;

  return (
    <span
      className={cn(
        "num shrink-0 text-xs tabular-nums",
        excedeu ? "font-medium text-danger" : perto ? "text-warning" : "text-fg-subtle",
        className,
      )}
    >
      {numero(total)}
      {maximo !== undefined && ` / ${numero(maximo)}`}
    </span>
  );
}

export type AreaTextoProps = React.ComponentProps<"textarea"> & {
  /** Teto de caracteres cobraveis. Mostrado, nunca cortado no meio da digitacao. */
  maximo?: number;
  contador?: boolean;
  /** Texto a esquerda do contador — duracao estimada, dica, aviso. */
  auxiliar?: React.ReactNode;
  classNameCampo?: string;
};

export function AreaTexto({
  maximo,
  contador = true,
  auxiliar,
  className,
  classNameCampo,
  value,
  defaultValue,
  onChange,
  id,
  ...props
}: AreaTextoProps) {
  const idGerado = useId();
  const idCampo = id ?? idGerado;
  const idContador = `${idCampo}-contador`;

  const [interno, setInterno] = useState(String(defaultValue ?? ""));
  const controlado = value !== undefined;
  const texto = controlado ? String(value) : interno;

  const excedeu = useMemo(
    () => maximo !== undefined && contarCaracteres(texto) > maximo,
    [texto, maximo],
  );

  return (
    <div className={cn("space-y-1.5", className)}>
      <textarea
        {...props}
        id={idCampo}
        value={texto}
        onChange={(evento) => {
          if (!controlado) setInterno(evento.target.value);
          onChange?.(evento);
        }}
        // maxLength NAO entra aqui: ele corta por unidade UTF-16, entao um
        // roteiro cheio de emoji seria truncado antes do limite real cobrado.
        // O excesso e mostrado e barrado no envio, nunca amputado na digitacao.
        aria-describedby={contador ? idContador : props["aria-describedby"]}
        aria-invalid={excedeu ? true : props["aria-invalid"]}
        className={cn(
          "min-h-28 w-full resize-y rounded-md border border-border bg-surface px-3 py-2.5 text-sm leading-relaxed text-fg",
          "placeholder:text-fg-subtle",
          "transition-[border-color] duration-[--dur-fast] hover:border-border-strong",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "aria-invalid:border-danger",
          classNameCampo,
        )}
      />

      {contador && (
        <div
          id={idContador}
          className="flex items-start justify-between gap-3 text-xs text-fg-subtle"
        >
          <span className="min-w-0">{auxiliar}</span>
          <ContadorCaracteres texto={texto} maximo={maximo} />
        </div>
      )}
    </div>
  );
}
