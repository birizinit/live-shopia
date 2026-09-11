"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Dna,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Search,
  SearchX,
} from "lucide-react";
import {
  sincronizarVozes,
  usarVoz,
  type EstadoSincronizacao,
  type EstadoVozAtiva,
} from "./actions";
import { Abas, PainelAba } from "@/components/ui/abas";
import { useAvisos } from "@/components/ui/avisos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import {
  FiltroSegmentado,
  type OpcaoSegmento,
} from "@/components/ui/filtro-segmentado";
import { Campo, Input } from "@/components/ui/input";
import { Selecao, type OpcaoSelecao } from "@/components/ui/selecao";
import type { GeneroVoz, Voz } from "@/lib/dados/vozes";
import { cn, numero } from "@/lib/utils";

/**
 * O catálogo navegável: filtros, prévia e escolha da voz da live.
 *
 * Filtra no cliente, não no servidor. O catálogo inteiro cabe numa resposta
 * (algumas centenas de linhas curtas) e a pessoa está comparando timbres: cada
 * mudança de filtro que virasse ida ao servidor colocaria meio segundo entre a
 * dúvida e a resposta, repetido dezenas de vezes. Escolher voz é tarefa de
 * experimentar, não de consultar.
 *
 * Um elemento `<audio>` só para a tela toda, e não um por cartão: prévia é
 * comparação, e duas vozes tocando juntas não comparam nada. Quem toca
 * interrompe quem estava tocando, sem o usuário precisar pausar antes.
 */

const TODOS = "todos";

const GENEROS: OpcaoSegmento<typeof TODOS | GeneroVoz>[] = [
  { valor: TODOS, rotulo: "Todos", rotuloAcessivel: "Todos os gêneros" },
  { valor: "feminina", rotulo: "Feminina" },
  { valor: "masculina", rotulo: "Masculina" },
  { valor: "neutra", rotulo: "Neutra" },
];

const ROTULO_GENERO: Record<GeneroVoz, string> = {
  feminina: "Feminina",
  masculina: "Masculina",
  neutra: "Neutra",
};

/** Busca sem acento: quem procura "sotaque carioca" digita "sotaque carioca". */
function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function textoBuscavel(voz: Voz) {
  return normalizar(
    [voz.nome, voz.descricao, voz.sotaque, voz.categoria, voz.uso, voz.idade, voz.idiomaNome]
      .filter(Boolean)
      .join(" "),
  );
}

/** Valores distintos de uma coluna, em ordem alfabética, para virar `<option>`. */
function opcoesDe(vozes: Voz[], ler: (voz: Voz) => string | null, rotuloTodos: string) {
  const vistos = new Map<string, string>();
  for (const voz of vozes) {
    const valor = ler(voz)?.trim();
    if (valor) vistos.set(valor.toLowerCase(), valor);
  }

  const opcoes: OpcaoSelecao[] = [...vistos.values()]
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((valor) => ({ valor: valor.toLowerCase(), rotulo: valor }));

  return [{ valor: TODOS, rotulo: rotuloTodos }, ...opcoes];
}

// -----------------------------------------------------------------------------

export type CatalogoProps = {
  catalogo: Voz[];
  minhas: Voz[];
  vozAtivaId: string | null;
};

