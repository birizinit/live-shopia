"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Coins,
  ListMusic,
  Plus,
  Radio,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import { ativarAcao, criarAcao, excluirAcao, salvarAcao, type EstadoMontador } from "./actions";
import { Alerta } from "@/components/ui/alerta";
import { useAvisos } from "@/components/ui/avisos";
import { Badge } from "@/components/ui/badge";
import { BarraProgresso } from "@/components/ui/barra-progresso";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { ConfirmarAcao } from "@/components/ui/confirmar-acao";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Campo, Input } from "@/components/ui/input";
import { Interruptor } from "@/components/ui/interruptor";
import { PlayerAudio } from "@/components/ui/player-audio";
import { Propriedade, Propriedades } from "@/components/ui/propriedades";
import { Selecao } from "@/components/ui/selecao";
import { formatarDuracao } from "@/lib/caracteres";
import { cn, numero } from "@/lib/utils";
import type { AudioPronto, Montagem, MontagemResumo, Trilha } from "@/lib/dados/montagens";

/**
 * Montador do áudio contínuo da live.
 *
 * A lista mora em estado local e é gravada de uma vez no botão salvar, em vez
 * de uma ação de servidor por clique. Dois motivos: reordenar com o teclado
 * precisa responder no mesmo quadro (uma ida ao servidor por seta perde o foco
 * e a noção de onde se está), e a prévia tem que tocar a ordem que está na
 * tela, não a última que foi salva.
 *
 * Nada aqui gasta crédito: montar, reordenar e repetir mexem em áudio que já
 * foi pago uma vez na geração. É o que a tela precisa deixar explícito.
 */

/** Live de referência para a barra de cobertura: 3 h (docs/PLANO.md §5). */
const META_LIVE_MS = 3 * 60 * 60 * 1000;
/** Um dia inteiro no ar — o argumento de venda do laço. */
const DIA_MS = 24 * 60 * 60 * 1000;

const INICIAL: EstadoMontador = {};

export type MontadorProps = {
  montagem: Montagem | null;
  montagens: MontagemResumo[];
  catalogo: AudioPronto[];
  trilhas: Trilha[];
  tetoItens: number;
  /** Sessão demo: a tela navega inteira, mas nada é salvo e não há bloco real. */
  demo: boolean;
  /** O catálogo bateu no teto — o resto dos áudios está na biblioteca. */
  catalogoCortado: boolean;
};

function decimal(valor: number, casas = 1) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas,
  }).format(valor);
}

/** Dispara um aviso passageiro a cada resposta nova da ação. */
function useAvisoDeAcao(estado: EstadoMontador, tituloOk: string, tituloErro: string) {
  const avisos = useAvisos();
  const visto = useRef(0);

  useEffect(() => {
    const carimbo = estado.carimbo ?? 0;
    if (!carimbo || carimbo === visto.current) return;
    visto.current = carimbo;

    if (estado.erro) avisos.erro(tituloErro, estado.erro);
    else if (estado.mensagem) avisos.sucesso(tituloOk, estado.mensagem);
  }, [estado, avisos, tituloOk, tituloErro]);
}

export function Montador(props: MontadorProps) {
  if (!props.montagem) {
    return (
      <EstadoVazio
        icone={ListMusic}
        titulo="Nenhuma montagem ainda"
        texto="A montagem é a lista de áudios que a extensão toca em laço durante a live. Gerar a voz cobra crédito uma vez; repetir a lista, nenhuma."
        acao={<FormNovaMontagem rotulo="Criar a primeira montagem" variante="primary" />}
      />
    );
  }

  // Trocar de montagem troca o dono do estado local: remontar é o jeito de não
  // carregar a lista de uma para dentro da outra.
  return <Editor key={props.montagem.id} {...props} montagem={props.montagem} />;
}

type EditorProps = Omit<MontadorProps, "montagem"> & { montagem: Montagem };

type AlvoFoco = "subir" | "descer" | "remover";

