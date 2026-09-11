"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { FiltroPeriodo, FiltroSegmentado } from "@/components/ui/filtro-segmentado";
import type { OpcaoSegmento } from "@/components/ui/filtro-segmentado";
import { Cabecalho, Celula, Linha, Tabela } from "@/components/ui/tabela";
import type { FatiaProduto, PontoSerie, SerieVendas } from "@/lib/dados/vendas";
import type { Periodo } from "@/lib/dados/tipos";
import { brl, cn, numero } from "@/lib/utils";

/**
 * A parte interativa das duas telas de dados — dashboard e ranking.
 *
 * Os gráficos são SVG escrito à mão, sem biblioteca: o que eles desenham são
 * quatro formas (grade, área, linha e barra) e uma escala. Uma dependência de
 * gráfico custaria centenas de kB no cliente e ainda assim precisaria ser
 * reestilizada token a token para responder ao tema.
 *
 * A cor sai de `--chart-1..6`, aplicada como `text-chart-N` + `currentColor`.
 * Isso vale para o gradiente da área também, e é o que faz o gráfico trocar de
 * tema sozinho — não existe cor literal em lugar nenhum daqui.
 */

/* -------------------------------------------------------------------------- */
/* Filtro de período                                                          */
/* -------------------------------------------------------------------------- */

/**
 * O período mora na URL, não em estado de componente: a tela é Server
 * Component e a consulta acontece no servidor. Assim o recorte sobrevive ao
 * F5, pode ser compartilhado por link e entra no histórico como se deve.
 */