export function Catalogo({ catalogo, minhas, vozAtivaId }: CatalogoProps) {
  const [aba, setAba] = useState<"catalogo" | "minhas">("catalogo");
  const [busca, setBusca] = useState("");
  const [idioma, setIdioma] = useState(TODOS);
  const [genero, setGenero] = useState<typeof TODOS | GeneroVoz>(TODOS);
  const [sotaque, setSotaque] = useState(TODOS);
  const [categoria, setCategoria] = useState(TODOS);

  const lista = aba === "catalogo" ? catalogo : minhas;

  const indice = useMemo(
    () => new Map(lista.map((voz) => [voz.id, textoBuscavel(voz)])),
    [lista],
  );

  const idiomas = useMemo(
    () => {
      const vistos = new Map<string, Voz>();
      for (const voz of lista) if (!vistos.has(voz.idioma)) vistos.set(voz.idioma, voz);
      return [
        { valor: TODOS, rotulo: "Todos os idiomas" },
        ...[...vistos.values()].map((voz) => ({
          valor: voz.idioma,
          // A bandeira entra no rótulo do `<option>`: é texto, e o select
          // nativo não aceita marcação dentro da opção.
          rotulo: `${voz.bandeira} ${voz.idiomaNome}`,
        })),
      ];
    },
    [lista],
  );

  const sotaques = useMemo(() => opcoesDe(lista, (v) => v.sotaque, "Todos os sotaques"), [lista]);
  const categorias = useMemo(
    () => opcoesDe(lista, (v) => v.categoria, "Todas as categorias"),
    [lista],
  );

  const buscaNormalizada = normalizar(busca.trim());

  const filtradas = useMemo(
    () =>
      lista.filter((voz) => {
        if (idioma !== TODOS && voz.idioma !== idioma) return false;
        if (genero !== TODOS && voz.genero !== genero) return false;
        if (sotaque !== TODOS && voz.sotaque?.toLowerCase() !== sotaque) return false;
        if (categoria !== TODOS && voz.categoria?.toLowerCase() !== categoria) return false;
        if (buscaNormalizada && !indice.get(voz.id)?.includes(buscaNormalizada)) return false;
        return true;
      }),
    [lista, idioma, genero, sotaque, categoria, buscaNormalizada, indice],
  );

  const comFiltro =
    idioma !== TODOS ||
    genero !== TODOS ||
    sotaque !== TODOS ||
    categoria !== TODOS ||
    busca.trim() !== "";

  function limpar() {
    setBusca("");
    setIdioma(TODOS);
    setGenero(TODOS);
    setSotaque(TODOS);
    setCategoria(TODOS);
  }

  // Filtro escolhido numa aba pode não existir na outra (ninguém clona voz em
  // japonês e em alemão). Trocar de aba mantendo o filtro mostraria lista vazia
  // sem motivo aparente — então a troca zera o que foi filtrado.
  function trocarAba(id: string) {
    if (id !== "catalogo" && id !== "minhas") return;
    setAba(id);
    limpar();
  }

  return (
    <Abas
      abas={[
        { id: "catalogo", rotulo: "Catálogo", contagem: catalogo.length },
        { id: "minhas", rotulo: "Minhas vozes clonadas", contagem: minhas.length },
      ]}
      ativa={aba}
      aoMudar={trocarAba}
      rotulo="Origem das vozes"
    >
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Buscar" htmlFor="voz-busca">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
              aria-hidden
            />
            <Input
              id="voz-busca"
              type="search"
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Nome, sotaque, uso…"
              className="pl-9"
            />
          </div>
        </Campo>

        <Campo rotulo="Idioma" htmlFor="voz-idioma">
          <Selecao
            id="voz-idioma"
            opcoes={idiomas}
            value={idioma}
            onChange={(evento) => setIdioma(evento.target.value)}
          />
        </Campo>

        <Campo rotulo="Sotaque" htmlFor="voz-sotaque">
          <Selecao
            id="voz-sotaque"
            opcoes={sotaques}
            value={sotaque}
            onChange={(evento) => setSotaque(evento.target.value)}
            disabled={sotaques.length <= 1}
          />
        </Campo>

        <Campo rotulo="Categoria" htmlFor="voz-categoria">
          <Selecao
            id="voz-categoria"
            opcoes={categorias}
            value={categoria}
            onChange={(evento) => setCategoria(evento.target.value)}
            disabled={categorias.length <= 1}
          />
        </Campo>
      </div>

      <div className="mt-3 mb-4 flex flex-wrap items-center justify-between gap-3">
        <FiltroSegmentado
          opcoes={GENEROS}
          valor={genero}
          aoMudar={setGenero}
          rotulo="Gênero da voz"
        />

        <div className="flex items-center gap-3">
          <p className="text-sm text-fg-muted" aria-live="polite">
            <span className="num font-medium text-fg">{numero(filtradas.length)}</span>
            {" de "}
            <span className="num">{numero(lista.length)}</span>
            {lista.length === 1 ? " voz" : " vozes"}
          </p>
          {comFiltro && (
            <Button variante="ghost" tamanho="sm" onClick={limpar}>
              Limpar filtros
            </Button>
          )}
        </div>
      </div>

      <PainelAba id="catalogo">
        <Grade
          vozes={filtradas}
          vozAtivaId={vozAtivaId}
          vazio={
            comFiltro ? (
              <EstadoVazio
                icone={SearchX}
                titulo="Nenhuma voz com esses filtros"
                texto="Afrouxe um filtro ou limpe todos para ver o catálogo inteiro."
                acao={<Button onClick={limpar}>Limpar filtros</Button>}
              />
            ) : (
              <EstadoVazio
                icone={RefreshCw}
                titulo="Catálogo ainda não sincronizado"
                texto="As vozes da ElevenLabs só aparecem aqui depois que um administrador roda a sincronização."
              />
            )
          }
        />
      </PainelAba>

      <PainelAba id="minhas">
        <Grade
          vozes={filtradas}
          vozAtivaId={vozAtivaId}
          vazio={
            comFiltro ? (
              <EstadoVazio
                icone={SearchX}
                titulo="Nenhuma voz com esses filtros"
                texto="Afrouxe um filtro ou limpe todos para ver as suas vozes."
                acao={<Button onClick={limpar}>Limpar filtros</Button>}
              />
            ) : (
              <EstadoVazio
                icone={Dna}
                titulo="Você ainda não clonou nenhuma voz"
                texto="A voz clonada é a sua própria voz narrando a live. Ela fica só na sua conta, separada do catálogo."
                acao={
                  <Link
                    href="/clonar"
                    className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg transition-colors duration-[--dur-fast] hover:bg-primary-hover"
                  >
                    Clonar minha voz
                  </Link>
                }
              />
            )
          }
        />
      </PainelAba>
    </Abas>
  );
}