function Editor({
  montagem,
  montagens,
  catalogo,
  trilhas,
  tetoItens,
  demo,
  catalogoCortado,
}: EditorProps) {
  const avisos = useAvisos();

  // Áudio que saiu do catálogo (apagado, ou que voltou a não estar pronto) é
  // descartado já na entrada: mantê-lo faria a lista da tela nunca coincidir
  // com a que o servidor aceita gravar, e o aviso de "não salvo" ficaria preso.
  const [itens, setItens] = useState<string[]>(() =>
    montagem.audios.filter((id) => catalogo.some((audio) => audio.id === id)),
  );
  const [nome, setNome] = useState(montagem.nome);
  // Mesma limpeza da lista: trilha que saiu do catálogo vira "sem trilha", em
  // vez de um <select> apontando para uma opção que não existe mais.
  const [trilhaId, setTrilhaId] = useState(() =>
    montagem.trilhaId && trilhas.some((trilha) => trilha.id === montagem.trilhaId)
      ? montagem.trilhaId
      : "",
  );
  const [volume, setVolume] = useState(montagem.volumeTrilha);
  const [intervalo, setIntervalo] = useState(montagem.intervaloMs);
  const [embaralhar, setEmbaralhar] = useState(montagem.embaralhar);
  const [escolhido, setEscolhido] = useState("");
  const [repetir, setRepetir] = useState(true);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [recado, setRecado] = useState("");

  const [estadoSalvar, salvar, salvando] = useActionState(salvarAcao, INICIAL);
  const [estadoAtivar, ativar, ativando] = useActionState(ativarAcao, INICIAL);

  useAvisoDeAcao(estadoSalvar, "Montagem salva", "Não deu para salvar");
  useAvisoDeAcao(estadoAtivar, "Pronto", "Não deu para mudar o estado");

  const idNome = useId();
  const idTrilha = useId();
  const idVolume = useId();
  const idIntervalo = useId();
  const idEscolha = useId();

  const seletor = useRef<HTMLSelectElement>(null);
  const botoes = useRef(
    new Map<string, Partial<Record<AlvoFoco, HTMLButtonElement | null>>>(),
  );
  const focoPendente = useRef<{ id: string; alvo: AlvoFoco } | null>(null);

  // O foco tem que seguir o item que se moveu. Quando ele chega à ponta, o
  // botão que estava em foco desabilita — e sem este remanejo o foco volta para
  // o corpo da página e quem usa teclado perde o lugar no meio da ordenação.
  useEffect(() => {
    const pendente = focoPendente.current;
    if (!pendente) return;
    focoPendente.current = null;

    const par = botoes.current.get(pendente.id);
    if (!par) {
      seletor.current?.focus();
      return;
    }

    const preferido = par[pendente.alvo];
    const alvo =
      preferido && !preferido.disabled
        ? preferido
        : ([par.subir, par.descer, par.remover].find((botao) => botao && !botao.disabled) ??
          null);

    if (alvo) alvo.focus();
    else seletor.current?.focus();
  }, [itens]);

  const porId = useMemo(
    () => new Map(catalogo.map((audio) => [audio.id, audio])),
    [catalogo],
  );

  const selecionados = useMemo(
    () =>
      itens
        .map((id) => porId.get(id))
        .filter((audio): audio is AudioPronto => Boolean(audio)),
    [itens, porId],
  );

  const disponiveis = useMemo(
    () => catalogo.filter((audio) => !itens.includes(audio.id)),
    [catalogo, itens],
  );

  const blocos = useMemo(
    () => selecionados.flatMap((audio) => audio.blocos),
    [selecionados],
  );

  const duracaoSomaMs = selecionados.reduce((soma, audio) => soma + audio.duracaoMs, 0);
  // O intervalo entra depois de cada bloco, inclusive antes de recomeçar: é
  // assim que a extensão toca, então é assim que a conta tem que fechar.
  const duracaoLacoMs = duracaoSomaMs + intervalo * selecionados.length;
  const caracteresTotal = selecionados.reduce((soma, audio) => soma + audio.caracteres, 0);
  const voltasNaMeta = duracaoLacoMs > 0 ? META_LIVE_MS / duracaoLacoMs : 0;
  const voltasNoDia = duracaoLacoMs > 0 ? DIA_MS / duracaoLacoMs : 0;
  const semBlocos = selecionados.some((audio) => audio.blocos.length === 0);

  // A assinatura compara o que está na tela com o que o servidor devolveu. Um
  // salvamento bem-sucedido revalida a página, a prop muda e o aviso de "não
  // salvo" some sozinho — sem estado paralelo para esquecer de limpar.
  const salvo =
    JSON.stringify([
      montagem.nome,
      montagem.trilhaId ?? "",
      montagem.volumeTrilha,
      montagem.intervaloMs,
      montagem.embaralhar,
      montagem.audios,
    ]) === JSON.stringify([nome, trilhaId, volume, intervalo, embaralhar, itens]);

  function registrar(id: string, alvo: AlvoFoco, elemento: HTMLButtonElement | null) {
    const par = botoes.current.get(id) ?? {};
    par[alvo] = elemento;
    botoes.current.set(id, par);
  }

  function mover(indice: number, passo: number) {
    const destino = indice + passo;
    if (destino < 0 || destino >= itens.length) return;

    const id = itens[indice]!;
    const audio = porId.get(id);

    setItens((lista) => {
      const copia = [...lista];
      const [movido] = copia.splice(indice, 1);
      copia.splice(destino, 0, movido!);
      return copia;
    });

    focoPendente.current = { id, alvo: passo < 0 ? "subir" : "descer" };
    setRecado(
      `${audio?.titulo ?? "Áudio"} foi para a posição ${destino + 1} de ${itens.length}.`,
    );
  }

  function remover(indice: number) {
    const audio = porId.get(itens[indice]!);
    const vizinho = itens[indice + 1] ?? itens[indice - 1] ?? null;

    setItens((lista) => lista.filter((_, posicao) => posicao !== indice));

    focoPendente.current = vizinho ? { id: vizinho, alvo: "remover" } : null;
    if (!vizinho) seletor.current?.focus();
    setRecado(`${audio?.titulo ?? "Áudio"} saiu da montagem.`);
  }

  function adicionar() {
    if (!escolhido) return;

    if (itens.length >= tetoItens) {
      avisos.alerta(
        "Lista cheia",
        `Uma montagem aceita até ${tetoItens} áudios. Em laço, isso já cobre qualquer live.`,
      );
      return;
    }

    const audio = porId.get(escolhido);
    setItens((lista) => (lista.includes(escolhido) ? lista : [...lista, escolhido]));
    setRecado(`${audio?.titulo ?? "Áudio"} entrou no fim da lista.`);
    setEscolhido("");
  }

  async function excluir() {
    const resposta = await excluirAcao(montagem.id);
    if (resposta?.erro) avisos.erro("Não deu para excluir", resposta.erro);
    setConfirmandoExclusao(false);
  }

  const opcoesTrilha = [
    { valor: "", rotulo: "Sem trilha de ambiente" },
    ...trilhas.map((trilha) => ({ valor: trilha.id, rotulo: trilha.nome })),
  ];

  const trilhaEscolhida = trilhas.find((trilha) => trilha.id === trilhaId) ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-fg"
            aria-hidden
          >
            <Coins className="size-5" />
          </span>

          <div className="min-w-0 flex-1">
            <CardTitulo>Gerar custa crédito. Repetir não custa nada.</CardTitulo>
            <CardDescricao>
              O crédito é medido em caracteres e sai uma única vez, quando a voz é
              sintetizada no estúdio. A montagem só decide em que ordem esses áudios
              tocam: a extensão repete a lista o tempo que a live durar, e nenhuma
              repetição escreve na sua conta.
            </CardDescricao>

            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border p-3">
                <dt className="text-xs text-fg-subtle">Já gerado nesta lista</dt>
                <dd className="num mt-0.5 text-lg font-semibold">
                  {numero(caracteresTotal)}
                </dd>
                <dd className="text-xs text-fg-muted">caracteres, cobrados uma vez</dd>
              </div>

              <div className="rounded-md border border-border p-3">
                <dt className="text-xs text-fg-subtle">Para rodar 24 h em laço</dt>
                <dd className="num mt-0.5 text-lg font-semibold text-success">0</dd>
                <dd className="text-xs text-fg-muted">
                  caracteres a mais —{" "}
                  <span className="num">{decimal(voltasNoDia)}</span> voltas na mesma lista
                </dd>
              </div>

              <div className="rounded-md border border-border p-3">
                <dt className="text-xs text-fg-subtle">Se mandar gerar de novo</dt>
                <dd className="num mt-0.5 text-lg font-semibold text-warning">
                  −{numero(caracteresTotal)}
                </dd>
                <dd className="text-xs text-fg-muted">
                  caracteres cobrados outra vez — só vale a pena se o roteiro mudou
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="min-w-0 space-y-4">
          <form action={salvar} className="space-y-4">
            <input type="hidden" name="montagemId" value={montagem.id} />
            <input type="hidden" name="audios" value={JSON.stringify(itens)} />
            <input type="hidden" name="embaralhar" value={embaralhar ? "1" : "0"} />

            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitulo>A lista que vai ao ar</CardTitulo>
                  <CardDescricao>
                    A ordem aqui é a ordem da live. No fim da lista, a extensão volta
                    para o primeiro áudio e recomeça.
                  </CardDescricao>
                </div>
                {!salvo && <Badge tom="alerta">Não salvo</Badge>}
              </div>

              <div className="mt-4 max-w-md">
                <Campo rotulo="Nome da montagem" htmlFor={idNome}>
                  {/* `maxLength` corta por unidade UTF-16 e por isso é proibido em
                      texto cobrável (ver AreaTexto). Aqui é só o nome da lista:
                      não vira crédito, e o corte fino por code point acontece no
                      servidor. O teto no campo evita digitar o que seria truncado. */}
                  <Input
                    id={idNome}
                    name="nome"
                    value={nome}
                    onChange={(evento) => setNome(evento.target.value)}
                    placeholder="Live do secador — 24h"
                    maxLength={80}
                    required
                  />
                </Campo>
              </div>

              {selecionados.length === 0 ? (
                <EstadoVazio
                  className="mt-4"
                  icone={ListMusic}
                  titulo="Lista vazia"
                  texto={
                    catalogo.length === 0
                      ? "Você ainda não tem áudio pronto. O áudio nasce no estúdio, a partir de um roteiro e de uma voz."
                      : "Escolha abaixo o primeiro áudio. Ele é o que abre a live."
                  }
                  acao={
                    catalogo.length === 0 ? (
                      <Link
                        href="/estudio"
                        className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
                      >
                        Ir para o estúdio
                      </Link>
                    ) : undefined
                  }
                />
              ) : (
                <ol className="mt-4 space-y-2">
                  {selecionados.map((audio, indice) => (
                    <li
                      key={audio.id}
                      onKeyDown={(evento) => {
                        // Atalho para quem já entendeu a tela: Alt + seta move o
                        // item em foco sem precisar mirar no botão certo.
                        if (!evento.altKey) return;
                        if (evento.key === "ArrowUp") {
                          evento.preventDefault();
                          mover(indice, -1);
                        } else if (evento.key === "ArrowDown") {
                          evento.preventDefault();
                          mover(indice, 1);
                        }
                      }}
                      className="flex items-center gap-3 rounded-md border border-border bg-surface p-3"
                    >
                      <span className="num grid size-7 shrink-0 place-items-center rounded-full border border-border text-xs font-semibold text-fg-subtle">
                        {indice + 1}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{audio.titulo}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
                          <span className="num">{formatarDuracao(audio.duracaoMs)}</span>
                          <span aria-hidden>·</span>
                          <span className="truncate">{audio.vozNome}</span>
                          <span aria-hidden>·</span>
                          <span className="num">
                            {numero(audio.caracteres)} caracteres
                          </span>
                          {audio.exemplo && <Badge tom="alerta">Voz de exemplo</Badge>}
                          {audio.blocos.length === 0 && (
                            <Badge tom="perigo">Sem blocos para tocar</Badge>
                          )}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variante="ghost"
                          tamanho="sm"
                          className="size-8 px-0"
                          aria-label={`Subir ${audio.titulo}`}
                          disabled={indice === 0}
                          onClick={() => mover(indice, -1)}
                          ref={(elemento) => {
                            registrar(audio.id, "subir", elemento);
                          }}
                        >
                          <ArrowUp className="size-4" aria-hidden />
                        </Button>

                        <Button
                          variante="ghost"
                          tamanho="sm"
                          className="size-8 px-0"
                          aria-label={`Descer ${audio.titulo}`}
                          disabled={indice === selecionados.length - 1}
                          onClick={() => mover(indice, 1)}
                          ref={(elemento) => {
                            registrar(audio.id, "descer", elemento);
                          }}
                        >
                          <ArrowDown className="size-4" aria-hidden />
                        </Button>

                        <Button
                          variante="ghost"
                          tamanho="sm"
                          className="size-8 px-0 hover:text-danger"
                          aria-label={`Tirar ${audio.titulo} da montagem`}
                          onClick={() => remover(indice)}
                          ref={(elemento) => {
                            registrar(audio.id, "remover", elemento);
                          }}
                        >
                          <X className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              <p className="mt-3 text-xs text-fg-subtle">
                Ordene pelas setas de cada linha. Com o foco numa linha,{" "}
                <kbd className="rounded-sm border border-border px-1 font-[family-name:var(--font-mono)]">
                  Alt
                </kbd>{" "}
                +{" "}
                <kbd className="rounded-sm border border-border px-1 font-[family-name:var(--font-mono)]">
                  ↑
                </kbd>{" "}
                <kbd className="rounded-sm border border-border px-1 font-[family-name:var(--font-mono)]">
                  ↓
                </kbd>{" "}
                move o áudio direto.
              </p>

              {/* Região presente desde o primeiro render: leitor de tela só
                  anuncia mudança dentro de um aria-live que já estava no DOM. */}
              <p aria-live="polite" className="sr-only">
                {recado}
              </p>

              <div className="mt-4 border-t border-border pt-4">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-56 flex-1">
                    <Campo
                      rotulo="Adicionar áudio pronto"
                      htmlFor={idEscolha}
                      dica={
                        disponiveis.length === 0
                          ? "Todos os áudios prontos já estão na lista."
                          : `${numero(disponiveis.length)} ${disponiveis.length === 1 ? "áudio disponível" : "áudios disponíveis"}.`
                      }
                    >
                      <Selecao
                        id={idEscolha}
                        ref={seletor}
                        placeholder="Escolha um áudio"
                        value={escolhido}
                        onChange={(evento) => setEscolhido(evento.target.value)}
                        disabled={disponiveis.length === 0}
                        opcoes={disponiveis.map((audio) => ({
                          valor: audio.id,
                          rotulo: `${audio.titulo} · ${formatarDuracao(audio.duracaoMs)} · ${audio.vozNome}`,
                        }))}
                      />
                    </Campo>
                  </div>

                  <Button
                    variante="secondary"
                    onClick={adicionar}
                    disabled={!escolhido || itens.length >= tetoItens}
                  >
                    <Plus className="size-4" aria-hidden />
                    Adicionar
                  </Button>
                </div>

                {catalogoCortado && (
                  <p className="mt-2 text-xs text-fg-subtle">
                    Mostrando os áudios mais recentes. O resto está na{" "}
                    <Link href="/biblioteca" className="text-primary hover:underline">
                      biblioteca
                    </Link>
                    .
                  </p>
                )}
              </div>
            </Card>

            <Card>
              <CardTitulo>Como a live soa</CardTitulo>
              <CardDescricao>
                Estes ajustes viajam com a montagem, e quem aplica os quatro é a
                extensão, durante a transmissão.
              </CardDescricao>

              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <Campo
                  rotulo="Trilha de ambiente"
                  htmlFor={idTrilha}
                  dica={
                    trilhas.length === 0
                      ? "Nenhuma trilha cadastrada ainda — a live vai só com a voz."
                      : (trilhaEscolhida?.descricao ??
                        "Som de fundo para a live não soar sintética.")
                  }
                >
                  {/* Sem trilha cadastrada o campo fica com uma opção só, e não
                      desabilitado: campo desabilitado não é enviado, e a escolha
                      guardada seria apagada em cada salvamento. */}
                  <Selecao
                    id={idTrilha}
                    name="trilha"
                    value={trilhaId}
                    onChange={(evento) => setTrilhaId(evento.target.value)}
                    opcoes={opcoesTrilha}
                  />
                </Campo>

                <Campo
                  rotulo={`Volume da trilha: ${volume}%`}
                  htmlFor={idVolume}
                  dica={
                    trilhaId
                      ? "Acima de uns 20% a trilha começa a disputar com a voz."
                      : "Fica guardado e passa a valer quando você escolher uma trilha."
                  }
                >
                  {/* O campo continua ativo sem trilha de propósito: desabilitar
                      tiraria o valor do envio e o ajuste voltaria para o padrão. */}
                  <input
                    id={idVolume}
                    name="volume"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={volume}
                    onChange={(evento) => setVolume(Number(evento.target.value))}
                    className="h-10 w-full accent-primary"
                  />
                </Campo>

                <Campo
                  rotulo={`Intervalo entre blocos: ${decimal(intervalo / 1000)} s`}
                  htmlFor={idIntervalo}
                  dica="A respiração entre um áudio e o próximo. Zero soa robótico; acima de 3 s soa travado."
                >
                  <input
                    id={idIntervalo}
                    name="intervalo"
                    type="range"
                    min={0}
                    max={10000}
                    step={100}
                    value={intervalo}
                    onChange={(evento) => setIntervalo(Number(evento.target.value))}
                    className="h-10 w-full accent-primary"
                  />
                </Campo>

                <div className="flex items-center">
                  <Interruptor
                    ligado={embaralhar}
                    aoMudar={setEmbaralhar}
                    rotulo="Embaralhar a cada volta"
                    descricao="Sorteia a ordem quando a lista recomeça. Quem entrou no meio da live não ouve a mesma sequência."
                  />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <Button type="submit" disabled={salvando || salvo}>
                  {salvando ? "Salvando…" : "Salvar montagem"}
                </Button>
                <p className="text-xs text-fg-subtle">
                  Salvar não gasta crédito — nenhuma ação desta tela gasta.
                </p>
              </div>

              {estadoSalvar.erro && (
                <Alerta tom="erro" className="mt-3">
                  {estadoSalvar.erro}
                </Alerta>
              )}
            </Card>
          </form>

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitulo>Prévia da montagem</CardTitulo>
                <CardDescricao>
                  Toca os blocos de todos os áudios em sequência, como a live vai
                  tocar. Ouvir aqui também não gasta crédito.
                </CardDescricao>
              </div>
              <Badge tom={repetir ? "marca" : "neutro"}>
                <Repeat className="mr-1 size-3" aria-hidden />
                {repetir ? "Em laço" : "Uma volta"}
              </Badge>
            </div>

            {demo && (
              <Alerta tom="info" className="mt-4">
                Modo demonstração: no lugar da voz, cada bloco é um bipe de oito
                segundos. O encadeamento e o laço são os de verdade — é exatamente
                assim que a extensão toca na live.
              </Alerta>
            )}

            <PlayerAudio
              className="mt-4"
              titulo={nome || montagem.nome}
              blocos={blocos}
              loop={repetir}
              aoMudarLoop={setRepetir}
            />

            <p className="mt-2 text-xs text-fg-subtle">
              A prévia emenda os blocos direto: o intervalo de{" "}
              <span className="num">{decimal(intervalo / 1000)} s</span> e a trilha de
              ambiente são aplicados pela extensão, na hora da live.
              {embaralhar && " Na live, a ordem ainda é sorteada a cada volta."}
            </p>

            {semBlocos && (
              <Alerta tom="erro" className="mt-3">
                Um dos áudios da lista não tem bloco pronto para tocar e vai ser pulado.
                Gere esse áudio de novo no estúdio.
              </Alerta>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardTitulo>Quanto de live isso cobre</CardTitulo>

            <div className="mt-4">
              <BarraProgresso
                rotulo="Áudio sem repetir, numa live de 3 h"
                rotuloVisivel
                valor={duracaoLacoMs}
                maximo={META_LIVE_MS}
                tom={duracaoLacoMs >= META_LIVE_MS ? "sucesso" : "primaria"}
                textoValor={`${formatarDuracao(duracaoLacoMs)} de 3h`}
              />
              <p className="mt-2 text-xs text-fg-muted">
                A barra mede o áudio <strong className="font-medium text-fg">sem repetir</strong>.
                Em laço, a lista cobre quantas horas a live durar — quem acaba é a
                live, não o áudio.
              </p>
            </div>

            <Propriedades className="mt-4">
              <Propriedade
                rotulo="Áudios na lista"
                numerica
                valor={`${numero(selecionados.length)} de ${numero(tetoItens)}`}
              />
              <Propriedade
                rotulo="Soma dos áudios"
                numerica
                valor={formatarDuracao(duracaoSomaMs)}
              />
              <Propriedade
                rotulo="Com os intervalos"
                numerica
                valor={formatarDuracao(duracaoLacoMs)}
              />
              <Propriedade
                rotulo="Voltas numa live de 3 h"
                numerica
                valor={duracaoLacoMs > 0 ? decimal(voltasNaMeta) : "—"}
              />
              <Propriedade
                rotulo="Custo de repetir"
                valor={<span className="num text-success">0 caracteres</span>}
              />
            </Propriedades>

            <p className="mt-3 text-xs text-fg-muted">
              {duracaoLacoMs >= META_LIVE_MS
                ? "Três horas sem ninguém ouvir a mesma fala duas vezes."
                : duracaoLacoMs > 0
                  ? `Faltam ${formatarDuracao(META_LIVE_MS - duracaoLacoMs)} de áudio para uma live de 3 h sem repetição. Até lá, a lista repete — o que funciona, só é mais perceptível.`
                  : "Adicione áudios para saber quanto de live esta montagem cobre."}
            </p>
          </Card>

          <Card>
            <CardTitulo>No ar</CardTitulo>
            <CardDescricao>
              Uma montagem ativa por conta: é dela que a extensão puxa o áudio quando a
              live sobe.
            </CardDescricao>

            <div className="mt-4 flex items-center gap-2">
              {montagem.ativa ? (
                <Badge tom="sucesso">
                  <Radio className="mr-1 size-3" aria-hidden />
                  Esta é a montagem ativa
                </Badge>
              ) : (
                <Badge>Fora do ar</Badge>
              )}
            </div>

            <form action={ativar} className="mt-4">
              <input type="hidden" name="montagemId" value={montagem.id} />
              <input type="hidden" name="ligar" value={montagem.ativa ? "0" : "1"} />
              <Button
                type="submit"
                bloco
                variante={montagem.ativa ? "secondary" : "primary"}
                disabled={ativando || (!montagem.ativa && (!salvo || itens.length === 0))}
              >
                {ativando
                  ? "Aplicando…"
                  : montagem.ativa
                    ? "Tirar do ar"
                    : "Colocar esta no ar"}
              </Button>
            </form>

            {!montagem.ativa && itens.length === 0 && (
              <p className="mt-2 text-xs text-warning">
                Uma montagem vazia não tem o que tocar. Adicione ao menos um áudio.
              </p>
            )}

            {!montagem.ativa && itens.length > 0 && !salvo && (
              <p className="mt-2 text-xs text-warning">
                Salve as alterações antes de colocar no ar: o que vai ao ar é o que está
                gravado, não o que está na tela.
              </p>
            )}

            {estadoAtivar.erro && (
              <Alerta tom="erro" className="mt-3">
                {estadoAtivar.erro}
              </Alerta>
            )}
          </Card>

          <Card>
            <CardTitulo>Suas montagens</CardTitulo>

            <ul className="mt-3 space-y-1.5">
              {montagens.map((outra) => {
                const atual = outra.id === montagem.id;
                return (
                  <li key={outra.id}>
                    <Link
                      href={`/audio?m=${outra.id}`}
                      aria-current={atual ? "page" : undefined}
                      className={cn(
                        "block rounded-md border px-3 py-2 transition-colors duration-[--dur-fast]",
                        atual
                          ? "border-primary-border bg-primary-soft"
                          : "border-border hover:bg-surface-hover",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{outra.nome}</span>
                        {outra.ativa && <Badge tom="sucesso">No ar</Badge>}
                      </span>
                      <span className="mt-0.5 block text-xs text-fg-subtle">
                        <span className="num">{numero(outra.itens)}</span>{" "}
                        {outra.itens === 1 ? "áudio" : "áudios"} ·{" "}
                        <span className="num">{formatarDuracao(outra.duracaoMs)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="mt-3 space-y-2">
              <FormNovaMontagem bloco />
              <Button
                variante="ghost"
                bloco
                className="text-danger hover:bg-danger-soft"
                onClick={() => setConfirmandoExclusao(true)}
              >
                <Trash2 className="size-4" aria-hidden />
                Excluir esta montagem
              </Button>
            </div>
          </Card>

          <Card className="bg-bg-subtle shadow-none">
            <div className="flex gap-3">
              <Clock className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
              <p className="text-xs text-fg-muted">
                O áudio contínuo de 3 h não existe como arquivo: são blocos de até 2.400
                caracteres tocados em sequência. É o que permite servir a live sem
                materializar um arquivo gigante — e é o que faz o laço sair de graça.
              </p>
            </div>
          </Card>
        </aside>
      </div>

      <ConfirmarAcao
        aberto={confirmandoExclusao}
        aoFechar={() => setConfirmandoExclusao(false)}
        aoConfirmar={excluir}
        titulo="Excluir a montagem"
        texto="Os áudios continuam na sua biblioteca — o que some é a lista e os ajustes."
        perdas={[
          `A ordem dos ${numero(montagem.audios.length)} áudios desta montagem`,
          "A trilha, o volume e o intervalo escolhidos",
          ...(montagem.ativa
            ? ["A montagem no ar: a live fica sem áudio até você ativar outra"]
            : []),
        ]}
        rotuloConfirmar="Excluir montagem"
        exigirTexto={montagem.nome}
      />
    </div>
  );
}

/**
 * Criar montagem é ação com resposta: em modo demo ela falha de propósito, e o
 * usuário precisa ler o porquê em vez de cair numa tela de erro.
 */
function FormNovaMontagem({
  rotulo = "Nova montagem",
  bloco,
  variante = "secondary",
}: {
  rotulo?: string;
  bloco?: boolean;
  variante?: "primary" | "secondary";
}) {
  const [estado, acao, enviando] = useActionState(criarAcao, INICIAL);

  return (
    <form action={acao} className={bloco ? "w-full" : undefined}>
      {estado.erro && (
        <Alerta tom="erro" className="mb-2">
          {estado.erro}
        </Alerta>
      )}
      <Button type="submit" variante={variante} bloco={bloco} disabled={enviando}>
        <Plus className="size-4" aria-hidden />
        {enviando ? "Criando…" : rotulo}
      </Button>
    </form>
  );
}