export function FiltroPeriodoNaUrl({ periodo }: { periodo: Periodo }) {
  const router = useRouter();
  const caminho = usePathname();
  const [pendente, iniciar] = useTransition();

  function trocar(novo: Periodo) {
    iniciar(() => {
      // `replace` e não `push`: trocar de recorte não é navegar. Com `push`, o
      // Voltar do celular desfaria cinco filtros antes de sair da tela.
      router.replace(`${caminho}?periodo=${novo}`, { scroll: false });
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span
        role="status"
        aria-live="polite"
        className={cn(
          "text-xs text-fg-subtle transition-opacity duration-[--dur-fast]",
          pendente ? "opacity-100" : "opacity-0",
        )}
      >
        {pendente ? "Atualizando…" : ""}
      </span>
      <FiltroPeriodo valor={periodo} aoMudar={trocar} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Medida                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Largura real do container, em pixels.
 *
 * O SVG desenha em pixel medido em vez de um `viewBox` fixo esticado por CSS:
 * esticar encolhe o texto do eixo junto com o desenho, e a 360px de tela o
 * rótulo viraria 6px. Antes da primeira medida vale um palpite — e como ele é
 * o mesmo no servidor e na primeira renderização do cliente, a hidratação não
 * reclama.
 */
function useLargura<T extends HTMLElement>() {
  const alvo = useRef<T>(null);
  const [largura, setLargura] = useState(0);

  useEffect(() => {
    const no = alvo.current;
    if (!no || typeof ResizeObserver === "undefined") return;

    const observador = new ResizeObserver((entradas) => {
      const medida = entradas[0]?.contentRect.width ?? 0;
      setLargura(Math.round(medida));
    });

    observador.observe(no);
    return () => observador.disconnect();
  }, []);

  return [alvo, largura] as const;
}

/* -------------------------------------------------------------------------- */
/* Formatação e escala                                                        */
/* -------------------------------------------------------------------------- */

const COMPACTO = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatar(valor: number, dinheiro: boolean) {
  return dinheiro ? brl(valor / 100) : numero(valor);
}

/** Rótulo de eixo: "R$ 12,4 mil" em vez de "R$ 12.417,00". */
function curto(valor: number, dinheiro: boolean) {
  return dinheiro ? `R$ ${COMPACTO.format(valor / 100)}` : COMPACTO.format(valor);
}

/** Topo do eixo num número redondo: 1, 2, 2,5 ou 5 vezes uma potência de dez. */
function tetoAgradavel(valor: number) {
  if (!Number.isFinite(valor) || valor <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(valor));
  const passo = [1, 2, 2.5, 5, 10].find((p) => valor <= p * magnitude) ?? 10;
  return passo * magnitude;
}

function encurtar(texto: string, limite: number) {
  if (limite < 4) return "…";
  return texto.length <= limite ? texto : `${texto.slice(0, limite - 1).trimEnd()}…`;
}

/* -------------------------------------------------------------------------- */
/* Série temporal                                                             */
/* -------------------------------------------------------------------------- */

type Metrica = "faturamento" | "gmv" | "vendas";

const METRICAS: Record<Metrica, { rotulo: string; cor: string; dinheiro: boolean }> = {
  faturamento: { rotulo: "Faturamento", cor: "text-chart-1", dinheiro: true },
  gmv: { rotulo: "GMV", cor: "text-chart-2", dinheiro: true },
  vendas: { rotulo: "Vendas", cor: "text-chart-3", dinheiro: false },
};

const OPCOES_METRICA: OpcaoSegmento<Metrica>[] = [
  { valor: "faturamento", rotulo: "Faturamento" },
  { valor: "gmv", rotulo: "GMV", rotuloAcessivel: "GMV, total dos pedidos" },
  { valor: "vendas", rotulo: "Vendas", rotuloAcessivel: "Número de vendas" },
];

function valorDe(ponto: PontoSerie, metrica: Metrica) {
  if (metrica === "vendas") return ponto.vendas;
  if (metrica === "gmv") return ponto.gmvCentavos;
  return ponto.faturamentoCentavos;
}

export function GraficoSerie({ serie }: { serie: SerieVendas }) {
  const [metrica, setMetrica] = useState<Metrica>("faturamento");
  const [ativo, setAtivo] = useState<number | null>(null);
  const [caixa, largura] = useLargura<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  // id do gradiente: `useId` porque id de SVG é global no documento, e dois
  // gráficos na mesma página herdariam o gradiente um do outro.
  // Os dois-pontos que o React põe no id não sobrevivem a `url(#id)`.
  const gradiente = `grad-${useId().replace(/:/g, "")}`;

  const pontos = serie.pontos;
  const total = pontos.length;
  const { rotulo, cor, dinheiro } = METRICAS[metrica];

  const L = largura || 720;
  const estreito = L < 420;
  const altura = estreito ? 180 : 224;
  const pad = { t: 16, r: 10, b: 26, l: estreito ? 46 : 58 };
  const areaL = Math.max(L - pad.l - pad.r, 40);
  const areaA = altura - pad.t - pad.b;

  const valores = pontos.map((ponto) => valorDe(ponto, metrica));
  const soma = valores.reduce((acumulado, valor) => acumulado + valor, 0);
  const teto = tetoAgradavel(Math.max(...valores, 0));
  const banda = areaL / Math.max(total, 1);

  const x = (indice: number) => pad.l + banda * (indice + 0.5);
  const y = (valor: number) => pad.t + areaA * (1 - valor / teto);
  const base = pad.t + areaA;

  const caminho = pontos
    .map((_, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(valores[i] ?? 0).toFixed(1)}`)
    .join(" ");

  const preenchimento =
    total > 1
      ? `${caminho} L ${x(total - 1).toFixed(1)} ${base.toFixed(1)} L ${x(0).toFixed(1)} ${base.toFixed(1)} Z`
      : "";

  // Um rótulo a cada ~56px; sem isso trinta dias viram uma tarja preta no eixo.
  const passo = Math.max(1, Math.ceil(total / Math.max(2, Math.floor(areaL / 56))));

  const pontoAtivo = ativo === null ? null : pontos[ativo];
  const unidade = serie.granularidade === "hora" ? "hora" : "dia";

  function apontar(evento: React.PointerEvent<SVGSVGElement>) {
    const retangulo = svg.current?.getBoundingClientRect();
    if (!retangulo || total === 0) return;
    const relativo = evento.clientX - retangulo.left - pad.l;
    const indice = Math.floor(relativo / banda);
    setAtivo(Math.min(Math.max(indice, 0), total - 1));
  }

  function aoTeclar(evento: React.KeyboardEvent<HTMLDivElement>) {
    if (total === 0) return;

    const atual = ativo ?? total - 1;
    const mapa: Record<string, number | undefined> = {
      ArrowRight: Math.min(atual + 1, total - 1),
      ArrowLeft: Math.max(atual - 1, 0),
      Home: 0,
      End: total - 1,
    };

    if (evento.key === "Escape") {
      setAtivo(null);
      return;
    }

    const destino = mapa[evento.key];
    if (destino === undefined) return;
    evento.preventDefault();
    setAtivo(destino);
  }

  return (
    <div ref={caixa}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div aria-live="polite" className="min-w-0">
          <p className="text-xs text-fg-subtle">
            {pontoAtivo ? pontoAtivo.rotuloLongo : `${rotulo} do período`}
          </p>
          <p className="num text-xl font-semibold">
            {formatar(pontoAtivo ? valorDe(pontoAtivo, metrica) : soma, dinheiro)}
          </p>
        </div>

        <FiltroSegmentado
          opcoes={OPCOES_METRICA}
          valor={metrica}
          aoMudar={setMetrica}
          rotulo="Métrica do gráfico"
        />
      </div>

      <div
        role="img"
        tabIndex={0}
        aria-label={`${rotulo} por ${unidade}. ${
          total === 0
            ? "Sem dados no período."
            : `${total} pontos, de ${pontos[0]?.rotuloLongo} a ${pontos[total - 1]?.rotuloLongo}. Total de ${formatar(soma, dinheiro)}. Use as setas para percorrer os pontos.`
        }`}
        onKeyDown={aoTeclar}
        className="rounded-md"
      >
        <svg
          ref={svg}
          width={L}
          height={altura}
          viewBox={`0 0 ${L} ${altura}`}
          className={cn("block w-full", cor)}
          onPointerMove={apontar}
          onPointerLeave={() => setAtivo(null)}
          aria-hidden
        >
          <defs>
            {/* `currentColor` no gradiente: o tom vem da classe `text-chart-N`
                do próprio SVG, então trocar a métrica troca a cor inteira. */}
            <linearGradient id={gradiente} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.30" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((fracao) => {
            const linhaY = pad.t + areaA * (1 - fracao);
            return (
              <line
                key={fracao}
                x1={pad.l}
                x2={pad.l + areaL}
                y1={linhaY}
                y2={linhaY}
                className="stroke-border"
                strokeWidth={1}
              />
            );
          })}

          {[0, 0.5, 1].map((fracao) => (
            <text
              key={fracao}
              x={pad.l - 8}
              y={pad.t + areaA * (1 - fracao)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-fg-subtle"
              fontSize={11}
            >
              {curto(teto * fracao, dinheiro)}
            </text>
          ))}

          {preenchimento && <path d={preenchimento} fill={`url(#${gradiente})`} />}

          {total > 1 && (
            <path
              d={caminho}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {pontos.map((ponto, i) =>
            i % passo === 0 ? (
              <text
                key={ponto.chave}
                x={x(i)}
                y={altura - 8}
                textAnchor="middle"
                className="fill-fg-subtle"
                fontSize={11}
              >
                {ponto.rotulo}
              </text>
            ) : null,
          )}

          {ativo !== null && pontoAtivo && (
            <g>
              <line
                x1={x(ativo)}
                x2={x(ativo)}
                y1={pad.t}
                y2={base}
                className="stroke-border-strong"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle
                cx={x(ativo)}
                cy={y(valorDe(pontoAtivo, metrica))}
                r={4.5}
                fill="currentColor"
                className="stroke-surface"
                strokeWidth={2}
              />
            </g>
          )}

          {/* Ponto único (uma hora, um dia) não faz linha: vira marca. */}
          {total === 1 && (
            <circle cx={x(0)} cy={y(valores[0] ?? 0)} r={5} fill="currentColor" />
          )}
        </svg>
      </div>

      <TabelaAlternativa
        rotulo={`${rotulo} por ${unidade}`}
        colunas={[
          { rotulo: unidade === "hora" ? "Hora" : "Dia" },
          { rotulo: "Vendas", numerica: true },
          { rotulo: "Faturamento", numerica: true },
          { rotulo: "GMV", numerica: true },
        ]}
      >
        {pontos.map((ponto) => (
          <Linha key={ponto.chave}>
            <Celula linha>{ponto.rotuloLongo}</Celula>
            <Celula numerica>{numero(ponto.vendas)}</Celula>
            <Celula numerica>{brl(ponto.faturamentoCentavos / 100)}</Celula>
            <Celula numerica>{brl(ponto.gmvCentavos / 100)}</Celula>
          </Linha>
        ))}
      </TabelaAlternativa>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Barras por produto                                                         */
/* -------------------------------------------------------------------------- */

/** Uma cor por barra, na ordem dos tokens de gráfico. */
const CORES = [
  "text-chart-1",
  "text-chart-2",
  "text-chart-3",
  "text-chart-4",
  "text-chart-5",
  "text-chart-6",
];

const LINHA_ALTURA = 48;

export function GraficoProdutos({ fatias }: { fatias: FatiaProduto[] }) {
  const [caixa, largura] = useLargura<HTMLDivElement>();

  const L = largura || 640;
  const altura = fatias.length * LINHA_ALTURA;
  const maior = Math.max(...fatias.map((f) => f.faturamentoCentavos), 1);

  return (
    <div ref={caixa}>
      <div
        role="img"
        aria-label={`Faturamento por produto. ${fatias
          .map((f) => `${f.nome}: ${brl(f.faturamentoCentavos / 100)}`)
          .join("; ")}.`}
      >
        <svg
          width={L}
          height={altura}
          viewBox={`0 0 ${L} ${altura}`}
          className="block w-full"
          aria-hidden
        >
          {fatias.map((fatia, indice) => {
            const topo = indice * LINHA_ALTURA;
            const valor = brl(fatia.faturamentoCentavos / 100);
            // ~6,6px por caractere a 12,5px de fonte: o nome é cortado para
            // nunca passar por baixo do valor, que é o número que importa.
            const espacoNome = Math.max(L - valor.length * 6.6 - 16, 40);
            const comprimento = Math.max(
              3,
              (fatia.faturamentoCentavos / maior) * L,
            );

            return (
              <g key={fatia.id}>
                <text x={0} y={topo + 13} className="fill-fg" fontSize={12.5}>
                  {encurtar(fatia.nome, Math.floor(espacoNome / 6.6))}
                  <title>{fatia.nome}</title>
                </text>
                <text
                  x={L}
                  y={topo + 13}
                  textAnchor="end"
                  className="num fill-fg-muted"
                  fontSize={12.5}
                >
                  {valor}
                </text>

                <rect
                  x={0}
                  y={topo + 24}
                  width={L}
                  height={8}
                  rx={4}
                  className="fill-border"
                />
                <rect
                  x={0}
                  y={topo + 24}
                  width={comprimento}
                  height={8}
                  rx={4}
                  fill="currentColor"
                  className={CORES[indice % CORES.length]}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <TabelaAlternativa
        rotulo="Faturamento por produto"
        colunas={[
          { rotulo: "Produto" },
          { rotulo: "Vendas", numerica: true },
          { rotulo: "Faturamento", numerica: true },
          { rotulo: "GMV", numerica: true },
        ]}
      >
        {fatias.map((fatia) => (
          <Linha key={fatia.id}>
            <Celula linha quebrar>
              {fatia.nome}
            </Celula>
            <Celula numerica>{numero(fatia.vendas)}</Celula>
            <Celula numerica>{brl(fatia.faturamentoCentavos / 100)}</Celula>
            <Celula numerica>{brl(fatia.gmvCentavos / 100)}</Celula>
          </Linha>
        ))}
      </TabelaAlternativa>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A alternativa textual do gráfico.
 *
 * Fica num `<details>` e não num bloco só para leitor de tela: quem enxerga
 * também quer o número exato, e uma tabela escondida de todo mundo menos do
 * leitor de tela é uma tabela que ninguém revisa.
 */
function TabelaAlternativa({
  rotulo,
  colunas,
  children,
}: {
  rotulo: string;
  colunas: React.ComponentProps<typeof Cabecalho>["colunas"];
  children: React.ReactNode;
}) {
  return (
    <details className="mt-4 border-t border-border pt-3">
      <summary className="cursor-pointer text-xs text-fg-muted select-none hover:text-fg">
        Ver os números
      </summary>
      <div className="mt-2">
        <Tabela rotulo={rotulo} cabecalho={<Cabecalho colunas={colunas} />}>
          {children}
        </Tabela>
      </div>
    </details>
  );
}
