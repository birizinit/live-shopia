"use client";

import { useActionState } from "react";
import { Radio } from "lucide-react";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { colocarNaLiveAcao, type EstadoCriar } from "./actions";

/**
 * O último clique: o áudio pronto entra no que a extensão toca.
 *
 * Quem já tem uma live montada escolhe entre somar (a live alterna os
 * produtos) e trocar (só este). Quem não tem, não precisa escolher nada.
 */
export function ColocarNaLive({
  audioId,
  liveAtual,
}: {
  audioId: string;
  liveAtual: { nome: string; falas: number } | null;
}) {
  const [estado, enviar, enviando] = useActionState<EstadoCriar, FormData>(colocarNaLiveAcao, {});

  return (
    <form action={enviar} className="space-y-3">
      <input type="hidden" name="audioId" value={audioId} />

      {liveAtual && liveAtual.falas > 0 ? (
        <>
          <p className="text-sm text-fg-muted">
            A sua live “{liveAtual.nome}” já tem {liveAtual.falas}{" "}
            {liveAtual.falas === 1 ? "áudio" : "áudios"}. Este entra junto, ou no lugar deles?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="modo" value="juntar" tamanho="lg" disabled={enviando}>
              <Radio className="size-4" aria-hidden />
              Tocar junto com os outros
            </Button>
            <Button type="submit" name="modo" value="sozinho" variante="secondary" tamanho="lg" disabled={enviando}>
              Tocar só este
            </Button>
          </div>
        </>
      ) : (
        <Button type="submit" name="modo" value="juntar" tamanho="lg" disabled={enviando}>
          <Radio className="size-4" aria-hidden />
          {enviando ? "Colocando na live…" : "Colocar na minha live"}
        </Button>
      )}

      {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}
    </form>
  );
}
