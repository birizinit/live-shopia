import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarClock,
  HandCoins,
  Lock,
  Scale,
  ShieldCheck,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { BotaoCopiar } from "@/components/ui/copiar";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Cabecalho, Celula, Linha, Tabela } from "@/components/ui/tabela";
import {
  convitesRecebidos,
  dataCurta,
  diasAte,
  dinheiro,
  painelDeIndicacao,
  percentual,
  ROTULO_ORIGEM_CURTO,
  type NivelRede,
} from "@/lib/dados/afiliados";
import { PAGINAS } from "@/lib/paginas";
import { temPapel } from "@/lib/roles";
import { exigirUsuario } from "@/lib/sessao";
import { cn, numero } from "@/lib/utils";
import { responderConviteDeGerente } from "./actions";

const ROTA = "/indique" as const;

export const metadata: Metadata = { title: PAGINAS[ROTA].titulo };

/**
 * Catálogo fechado de mensagens.
 *
 * A action devolve um CÓDIGO na query, nunca o texto: `?erro=` renderizado
 * direto deixaria qualquer pessoa montar um link que faz a nossa própria tela
 * dizer o que ela quiser. Código que não está aqui é simplesmente ignorado.
 */
const AVISOS: Record<string, { tom: "sucesso" | "erro" | "info"; texto: string }> = {
  convite_aceito: {
    tom: "sucesso",
    texto: "Convite aceito. Você agora faz parte da equipe desse gerente.",
  },
  convite_recusado: { tom: "info", texto: "Convite recusado." },
  demo: {
    tom: "info",
    texto: "Modo demo: a tela responde, mas nada foi gravado no banco.",
  },
  nao_encontrado: {
    tom: "erro",
    texto: "Este convite não é seu, já foi respondido ou expirou.",
  },
  conflito: {
    tom: "erro",
    texto: "Você já faz parte da equipe de um gerente. Só é possível ter um.",
  },
  dado_invalido: { tom: "erro", texto: "Os dados enviados não passaram na validação." },
  sem_permissao: { tom: "erro", texto: "Esta ação não é permitida nesta conta." },
  servico_indisponivel: {
    tom: "erro",
    texto: "O serviço necessário não está configurado neste ambiente.",
  },
  desconhecido: { tom: "erro", texto: "Não foi possível concluir a operação." },
};

function Tile({
  icone: Icone,
  rotulo,
  valor,
  detalhe,
  tom = "neutro",
}: {
  icone: React.ComponentType<{ className?: string }>;
  rotulo: string;
  valor: string;
  detalhe?: string;
  tom?: "neutro" | "marca" | "alerta" | "perigo";
}) {
  const fundo =
    tom === "marca"
      ? "bg-primary-soft text-primary-soft-fg"
      : tom === "alerta"
        ? "bg-warning-soft text-warning"
        : tom === "perigo"
          ? "bg-danger-soft text-danger"
          : "bg-bg-subtle text-fg-subtle";

  return (
    <Card className="flex items-start gap-3">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-md", fundo)}>
        <Icone className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-fg-subtle">{rotulo}</p>
        <p className="num truncate text-lg font-semibold">{valor}</p>
        {detalhe && <p className="mt-0.5 text-xs text-fg-muted">{detalhe}</p>}
      </div>
    </Card>
  );
}

function LinhaNivel({ nivel }: { nivel: NivelRede }) {
  return (
    <Linha>
      <Celula linha>
        {ROTULO_ORIGEM_CURTO[`nivel_${nivel.nivel}`]}
        {nivel.nivel === 1 && (
          <span className="ml-2 text-xs font-normal text-fg-subtle">indicação direta</span>
        )}
      </Celula>
      <Celula numerica>{numero(nivel.pessoas)}</Celula>
      <Celula numerica>
        {nivel.taxa ? percentual(nivel.taxa.percentual) : "—"}
        {nivel.taxa?.provisorio && (
          <Badge tom="alerta" className="ml-2 align-middle">
            provisória
          </Badge>
        )}
      </Celula>
      <Celula numerica>{numero(nivel.vendas)}</Celula>
      <Celula numerica>{dinheiro(nivel.pendenteCentavos)}</Celula>
      <Celula numerica>{dinheiro(nivel.totalCentavos)}</Celula>
    </Linha>
  );
}