// -----------------------------------------------------------------------------
// Grade de cartões + prévia compartilhada
// -----------------------------------------------------------------------------

type EstadoPrevia = { id: string; tocando: boolean };

function Grade({
  vozes,
  vozAtivaId,
  vazio,
}: {
  vozes: Voz[];
  vozAtivaId: string | null;
  vazio: React.ReactNode;
}) {
  const avisos = useAvisos();
  const elemento = useRef<HTMLAudioElement>(null);
  const [previa, setPrevia] = useState<EstadoPrevia | null>(null);

  function alternarPrevia(voz: Voz) {
    const audio = elemento.current;
    if (!audio) return;

    // Segundo clique na mesma voz: para. Vale também enquanto carrega — é a
    // saída de quem clicou sem querer e não quer esperar a síntese terminar.
    if (previa?.id === voz.id) {
      audio.pause();
      setPrevia(null);
      return;
    }

    // O `src` é trocado e o `play()` sai no MESMO gesto do clique. Buscar o
    // áudio antes com `fetch` e só então chamar `play()` quebra em navegador
    // que exige gesto do usuário — o gesto não sobrevive ao `await`. Por isso a
    // URL vai direto no elemento, e quem cuida do cache é o HTTP.
    audio.pause();
    audio.src = `/api/vozes/${encodeURIComponent(voz.id)}/previa`;
    setPrevia({ id: voz.id, tocando: false });
    void audio.play().catch(() => {
      /* o evento onError abaixo é quem fala com o usuário */
    });
  }

  return (
    <>
      {/* Sem `controls`: quem comanda são os botões dos cartões. O elemento
          existe desde o primeiro render para o play() do clique achá-lo pronto. */}
      <audio
        ref={elemento}
        preload="none"
        onPlaying={() => setPrevia((atual) => (atual ? { ...atual, tocando: true } : atual))}
        onEnded={() => setPrevia(null)}
        onError={() => {
          if (!previa) return;
          setPrevia(null);
          avisos.erro(
            "A prévia não tocou",
            "Tente de novo em alguns segundos. Se insistir, a voz pode estar indisponível no provedor.",
          );
        }}
      />

      {vozes.length === 0 ? (
        vazio
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {vozes.map((voz) => (
            <CartaoVoz
              key={voz.id}
              voz={voz}
              ativa={voz.id === vozAtivaId}
              previa={previa?.id === voz.id ? previa : null}
              aoAlternarPrevia={() => alternarPrevia(voz)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function CartaoVoz({
  voz,
  ativa,
  previa,
  aoAlternarPrevia,
}: {
  voz: Voz;
  ativa: boolean;
  previa: EstadoPrevia | null;
  aoAlternarPrevia: () => void;
}) {
  const atributos = [
    { rotulo: "Gênero", valor: ROTULO_GENERO[voz.genero] },
    { rotulo: "Idade", valor: voz.idade },
    { rotulo: "Sotaque", valor: voz.sotaque },
    { rotulo: "Categoria", valor: voz.categoria },
    { rotulo: "Uso", valor: voz.uso },
  ].filter((item): item is { rotulo: string; valor: string } => Boolean(item.valor));

  const carregando = previa !== null && !previa.tocando;
  const tocando = previa?.tocando ?? false;

  return (
    <li>
      <article
        className={cn(
          "flex h-full flex-col rounded-lg border bg-surface p-4 transition-colors duration-[--dur-fast]",
          ativa ? "border-primary-border bg-primary-soft" : "border-border",
        )}
      >
        <div className="flex items-start gap-3">
          {/* A bandeira é decoração: o nome do idioma está escrito logo abaixo,
              e anunciar os dois faria o leitor de tela repetir a mesma coisa. */}
          <span
            className="grid size-10 shrink-0 place-items-center rounded-full bg-bg-subtle text-lg"
            aria-hidden
          >
            {voz.bandeira}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="min-w-0 truncate text-sm font-semibold text-fg">{voz.nome}</h3>
              {ativa && <Badge tom="marca">Voz da live</Badge>}
              {voz.exemplo && <Badge tom="info">Exemplo</Badge>}
              {voz.premium && !voz.exemplo && <Badge tom="alerta">Premium</Badge>}
              {voz.origem === "clonada" && <Badge>Clonada</Badge>}
              {voz.estado === "processando" && <Badge tom="alerta">Processando</Badge>}
              {voz.estado === "falhou" && <Badge tom="perigo">Falhou</Badge>}
            </div>
            <p className="mt-0.5 truncate text-xs text-fg-subtle">{voz.idiomaNome}</p>
          </div>
        </div>

        {voz.descricao && (
          <p className="mt-3 line-clamp-3 text-sm text-fg-muted">{voz.descricao}</p>
        )}

        {/* Lista de definições e não chips soltos: o leitor de tela anuncia
            "sotaque, carioca" em vez de despejar cinco palavras sem contexto. */}
        <dl className="mt-3 flex flex-wrap gap-1.5">
          {atributos.map((item) => (
            <div
              key={item.rotulo}
              className="rounded-full bg-bg-subtle px-2 py-0.5 text-xs text-fg-muted"
            >
              <dt className="sr-only">{item.rotulo}</dt>
              <dd>{item.valor}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button
            variante="secondary"
            tamanho="sm"
            onClick={aoAlternarPrevia}
            aria-pressed={tocando}
            // O nome acessível começa pelo texto visível de propósito: comando
            // de voz ("clique em ouvir prévia") precisa casar com o que se lê.
            aria-label={
              carregando
                ? `${voz.temPrevia ? "Carregando" : "Gerando"} prévia de ${voz.nome}`
                : tocando
                  ? `Parar prévia de ${voz.nome}`
                  : `Ouvir prévia de ${voz.nome}`
            }
          >
            {carregando ? (
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : tocando ? (
              <Pause className="size-4" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            {carregando
              ? voz.temPrevia
                ? "Carregando…"
                : "Gerando…"
              : tocando
                ? "Parar"
                : "Ouvir prévia"}
          </Button>

          <BotaoUsar voz={voz} ativa={ativa} />
        </div>
      </article>
    </li>
  );
}

// -----------------------------------------------------------------------------
// Definir a voz da live
// -----------------------------------------------------------------------------

function BotaoUsar({ voz, ativa }: { voz: Voz; ativa: boolean }) {
  const avisos = useAvisos();
  const [estado, acao, enviando] = useActionState<EstadoVozAtiva, FormData>(usarVoz, null);
  const anunciado = useRef<EstadoVozAtiva>(null);

  useEffect(() => {
    if (!estado || estado === anunciado.current) return;
    anunciado.current = estado;

    if (!estado.ok) {
      avisos.erro("Não deu para definir a voz", estado.erro);
      return;
    }

    if (estado.dado.salvo) {
      avisos.sucesso(
        "Voz da live definida",
        `${estado.dado.nome} vai narrar a próxima live.`,
      );
    } else {
      avisos.alerta(
        "Modo demonstração",
        `${estado.dado.nome} foi escolhida aqui, mas nada é salvo nesta sessão.`,
      );
    }
  }, [estado, avisos]);

  if (ativa) {
    return (
      <p className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary">
        <Check className="size-4" aria-hidden />
        Voz da live
      </p>
    );
  }

  const impedimento = voz.exemplo
    ? "Voz de exemplo: existe só para a tela ter o que mostrar. Configure a ELEVENLABS_API_KEY e sincronize o catálogo."
    : voz.estado === "processando"
      ? "A clonagem desta voz ainda está em andamento."
      : voz.estado === "falhou"
        ? "A clonagem desta voz falhou."
        : null;

  return (
    // O title fica no invólucro porque botão desabilitado não recebe ponteiro —
    // e uma recusa sem motivo à vista é uma recusa que ninguém entende.
    <span className="ml-auto" title={impedimento ?? undefined}>
      <form action={acao}>
        <input type="hidden" name="vozId" value={voz.id} />
        <Button
          type="submit"
          tamanho="sm"
          disabled={enviando || impedimento !== null}
          // Sem o nome da voz, uma lista de cem botões "Usar na live" é a mesma
          // frase cem vezes para quem navega de botão em botão.
          aria-label={`Usar na live a voz ${voz.nome}`}
        >
          {enviando ? "Definindo…" : "Usar na live"}
        </Button>
      </form>
    </span>
  );
}

// -----------------------------------------------------------------------------
// Sincronização do catálogo (admin)
// -----------------------------------------------------------------------------

export function BotaoSincronizar({ vozLigada }: { vozLigada: boolean }) {
  const avisos = useAvisos();
  const [estado, acao, enviando] = useActionState<EstadoSincronizacao, FormData>(
    sincronizarVozes,
    null,
  );
  const anunciado = useRef<EstadoSincronizacao>(null);

  useEffect(() => {
    if (!estado || estado === anunciado.current) return;
    anunciado.current = estado;

    if (!estado.ok) {
      avisos.erro("A sincronização não rodou", estado.erro);
      return;
    }

    const { importadas, atualizadas, total } = estado.dado;
    avisos.sucesso(
      "Catálogo sincronizado",
      `${numero(total)} ${total === 1 ? "voz lida" : "vozes lidas"} — ${numero(importadas)} nova(s) e ${numero(atualizadas)} atualizada(s).`,
    );
  }, [estado, avisos]);

  return (
    <span
      title={
        vozLigada ? undefined : "Sem ELEVENLABS_API_KEY não há catálogo real para sincronizar."
      }
    >
      <form action={acao}>
        <Button type="submit" variante="secondary" disabled={!vozLigada || enviando}>
          <RefreshCw
            className={cn("size-4", enviando && "animate-spin motion-reduce:animate-none")}
            aria-hidden
          />
          {enviando ? "Sincronizando…" : "Sincronizar catálogo"}
        </Button>
      </form>
    </span>
  );
}
