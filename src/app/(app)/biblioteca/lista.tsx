"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  AudioLines,
  FileText,
  Library,
  Repeat2,
  Search,
} from "lucide-react";
import { Alerta } from "@/components/ui/alerta";
import { useAvisos } from "@/components/ui/avisos";
import { Badge } from "@/components/ui/badge";
import { BarraProgresso } from "@/components/ui/barra-progresso";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BotaoCopiar } from "@/components/ui/copiar";
import { EsqueletoTexto, RegiaoCarregando } from "@/components/ui/esqueleto";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import {
  FiltroPeriodo,
  FiltroSegmentado,
  type OpcaoSegmento,
} from "@/components/ui/filtro-segmentado";
import { Campo, Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { juntarPaginas, Paginacao } from "@/components/ui/paginacao";
import { Propriedade, Propriedades } from "@/components/ui/propriedades";
import { Selecao } from "@/components/ui/selecao";
import { formatarDuracao } from "@/lib/caracteres";
import type {
  DetalheBiblioteca,
  FiltroTipo,
  FiltrosBiblioteca,
  ItemBiblioteca,
  OpcoesFiltro,
  TipoItem,
} from "@/lib/dados/biblioteca";
import { ROTULO_SECAO, type EstadoAudio, type Pagina } from "@/lib/dados/tipos";
import { numero } from "@/lib/utils";

/**
 * A lista da biblioteca.
 *
 * É cliente porque tem filtro, modal e "carregar mais". O recorte mora na URL:
 * assim o estado volta no botão voltar do navegador, o link é compartilhável e
 * quem consulta o banco continua sendo o Server Component — o cliente nunca
 * monta consulta, só pede a próxima página por ação de servidor.
 */

export type ListaProps = {
  inicial: Pagina<ItemBiblioteca>;
  filtros: FiltrosBiblioteca;
  total: number;
  opcoes: OpcoesFiltro;
  /** Biblioteca sem nada, e não só sem resultado para este filtro. */
  vaziaDeVerdade: boolean;
  carregarMais: (consulta: string, cursor: string) => Promise<Pagina<ItemBiblioteca>>;
  abrir: (tipo: TipoItem, id: string) => Promise<DetalheBiblioteca | null>;
};

const OPCOES_TIPO: OpcaoSegmento<FiltroTipo>[] = [
  { valor: "todos", rotulo: "Tudo" },
  { valor: "audio", rotulo: "Áudios" },
  { valor: "roteiro", rotulo: "Roteiros" },
];

const ESTADOS: Record<
  EstadoAudio,
  { rotulo: string; tom: "neutro" | "info" | "sucesso" | "alerta" | "perigo" }
> = {
  rascunho: { rotulo: "Rascunho", tom: "neutro" },
  na_fila: { rotulo: "Na fila", tom: "alerta" },
  gerando: { rotulo: "Gerando", tom: "info" },
  pronto: { rotulo: "Pronto", tom: "sucesso" },
  falhou: { rotulo: "Falhou", tom: "perigo" },
};

/**
 * Fuso fixo, e não o do navegador: este componente também renderiza no
 * servidor, e uma data formatada em dois fusos diferentes quebra a hidratação.
 * É o mesmo America/Sao_Paulo que o banco usa para fechar o dia.
 */
const DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function plural(quantidade: number, um: string, varios: string) {
  return `${numero(quantidade)} ${quantidade === 1 ? um : varios}`;
}

/** A mesma leitura que `normalizarFiltros` faz do outro lado. */
function consultaDe(filtros: FiltrosBiblioteca) {
  const parametros = new URLSearchParams();
  if (filtros.tipo !== "todos") parametros.set("tipo", filtros.tipo);
  if (filtros.produtoId) parametros.set("produto", filtros.produtoId);
  if (filtros.vozId) parametros.set("voz", filtros.vozId);
  if (filtros.periodo !== "total") parametros.set("periodo", filtros.periodo);
  if (filtros.busca) parametros.set("q", filtros.busca);
  return parametros.toString();
}

function temFiltro(filtros: FiltrosBiblioteca) {
  return consultaDe(filtros).length > 0;
}

export function Lista({
  inicial,
  filtros,
  total,
  opcoes,
  vaziaDeVerdade,
  carregarMais,
  abrir,
}: ListaProps) {
  const router = useRouter();
  const avisos = useAvisos();

  const [pagina, setPagina] = useState(inicial);
  // A página nova chega por props quando o filtro muda. Comparar a semente
  // durante o render zera o acumulado sem `useEffect` — e sem remontar a
  // árvore, que tiraria o foco de quem está digitando na busca.
  const [semente, setSemente] = useState(inicial);
  if (semente !== inicial) {
    setSemente(inicial);
    setPagina(inicial);
  }

  const [busca, setBusca] = useState(filtros.busca);
  const [navegando, iniciarNavegacao] = useTransition();
  const [carregando, iniciarCarga] = useTransition();

  const [aberto, setAberto] = useState<ItemBiblioteca | null>(null);
  const [detalhe, setDetalhe] = useState<DetalheBiblioteca | null>(null);
  const [abrindo, iniciarAbertura] = useTransition();

  function aplicar(mudanca: Partial<FiltrosBiblioteca>) {
    const proximo = { ...filtros, ...mudanca };
    // Roteiro não tem voz: filtrar por voz é, por definição, pedir só áudio.
    if (mudanca.vozId) proximo.tipo = "audio";

    const consulta = consultaDe(proximo);
    setBusca(proximo.busca);
    iniciarNavegacao(() => {
      router.replace(consulta ? `/biblioteca?${consulta}` : "/biblioteca", {
        scroll: false,
      });
    });
  }

  function carregar(cursor: string) {
    iniciarCarga(async () => {
      try {
        const nova = await carregarMais(consultaDe(filtros), cursor);
        setPagina((atual) => juntarPaginas(atual, nova));
      } catch {
        avisos.erro("Não deu para carregar mais", "Tente de novo em alguns segundos.");
      }
    });
  }

  function abrirItem(item: ItemBiblioteca) {
    setAberto(item);
    setDetalhe(null);
    iniciarAbertura(async () => {
      try {
        const dado = await abrir(item.tipo, item.id);
        if (!dado) {
          setAberto(null);
          avisos.erro("Item não encontrado", "Ele pode ter sido apagado na tela dele.");
          return;
        }
        setDetalhe(dado);
      } catch {
        setAberto(null);
        avisos.erro("Não deu para abrir", "Tente de novo em alguns segundos.");
      }
    });
  }

  const filtrada = temFiltro(filtros);

  return (
    <>
      <Card className="mt-6 p-4">
        <form
          role="search"
          onSubmit={(evento) => {
            evento.preventDefault();
            aplicar({ busca: busca.trim() });
          }}
          className="flex gap-2"
        >
          <div className="relative min-w-0 flex-1">
            <Label htmlFor="biblioteca-busca" className="sr-only">
              Buscar por título ou por trecho do texto
            </Label>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
              aria-hidden
            />
            <Input
              id="biblioteca-busca"
              type="search"
              name="q"
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Buscar por título ou por um trecho do texto"
              className="pl-9"
            />
          </div>
          <Button type="submit" variante="secondary" disabled={navegando}>
            Buscar
          </Button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FiltroSegmentado
            opcoes={OPCOES_TIPO}
            valor={filtros.tipo}
            aoMudar={(tipo) => aplicar({ tipo, vozId: tipo === "roteiro" ? null : filtros.vozId })}
            rotulo="Tipo de item"
          />
          <FiltroPeriodo valor={filtros.periodo} aoMudar={(periodo) => aplicar({ periodo })} />
          {filtrada && (
            <Button
              variante="ghost"
              tamanho="sm"
              onClick={() =>
                aplicar({
                  tipo: "todos",
                  produtoId: null,
                  vozId: null,
                  periodo: "total",
                  busca: "",
                })
              }
            >
              Limpar filtros
            </Button>
          )}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Produto" htmlFor="biblioteca-produto">
            <Selecao
              id="biblioteca-produto"
              value={filtros.produtoId ?? ""}
              disabled={opcoes.produtos.length === 0}
              onChange={(evento) => aplicar({ produtoId: evento.target.value || null })}
              opcoes={[
                { valor: "", rotulo: "Todos os produtos" },
                ...opcoes.produtos.map((produto) => ({
                  valor: produto.id,
                  rotulo: produto.nome,
                })),
              ]}
            />
          </Campo>

          <Campo
            rotulo="Voz"
            htmlFor="biblioteca-voz"
            dica={opcoes.vozes.length === 0 ? "Nenhum áudio gerado ainda." : undefined}
          >
            <Selecao
              id="biblioteca-voz"
              value={filtros.vozId ?? ""}
              disabled={opcoes.vozes.length === 0}
              onChange={(evento) => aplicar({ vozId: evento.target.value || null })}
              opcoes={[
                { valor: "", rotulo: "Todas as vozes" },
                ...opcoes.vozes.map((voz) => ({ valor: voz.id, rotulo: voz.nome })),
              ]}
            />
          </Campo>
        </div>
      </Card>

      <RegiaoCarregando
        carregando={navegando}
        rotulo="Atualizando a biblioteca"
        className={navegando ? "mt-4 opacity-60 transition-opacity" : "mt-4"}
      >
        {pagina.itens.length === 0 ? (
          vaziaDeVerdade ? (
            <EstadoVazio
              icone={Library}
              titulo="A biblioteca ainda está vazia"
              texto="Tudo que você gerar no roteiro e no estúdio cai aqui — e continua disponível para repetir na live sem gastar crédito de novo."
              acao={
                <>
                  <Link
                    href="/roteiro"
                    className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
                  >
                    Escrever o primeiro roteiro
                  </Link>
                  <Link
                    href="/estudio"
                    className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
                  >
                    Ir para o estúdio
                  </Link>
                </>
              }
            />
          ) : (
            <EstadoVazio
              icone={Search}
              titulo="Nada neste recorte"
              texto="Nenhum áudio ou roteiro casa com o filtro atual."
              acao={
                <Button
                  variante="secondary"
                  onClick={() =>
                    aplicar({
                      tipo: "todos",
                      produtoId: null,
                      vozId: null,
                      periodo: "total",
                      busca: "",
                    })
                  }
                >
                  Limpar filtros
                </Button>
              }
            />
          )
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {pagina.itens.map((item) => (
              <Cartao
                key={`${item.tipo}:${item.id}`}
                item={item}
                aoAbrir={() => abrirItem(item)}
              />
            ))}
          </ul>
        )}
      </RegiaoCarregando>

      <Paginacao
        proximo={pagina.proximo}
        mostrados={pagina.itens.length}
        total={total}
        aoCarregarMais={carregar}
        carregando={carregando}
        itens="itens"
      />

      <Modal
        aberto={aberto !== null}
        aoFechar={() => setAberto(null)}
        titulo={aberto?.titulo ?? "Item da biblioteca"}
        descricao={
          aberto
            ? aberto.tipo === "audio"
              ? "Áudio gerado — o texto abaixo é o que foi falado."
              : "Roteiro salvo — o texto abaixo é o que a IA escreveu."
            : undefined
        }
        tamanho="lg"
        rodape={
          aberto && (
            <>
              <BotaoCopiar
                texto={detalhe?.texto ?? ""}
                rotulo="Copiar texto"
                tamanho="md"
                disabled={!detalhe}
              />
              <Link
                href={aberto.href}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
              >
                {aberto.tipo === "audio" ? "Abrir no estúdio" : "Abrir no roteiro"}
                <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            </>
          )
        }
      >
        {abrindo || !detalhe ? (
          <EsqueletoTexto linhas={6} />
        ) : (
          <Detalhe detalhe={detalhe} />
        )}
      </Modal>
    </>
  );
}

function Cartao({ item, aoAbrir }: { item: ItemBiblioteca; aoAbrir: () => void }) {
  const ehAudio = item.tipo === "audio";
  const estado = item.estado ? ESTADOS[item.estado] : null;
  const emProgresso =
    ehAudio &&
    (item.estado === "gerando" || item.estado === "na_fila") &&
    item.blocosTotal > 0;

  return (
    <li>
      <Card className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span
            className={
              ehAudio
                ? "grid size-9 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-fg"
                : "grid size-9 shrink-0 place-items-center rounded-md bg-bg-subtle text-fg-subtle"
            }
            aria-hidden
          >
            {ehAudio ? <AudioLines className="size-4.5" /> : <FileText className="size-4.5" />}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tom={ehAudio ? "marca" : "neutro"}>{ehAudio ? "Áudio" : "Roteiro"}</Badge>
              {estado && <Badge tom={estado.tom}>{estado.rotulo}</Badge>}
              {/* O fuso é fixo, mas a pontuação do formato depende do ICU do
                  ambiente; o aviso suprimido evita ruído no console por uma
                  vírgula que o servidor e o navegador escrevem diferente. */}
              <time
                dateTime={item.criadoEm}
                className="num text-xs text-fg-subtle"
                suppressHydrationWarning
              >
                {DATA.format(new Date(item.criadoEm))}
              </time>
            </div>

            <h3 className="mt-1.5 font-medium break-words">{item.titulo}</h3>
            <p className="mt-1 line-clamp-2 text-sm text-fg-muted">
              {item.trecho || "Sem texto ainda."}
            </p>
          </div>
        </div>

        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-subtle">
          <span className="truncate">Produto: {item.produto ?? "sem produto"}</span>
          {ehAudio && <span className="truncate">Voz: {item.voz ?? "—"}</span>}
          {ehAudio && item.duracaoMs !== null && (
            <span className="num">{formatarDuracao(item.duracaoMs)} de fala</span>
          )}
        </p>

        {emProgresso && (
          <BarraProgresso
            valor={item.blocosProntos}
            maximo={item.blocosTotal}
            rotulo="Blocos prontos"
            textoValor={`${item.blocosProntos}/${item.blocosTotal} blocos`}
            tamanho="sm"
          />
        )}

        {/* O que a tela existe para ensinar: o custo aconteceu uma vez; a
            repetição é de graça. */}
        <div className="mt-auto rounded-md bg-bg-subtle px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-sm text-fg-muted">
              {ehAudio ? "Custou" : "Texto de"}{" "}
              <span className="num font-medium text-fg">{numero(item.caracteres)}</span>{" "}
              caracteres
            </span>

            {ehAudio &&
              (item.reusos > 0 ? (
                <span className="inline-flex items-center gap-1 text-sm text-success">
                  <Repeat2 className="size-4" aria-hidden />
                  <span className="num font-medium">
                    {numero(item.caracteresPoupados)}
                  </span>{" "}
                  poupados
                </span>
              ) : (
                <span className="text-sm text-fg-subtle">Ainda não reaproveitado</span>
              ))}
          </div>

          <p className="num mt-1 text-xs text-fg-subtle">
            {ehAudio
              ? `${plural(item.montagens, "montagem", "montagens")} · ${plural(item.lives, "live no ar", "lives no ar")}`
              : `${plural(item.versoes, "versão", "versões")} · ${plural(item.audiosGerados, "áudio gerado", "áudios gerados")}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variante="secondary" tamanho="sm" onClick={aoAbrir}>
            Abrir
          </Button>
          <Link
            href={item.href}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            {ehAudio ? "Ver no estúdio" : "Ver no roteiro"}
            <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        </div>
      </Card>
    </li>
  );
}

function Detalhe({ detalhe }: { detalhe: DetalheBiblioteca }) {
  const { item } = detalhe;
  const ehAudio = item.tipo === "audio";

  return (
    <div className="space-y-4">
      <Propriedades colunas={2}>
        <Propriedade rotulo="Produto" valor={item.produto ?? "sem produto"} />
        <Propriedade
          rotulo="Criado em"
          valor={DATA.format(new Date(item.criadoEm))}
          numerica
        />
        {ehAudio ? (
          <>
            <Propriedade rotulo="Voz" valor={item.voz ?? "—"} />
            <Propriedade
              rotulo="Duração"
              valor={item.duracaoMs === null ? "—" : formatarDuracao(item.duracaoMs)}
              numerica
            />
            <Propriedade rotulo="Custo" valor={`${numero(item.caracteres)} caracteres`} numerica />
            <Propriedade
              rotulo="Blocos"
              valor={`${item.blocosProntos}/${item.blocosTotal}`}
              numerica
            />
            <Propriedade rotulo="Montagens" valor={numero(item.montagens)} numerica />
            <Propriedade rotulo="Lives no ar" valor={numero(item.lives)} numerica />
          </>
        ) : (
          <>
            <Propriedade
              rotulo="Versão"
              valor={detalhe.versao === null ? "—" : `v${detalhe.versao}`}
              numerica
            />
            <Propriedade rotulo="Tamanho" valor={`${numero(item.caracteres)} caracteres`} numerica />
            <Propriedade rotulo="Versões guardadas" valor={numero(item.versoes)} numerica />
            <Propriedade rotulo="Áudios gerados" valor={numero(item.audiosGerados)} numerica />
            <Propriedade
              rotulo="Escrito por"
              valor={detalhe.geradoPorIa ? "IA" : "Você"}
            />
          </>
        )}
      </Propriedades>

      {ehAudio && (
        <Alerta tom={item.reusos > 0 ? "sucesso" : "info"}>
          {item.reusos > 0 ? (
            <>
              Este áudio já foi usado {plural(item.reusos, "vez", "vezes")} sem gerar de
              novo — <span className="num font-medium">{numero(item.caracteresPoupados)}</span>{" "}
              caracteres que não foram cobrados.
            </>
          ) : (
            <>
              Colocar este áudio numa montagem repete a fala quantas vezes você quiser
              sem gastar crédito. Gerar outro igual custaria{" "}
              <span className="num font-medium">{numero(item.caracteres)}</span> caracteres
              de novo.
            </>
          )}
        </Alerta>
      )}

      {detalhe.secoes && detalhe.secoes.length > 0 && (
        <div className="space-y-3">
          {detalhe.secoes.map((bloco, indice) => (
            <div key={`${bloco.secao}-${indice}`}>
              <h4 className="text-xs font-semibold tracking-wider text-fg-subtle uppercase">
                {ROTULO_SECAO[bloco.secao] ?? bloco.secao}
              </h4>
              <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
                {bloco.texto}
              </p>
            </div>
          ))}
        </div>
      )}

      {(!detalhe.secoes || detalhe.secoes.length === 0) && (
        <div>
          <h4 className="text-xs font-semibold tracking-wider text-fg-subtle uppercase">
            Texto
          </h4>
          <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
            {detalhe.texto || "Sem texto ainda."}
          </p>
        </div>
      )}

      {detalhe.truncado && (
        <Alerta tom="info">
          O texto é longo e foi cortado aqui. O conteúdo inteiro está na tela dona do
          item.
        </Alerta>
      )}
    </div>
  );
}