export default async function IndiquePage(props: PageProps<typeof ROTA>) {
  const usuario = await exigirUsuario(ROTA);
  const { aviso: avisoBruto } = await props.searchParams;

  const codigoAviso = typeof avisoBruto === "string" ? avisoBruto : null;
  const aviso = codigoAviso ? AVISOS[codigoAviso] : undefined;

  const [painel, convites] = await Promise.all([
    painelDeIndicacao(usuario.id),
    convitesRecebidos(usuario.id),
  ]);

  const ehAfiliado = temPapel(usuario.papel, ["affiliate"]);
  const totalRede = painel.niveis.reduce((soma, n) => soma + n.pessoas, 0);
  const totalGanho = painel.niveis.reduce((soma, n) => soma + n.totalCentavos, 0);
  const emDivida = painel.saldo.disponivel < 0;

  return (
    <>
      {/* O aviso vem ANTES do título: quem abre esta tela precisa ler que o
          programa não está no ar antes de ler quanto vai ganhar. */}
      <Alerta tom="info" className="mb-6 bg-warning-soft text-warning">
        <strong className="font-semibold">
          Programa em revisão jurídica — ainda não está valendo.
        </strong>{" "}
        Comissão por profundidade de recrutamento é o desenho que atrai
        enquadramento como pirâmide (Lei 1.521/51, art. 2º, IX). O que separa um
        programa legítimo é a comissão nascer de <strong>venda paga</strong>,
        nunca de cadastro — e é assim que está construído aqui. Ainda assim, os
        três níveis precisam passar por advogado antes de ir ao ar, e os
        percentuais abaixo são provisórios (docs/PLANO.md §7).
      </Alerta>

      <PageHeader
        titulo={PAGINAS[ROTA].titulo}
        descricao="Convide gente para a Shopia e ganhe uma fatia de cada assinatura paga — em até três níveis."
        acoes={
          ehAfiliado ? (
            <Link
              href="/afiliado"
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
            >
              Painel do afiliado
            </Link>
          ) : undefined
        }
      />

      {aviso && (
        <Alerta tom={aviso.tom} className="mb-6">
          {aviso.texto}
        </Alerta>
      )}

      {usuario.demo && (
        <Alerta tom="info" className="mb-6">
          Esta sessão é do modo demo. Os números abaixo são um exemplo para a
          tela poder ser vista — nenhum deles veio do banco.
        </Alerta>
      )}

      {convites.length > 0 && (
        <section className="mb-6 space-y-3">
          {convites.map((convite) => (
            <Card key={convite.id} className="border-primary-border">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitulo>Convite para a equipe de {convite.gerente}</CardTitulo>
                  <CardDescricao>
                    {convite.mensagem ? `“${convite.mensagem}” · ` : ""}
                    Expira em{" "}
                    <span className="num">{numero(diasAte(convite.expiraEm))}</span>{" "}
                    dia(s). Aceitar não muda o seu papel nem a sua indicação — só
                    diz quem acompanha o seu trabalho.
                  </CardDescricao>
                </div>

                <div className="flex shrink-0 gap-2">
                  <form action={responderConviteDeGerente}>
                    <input type="hidden" name="conviteId" value={convite.id} />
                    <input type="hidden" name="resposta" value="aceitar" />
                    <Button type="submit" tamanho="sm">
                      Aceitar
                    </Button>
                  </form>
                  <form action={responderConviteDeGerente}>
                    <input type="hidden" name="conviteId" value={convite.id} />
                    <input type="hidden" name="resposta" value="recusar" />
                    <Button type="submit" tamanho="sm" variante="secondary">
                      Recusar
                    </Button>
                  </form>
                </div>
              </div>
            </Card>
          ))}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardTitulo>Seu convite</CardTitulo>
          <CardDescricao>
            Quem se cadastrar por este link entra como seu indicado de nível 1.
            O vínculo é gravado no cadastro e não pode ser trocado depois —
            comissão já paga aponta para essa rede.
          </CardDescricao>

          <div className="mt-4 space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-fg-subtle">Código</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-md border border-border bg-bg-subtle px-3 py-2 font-[family-name:var(--font-mono)] text-sm font-semibold tracking-widest">
                  {painel.codigo || "—"}
                </code>
                {painel.codigo && (
                  <BotaoCopiar texto={painel.codigo} rotulo="Copiar código" />
                )}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-fg-subtle">
                Link de cadastro
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-bg-subtle px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-fg-muted">
                  {painel.link}
                </span>
                <BotaoCopiar texto={painel.link} rotulo="Copiar link" />
              </div>
            </div>
          </div>
        </Card>

        <Card className="bg-bg-subtle shadow-none">
          <CardTitulo>A rede, em números</CardTitulo>
          <dl className="mt-3 space-y-2.5">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-fg-muted">Pessoas nos 3 níveis</dt>
              <dd className="num text-sm font-semibold">{numero(totalRede)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-fg-muted">Comissão acumulada</dt>
              <dd className="num text-sm font-semibold">{dinheiro(totalGanho)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-fg-muted">Prazo de liberação</dt>
              <dd className="num text-sm font-semibold">D+{painel.diasLiberacao}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Saldo</h2>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            icone={CalendarClock}
            tom="alerta"
            rotulo="Pendente"
            valor={dinheiro(painel.saldo.pendente)}
            detalhe={
              painel.saldo.proximaLiberacao
                ? `Próxima liberação em ${dataCurta(painel.saldo.proximaLiberacao)}`
                : "Nada aguardando liberação"
            }
          />
          <Tile
            icone={Wallet}
            tom={emDivida ? "perigo" : "marca"}
            rotulo="Disponível"
            valor={dinheiro(painel.saldo.disponivel)}
            detalhe={
              emDivida
                ? "Negativo: uma venda já sacada foi estornada"
                : "Pronto para entrar num pedido de saque"
            }
          />
          <Tile
            icone={Lock}
            rotulo="Reservado em saque"
            valor={dinheiro(painel.saldo.bloqueado)}
            detalhe="Comprometido num pedido em análise"
          />
          <Tile
            icone={HandCoins}
            rotulo="Já recebido"
            valor={dinheiro(painel.saldo.sacado)}
            detalhe="Total pago em saques"
          />
        </div>

        {emDivida && (
          <Alerta tom="erro" className="mt-4">
            O disponível está negativo porque uma venda que já tinha virado saque
            foi estornada pelo gateway. O número fica negativo de propósito:
            zerar na marra esconderia um prejuízo real. As próximas comissões
            abatem essa diferença antes de liberar saldo novo.
          </Alerta>
        )}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardTitulo>Por que o dinheiro espera {painel.diasLiberacao} dias</CardTitulo>
          <div className="mt-3 space-y-3 text-sm text-fg-muted">
            <p>
              Cartão e PIX podem ser contestados <em>depois</em> da venda. Entre
              a compra e o fim do prazo de chargeback, o dinheiro que entrou
              ainda pode voltar — e comissão paga em cima de venda estornada
              vira dívida sua, não prejuízo nosso.
            </p>
            <p>
              Por isso a comissão nasce em{" "}
              <strong className="font-medium text-fg">pendente</strong> no dia do
              pagamento confirmado e só vira{" "}
              <strong className="font-medium text-fg">disponível</strong>{" "}
              <span className="num">{painel.diasLiberacao}</span> dias depois. A
              data de liberação é congelada quando a comissão nasce: mudar o
              prazo no futuro não mexe no que já está contado.
            </p>
            <p>
              Se a venda for estornada nessa janela, a comissão é estornada junto
              — nos três níveis e no gerente, no mesmo instante em que o
              pagamento muda de estado. É o clawback, e ele é automático.
            </p>
          </div>
        </Card>

        <Card className="bg-bg-subtle shadow-none">
          <CardTitulo>O que gera comissão</CardTitulo>
          <ul className="mt-3 space-y-3 text-sm text-fg-muted">
            <li className="flex gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <span>
                <strong className="font-medium text-fg">Assinatura paga</strong> de
                alguém da sua rede, confirmada pelo gateway.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Scale className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
              <span>
                <strong className="font-medium text-fg">Cadastro não gera nada.</strong>{" "}
                Nem convite, nem promoção, nem “ativação”. Não existe caminho no
                sistema que crie comissão a partir de uma pessoa nova.
              </span>
            </li>
          </ul>
        </Card>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Os três níveis</h2>
        <Card>
            <Tabela
              rotulo="Comissão por nível da rede"
              cabecalho={
                <Cabecalho
                  colunas={[
                    "Nível",
                    { rotulo: "Pessoas", numerica: true },
                    { rotulo: "Taxa", numerica: true },
                    { rotulo: "Vendas", numerica: true },
                    { rotulo: "Pendente", numerica: true },
                    { rotulo: "Acumulado", numerica: true },
                  ]}
                />
              }
            >
              {painel.niveis.map((nivel) => (
                <LinhaNivel key={nivel.nivel} nivel={nivel} />
              ))}
            </Tabela>
        </Card>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Quem você indicou</h2>
          {painel.indicados.length > 0 && (
            <Badge>
              <span className="num">{numero(painel.indicados.length)}</span>
              <span className="ml-1">pessoa(s)</span>
            </Badge>
          )}
        </div>

        {painel.indicados.length === 0 ? (
          <EstadoVazio
            icone={UserPlus}
            titulo="Ninguém entrou pelo seu link ainda"
            texto="Copie o link acima e mande para quem vende ao vivo. A comissão começa quando a primeira assinatura for paga — não quando a pessoa se cadastra."
          />
        ) : (
          <Card>
              <Tabela
                rotulo="Indicados por nível"
                cabecalho={
                  <Cabecalho
                    colunas={[
                      "Pessoa",
                      "Nível",
                      "Desde",
                      { rotulo: "Vendas", numerica: true },
                      { rotulo: "Sua comissão", numerica: true },
                    ]}
                  />
                }
              >
                {painel.indicados.map((indicado) => (
                  <Linha key={indicado.id}>
                    <Celula linha quebrar>
                      {indicado.nome}
                    </Celula>
                    <Celula>
                      <Badge tom={indicado.nivel === 1 ? "marca" : "neutro"}>
                        Nível {indicado.nivel}
                      </Badge>
                    </Celula>
                    <Celula className="text-fg-muted">{dataCurta(indicado.desde)}</Celula>
                    <Celula numerica>{numero(indicado.vendas)}</Celula>
                    <Celula numerica>{dinheiro(indicado.comissaoCentavos)}</Celula>
                  </Linha>
                ))}
              </Tabela>
          </Card>
        )}

        <p className="mt-3 flex items-start gap-2 text-xs text-fg-subtle">
          <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            A coluna <strong className="font-medium">Sua comissão</strong> é o que
            cada pessoa gerou <em>para você</em> — é a sua receita, não o
            faturamento dela. E-mail, CPF e telefone de terceiros nunca aparecem
            nesta tela.
          </span>
        </p>
      </section>

      {!ehAfiliado && (
        <Card className="mt-6 bg-bg-subtle shadow-none">
          <CardTitulo>Afiliado PRO</CardTitulo>
          <CardDescricao>
            O painel com extrato completo, volume gerado e solicitação de saque
            abre para quem é Afiliado PRO. O acesso é dado por um gerente ou pela
            equipe da Shopia — não é uma compra e não muda a sua rede.
          </CardDescricao>
        </Card>
      )}
    </>
  );
}
