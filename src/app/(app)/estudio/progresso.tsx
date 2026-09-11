"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines } from "lucide-react";
import { Alerta } from "@/components/ui/alerta";
import { useAvisos } from "@/components/ui/avisos";
import { Badge } from "@/components/ui/badge";
import { BarraProgresso } from "@/components/ui/barra-progresso";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Indicador } from "@/components/ui/indicador";
import { PlayerAudio } from "@/components/ui/player-audio";
import { formatarDuracao } from "@/lib/caracteres";
import type { AudioAoVivo } from "@/lib/dados/audios";
import { numero } from "@/lib/utils";

/**
 * Acompanhamento ao vivo de uma geração.
 *
 * O job de tts sintetiza bloco a bloco e pode levar minutos num áudio de 3h,
 * então a tela pergunta o estado em vez de congelar. O intervalo cresce a cada
 * volta e a aba escondida não pergunta nada: um áudio longo ficaria batendo no
 * banco por meia hora à toa.
 *
 * Quem sabe que a geração MORREU é o job, não o áudio — o handler marca o
 * áudio como 'gerando' e não volta para marcar 'falhou'. Por isso o estado de
 * falha aqui vem de `aoVivo.job`.
 */

const INTERVALO_INICIAL_MS = 2_000;
const INTERVALO_MAXIMO_MS = 10_000;
/** Três respostas ruins seguidas: para de insistir e oferece o botão. */
const FALHAS_ATE_DESISTIR = 3;

function emAndamento(vivo: AudioAoVivo) {
  if (vivo.job?.estado === "falhou" || vivo.job?.estado === "cancelado") return false;
  return vivo.estado === "na_fila" || vivo.estado === "gerando";
}

export type ProgressoProps = {
  audioId: string;
  titulo: string;
  inicial: AudioAoVivo;
  /** Modo demo: o que toca é exemplo, e a tela diz isso. */
  exemplo?: boolean;
};

