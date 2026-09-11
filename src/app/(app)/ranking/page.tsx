import type { Metadata } from "next";
import Link from "next/link";
import { Trophy } from "lucide-react";
// O filtro de período é o mesmo das duas telas de dados e mora junto dos
// gráficos, que é o único módulo de cliente deste par de rotas.
import { FiltroPeriodoNaUrl } from "../dashboard/graficos";
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
  rankingDoPeriodo,
} from "@/lib/dados/vendas";

export const metadata: Metadata = { title: "Ranking" };

const LIMITE = 20;

/**
 * A posição não é dita só pela cor: o número está lá para quem não distingue
 * o dourado do cinza — e para quem lê a tela com o leitor de tela.
 */
function Posicao({ posicao }: { posicao: number }) {
  return (
    <span
      className={cn(
        "num grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
        posicao === 1 && "bg-warning-soft text-warning",
        posicao === 2 && "bg-bg-subtle text-fg",
        posicao === 3 && "bg-bg-subtle text-fg-muted",
        posicao > 3 && "text-fg-subtle",
      )}
    >
      {posicao}
    </span>
  );
}

export default async function RankingPage(props: PageProps<"/ranking">) {
  const usuario = await exigirUsuario("/ranking");

  const parametros = await props.searchParams;
  const bruto = parametros.periodo;
  const periodo = lerPeriodo(Array.isArray(bruto) ? bruto[0] : bruto);

  const linhas = await rankingDoPeriodo(usuario.id, periodo, {
    limite: LIMITE,
    nomeExibicao: usuario.nome || usuario.usuario,
  });

  const recorte = DESCRICAO_PERIODO[periodo];
  const topo = linhas.filter((linha) => linha.posicao <= LIMITE);
  const eu = linhas.find((linha) => linha.voce);
  const foraDoTopo = Boolean(eu && eu.posicao > LIMITE);

  return (
    <>
      <PageHeader
        titulo="Ranking"
        descricao={`Quem mais vendeu ${recorte}, pelo total dos pedidos.`}
        acoes={<FiltroPeriodoNaUrl periodo={periodo} />}
      />

      {modoDemo && (
        <Alerta tom="info" className="mb-4">
          <strong>Modo demo.</strong> O placar abaixo é exemplo, com nomes
          fictícios. Nenhuma conta real aparece aqui.
        </Alerta>
      )}

      <Card className="mb-4">
        <CardTitulo>Sua posição</CardTitulo>
        {eu ? (
          <>
            <CardDescricao>
              Entre quem vendeu {recorte}.
            </CardDescricao>
            <dl className="mt-4 grid grid-cols-3 gap-4">
              <div>
                <dt className="text-xs text-fg-subtle">Posição</dt>
                <dd className="num text-2xl font-semibold text-primary">
                  {eu.posicao}º
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-subtle">Vendas</dt>
                <dd className="num text-2xl font-semibold">{numero(eu.vendas)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-fg-subtle">Total</dt>
                <dd className="num truncate text-2xl font-semibold">
                  {brl(eu.gmvCentavos / 100)}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <CardDescricao>
            Você ainda não aparece no placar {recorte}. A primeira venda
            registrada pela extensão já coloca a sua conta na lista.
          </CardDescricao>
        )}
      </Card>

      {topo.length === 0 ? (
        <EstadoVazio
          icone={Trophy}
          titulo="O placar ainda está vazio"
          texto="Ninguém registrou venda no período. O ranking é montado a partir das vendas que a extensão do Chrome envia — assim que a primeira live for ao ar, ele começa a preencher."
          acao={
            <>
              <Link
                href="/extensao"
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
              >
                Instalar a extensão
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
              >
                Ver o dashboard
              </Link>
            </>
          }
        />
      ) : (
        <Card className="min-w-0">
          <Tabela
            rotulo={`Ranking de vendedores ${recorte}`}
            cabecalho={
              <Cabecalho
                colunas={[
                  { rotulo: "#", className: "w-10" },
                  "Vendedor",
                  { rotulo: "Vendas", numerica: true },
                  { rotulo: "Total", numerica: true },
                ]}
              />
            }
          >
            {topo.map((linha) => (
              <Linha key={`${linha.posicao}-${linha.nome}`} destacada={linha.voce}>
                <Celula>
                  <Posicao posicao={linha.posicao} />
                </Celula>
                <Celula linha quebrar>
                  <span className="flex items-center gap-2">
                    {linha.nome}
                    {linha.voce && <Badge tom="marca">Você</Badge>}
                  </span>
                </Celula>
                <Celula numerica>{numero(linha.vendas)}</Celula>
                <Celula numerica>{brl(linha.gmvCentavos / 100)}</Celula>
              </Linha>
            ))}

            {/* Fora do top 20, a própria linha vem junto assim mesmo: o placar
                que esconde a sua posição não serve para nada. */}
            {foraDoTopo && eu && (
              <>
                <Linha>
                  <Celula
                    colSpan={4}
                    className="py-1 text-center text-xs text-fg-subtle"
                  >
                    ⋯
                  </Celula>
                </Linha>
                <Linha destacada>
                  <Celula>
                    <Posicao posicao={eu.posicao} />
                  </Celula>
                  <Celula linha quebrar>
                    <span className="flex items-center gap-2">
                      {eu.nome}
                      <Badge tom="marca">Você</Badge>
                    </span>
                  </Celula>
                  <Celula numerica>{numero(eu.vendas)}</Celula>
                  <Celula numerica>{brl(eu.gmvCentavos / 100)}</Celula>
                </Linha>
              </>
            )}
          </Tabela>

          <p className="mt-4 border-t border-border pt-3 text-xs text-fg-subtle">
            O placar mostra nome de exibição e valores, e só. E-mail, CPF e
            telefone de outras contas não passam por esta tela.
          </p>
        </Card>
      )}
    </>
  );
}
