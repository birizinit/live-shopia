"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Bot,
  CircleStop,
  ListOrdered,
  MessageCircle,
  Radio,
  ShoppingBag,
  TriangleAlert,
  UserPlus,
  Users,
} from "lucide-react";
import { alternarModuloAcao, pararTudoAcao } from "../live/actions";
import { Alerta } from "@/components/ui/alerta";
import { useAvisos } from "@/components/ui/avisos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { ConfirmarAcao } from "@/components/ui/confirmar-acao";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Indicador } from "@/components/ui/indicador";
import { Interruptor } from "@/components/ui/interruptor";
import { formatarDuracao } from "@/lib/caracteres";
import type { EstadoLive, EventoLive, FalaDaFila, TipoEventoLive } from "@/lib/dados/live";
import { cn, numero } from "@/lib/utils";

const FUSO = "America/Sao_Paulo";

/** Teto de eventos em memória. Uma live de 3h passa de mil linhas sem isto. */
const TETO_EVENTOS = 400;

/** Intervalo do degrau de polling. Mais curto do que isto vira carga sem ganho. */
const POLLING_MS = 5_000;

/** Espera até desistir do SSE. Proxy que bufferiza não dá erro: só nunca abre. */
const PACIENCIA_MS = 8_000;

type ResumoSessao = {
  id: string;
  estado: EstadoLive;
  inicio: string;
  vistoEm: string;
  espectadoresPico: number;
  fim: string | null;
};

type Conexao = "conectando" | "ao_vivo" | "polling" | "encerrada" | "demo";

const ROTULO_CONEXAO: Record<Conexao, { texto: string; tom: "sucesso" | "alerta" | "neutro" | "info" }> = {
  conectando: { texto: "Conectando…", tom: "neutro" },
  ao_vivo: { texto: "Fluxo ao vivo (SSE)", tom: "sucesso" },
  polling: { texto: "Sem fluxo: recarregando a cada 5s", tom: "alerta" },
  encerrada: { texto: "Sessão encerrada", tom: "neutro" },
  demo: { texto: "Exemplo do modo demonstração", tom: "info" },
};

const APARENCIA: Record<
  TipoEventoLive,
  { Icone: typeof MessageCircle; cor: string; coluna: "chat" | "ia" }
> = {
  inicio: { Icone: Radio, cor: "text-fg-subtle", coluna: "chat" },
  entrada: { Icone: Users, cor: "text-fg-subtle", coluna: "chat" },
  seguidor: { Icone: UserPlus, cor: "text-info", coluna: "chat" },
  comentario: { Icone: MessageCircle, cor: "text-fg-muted", coluna: "chat" },
  resposta_ia: { Icone: Bot, cor: "text-primary", coluna: "ia" },
  venda: { Icone: ShoppingBag, cor: "text-success", coluna: "chat" },
  queda: { Icone: TriangleAlert, cor: "text-warning", coluna: "chat" },
  fim: { Icone: CircleStop, cor: "text-fg-subtle", coluna: "chat" },
  erro: { Icone: TriangleAlert, cor: "text-danger", coluna: "chat" },
};

function horario(instante: string) {
  return new Date(instante).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: FUSO,
  });
}

