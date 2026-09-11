import type { Metadata } from "next";
import Link from "next/link";
import { ChartColumn, Eye, Receipt, ShoppingBag, Wallet } from "lucide-react";
import { GraficoProdutos, GraficoSerie, FiltroPeriodoNaUrl } from "./graficos";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Cabecalho, Celula, Linha, Tabela } from "@/components/ui/tabela";
import { modoDemo } from "@/lib/env";
import { exigirUsuario } from "@/lib/sessao";
import { brl, cn, numero } from "@/lib/utils";
import {
  DESCRICAO_PERIODO,
  lerPeriodo,
  resumoDeVendas,
  serieDeVendas,
  ultimasVendas,
  vendasPorProduto,
} from "@/lib/dados/vendas";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Horário sempre em São Paulo, formatado no servidor.
 *
 * O fuso do processo Node não decide nada aqui: o dia da venda é o dia de
 * São Paulo (coluna gerada em `vendas`), e a coluna "Quando" precisa falar o
 * mesmo idioma que o resto da tela.
 */
const QUANDO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function Cartao({
  icone: Icone,
  cor,
  rotulo,
  valor,
  detalhe,
}: {
  icone: React.ComponentType<{ className?: string }>;
  cor: string;
  rotulo: string;
  valor: string;
  detalhe: string;
}) {
  return (
    <Card className="flex items-start gap-3">
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-md bg-bg-subtle",
          cor,
        )}
        aria-hidden
      >
        <Icone className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-fg-subtle">{rotulo}</p>
        <p className="num truncate text-lg font-semibold">{valor}</p>
        <p className="mt-0.5 text-xs text-fg-muted">{detalhe}</p>
      </div>
    </Card>
  );
}

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const usuario = await exigirUsuario("/dashboard");

  const parametros = await props.searchParams;
  const bruto = parametros.periodo;
  const periodo = lerPeriodo(Array.isArray(bruto) ? bruto[0] : bruto);

  const [resumo, serie, produtos, ultimas] = await Promise.all([
    resumoDeVendas(usuario.id, periodo),
    serieDeVendas(usuario.id, periodo),
    vendasPorProduto(usuario.id, periodo),
    ultimasVendas(usuario.id, periodo),
  ]);

  const recorte = DESCRICAO_PERIODO[periodo];
  const porHora = serie.granularidade === "hora";
  const semDado = resumo.vendas === 0 && ultimas.length === 0;

  return (
    <>
      <PageHeader
        titulo="Dashboard de vendas"
        descricao={`Faturamento, GMV e audiência da live ${recorte}.`}
        acoes={<FiltroPeriodoNaUrl periodo={periodo} />}
      />

      {modoDemo && (
        <Alerta tom="info" className="mb-4">
          <strong>Modo demo.</strong> Todo número desta tela é exemplo, gerado
          aqui mesmo para o desenho poder ser visto. Nada disso é venda real.
        </Alerta>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          icone={Wallet}
          cor="text-chart-1"
          rotulo="Faturamento"
          valor={brl(resumo.faturamentoCentavos / 100)}
          detalhe="Valor pago por unidade"
        />
        <Cartao
          icone={Receipt}
          cor="text-chart-2"
          rotulo="GMV"
          valor={brl(resumo.gmvCentavos / 100)}
          detalhe="Total dos pedidos, com frete e taxa"
        />
        <Cartao
          icone={ShoppingBag}
          cor="text-chart-3"
          rotulo="Vendas"
          valor={numero(resumo.vendas)}
          detalhe={`${numero(resumo.itens)} ${resumo.itens === 1 ? "item" : "itens"}`}
        />
        <Cartao
          icone={Eye}
          cor="text-chart-4"
          rotulo="Espectadores"
          valor={numero(resumo.espectadores)}
          detalhe={
            resumo.lives === 0
              ? "Nenhuma live no período"
              : `Pico somado de ${numero(resumo.lives)} ${resumo.lives === 1 ? "live" : "lives"}`
          }
        />
      </div>

      {semDado ? (
        <EstadoVazio
          className="mt-4"
          icone={ChartColumn}
          titulo="Nenhuma venda registrada ainda"
          texto="Quem escreve nesta tela é a extensão do Chrome: é ela que lê as vendas da sala do TikTok e envia para cá. Enquanto ela não estiver instalada e no ar, o painel fica assim — zerado de verdade, sem número inventado."
          acao={
            <>
              <Link
                href="/extensao"
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
              >
                Instalar a extensão
              </Link>
              <Link
                href="/live"
                className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
              >
                Preparar a live
              </Link>
            </>
          }
        />
      ) : (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            <Card className="min-w-0 lg:col-span-3">
              <CardTitulo>Movimento da live</CardTitulo>
              <CardDescricao>
                {porHora
                  ? "Hora a hora, no fuso de São Paulo."
                  : serie.recortada
                    ? "Dia a dia, nos últimos 90 dias — os cartões acima somam o período inteiro."
                    : "Dia a dia, no fuso de São Paulo."}
              </CardDescricao>
              <div className="mt-4">
                <GraficoSerie serie={serie} />
              </div>
            </Card>

            <Card className="min-w-0 lg:col-span-2">
              <CardTitulo>Por produto</CardTitulo>
              <CardDescricao>
                Os seis que mais faturaram {recorte}.
              </CardDescricao>
              <div className="mt-4">
                {produtos.length === 0 ? (
                  <EstadoVazio
                    titulo="Sem produto vinculado"
                    texto="As vendas do período chegaram sem produto associado. Cadastre os produtos da live para o painel separar por item."
                    acao={
                      <Link
                        href="/produtos"
                        className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
                      >
                        Cadastrar produto
                      </Link>
                    }
                  />
                ) : (
                  <GraficoProdutos fatias={produtos} />
                )}
              </div>
            </Card>
          </div>

          <Card className="mt-4 min-w-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitulo>Últimas vendas</CardTitulo>
                <CardDescricao>As mais recentes {recorte}.</CardDescricao>
              </div>
              <Badge>{numero(ultimas.length)}</Badge>
            </div>

            <Tabela
              rotulo={`Últimas vendas ${recorte}`}
              cabecalho={
                <Cabecalho
                  colunas={[
                    "Quando",
                    "Produto",
                    "Comprador",
                    { rotulo: "Qtd", numerica: true },
                    { rotulo: "Valor", numerica: true },
                    { rotulo: "GMV", numerica: true },
                  ]}
                />
              }
            >
              {ultimas.map((venda) => (
                <Linha key={venda.id}>
                  <Celula linha>{QUANDO.format(new Date(venda.ocorridoEm))}</Celula>
                  <Celula>{venda.produto ?? "—"}</Celula>
                  <Celula className="text-fg-muted">{venda.comprador ?? "—"}</Celula>
                  <Celula numerica>{numero(venda.quantidade)}</Celula>
                  <Celula numerica>{brl(venda.valorCentavos / 100)}</Celula>
                  <Celula numerica>{brl(venda.gmvCentavos / 100)}</Celula>
                </Linha>
              ))}
            </Tabela>
          </Card>
        </>
      )}
    </>
  );
}
