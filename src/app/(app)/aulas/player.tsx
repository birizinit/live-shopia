"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { salvarProgresso } from "./actions";
import { Alerta } from "@/components/ui/alerta";
import { useAvisos } from "@/components/ui/avisos";
import { BarraProgresso } from "@/components/ui/barra-progresso";
import { formatarDuracao } from "@/lib/caracteres";

/**
 * Player da aula.
 *
 * O video e servido por embed do YouTube — hospedar video e caro e e problema
 * de outra empresa (ver 0009). O que este componente precisa resolver e a parte
 * que o embed sozinho nao entrega: saber ONDE o video parou, para o progresso
 * da aula existir.
 *
 * Por isso o iframe e nosso (dominio nocookie, `loading="lazy"`) e so DEPOIS e
 * promovido a player controlado pela API do YouTube. O caminho contrario —
 * deixar a API criar o iframe — devolve um iframe em `youtube.com`, sem lazy e
 * sem o titulo acessivel que o leitor de tela le.
 *
 * Se a API nao carregar, o embed continua tocando normalmente: o que se perde e
 * o registro do progresso, e a tela diz isso em vez de fingir que gravou.
 */

/** De quanto em quanto tempo se le a posicao do video. */
const INTERVALO_LEITURA_MS = 5_000;

/**
 * Quantos segundos de video precisam passar entre duas gravacoes.
 *
 * Gravar a cada leitura seria uma escrita a cada 5 s por espectador, para um
 * dado que so muda de significado no fim. 15 s perde, no pior caso, 15 s de
 * progresso de quem fechou a aba — e o `visibilitychange` cobre a maior parte
 * desse caso.
 */
const INTERVALO_ENVIO_S = 15;

const FONTE_API = "https://www.youtube.com/iframe_api";

type EventoEstado = { data: number };

type PlayerYouTube = {
  getCurrentTime: () => number;
  destroy: () => void;
};

type ApiYouTube = {
  Player: new (
    elemento: HTMLIFrameElement,
    opcoes: { events?: { onStateChange?: (evento: EventoEstado) => void } },
  ) => PlayerYouTube;
  PlayerState: { PLAYING: number };
};

type JanelaYouTube = Window & {
  YT?: ApiYouTube;
  onYouTubeIframeAPIReady?: () => void;
};

/**
 * A API do YouTube se anuncia em `window.YT` e `window.onYouTubeIframeAPIReady`.
 *
 * Um `declare global` aqui obrigaria qualquer outro arquivo do projeto a
 * declarar exatamente os mesmos tipos para a mesma propriedade — e duas
 * declaracoes diferentes de `Window.YT` param a compilacao inteira. A conversao
 * local resolve so onde o problema existe.
 */
function janela(): JanelaYouTube {
  return window as unknown as JanelaYouTube;
}

/** O script e unico na pagina: a promessa vive no modulo, nao no componente. */
let promessaApi: Promise<ApiYouTube> | null = null;

function carregarApi(): Promise<ApiYouTube> {
  if (promessaApi) return promessaApi;

  promessaApi = new Promise<ApiYouTube>((resolver, rejeitar) => {
    const alvo = janela();
    if (alvo.YT?.Player) {
      resolver(alvo.YT);
      return;
    }

    // O callback e global e dispara uma vez so. Encadear o anterior evita
    // derrubar quem ja estava esperando.
    const anterior = alvo.onYouTubeIframeAPIReady;
    alvo.onYouTubeIframeAPIReady = () => {
      anterior?.();
      const api = janela().YT;
      if (api?.Player) resolver(api);
      else rejeitar(new Error("A API do YouTube carregou sem o player."));
    };

    if (!document.querySelector(`script[src="${FONTE_API}"]`)) {
      const script = document.createElement("script");
      script.src = FONTE_API;
      script.async = true;
      script.onerror = () => rejeitar(new Error("O player do YouTube não carregou."));
      document.head.appendChild(script);
    }
  }).catch((erro: unknown) => {
    // Queda de rede nao pode envenenar a promessa para sempre: zerando o cache,
    // a proxima aula tenta de novo.
    promessaApi = null;
    throw erro;
  });

  return promessaApi;
}

