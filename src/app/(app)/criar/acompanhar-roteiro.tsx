"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw, Sparkles } from "lucide-react";
import { consultarGeracao, regerarRoteiro, type EstadoRoteiro } from "@/app/(app)/roteiro/actions";
import { Alerta } from "@/components/ui/alerta";
import { BarraProgresso } from "@/components/ui/barra-progresso";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { EstadoGeracao } from "@/lib/dados/roteiros";

/**
 * A espera enquanto a IA escreve — em geral menos de um minuto.
 *
 * O texto pronto vem do servidor: quando o job termina, esta ilha faz UM
 * refresh e a página renderiza o próximo passo. Nada de montar o roteiro aqui
 * com o que veio da consulta.
 */
export function AcompanharRoteiro({
  roteiroId,
  inicial,
  referenciaNovaTentativa,
}: {
  roteiroId: string;
  inicial: EstadoGeracao;
  /** Chave nova, gerada no render, para o "tentar de novo" não colidir com a primeira. */
  referenciaNovaTentativa: string;
}) {
  const router = useRouter();
  const [tentativa, tentarDeNovo, tentando] = useActionState<EstadoRoteiro, FormData>(
    regerarRoteiro,
    {},
  );

  const { data, refetch } = useQuery({
    queryKey: ["criar-roteiro", roteiroId],
    queryFn: () => consultarGeracao(roteiroId),
    initialData: inicial,
    refetchInterval: (consulta) =>
      consulta.state.data?.ativo || consulta.state.data?.estado === null ? 2000 : false,
    staleTime: 2000,
    retry: 1,
  });

  const atualizou = useRef(false);
  useEffect(() => {
    if (!data || data.ativo || atualizou.current) return;
    if (data.versaoAtual <= inicial.versaoAtual) return;
    atualizou.current = true;
    router.refresh();
  }, [data, inicial.versaoAtual, router]);

  // Nova tentativa entrou na fila. A última resposta guardada é "falhou", que
  // desliga o intervalo — sem esta consulta, a tela ficaria parada no erro.
  useEffect(() => {
    if (tentativa.mensagem) void refetch();
  }, [tentativa.mensagem, refetch]);

  const falhou = data?.estado === "falhou" && !data.ativo;

  if (falhou) {
    return (
      <Card className="space-y-4">
        <Alerta tom="erro">
          A IA não conseguiu escrever o roteiro agora{data?.erro ? `: ${data.erro}` : "."} Nenhum
          crédito foi gasto.
        </Alerta>
        <form action={tentarDeNovo}>
          <input type="hidden" name="roteiroId" value={roteiroId} />
          <input type="hidden" name="referencia" value={referenciaNovaTentativa} />
          {/* Sem isto a ação lê "" como 0 e escreve um roteiro de 1 minuto. */}
          <input type="hidden" name="minutos" value="3" />
          <Button type="submit" disabled={tentando}>
            <RotateCcw className="size-4" aria-hidden />
            {tentando ? "Enviando…" : "Tentar de novo"}
          </Button>
        </form>
        {tentativa.erro && <Alerta tom="erro">{tentativa.erro}</Alerta>}
      </Card>
    );
  }

  return (
    <Card className="space-y-4" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-soft-fg">
          <Sparkles className="size-5 motion-safe:animate-pulse" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">A IA está escrevendo o seu roteiro</p>
          <p className="text-sm text-fg-muted">
            Gancho, oferta, prova, dúvidas e chamada para comprar. Leva menos de um
            minuto — pode deixar esta aba aberta.
          </p>
        </div>
      </div>
      <BarraProgresso
        rotulo="Escrevendo o roteiro"
        valor={Math.max(5, data?.progresso ?? 0)}
        mostrarValor={false}
      />
    </Card>
  );
}
