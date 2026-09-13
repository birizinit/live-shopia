import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Check, LogIn, Minus, Repeat } from "lucide-react";
import { assinar } from "./actions";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Propriedade, Propriedades } from "@/components/ui/propriedades";
import { Cabecalho, Celula, Linha, Tabela } from "@/components/ui/tabela";
import {
  assinaturaDoPerfil,
  falaDe,
  formatarData,
  formatarPreco,
  listarPlanos,
  podeCobrar,
  type Assinatura,
  type Plano,
  type StatusAssinatura,
} from "@/lib/dados/planos";
import { obterUsuario } from "@/lib/sessao";
import { cn, numero } from "@/lib/utils";

/**
 * Como cada plano se apresenta, dado que agora há três periodicidades do mesmo
 * produto. Escrever "/mês" no plano anual diria ao cliente que ele custa R$497
 * por mês — informação de preço errada, que volta como estorno e como Procon.
 */
function periodicidade(meses: number) {
  if (meses === 12) return { sufixo: "por ano", cada: "cobrado uma vez por ano" };
  if (meses === 3) return { sufixo: "a cada 3 meses", cada: "cobrado a cada três meses" };
  return { sufixo: "/mês", cada: "cobrado todo mês" };
}

export const metadata: Metadata = { title: "Planos" };

const STATUS: Record<
  StatusAssinatura,
  { rotulo: string; tom: React.ComponentProps<typeof Badge>["tom"] }
> = {
  ativa: { rotulo: "Ativa", tom: "sucesso" },
  pendente: { rotulo: "Aguardando pagamento", tom: "alerta" },
  inadimplente: { rotulo: "Inadimplente", tom: "perigo" },
  cancelada: { rotulo: "Cancelada", tom: "neutro" },
};

/** A frase que a tela usa toda vez que `creditos_mes` e nulo. Uma so. */
const COTA_INDEFINIDA = "Teto ainda não definido";

function cotaMensal(plano: Plano) {
  if (plano.creditosMes === null) return COTA_INDEFINIDA;
  return `${numero(plano.creditosMes)} caracteres · ~${falaDe(plano.creditosMes)} de fala`;
}

function Incluido({ sim, oQue }: { sim: boolean; oQue: string }) {
  const Icone = sim ? Check : Minus;
  return (
    <>
      <Icone
        className={cn("inline size-4", sim ? "text-success" : "text-fg-subtle")}
        aria-hidden
      />
      <span className="sr-only">
        {sim ? "Incluído" : "Não incluído"}: {oQue}
      </span>
    </>
  );
}

/** Estado da assinatura, do ciclo vigente e da cota do periodo. */
function BlocoAssinatura({ assinatura }: { assinatura: Assinatura }) {
  const { plano, ciclo } = assinatura;
  const status = STATUS[assinatura.status];

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitulo>Sua assinatura</CardTitulo>
          <CardDescricao>
            Quem move este estado é a confirmação do pagamento, não esta tela.
          </CardDescricao>
        </div>
        <Badge tom={status.tom}>{status.rotulo}</Badge>
      </div>

      <Propriedades className="mt-4" colunas={2}>
        <Propriedade rotulo="Plano" valor={plano.nome} />
        <Propriedade
          rotulo="Cobrança"
          valor={`${formatarPreco(plano.precoCentavos)} ${periodicidade(plano.meses).sufixo}`}
          numerica
        />
        <Propriedade
          rotulo="Início"
          valor={assinatura.inicio ? formatarData(assinatura.inicio) : "—"}
          numerica
        />
        <Propriedade
          rotulo="Encerramento"
          valor={assinatura.fim ? formatarData(assinatura.fim) : "Sem data marcada"}
          numerica
        />

        {ciclo ? (
          <>
            <Propriedade
              rotulo="Ciclo"
              valor={
                <span className="inline-flex items-center gap-2">
                  <span className="num">
                    {formatarData(ciclo.inicio)} – {formatarData(ciclo.fim)}
                  </span>
                  <Badge tom={ciclo.vigente ? "sucesso" : "neutro"}>
                    {ciclo.vigente ? "Vigente" : "Encerrado"}
                  </Badge>
                </span>
              }
            />
            <Propriedade
              rotulo={ciclo.vigente ? "Vence em" : "Venceu em"}
              valor={formatarData(ciclo.fim)}
              numerica
            />
            <Propriedade
              rotulo="Cota deste ciclo"
              valor={
                ciclo.concedidoEm
                  ? `${numero(ciclo.caracteresConcedidos)} caracteres em ${formatarData(ciclo.concedidoEm)}`
                  : "Nada concedido ainda"
              }
              numerica={Boolean(ciclo.concedidoEm)}
            />
          </>
        ) : (
          <Propriedade
            rotulo="Ciclo"
            valor="Nenhum ciclo registrado"
            className="sm:col-span-2"
          />
        )}
      </Propriedades>

      {plano.creditosMes === null && (
        <p className="mt-4 text-sm text-fg-muted">
          O teto mensal deste plano ainda não está definido no catálogo, então
          nenhuma cota é concedida quando o ciclo vira. Enquanto isso, crédito
          entra por{" "}
          <Link
            href="/creditos"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            pacote avulso
          </Link>
          .
        </p>
      )}

      {!ciclo && (
        <p className="mt-4 text-sm text-fg-muted">
          O ciclo nasce do pagamento confirmado, com as datas que o gateway
          informa. Sem ciclo não há período para conceder cota.
        </p>
      )}
    </Card>
  );
}

