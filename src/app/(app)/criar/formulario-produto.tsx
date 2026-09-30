"use client";

import { useActionState, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/input";
import { AreaTexto } from "@/components/ui/selecao";
import { comecarLive, type EstadoCriar } from "./actions";

/**
 * O que a pessoa precisa preencher para a Shopia poder responder pela live.
 *
 * Só o nome é obrigatório; o resto entra no manual como resposta pronta —
 * preço e cupom são as duas perguntas mais feitas em qualquer live, e quem
 * preenche aqui já sai com elas respondidas.
 *
 * Campos controlados de propósito: o React 19 limpa formulário não controlado
 * depois de cada envio, e quem erra o preço perderia a descrição inteira.
 */

export type ProdutoEscolhido = { id: string; nome: string; resumo: string | null };

export function FormularioProduto({
  produto,
  limiteDescricao,
}: {
  /** Produto já cadastrado: pula os campos e vai direto ao manual. */
  produto: ProdutoEscolhido | null;
  limiteDescricao: number;
}) {
  const [estado, enviar, enviando] = useActionState<EstadoCriar, FormData>(comecarLive, {});
  const [campos, setCampos] = useState({ nome: "", preco: "", precoDe: "", cupom: "", descricao: "" });

  const mudar = (campo: keyof typeof campos) => (evento: { target: { value: string } }) =>
    setCampos((atual) => ({ ...atual, [campo]: evento.target.value }));

  const invalido = (campo: string) => (estado.campo === campo ? true : undefined);

  return (
    <form action={enviar} className="space-y-5">
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
            dica="O que é, para quem é e o que tem de melhor. É daqui que saem as respostas do manual."
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

      {estado.erro && !estado.campo && <Alerta tom="erro">{estado.erro}</Alerta>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" tamanho="lg" disabled={enviando}>
          {enviando ? "Salvando…" : produto ? "Continuar" : "Salvar e montar o manual"}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </form>
  );
}
