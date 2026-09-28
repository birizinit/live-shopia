"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { AudioLines, Pause, Play } from "lucide-react";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatarDuracao } from "@/lib/caracteres";
import type { VozOpcao } from "@/lib/dados/audios";
import type { Estimativa } from "@/lib/dados/tipos";
import { cn, numero } from "@/lib/utils";
import { gerarAudioDaLive, type EstadoCriar } from "./actions";

/**
 * Voz e custo, na mesma tela, antes do único clique que cobra.
 *
 * O custo aparece ANTES do botão, com o saldo ao lado: mostrar depois de
 * cobrar é o mesmo que não mostrar. A prévia não gasta crédito.
 */

const VISIVEIS_DE_INICIO = 8;

const GENERO: Record<VozOpcao["genero"], string> = {
  feminina: "Feminina",
  masculina: "Masculina",
  neutra: "Neutra",
};

export function EscolherVoz({
  vozes,
  vozPadrao,
  estimativa,
  chave,
  roteiroId,
  versaoId,
  vozLigada,
}: {
  vozes: VozOpcao[];
  vozPadrao: string | null;
  estimativa: Estimativa;
  chave: string;
  roteiroId: string;
  versaoId: string;
  /** Sem chave da ElevenLabs a geração está desligada — e o botão diz isso. */
  vozLigada: boolean;
}) {
  const [estado, enviar, enviando] = useActionState<EstadoCriar, FormData>(gerarAudioDaLive, {});
  const [escolhida, setEscolhida] = useState(vozPadrao ?? vozes[0]?.id ?? "");
  const [todas, setTodas] = useState(false);
  const [tocando, setTocando] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => player.current?.pause(), []);

  function ouvir(vozId: string) {
    const elemento = (player.current ??= new Audio());
    if (tocando === vozId) {
      elemento.pause();
      setTocando(null);
      return;
    }
    elemento.src = `/api/vozes/${vozId}/previa`;
    elemento.onended = () => setTocando(null);
    elemento.onerror = () => setTocando(null);
    setTocando(vozId);
    elemento.play().catch(() => setTocando(null));
  }

  // A escolhida fica visível mesmo com a lista recolhida.
  const listadas = todas
    ? vozes
    : vozes.filter((v, i) => i < VISIVEIS_DE_INICIO || v.id === escolhida);

  const bloqueado = !vozLigada || !estimativa.suficiente || !escolhida;

  if (vozes.length === 0) {
    return (
      <Alerta tom="erro">
        Nenhuma voz disponível ainda. Peça ao suporte para sincronizar o catálogo de vozes.
      </Alerta>
    );
  }

  return (
    <form action={enviar} className="space-y-4">
      <input type="hidden" name="chave" value={chave} />
      <input type="hidden" name="roteiroId" value={roteiroId} />
      <input type="hidden" name="versaoId" value={versaoId} />

      <fieldset>
        <legend className="text-base font-semibold">Escolha a voz da apresentadora</legend>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {listadas.map((voz) => (
            <li
              key={voz.id}
              className={cn(
                "flex items-center gap-2 rounded-md border pr-2 transition-colors duration-[--dur-fast]",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                escolhida === voz.id
                  ? "border-primary-border bg-primary-soft"
                  : "border-border hover:bg-surface-hover",
              )}
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2.5 pl-3">
                <input
                  type="radio"
                  name="vozId"
                  value={voz.id}
                  checked={escolhida === voz.id}
                  onChange={() => setEscolhida(voz.id)}
                  className="size-4 accent-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{voz.nome}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    <Badge>{GENERO[voz.genero]}</Badge>
                    {voz.origem === "clonada" && <Badge tom="marca">Sua voz</Badge>}
                  </span>
                </span>
              </label>
              <button
                type="button"
                onClick={() => ouvir(voz.id)}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-border text-fg-muted hover:bg-surface hover:text-fg"
                aria-label={tocando === voz.id ? `Parar a prévia de ${voz.nome}` : `Ouvir ${voz.nome}`}
              >
                {tocando === voz.id ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
        {vozes.length > VISIVEIS_DE_INICIO && (
          <button
            type="button"
            onClick={() => setTodas((v) => !v)}
            className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {todas ? "Mostrar menos vozes" : `Ver todas as ${vozes.length} vozes`}
          </button>
        )}
      </fieldset>

      <div className="rounded-md border border-border bg-bg-subtle px-4 py-3 text-sm">
        <p>
          Este áudio usa <strong className="num">{numero(estimativa.caracteres)}</strong> créditos
          {" "}(cerca de <span className="num">{formatarDuracao(estimativa.duracaoMs)}</span> de fala).
          Você tem <strong className="num">{numero(estimativa.creditosDisponiveis)}</strong>.
        </p>
        <p className="mt-1 text-fg-muted">
          Depois de pronto, ele repete em laço na live por quantas horas você quiser, sem
          gastar de novo.
        </p>
      </div>

      {!estimativa.suficiente && (
        <Alerta tom="erro">
          Faltam <span className="num">{numero(estimativa.faltam)}</span> créditos para este áudio.{" "}
          <Link href="/creditos" className="font-medium underline underline-offset-4">
            Ver créditos
          </Link>{" "}
          ou escolha um roteiro mais curto.
        </Alerta>
      )}
      {!vozLigada && (
        <Alerta tom="erro">
          A geração de voz está desligada no momento. Nenhum crédito será gasto.
        </Alerta>
      )}
      {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}

      <Button type="submit" tamanho="lg" disabled={bloqueado || enviando}>
        <AudioLines className="size-4" aria-hidden />
        {enviando
          ? "Enviando…"
          : `Gerar o áudio · ${numero(estimativa.caracteres)} créditos`}
      </Button>
    </form>
  );
}