function CartaoPlano({
  plano,
  atual,
  cobrancaLigada,
}: {
  plano: Plano;
  atual: boolean;
  cobrancaLigada: boolean;
}) {
  return (
    <Card className={cn("flex flex-col", atual && "border-primary-border")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitulo>{plano.nome}</CardTitulo>
          {plano.descricao && <CardDescricao>{plano.descricao}</CardDescricao>}
        </div>
        {atual && (
          <Badge tom="marca">
            <BadgeCheck className="mr-1 size-3.5" aria-hidden />
            Seu plano
          </Badge>
        )}
      </div>

      <p className="mt-5 flex items-baseline gap-1.5">
        <span className="num text-3xl font-bold tracking-tight">
          {formatarPreco(plano.precoCentavos)}
        </span>
        <span className="text-sm text-fg-muted">
          {periodicidade(plano.meses).sufixo}
        </span>
      </p>
      {plano.meses > 1 && (
        <p className="mt-1 text-sm text-fg-muted">
          equivale a{" "}
          <span className="num font-medium text-fg">
            {formatarPreco(plano.precoMensalCentavos)}
          </span>{" "}
          por mês
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-border py-3 text-sm">
        <div>
          <dt className="text-xs text-fg-subtle">Contas TikTok</dt>
          <dd className="num font-medium">{numero(plano.contasTiktok)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">Cota mensal</dt>
          <dd
            className={cn(
              "font-medium",
              plano.creditosMes === null ? "text-fg-muted" : "num",
            )}
          >
            {plano.creditosMes === null
              ? COTA_INDEFINIDA
              : `${numero(plano.creditosMes)} caracteres`}
          </dd>
        </div>
      </dl>

      {plano.recursos.length > 0 && (
        <ul className="mt-4 space-y-2">
          {plano.recursos.map((recurso) => (
            <li key={recurso} className="flex gap-2 text-sm text-fg-muted">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <span>{recurso}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto pt-5">
        <form action={assinar}>
          <input type="hidden" name="planoId" value={plano.id} />
          <Button
            type="submit"
            bloco
            variante={atual ? "secondary" : "primary"}
            disabled={!cobrancaLigada || atual}
          >
            {atual ? "Plano atual" : `Assinar ${plano.nome}`}
          </Button>
        </form>
        {!cobrancaLigada && !atual && (
          <p className="mt-2 text-center text-xs text-fg-subtle">
            Sem meio de pagamento ativo.
          </p>
        )}
      </div>
    </Card>
  );
}

export default async function PlanosPage() {
  // /planos e rota publica (src/lib/rotas.ts): a vitrine tem de renderizar para
  // quem ainda nao entrou, entao aqui nao se exige sessao.
  const usuario = await obterUsuario();

  const [planos, assinatura] = await Promise.all([
    listarPlanos(),
    usuario ? assinaturaDoPerfil(usuario.id) : Promise.resolve(null),
  ]);

  const cobrancaLigada = podeCobrar();
  const planoAtualId = assinatura?.status === "ativa" ? assinatura.plano.id : null;

  return (
    <>
      <PageHeader
        titulo="Planos"
        descricao="O que cada plano libera, o estado da sua assinatura e o ciclo em curso."
      />

      {!cobrancaLigada && (
        <div className="mb-6">
          <Alerta tom="info">
            <strong className="font-semibold">
              O meio de pagamento ainda não está ativo.
            </strong>{" "}
            Nenhum gateway foi configurado, então assinar está desabilitado: não
            geramos PIX, QR nem cobrança por aqui. O catálogo abaixo e a sua
            assinatura são os dados reais do banco.
          </Alerta>
        </div>
      )}

      {usuario ? (
        assinatura ? (
          <BlocoAssinatura assinatura={assinatura} />
        ) : (
          <EstadoVazio
            icone={Repeat}
            titulo="Você ainda não tem assinatura"
            texto="Nenhuma assinatura foi registrada nesta conta. Os créditos que já estão no seu saldo continuam valendo."
            acao={
              <Link
                href="/creditos"
                className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
              >
                Ver saldo e pacotes
              </Link>
            }
          />
        )
      ) : (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitulo>Entre para ver a sua assinatura</CardTitulo>
            <CardDescricao>
              O catálogo abaixo é público. Estado da assinatura, ciclo e cota
              dependem da conta.
            </CardDescricao>
          </div>
          <Link
            href="/login?proximo=%2Fplanos"
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
          >
            <LogIn className="size-4" aria-hidden />
            Entrar
          </Link>
        </Card>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Escolha o plano</h2>

        {planos.length === 0 ? (
          <EstadoVazio
            titulo="Nenhum plano no catálogo"
            texto="Não há plano ativo cadastrado. Quem publica o catálogo é a operação, não esta tela."
          />
        ) : (
          <div
            className={cn(
              "grid gap-4",
              planos.length >= 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2",
            )}
          >
            {planos.map((plano) => (
              <CartaoPlano
                key={plano.id}
                plano={plano}
                atual={plano.id === planoAtualId}
                cobrancaLigada={cobrancaLigada}
              />
            ))}
          </div>
        )}
      </section>

      {planos.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Comparativo</h2>
          <Card>
            <Tabela
              rotulo="Comparativo dos planos"
              cabecalho={
                <Cabecalho
                  colunas={[
                    { rotulo: "O que o plano libera" },
                    ...planos.map((plano) => ({ rotulo: plano.nome, numerica: true })),
                  ]}
                />
              }
            >
              <Linha>
                <Celula linha>Cobrança</Celula>
                {planos.map((plano) => (
                  <Celula key={plano.id} numerica>
                    {formatarPreco(plano.precoCentavos)}{" "}
                    <span className="text-fg-subtle">
                      {periodicidade(plano.meses).sufixo}
                    </span>
                  </Celula>
                ))}
              </Linha>

              <Linha>
                <Celula linha>Equivale por mês</Celula>
                {planos.map((plano) => (
                  <Celula key={plano.id} numerica>
                    {formatarPreco(plano.precoMensalCentavos)}
                  </Celula>
                ))}
              </Linha>

              <Linha>
                <Celula linha>Contas TikTok</Celula>
                {planos.map((plano) => (
                  <Celula key={plano.id} numerica>
                    {numero(plano.contasTiktok)}
                  </Celula>
                ))}
              </Linha>

              <Linha>
                <Celula linha>Voz premium</Celula>
                {planos.map((plano) => (
                  <Celula key={plano.id} numerica>
                    <Incluido sim={plano.vozPremium} oQue={`voz premium no ${plano.nome}`} />
                  </Celula>
                ))}
              </Linha>

              <Linha>
                <Celula linha>Cota mensal</Celula>
                {planos.map((plano) => (
                  // `quebrar` porque a cota traz a equivalencia em fala junto:
                  // sem quebra a celula alarga a tabela e joga a rolagem
                  // horizontal numa linha que cabia.
                  <Celula key={plano.id} numerica quebrar>
                    {plano.creditosMes === null ? (
                      <span className="text-fg-muted">a definir</span>
                    ) : (
                      cotaMensal(plano)
                    )}
                  </Celula>
                ))}
              </Linha>
            </Tabela>
          </Card>
        </section>
      )}

      <Card className="mt-8 bg-bg-subtle shadow-none">
        <CardTitulo>Como o plano vira crédito</CardTitulo>
        <ul className="mt-3 space-y-2.5 text-sm text-fg-muted">
          <li>
            A cota é concedida <strong className="font-medium text-fg">por ciclo cobrado</strong>,
            não por mês de calendário — é o ciclo que responde &ldquo;já caiu este mês?&rdquo;.
          </li>
          <li>
            Enquanto o teto mensal do plano não estiver definido, nenhuma cota é
            concedida. O ciclo fica visivelmente sem concessão em vez de receber
            um número chutado que depois ninguém consegue estornar.
          </li>
          <li>
            Crédito é medido em <strong className="font-medium text-fg">caracteres</strong>,
            porque é a unidade que a geração de voz cobra. O detalhe do consumo
            está em{" "}
            <Link
              href="/creditos"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Créditos
            </Link>
            .
          </li>
          <li>
            A assinatura só fica ativa quando o pagamento é confirmado pelo
            gateway. Esta tela nunca muda esse estado sozinha.
          </li>
          <li>
            Trocar de plano no meio do ciclo — com o proporcional do que já foi
            pago — entra junto com o checkout: o cálculo depende do que o
            gateway cobra e devolve, e ainda não há gateway escolhido.
          </li>
        </ul>
      </Card>
    </>
  );
}
