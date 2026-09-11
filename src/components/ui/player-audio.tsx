"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Repeat, SkipBack, SkipForward } from "lucide-react";
import { formatarDuracao } from "@/lib/caracteres";
import { cn } from "@/lib/utils";
import { Alerta } from "./alerta";

/**
 * Player da live: toca uma LISTA ORDENADA de blocos como se fosse uma faixa so.
 *
 * O audio continuo de 3h nao existe como arquivo neste produto — sao ~45 blocos
 * de ate 2.400 caracteres, que e o teto de uma chamada de TTS (ver
 * db/migrations/0004_estudio.sql e src/lib/armazenamento.ts).
 *
 * Por que DOIS elementos <audio> e nao um so trocando de src: trocar o src
 * obriga o navegador a buscar e decodificar o proximo bloco depois que o
 * anterior acabou, e essa pausa e audivel. Aqui o bloco seguinte ja esta
 * carregado no elemento que esta em silencio; a virada e so um play() num
 * buffer pronto. Sao 45 emendas em 3h de live: uma so ja denuncia a IA.
 */

export type BlocoAudio = {
  id: string;
  url: string;
  /** Duracao conhecida. Faltando, o player mede quando o bloco carrega. */
  duracaoMs?: number | null;
};

export type PlayerAudioProps = {
  blocos: BlocoAudio[];
  /** Controlado quando vier junto de `aoMudarLoop`; senao e so o valor inicial. */
  loop?: boolean;
  aoMudarLoop?: (loop: boolean) => void;
  aoTerminar?: () => void;
  aoMudarBloco?: (indice: number) => void;
  titulo?: string;
  className?: string;
};

/**
 * A lista trocou = outro audio. Remontar por `key` zera posicao, slot e erro de
 * uma vez, em vez de um efeito de reset que precisaria lembrar de cada estado —
 * e a identidade vem do conteudo porque o pai remonta o array a cada render.
 */
export function PlayerAudio(props: PlayerAudioProps) {
  const chave = props.blocos.map((bloco) => bloco.id).join("|");
  return <Reprodutor key={chave} {...props} />;
}