export function Progresso({ audioId, titulo, inicial, exemplo }: ProgressoProps) {
  const router = useRouter();
  const avisos = useAvisos();

  const [vivo, setVivo] = useState(inicial);
  const [erroRede, setErroRede] = useState<string | null>(null);
  const [tocando, setTocando] = useState(inicial.blocos);

  const anunciou = useRef(inicial.estado === "pronto");
  const ativo = emAndamento(vivo);

  const consultar = useCallback(
    async (sinal?: AbortSignal) => {
      const resposta = await fetch(`/api/audios/${audioId}/blocos`, {
        cache: "no-store",
        signal: sinal,
      });
      if (!resposta.ok) throw new Error(`estado ${resposta.status}`);
      return (await resposta.json()) as AudioAoVivo;
    },
    [audioId],
  );

  /**
   * Tudo que muda na tela quando chega notícia nova do servidor.
   *
   * Fica aqui, no retorno da consulta, e não num efeito que observa `vivo`:
   * é uma reação a um sistema externo (a fila), não a uma mudança de render.
   */
  const aplicar = useCallback(
    (dado: AudioAoVivo) => {
      setVivo(dado);

      // A lista do player só troca quando ainda não há nada tocando ou quando a
      // geração termina. Trocar a cada bloco novo remontaria o PlayerAudio (a
      // identidade dele são os ids dos blocos) e a reprodução voltaria ao zero.
      setTocando((atual) =>
        atual.length === 0 || dado.estado === "pronto" ? dado.blocos : atual,
      );

      if (dado.estado === "pronto" && !anunciou.current) {
        anunciou.current = true;
        avisos.sucesso("Áudio pronto", `${numero(dado.blocosTotal)} blocos gerados.`);
        // O servidor desenhou saldo, propriedades e lista de recentes com os
        // números de antes da geração terminar.
        router.refresh();
      }
    },
    [avisos, router],
  );

  useEffect(() => {
    if (!ativo) return;

    const controlador = new AbortController();
    let montado = true;
    let falhas = 0;
    let voltas = 0;
    let relogio: ReturnType<typeof setTimeout> | null = null;

    function agendar() {
      voltas += 1;
      relogio = setTimeout(
        bater,
        Math.min(INTERVALO_MAXIMO_MS, INTERVALO_INICIAL_MS + voltas * 250),
      );
    }

    async function bater() {
      if (!montado) return;

      // Aba escondida não consulta: o usuário não está olhando e a fila não
      // anda mais rápido por causa disso.
      if (document.visibilityState === "hidden") {
        agendar();
        return;
      }

      try {
        const dado = await consultar(controlador.signal);
        if (!montado) return;
        falhas = 0;
        setErroRede(null);
        aplicar(dado);
        // Estado final: sai do laço em vez de bater para sempre.
        if (!emAndamento(dado)) return;
      } catch {
        if (!montado || controlador.signal.aborted) return;
        falhas += 1;
        if (falhas >= FALHAS_ATE_DESISTIR) {
          setErroRede("Perdemos o contato com o servidor. A geração continua na fila.");
          return;
        }
      }

      agendar();
    }

    agendar();

    return () => {
      montado = false;
      controlador.abort();
      if (relogio) clearTimeout(relogio);
    };
  }, [ativo, consultar, aplicar]);

  const falhou =
    vivo.estado === "falhou" ||
    vivo.job?.estado === "falhou" ||
    vivo.job?.estado === "cancelado";
  const novosBlocos = vivo.blocos.length - tocando.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {falhou ? (
          <Indicador estado="erro" texto="Geração falhou" />
        ) : vivo.estado === "pronto" ? (
          <Badge tom="sucesso">Pronto para a live</Badge>
        ) : vivo.estado === "gerando" ? (
          <Indicador estado="no_ar" texto="Gerando a fala" />
        ) : (
          <Indicador estado="pendente" texto="Na fila" />
        )}

        <p className="num text-xs text-fg-subtle">
          {numero(vivo.blocosProntos)} de {numero(vivo.blocosTotal)} blocos ·{" "}
          {formatarDuracao(vivo.duracaoMs)} gerados
        </p>
      </div>

      {vivo.blocosTotal > 0 && vivo.estado !== "pronto" && !falhou && (
        <BarraProgresso
          rotulo="Blocos gerados"
          rotuloVisivel
          valor={vivo.blocosProntos}
          maximo={vivo.blocosTotal}
          textoValor={`${numero(vivo.blocosProntos)}/${numero(vivo.blocosTotal)}`}
        />
      )}

      {falhou && (
        <Alerta tom="erro">
          A síntese não terminou e o crédito desta geração voltou para o seu saldo.{" "}
          {vivo.job?.erro && (
            <span className="font-[family-name:var(--font-mono)] text-xs">
              {vivo.job.erro}
            </span>
          )}
        </Alerta>
      )}

      {erroRede && <Alerta tom="info">{erroRede}</Alerta>}

      {exemplo && (
        <Alerta tom="info">
          Modo demonstração: os blocos abaixo são um tom de exemplo, não voz gerada.
        </Alerta>
      )}

      {tocando.length > 0 ? (
        <>
          <PlayerAudio blocos={tocando} titulo={titulo} />
          {novosBlocos > 0 && (
            <div className="flex items-center gap-3">
              <Button variante="secondary" tamanho="sm" onClick={() => setTocando(vivo.blocos)}>
                Carregar {numero(novosBlocos)} {novosBlocos === 1 ? "bloco novo" : "blocos novos"}
              </Button>
              <p className="text-xs text-fg-subtle">
                A lista só muda quando você pede: trocar no meio zeraria a reprodução.
              </p>
            </div>
          )}
        </>
      ) : falhou ? (
        <EstadoVazio
          icone={AudioLines}
          titulo="Nenhum bloco foi gerado"
          texto="O crédito voltou para o seu saldo. Você pode tentar de novo — talvez com um texto menor."
          acao={
            <Link
              href="/estudio"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
            >
              Gerar outro áudio
            </Link>
          }
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-fg-muted">
          Assim que o primeiro bloco ficar pronto, ele já toca aqui.
        </div>
      )}
    </div>
  );
}