/** Rola para o fim só se o leitor já estava no fim. Roubar a rolagem irrita. */
function useRolagemColada(gatilho: unknown) {
  const alvo = useRef<HTMLDivElement>(null);
  const colado = useRef(true);

  useEffect(() => {
    const el = alvo.current;
    if (!el || !colado.current) return;
    el.scrollTop = el.scrollHeight;
  }, [gatilho]);

  const aoRolar = useCallback(() => {
    const el = alvo.current;
    if (!el) return;
    colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  return { alvo, aoRolar };
}

// -----------------------------------------------------------------------------
// Console
// -----------------------------------------------------------------------------

export function ConsoleAoVivo({
  sessao: sessaoInicial,
  eventos: eventosIniciais,
  fila,
}: {
  sessao: ResumoSessao;
  eventos: EventoLive[];
  fila: FalaDaFila[];
}) {
  const sessaoId = sessaoInicial.id;
  const jaEncerrada = sessaoInicial.estado === "encerrada" || sessaoInicial.estado === "caiu";

  const [eventos, setEventos] = useState<EventoLive[]>(eventosIniciais);
  const [sessao, setSessao] = useState<ResumoSessao>(sessaoInicial);
  const [conexao, setConexao] = useState<Conexao>(jaEncerrada ? "encerrada" : "conectando");

  // Ajuste no proprio render, e nao num efeito: efeito so roda depois de pintar,
  // e o painel piscaria "Conectando..." por um quadro numa sessao que ja acabou.
  const [encerradaAntes, setEncerradaAntes] = useState(jaEncerrada);
  if (jaEncerrada !== encerradaAntes) {
    setEncerradaAntes(jaEncerrada);
    setConexao(jaEncerrada ? "encerrada" : "conectando");
  }

  // O último id vive num ref, não no estado: ele é lido dentro do efeito de
  // conexão, e se fosse estado o efeito remontaria a cada evento — derrubando e
  // reabrindo o SSE o tempo todo.
  const ultimoId = useRef<number>(eventosIniciais.at(-1)?.id ?? 0);

  const juntar = useCallback((novos: EventoLive[]) => {
    if (!Array.isArray(novos) || novos.length === 0) return;

    setEventos((atuais) => {
      // Dedupe por id: SSE e polling podem entregar o mesmo evento na troca de
      // degrau, e chave repetida quebra a lista no React.
      const vistos = new Set(atuais.map((evento) => evento.id));
      const acrescentar = novos.filter((evento) => !vistos.has(evento.id));
      if (acrescentar.length === 0) return atuais;
      const juntos = [...atuais, ...acrescentar];
      return juntos.length > TETO_EVENTOS ? juntos.slice(-TETO_EVENTOS) : juntos;
    });

    const maior = novos.reduce((maximo, evento) => Math.max(maximo, evento.id), 0);
    if (maior > ultimoId.current) ultimoId.current = maior;
  }, []);

  useEffect(() => {
    // Sessao fechada nao abre fluxo nenhum: nao ha o que ouvir, e a conexao
    // ficaria aberta so para receber ping.
    if (jaEncerrada) return;

    let vivo = true;
    let fonte: EventSource | null = null;
    let relogio: ReturnType<typeof setInterval> | null = null;
    let falhas = 0;

    const fecharFonte = () => {
      fonte?.close();
      fonte = null;
    };

    const pararPolling = () => {
      if (relogio) clearInterval(relogio);
      relogio = null;
    };

    const aplicarResumo = (resumo: ResumoSessao) => {
      setSessao(resumo);
      if (resumo.estado === "encerrada" || resumo.estado === "caiu") {
        fecharFonte();
        pararPolling();
        setConexao("encerrada");
      }
    };

    const buscarPorHttp = async () => {
      try {
        const resposta = await fetch(
          `/api/live/eventos?modo=json&sessao=${encodeURIComponent(sessaoId)}&desde=${ultimoId.current}`,
          { cache: "no-store" },
        );
        if (!resposta.ok || !vivo) return;

        const dados = (await resposta.json()) as {
          eventos: EventoLive[];
          sessao: ResumoSessao;
          encerrada: boolean;
        };
        if (!vivo) return;

        juntar(dados.eventos);
        if (dados.sessao) aplicarResumo(dados.sessao);
      } catch {
        // Rede oscilando. O próximo tique tenta de novo; alarmar a cada falha
        // de uma requisição de 5s seria ruído.
      }
    };

    const cairParaPolling = () => {
      if (!vivo || relogio) return;
      fecharFonte();
      setConexao("polling");
      void buscarPorHttp();
      relogio = setInterval(() => void buscarPorHttp(), POLLING_MS);
    };

    const abrirFluxo = () => {
      if (!vivo) return;

      fonte = new EventSource(
        `/api/live/eventos?sessao=${encodeURIComponent(sessaoId)}&desde=${ultimoId.current}`,
      );

      const ouvir = (nome: string, aoReceber: (dados: unknown) => void) => {
        fonte?.addEventListener(nome, (evento) => {
          try {
            aoReceber(JSON.parse((evento as MessageEvent).data));
          } catch {
            /* payload torto não derruba o painel */
          }
        });
      };

      fonte.addEventListener("open", () => {
        falhas = 0;
        setConexao("ao_vivo");
      });

      ouvir("estado", (dados) => aplicarResumo(dados as ResumoSessao));
      ouvir("eventos", (dados) => juntar(dados as EventoLive[]));

      ouvir("fim", (dados) => {
        const motivo = (dados as { motivo?: string }).motivo;

        // "renovar" é o teto de vida do fluxo: o navegador reconecta sozinho
        // mandando Last-Event-ID, então fechar aqui só atrapalharia.
        if (motivo === "renovar") return;

        fecharFonte();
        if (motivo === "encerrada") {
          pararPolling();
          setConexao("encerrada");
        } else if (motivo === "demo") {
          setConexao("demo");
        } else {
          cairParaPolling();
        }
      });

      fonte.addEventListener("error", () => {
        if (!vivo || !fonte) return;
        falhas += 1;
        // CONNECTING significa que o próprio EventSource vai tentar de novo —
        // só se ele desistiu (CLOSED), ou se insistiu três vezes sem sucesso,
        // é que trocamos de degrau.
        if (fonte.readyState === EventSource.CLOSED || falhas >= 3) cairParaPolling();
      });
    };

    abrirFluxo();

    const paciencia = setTimeout(() => {
      if (vivo && fonte && fonte.readyState !== EventSource.OPEN) cairParaPolling();
    }, PACIENCIA_MS);

    return () => {
      // Desmontar sem isto deixa a conexão aberta segurando um LISTEN no banco.
      vivo = false;
      clearTimeout(paciencia);
      fecharFonte();
      pararPolling();
    };
  }, [sessaoId, jaEncerrada, juntar]);

  const doChat = eventos.filter((evento) => APARENCIA[evento.tipo].coluna === "chat");
  const daIa = eventos.filter((evento) => evento.tipo === "resposta_ia");
  const espectadores =
    [...eventos].reverse().find((evento) => evento.espectadores !== null)?.espectadores ?? null;

  const rotulo = ROTULO_CONEXAO[conexao];

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Indicador
            estado={
              conexao === "encerrada"
                ? "fora_do_ar"
                : sessao.estado === "ativa"
                  ? "no_ar"
                  : "pendente"
            }
            texto={
              conexao === "encerrada"
                ? "Fora do ar"
                : sessao.estado === "ativa"
                  ? "No ar"
                  : "Aguardando a extensão"
            }
          />
          <TempoNoAr inicio={sessaoInicial.inicio} fim={sessao.fim} />
          <div>
            <p className="text-xs text-fg-subtle">Espectadores agora</p>
            <p className="num text-sm font-semibold">
              {espectadores === null ? "—" : numero(espectadores)}
            </p>
          </div>
          <div>
            <p className="text-xs text-fg-subtle">Pico</p>
            <p className="num text-sm font-semibold">{numero(sessao.espectadoresPico)}</p>
          </div>
        </div>

        <Badge tom={rotulo.tom} aria-live="polite">
          {rotulo.texto}
        </Badge>
      </Card>

      {conexao === "polling" && (
        <Alerta tom="info">
          O fluxo em tempo real não subiu — costuma ser proxy ou rede corporativa
          cortando conexão longa. O painel continua atualizando, só que buscando
          de 5 em 5 segundos.
        </Alerta>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Painel
          titulo="Fila de falas"
          descricao="A montagem em laço, na ordem em que a extensão toca."
          icone={ListOrdered}
          contagem={fila.length}
        >
          {fila.length === 0 ? (
            <EstadoVazio
              titulo="Sem montagem"
              texto="Escolha a montagem ativa na sala de live."
              className="border-0"
            />
          ) : (
            <ol className="space-y-2">
              {fila.map((fala) => (
                <li
                  key={fala.id}
                  className="flex items-start gap-3 rounded-md border border-border bg-bg-subtle px-3 py-2"
                >
                  <span className="num mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-border text-xs font-semibold text-fg-subtle">
                    {fala.ordem}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{fala.titulo}</span>
                    <span className="num mt-0.5 block text-xs text-fg-subtle">
                      {formatarDuracao(fala.duracaoMs)} · {numero(fala.caracteres)} caracteres
                    </span>
                  </span>
                  {fala.estado !== "pronto" && <Badge tom="alerta">{fala.estado}</Badge>}
                </li>
              ))}
            </ol>
          )}
        </Painel>

        <ListaDeEventos
          titulo="Chat e eventos"
          descricao="Tudo que chega da live: comentários, entradas, seguidores e vendas."
          icone={MessageCircle}
          eventos={doChat}
          vazio="Nada chegou ainda. Assim que a extensão assumir, os eventos aparecem aqui."
        />

        <ListaDeEventos
          titulo="Respostas da IA"
          descricao="O que a apresentadora escreveu no chat, com o atraso de cada resposta."
          icone={Bot}
          eventos={daIa}
          vazio="Nenhuma resposta ainda. Com cadência humana, a primeira leva alguns segundos."
        />
      </div>
    </div>
  );
}

function Painel({
  titulo,
  descricao,
  icone: Icone,
  contagem,
  children,
  alvo,
  aoRolar,
}: {
  titulo: string;
  descricao: string;
  icone: typeof MessageCircle;
  contagem: number;
  children: React.ReactNode;
  alvo?: React.RefObject<HTMLDivElement | null>;
  aoRolar?: () => void;
}) {
  return (
    <Card className="flex min-w-0 flex-col p-0 sm:p-0">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Icone className="size-4 text-fg-subtle" aria-hidden />
            {titulo}
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">{descricao}</p>
        </div>
        <Badge>
          <span className="num">{numero(contagem)}</span>
        </Badge>
      </div>

      <div
        ref={alvo}
        onScroll={aoRolar}
        className="max-h-[26rem] min-h-32 overflow-y-auto overscroll-contain px-4 py-3"
      >
        {children}
      </div>
    </Card>
  );
}

function ListaDeEventos({
  titulo,
  descricao,
  icone,
  eventos,
  vazio,
}: {
  titulo: string;
  descricao: string;
  icone: typeof MessageCircle;
  eventos: EventoLive[];
  vazio: string;
}) {
  const { alvo, aoRolar } = useRolagemColada(eventos.length);

  return (
    <Painel
      titulo={titulo}
      descricao={descricao}
      icone={icone}
      contagem={eventos.length}
      alvo={alvo}
      aoRolar={aoRolar}
    >
      {eventos.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-subtle">{vazio}</p>
      ) : (
        <ul className="space-y-2.5">
          {eventos.map((evento) => (
            <LinhaEvento key={evento.id} evento={evento} />
          ))}
        </ul>
      )}
    </Painel>
  );
}

function LinhaEvento({ evento }: { evento: EventoLive }) {
  const { Icone, cor } = APARENCIA[evento.tipo];
  const centavos = Number(evento.dados?.valor_centavos ?? 0);
  const atraso = Number(evento.dados?.atraso_s ?? 0);

  return (
    <li className="flex gap-2.5">
      <Icone className={cn("mt-0.5 size-4 shrink-0", cor)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs font-medium text-fg">
            {evento.apelido ?? evento.rotulo}
          </span>
          <span className="num text-[11px] text-fg-subtle">{horario(evento.criadoEm)}</span>
          {evento.tipo === "venda" && centavos > 0 && (
            <Badge tom="sucesso">
              <span className="num">
                {(centavos / 100).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </span>
            </Badge>
          )}
          {evento.tipo === "resposta_ia" && atraso > 0 && (
            <span className="num text-[11px] text-fg-subtle">esperou {atraso}s</span>
          )}
        </p>
        <p className="mt-0.5 text-sm break-words text-fg-muted">
          {evento.texto ?? evento.rotulo}
        </p>
      </div>
    </li>
  );
}

/**
 * Cronômetro do tempo no ar.
 *
 * Só começa a contar depois de montado: renderizar "há 3 min" no servidor e
 * "há 4 min" no cliente é divergência de hidratação garantida.
 */
function TempoNoAr({ inicio, fim }: { inicio: string; fim: string | null }) {
  const [texto, setTexto] = useState<string>("—");

  useEffect(() => {
    const calcular = () => {
      const fimMs = fim ? new Date(fim).getTime() : Date.now();
      setTexto(formatarDuracao(fimMs - new Date(inicio).getTime()));
    };

    calcular();
    if (fim) return;

    const relogio = setInterval(calcular, 1000);
    return () => clearInterval(relogio);
  }, [inicio, fim]);

  return (
    <div>
      <p className="text-xs text-fg-subtle">{fim ? "Durou" : "No ar há"}</p>
      <p className="num text-sm font-semibold">{texto}</p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Kill switch
// -----------------------------------------------------------------------------

export function KillSwitch({
  licenciada,
  mixerInicial,
  chatInicial,
  chatDesligadoNaBase,
  contatoTexto,
  versao,
  temSessao,
}: {
  licenciada: boolean;
  mixerInicial: boolean;
  chatInicial: boolean;
  chatDesligadoNaBase: boolean;
  /** Já formatado no servidor: "há 2 min", "Nunca". */
  contatoTexto: string;
  versao: string | null;
  temSessao: boolean;
}) {
  const avisos = useAvisos();
  const [mixer, setMixer] = useState(mixerInicial);
  const [chat, setChat] = useState(chatInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [pendente, transicao] = useTransition();

  function alternar(modulo: "mixer" | "chat", ligado: boolean) {
    const anteriorMixer = mixer;
    const anteriorChat = chat;

    // Otimista: o interruptor responde na hora e volta sozinho se o servidor
    // recusar. Esperar a ida e volta faz o botão parecer travado.
    if (modulo === "mixer") setMixer(ligado);
    else setChat(ligado);
    setErro(null);

    transicao(async () => {
      const dados = new FormData();
      dados.set("modulo", modulo);
      dados.set("ligado", ligado ? "1" : "0");

      const resultado = await alternarModuloAcao({}, dados);
      if (resultado.ok) {
        avisos.sucesso(resultado.mensagem ?? "Pronto.");
        return;
      }

      setMixer(anteriorMixer);
      setChat(anteriorChat);
      setErro(resultado.erro ?? "Não foi possível mudar o módulo.");
    });
  }

  function pararTudo() {
    setErro(null);
    transicao(async () => {
      const resultado = await pararTudoAcao({});
      if (resultado.ok) {
        setMixer(false);
        setChat(false);
        avisos.sucesso(resultado.mensagem ?? "Tudo parado.");
        return;
      }
      setErro(resultado.erro ?? "Não foi possível parar.");
    });
  }

  return (
    <Card>
      <CardTitulo>Extensão e parada de emergência</CardTitulo>
      <CardDescricao>
        Mixer de áudio e automação de chat são recursos separados: desligar o chat
        não derruba a fala da apresentadora. Vale para esta conta, na hora — a
        extensão obedece no próximo contato.
      </CardDescricao>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-fg-subtle">Licença</dt>
          <dd className="font-medium">
            {licenciada ? (
              <Badge tom="sucesso">Ativa</Badge>
            ) : (
              <Badge tom="perigo">Sem licença</Badge>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">Último contato</dt>
          <dd className="font-medium">{contatoTexto}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">Versão</dt>
          <dd className="num font-medium">{versao ?? "—"}</dd>
        </div>
      </dl>

      {erro && (
        <Alerta tom="erro" className="mt-4">
          {erro}
        </Alerta>
      )}

      {chatDesligadoNaBase && (
        <Alerta tom="info" className="mt-4">
          A automação de chat está desligada para toda a base neste momento. O
          interruptor abaixo continua valendo, mas o chat só volta quando o
          desligamento geral sair.
        </Alerta>
      )}

      <div className="mt-5 space-y-4">
        <Interruptor
          ligado={mixer}
          aoMudar={(ligado) => alternar("mixer", ligado)}
          rotulo="Mixer de áudio"
          descricao="Joga o áudio da apresentadora no LIVE Studio. Desligado, a live fica muda."
          desabilitado={!licenciada || pendente}
        />

        <Interruptor
          ligado={chat}
          aoMudar={(ligado) => alternar("chat", ligado)}
          rotulo="Automação de chat"
          descricao="Lê os comentários e responde com a cadência configurada."
          desabilitado={!licenciada || pendente}
        />
      </div>

      <div className="mt-5 border-t border-border pt-5">
        <Button
          variante="danger"
          bloco
          onClick={() => setConfirmando(true)}
          disabled={!licenciada || pendente}
        >
          <CircleStop className="size-4" aria-hidden />
          Parar tudo agora
        </Button>
        <p className="mt-2 text-xs text-fg-subtle">
          Desliga o mixer, desliga o chat e encerra a sessão da live numa ação só.
        </p>
      </div>

      <ConfirmarAcao
        aberto={confirmando}
        aoFechar={() => setConfirmando(false)}
        titulo="Parar tudo agora?"
        rotuloConfirmar="Parar tudo"
        texto="Use quando algo estiver saindo errado no ar. É reversível: religar é um clique nos interruptores."
        perdas={[
          "O áudio da apresentadora para imediatamente",
          "As respostas automáticas no chat param",
          temSessao
            ? "A sessão da live é encerrada e entra no histórico"
            : "Nenhuma sessão aberta para encerrar",
        ]}
        aoConfirmar={() => {
          pararTudo();
          setConfirmando(false);
        }}
      />
    </Card>
  );
}
