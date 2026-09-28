"use client";

import { useActionState, useState } from "react";
import { Sparkles } from "lucide-react";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/input";
import { AreaTexto, Selecao } from "@/components/ui/selecao";
import { cn } from "@/lib/utils";
import { comecarLive, type EstadoCriar } from "./actions";

/**
 * O único formulário que a pessoa precisa preencher para ter uma live.
 *
 * Só o nome é obrigatório; o resto melhora o roteiro, mas não trava. Campos
 * controlados de propósito: o React 19 limpa formulário não controlado depois
 * de cada envio, e quem erra o preço perderia a descrição inteira.
 */

const TONS = [
  { valor: "energético", rotulo: "Animado" },
  { valor: "acolhedor", rotulo: "Acolhedor" },
  { valor: "direto ao ponto", rotulo: "Direto" },
  { valor: "divertido", rotulo: "Divertido" },
] as const;

const DURACOES = [
  { valor: "1", rotulo: "1 minuto" },
  { valor: "2", rotulo: "2 minutos" },
  { valor: "3", rotulo: "3 minutos (recomendado)" },
  { valor: "5", rotulo: "5 minutos" },
];

export type ProdutoEscolhido = { id: string; nome: string; resumo: string | null };

export function FormularioProduto({
  referencia,
  produto,
  limiteDescricao,
}: {
  referencia: string;
  /** Produto já cadastrado: pula os campos e vai direto ao roteiro. */
  produto: ProdutoEscolhido | null;
  limiteDescricao: number;
}) {
  const [estado, enviar, enviando] = useActionState<EstadoCriar, FormData>(comecarLive, {});
  const [campos, setCampos] = useState({ nome: "", preco: "", precoDe: "", cupom: "", descricao: "" });
  const [tom, setTom] = useState<string>(TONS[0].valor);
  const [minutos, setMinutos] = useState("3");

  const mudar = (campo: keyof typeof campos) => (evento: { target: { value: string } }) =>
    setCampos((atual) => ({ ...atual, [campo]: evento.target.value }));

  const invalido = (campo: string) => (estado.campo === campo ? true : undefined);

  return (
    <form action={enviar} className="space-y-5">
      <input type="hidden" name="referencia" value={referencia} />
      {produto && <input type="hidden" name="produtoId" value={produto.id} />}

      {produto ? (
        <div className="rounded-md border border-border bg-bg-subtle px-4 py-3">
          <p className="text-xs text-fg-subtle">Produto</p>
          <p className="font-semibold">{produto.nome}</p>
          {produto.resumo && <p className="mt-0.5 text-sm text-fg-muted">{produto.resumo}</p>}
        </div>
      ) : (
        <>
          <Campo rotulo="O que você vai vender?" htmlFor="nome" erro={estado.campo === "nome" ? estado.erro : undefined}>
            <Input
              id="nome"
              name="nome"
              required
              autoFocus
              placeholder="Ex.: Fone sem fio com 30h de bateria"
              value={campos.nome}
              onChange={mudar("nome")}
              aria-invalid={invalido("nome")}
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Preço na live" htmlFor="preco" dica="Opcional" erro={estado.campo === "preco" ? estado.erro : undefined}>
              <Input
                id="preco"
                name="preco"
                inputMode="decimal"
                placeholder="89,90"
                value={campos.preco}
                onChange={mudar("preco")}
                aria-invalid={invalido("preco")}
              />
            </Campo>
            <Campo rotulo="Preço antigo" htmlFor="precoDe" dica="Opcional, mostra o desconto" erro={estado.campo === "precoDe" ? estado.erro : undefined}>
              <Input
                id="precoDe"
                name="precoDe"
                inputMode="decimal"
                placeholder="149,90"
                value={campos.precoDe}
                onChange={mudar("precoDe")}
                aria-invalid={invalido("precoDe")}
              />
            </Campo>
            <Campo rotulo="Cupom" htmlFor="cupom" dica="Opcional" erro={estado.campo === "cupom" ? estado.erro : undefined}>
              <Input
                id="cupom"
                name="cupom"
                placeholder="LIVE10"
                value={campos.cupom}
                onChange={mudar("cupom")}
                aria-invalid={invalido("cupom")}
              />
            </Campo>
          </div>

          <Campo
            rotulo="Conte sobre o produto"
            htmlFor="descricao"
            dica="O que é, para quem é e o que tem de melhor. Quanto mais concreto, melhor o roteiro."
            erro={estado.campo === "descricao" ? estado.erro : undefined}
          >
            <AreaTexto
              id="descricao"
              name="descricao"
              rows={4}
              maximo={limiteDescricao}
              placeholder="Ex.: Fone bluetooth, bateria de 30 horas, à prova de suor, cancela ruído. Ideal para academia e para quem trabalha em casa."
              value={campos.descricao}
              onChange={mudar("descricao")}
            />
          </Campo>
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Tamanho do roteiro" htmlFor="minutos" dica="Ele repete em laço na live, sem gastar de novo.">
          <Selecao
            id="minutos"
            name="minutos"
            opcoes={DURACOES}
            value={minutos}
            onChange={(evento) => setMinutos(evento.target.value)}
          />
        </Campo>

        <fieldset>
          <legend className="block text-sm font-medium text-fg">Jeito de falar</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {TONS.map((opcao) => (
              <label
                key={opcao.valor}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors duration-[--dur-fast]",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  tom === opcao.valor
                    ? "border-primary-border bg-primary-soft font-medium text-primary-soft-fg"
                    : "border-border text-fg-muted hover:bg-surface-hover",
                )}
              >
                <input
                  type="radio"
                  name="tom"
                  value={opcao.valor}
                  checked={tom === opcao.valor}
                  onChange={() => setTom(opcao.valor)}
                  className="sr-only"
                />
                {opcao.rotulo}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {estado.erro && !estado.campo && <Alerta tom="erro">{estado.erro}</Alerta>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" tamanho="lg" disabled={enviando}>
          <Sparkles className="size-4" aria-hidden />
          {enviando ? "Enviando para a IA…" : "Escrever o roteiro com IA"}
        </Button>
        <p className="text-sm text-fg-muted">Escrever o roteiro não gasta créditos.</p>
      </div>
    </form>
  );
}
