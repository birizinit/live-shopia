"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AudioLines } from "lucide-react";
import { BarraProgresso } from "@/components/ui/barra-progresso";
import { Card } from "@/components/ui/card";
import type { AudioAoVivo } from "@/lib/dados/audios";

/**
 * A espera enquanto a voz é gerada, bloco a bloco.
 *
 * Um roteiro de 3 minutos sai em menos de um minuto; um de horas leva mais.
 * Quando termina (ou falha de vez), UM refresh e a página mostra o passo
 * seguinte — que é o servidor quem decide.
 */

function terminou(vivo: AudioAoVivo | undefined) {
  if (!vivo) return false;
  if (vivo.estado === "pronto" || vivo.estado === "falhou") return true;
  return vivo.job?.estado === "falhou" || vivo.job?.estado === "cancelado";
}

async function consultar(audioId: string): Promise<AudioAoVivo> {
  const resposta = await fetch(`/api/audios/${audioId}/blocos`, { cache: "no-store" });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  return resposta.json();
}

export function AcompanharAudio({ audioId, inicial }: { audioId: string; inicial: AudioAoVivo }) {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["criar-audio", audioId],
    queryFn: () => consultar(audioId),
    initialData: inicial,
    refetchInterval: (consulta) => (terminou(consulta.state.data) ? false : 3000),
    staleTime: 2000,
    retry: 2,
  });

  const atualizou = useRef(false);
  useEffect(() => {
    if (!terminou(data) || atualizou.current) return;
    atualizou.current = true;
    router.refresh();
  }, [data, router]);

  const total = Math.max(1, data?.blocosTotal ?? 1);
  const prontos = data?.blocosProntos ?? 0;

  return (
    <Card className="space-y-4" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-soft-fg">
          <AudioLines className="size-5 motion-safe:animate-pulse" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Gerando a voz da apresentadora</p>
          <p className="text-sm text-fg-muted">
            {data?.estado === "na_fila"
              ? "Na fila — começa em instantes."
              : "Pode deixar esta aba aberta; quando terminar, o próximo passo aparece sozinho."}
          </p>
        </div>
      </div>
      <BarraProgresso
        rotulo="Blocos de áudio prontos"
        valor={prontos}
        maximo={total}
        textoValor={`${prontos} de ${total}`}
      />
    </Card>
  );
}