export type PlayerAulaProps = {
  aulaId: string;
  titulo: string;
  /** Id de 11 caracteres. A coluna do banco guarda so isso. */
  videoYoutube: string;
  duracaoS: number | null;
  /** Onde o video conclui sozinho. Vem do servidor: o corte e regra do banco. */
  conclusaoS: number | null;
  segundosVistos: number;
  concluida: boolean;
};

export function PlayerAula({
  aulaId,
  titulo,
  videoYoutube,
  duracaoS,
  conclusaoS,
  segundosVistos,
  concluida,
}: PlayerAulaProps) {
  const router = useRouter();
  const avisos = useAvisos();

  const [posicao, setPosicao] = useState(segundosVistos);
  const [terminada, setTerminada] = useState(concluida);
  const [semAcompanhamento, setSemAcompanhamento] = useState(false);
  const [falhaEnvio, setFalhaEnvio] = useState<string | null>(null);

  const quadro = useRef<HTMLIFrameElement>(null);
  const player = useRef<PlayerYouTube | null>(null);
  const relogio = useRef<ReturnType<typeof setInterval> | null>(null);
  const ultimoEnvio = useRef(segundosVistos);
  const enviando = useRef(false);

  // O endereco sai pronto do render, e nao de um efeito: assim o embed ja vai
  // no HTML do servidor e comeca a carregar junto com a pagina.
  //
  // Sem o parametro `origin` de proposito — ele exigiria `window.location`, que
  // so existe depois da hidratacao, e trocar o `src` do iframe depois de montado
  // recarrega o video do zero. O parametro e opcional na API do YouTube.
  const parametros = new URLSearchParams({
    enablejsapi: "1",
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });
  const fonte = `https://www.youtube-nocookie.com/embed/${videoYoutube}?${parametros}`;

  const enviar = useCallback(
    async (segundos: number, forcar = false) => {
      const atual = Math.floor(segundos);
      if (!Number.isFinite(atual) || atual <= 0) return;
      if (atual <= ultimoEnvio.current) return;
      if (!forcar && atual - ultimoEnvio.current < INTERVALO_ENVIO_S) return;
      if (enviando.current) return;

      const anterior = ultimoEnvio.current;
      enviando.current = true;
      ultimoEnvio.current = atual;

      try {
        const resposta = await salvarProgresso(aulaId, atual);

        if (!resposta.ok) {
          ultimoEnvio.current = anterior;
          setFalhaEnvio(resposta.erro);
          return;
        }

        setFalhaEnvio(null);
        setPosicao((visto) => Math.max(visto, resposta.dado.segundosVistos));

        if (resposta.dado.concluida) setTerminada(true);

        if (resposta.dado.concluidaAgora) {
          avisos.sucesso("Aula concluída", "Ela já aparece marcada na lista.");
          // A lista e o cabecalho vivem no servidor; sem isto continuariam
          // mostrando a aula em aberto ate a proxima navegacao.
          router.refresh();
        }
      } catch {
        ultimoEnvio.current = anterior;
        setFalhaEnvio("O progresso não chegou ao servidor. Tentamos de novo no próximo trecho.");
      } finally {
        enviando.current = false;
      }
    },
    [aulaId, avisos, router],
  );

  /**
   * O player e criado UMA vez por montagem. Guardar `enviar` num ref (em vez de
   * na lista de dependencias) e o que garante isso: qualquer identidade nova da
   * funcao recriaria o player, e `destroy()` tira do DOM um iframe que o React
   * ainda considera seu.
   */
  const enviarRef = useRef(enviar);
  useEffect(() => {
    enviarRef.current = enviar;
  }, [enviar]);

  useEffect(() => {
    const elemento = quadro.current;
    if (!elemento) return;

    let vivo = true;

    function pararRelogio() {
      if (relogio.current) clearInterval(relogio.current);
      relogio.current = null;
    }

    function ler() {
      const atual = player.current;
      if (!atual) return;

      const segundos = Math.floor(atual.getCurrentTime());
      // A posicao na tela nunca volta, igual ao que o banco faz: rever um
      // trecho nao pode parecer desfazer o que ja foi assistido.
      setPosicao((visto) => Math.max(visto, segundos));
      void enviarRef.current(segundos);
    }

    carregarApi()
      .then((api) => {
        if (!vivo) return;

        player.current = new api.Player(elemento, {
          events: {
            onStateChange: (evento) => {
              if (evento.data === api.PlayerState.PLAYING) {
                pararRelogio();
                relogio.current = setInterval(ler, INTERVALO_LEITURA_MS);
                return;
              }

              // Pausou, acabou ou foi para o buffer: e o momento certo de
              // gravar sem esperar a janela de 15 s.
              pararRelogio();
              const atual = player.current;
              if (atual) void enviarRef.current(atual.getCurrentTime(), true);
            },
          },
        });
      })
      .catch(() => {
        if (vivo) setSemAcompanhamento(true);
      });

    return () => {
      vivo = false;
      pararRelogio();
      try {
        player.current?.destroy();
      } catch {
        // `destroy()` tira o iframe do DOM. Se o React chegou primeiro, a
        // chamada estoura — e nao ha nada a fazer, ja esta desmontado.
      }
      player.current = null;
    };
  }, []);

  // Trocar de aba ou minimizar e como a maioria das pessoas sai da aula. Sem
  // este descarregamento, o ultimo trecho assistido se perderia.
  useEffect(() => {
    function aoEsconder() {
      if (document.visibilityState !== "hidden") return;
      const atual = player.current;
      if (atual) void enviarRef.current(atual.getCurrentTime(), true);
    }

    document.addEventListener("visibilitychange", aoEsconder);
    return () => document.removeEventListener("visibilitychange", aoEsconder);
  }, []);

  const assistido = formatarDuracao(posicao * 1000);

  return (
    <div className="space-y-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-bg-subtle">
        <iframe
          ref={quadro}
          src={fonte}
          title={`Aula em vídeo: ${titulo}`}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute inset-0 size-full border-0"
        />
      </div>

      {duracaoS ? (
        <BarraProgresso
          rotulo="Progresso da aula"
          rotuloVisivel
          valor={Math.min(posicao, duracaoS)}
          maximo={duracaoS}
          tom={terminada ? "sucesso" : "primaria"}
          textoValor={`${assistido} de ${formatarDuracao(duracaoS * 1000)}`}
        />
      ) : (
        <p className="text-sm text-fg-muted">
          Assistido até <span className="num font-medium text-fg">{assistido}</span>.
        </p>
      )}

      {terminada && (
        <p className="flex items-center gap-2 text-sm font-medium text-success">
          <CircleCheck className="size-4 shrink-0" aria-hidden />
          Aula concluída.
        </p>
      )}

      {!terminada && conclusaoS !== null && (
        <p className="text-sm text-fg-subtle">
          A aula conclui sozinha em{" "}
          <span className="num">{formatarDuracao(conclusaoS * 1000)}</span> — não é
          preciso esperar os créditos do vídeo.
        </p>
      )}

      {conclusaoS === null && (
        <Alerta tom="info">
          Esta aula ainda não tem a duração cadastrada, então ela não conclui
          sozinha. O tempo assistido continua sendo guardado.
        </Alerta>
      )}

      {semAcompanhamento && (
        <Alerta tom="info">
          O vídeo toca normalmente, mas o player do YouTube não respondeu: o
          progresso desta sessão não será guardado.
        </Alerta>
      )}

      {falhaEnvio && <Alerta tom="erro">{falhaEnvio}</Alerta>}
    </div>
  );
}