function Reprodutor({
  blocos,
  loop = false,
  aoMudarLoop,
  aoTerminar,
  aoMudarBloco,
  titulo,
  className,
}: PlayerAudioProps) {
  const elementoA = useRef<HTMLAudioElement>(null);
  const elementoB = useRef<HTMLAudioElement>(null);
  /** Qual bloco esta dentro de cada elemento. -1 = vazio. */
  const carregado = useRef<[number, number]>([-1, -1]);
  const buscaPendente = useRef<{ slot: 0 | 1; segundos: number } | null>(null);
  const blocosRef = useRef(blocos);
  const repetirRef = useRef(loop);

  const [slot, setSlot] = useState<0 | 1>(0);
  const [indice, setIndice] = useState(0);
  const [tocando, setTocando] = useState(false);
  const [tempoBlocoMs, setTempoBlocoMs] = useState(0);
  const [medidas, setMedidas] = useState<Record<string, number>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [repetirInterno, setRepetirInterno] = useState(loop);

  const repetir = aoMudarLoop ? loop : repetirInterno;

  useEffect(() => {
    blocosRef.current = blocos;
  });

  useEffect(() => {
    repetirRef.current = repetir;
  }, [repetir]);

  const pegar = useCallback(
    (alvo: 0 | 1) => (alvo === 0 ? elementoA.current : elementoB.current),
    [],
  );

  const montar = useCallback((alvo: 0 | 1, i: number) => {
    const el = alvo === 0 ? elementoA.current : elementoB.current;
    const bloco = blocosRef.current[i];
    if (!el || !bloco) return;
    if (carregado.current[alvo] === i) return;
    carregado.current[alvo] = i;
    el.src = bloco.url;
    el.load();
  }, []);

  /** Indice do bloco que vem depois de `i`; -1 quando a lista acaba ali. */
  const proximoDe = useCallback((i: number) => {
    const total = blocosRef.current.length;
    if (i + 1 < total) return i + 1;
    return repetirRef.current && total > 0 ? 0 : -1;
  }, []);

  useEffect(() => {
    montar(0, 0);
    montar(1, 1);
  }, [montar]);

  // Invariante do encadeamento: o elemento em silencio segura sempre o bloco
  // seguinte — inclusive o bloco 0 quando o loop esta ligado e o fim se aproxima.
  useEffect(() => {
    const proximo = proximoDe(indice);
    if (proximo >= 0) montar(slot === 0 ? 1 : 0, proximo);
  }, [indice, slot, repetir, montar, proximoDe]);

  useEffect(
    () => () => {
      for (const el of [elementoA.current, elementoB.current]) {
        if (!el) continue;
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
    },
    [],
  );

  const duracoes = useMemo(
    () => blocos.map((bloco) => bloco.duracaoMs ?? medidas[bloco.id] ?? 0),
    [blocos, medidas],
  );

  const inicios = useMemo(() => {
    const lista: number[] = [];
    let soma = 0;
    for (const duracao of duracoes) {
      lista.push(soma);
      soma += duracao;
    }
    return lista;
  }, [duracoes]);

  const totalMs = useMemo(() => duracoes.reduce((a, b) => a + b, 0), [duracoes]);
  const decorridoMs = (inicios[indice] ?? 0) + tempoBlocoMs;

  function tocar() {
    const el = pegar(slot);
    if (!el) return;
    el.play()
      .then(() => {
        setTocando(true);
        setErro(null);
      })
      .catch(() => {
        // Politica de autoplay: sem gesto do usuario o play() e recusado.
        setTocando(false);
        setErro("O navegador bloqueou a reprodução. Toque em tocar de novo.");
      });
  }

  function pausar() {
    pegar(slot)?.pause();
    setTocando(false);
  }

  function aoFimDoBloco(slotQueTerminou: 0 | 1) {
    // O elemento em pre-carga nao esta tocando, mas se der ruim ele tambem
    // dispara 'ended' — e avancar duas vezes pularia um bloco inteiro.
    if (slotQueTerminou !== slot) return;

    const proximo = proximoDe(indice);
    if (proximo < 0) {
      setTocando(false);
      setTempoBlocoMs(0);
      aoTerminar?.();
      return;
    }

    const novoSlot: 0 | 1 = slot === 0 ? 1 : 0;
    montar(novoSlot, proximo);
    const el = pegar(novoSlot);

    setSlot(novoSlot);
    setIndice(proximo);
    setTempoBlocoMs(0);
    aoMudarBloco?.(proximo);

    if (el) {
      if (el.currentTime > 0) el.currentTime = 0;
      void el.play().catch(() => setTocando(false));
    }
  }

  function irParaBloco(alvo: number) {
    if (blocos.length === 0) return;
    const i = Math.min(Math.max(alvo, 0), blocos.length - 1);

    montar(slot, i);
    const el = pegar(slot);

    setIndice(i);
    setTempoBlocoMs(0);
    aoMudarBloco?.(i);

    if (el) {
      if (el.currentTime > 0) el.currentTime = 0;
      if (tocando) void el.play().catch(() => setTocando(false));
    }
  }

  function irPara(msAlvo: number) {
    if (blocos.length === 0 || totalMs <= 0) return;

    const alvo = Math.min(Math.max(msAlvo, 0), totalMs);
    let i = 0;
    while (i < blocos.length - 1 && alvo >= (inicios[i + 1] ?? Number.POSITIVE_INFINITY)) {
      i += 1;
    }

    const dentroMs = Math.max(0, alvo - (inicios[i] ?? 0));
    const trocouDeBloco = carregado.current[slot] !== i;

    montar(slot, i);
    const el = pegar(slot);

    setIndice(i);
    setTempoBlocoMs(dentroMs);
    if (!el) return;

    if (trocouDeBloco) {
      // currentTime so aceita valor depois que o bloco novo tem metadados.
      buscaPendente.current = { slot, segundos: dentroMs / 1000 };
    } else {
      el.currentTime = dentroMs / 1000;
    }

    if (tocando) void el.play().catch(() => setTocando(false));
  }

  function aoCarregarMetadados(alvo: 0 | 1) {
    const el = pegar(alvo);
    if (!el) return;

    const bloco = blocos[carregado.current[alvo]];
    if (bloco && !bloco.duracaoMs && Number.isFinite(el.duration)) {
      const ms = Math.round(el.duration * 1000);
      setMedidas((atual) => (atual[bloco.id] === ms ? atual : { ...atual, [bloco.id]: ms }));
    }

    const pendente = buscaPendente.current;
    if (pendente && pendente.slot === alvo) {
      el.currentTime = pendente.segundos;
      buscaPendente.current = null;
    }
  }

  function aoAvancarTempo(alvo: 0 | 1) {
    if (alvo !== slot) return;
    const el = pegar(alvo);
    if (el) setTempoBlocoMs(el.currentTime * 1000);
  }

  function aoFalhar(alvo: 0 | 1) {
    if (alvo !== slot) return;
    setTocando(false);
    setErro(`Não foi possível carregar o bloco ${indice + 1}.`);
  }

  function alternarRepetir() {
    if (aoMudarLoop) aoMudarLoop(!loop);
    else setRepetirInterno((atual) => !atual);
  }

  const vazio = blocos.length === 0;
  const semDuracao = totalMs <= 0;
  const posicaoMs = Math.min(decorridoMs, totalMs);

  return (
    <div className={cn("rounded-lg border border-border bg-surface p-4", className)}>
      <audio
        ref={elementoA}
        preload="auto"
        onEnded={() => aoFimDoBloco(0)}
        onTimeUpdate={() => aoAvancarTempo(0)}
        onLoadedMetadata={() => aoCarregarMetadados(0)}
        onError={() => aoFalhar(0)}
      />
      <audio
        ref={elementoB}
        preload="auto"
        onEnded={() => aoFimDoBloco(1)}
        onTimeUpdate={() => aoAvancarTempo(1)}
        onLoadedMetadata={() => aoCarregarMetadados(1)}
        onError={() => aoFalhar(1)}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {titulo && <p className="truncate text-sm font-medium text-fg">{titulo}</p>}
          <p className="text-xs text-fg-subtle">
            {vazio ? (
              "Nenhum bloco pronto"
            ) : (
              <>
                Bloco <span className="num">{indice + 1}</span> de{" "}
                <span className="num">{blocos.length}</span>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={alternarRepetir}
          aria-pressed={repetir}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
            "transition-colors duration-[--dur-fast]",
            repetir
              ? "border-primary-border bg-primary-soft text-primary-soft-fg"
              : "border-border text-fg-muted hover:bg-surface-hover hover:text-fg",
          )}
        >
          <Repeat className="size-3.5" aria-hidden />
          Repetir
        </button>
      </div>

      <div className="mt-3">
        <input
          type="range"
          min={0}
          max={Math.max(totalMs, 1)}
          step={1000}
          value={posicaoMs}
          onChange={(evento) => irPara(Number(evento.target.value))}
          disabled={vazio || semDuracao}
          aria-label="Posição no áudio"
          aria-valuetext={
            semDuracao
              ? "Duração desconhecida"
              : `${formatarDuracao(posicaoMs)} de ${formatarDuracao(totalMs)}`
          }
          className="w-full accent-primary disabled:cursor-not-allowed disabled:opacity-50"
        />
        <div className="mt-0.5 flex items-center justify-between text-xs text-fg-subtle">
          <span className="num">{formatarDuracao(posicaoMs)}</span>
          <span className="num">{semDuracao ? "--" : formatarDuracao(totalMs)}</span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => irParaBloco(indice - 1)}
          disabled={vazio || indice === 0}
          aria-label="Bloco anterior"
          className="grid size-9 place-items-center rounded-full text-fg-muted transition-colors duration-[--dur-fast] hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
        >
          <SkipBack className="size-4" aria-hidden />
        </button>

        <button
          type="button"
          onClick={tocando ? pausar : tocar}
          disabled={vazio}
          aria-label={tocando ? "Pausar" : "Tocar"}
          className="grid size-11 place-items-center rounded-full bg-primary text-primary-fg shadow-sm transition-colors duration-[--dur-fast] hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-40"
        >
          {tocando ? (
            <Pause className="size-5" aria-hidden />
          ) : (
            <Play className="size-5 translate-x-px" aria-hidden />
          )}
        </button>

        <button
          type="button"
          onClick={() => irParaBloco(indice + 1)}
          disabled={vazio || indice >= blocos.length - 1}
          aria-label="Próximo bloco"
          className="grid size-9 place-items-center rounded-full text-fg-muted transition-colors duration-[--dur-fast] hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
        >
          <SkipForward className="size-4" aria-hidden />
        </button>
      </div>

      {erro && (
        <Alerta tom="erro" className="mt-3">
          {erro}
        </Alerta>
      )}
    </div>
  );
}
