import type { Metadata } from "next";
import Link from "next/link";
import {
  Banknote,
  EyeOff,
  MailPlus,
  Percent,
  Star,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Campo, Input } from "@/components/ui/input";
import { Propriedade, Propriedades } from "@/components/ui/propriedades";
import { AreaTexto } from "@/components/ui/selecao";
import { Cabecalho, Celula, Linha, Tabela } from "@/components/ui/tabela";
import {
  dataCurta,
  diasAte,
  dinheiro,
  painelDoGerente,
  percentual,
  ROTULO_STATUS_SAQUE,
  type StatusConvite,
  type StatusSaque,
} from "@/lib/dados/afiliados";
import { PAGINAS } from "@/lib/paginas";
import { exigirPapel } from "@/lib/sessao";
import { cn, numero } from "@/lib/utils";
import { cancelarConviteEnviado, convidar, promover } from "./actions";

const ROTA = "/gerente" as const;

export const metadata: Metadata = { title: PAGINAS[ROTA].titulo };

/** Catálogo fechado: a action manda o código, a tela escolhe a frase. */
const AVISOS: Record<string, { tom: "sucesso" | "erro" | "info"; texto: string }> = {
  convite_enviado: {
    tom: "sucesso",
    texto: "Convite enviado. Ele aparece na tela Indique e ganhe da pessoa.",
  },
  convite_cancelado: { tom: "info", texto: "Convite cancelado." },
  promovido: {
    tom: "sucesso",
    texto: "Promoção registrada. A pessoa agora tem o painel de Afiliado PRO.",
  },
  demo: { tom: "info", texto: "Modo demo: a tela responde, mas nada foi gravado no banco." },

  codigo_vazio: {
    tom: "erro",
    texto: "Informe o código de indicação da pessoa que você quer convidar.",
  },
  conflito: {
    tom: "erro",
    texto: "Você já tem um convite pendente para essa pessoa.",
  },
  nao_encontrado: {
    tom: "erro",
    texto: "Nenhuma conta com esse código de indicação. Confira com a pessoa.",
  },
  sem_permissao: {
    tom: "erro",
    texto: "Só dá para promover quem já aceitou o seu convite e ainda não é afiliado.",
  },
  dado_invalido: { tom: "erro", texto: "Os dados enviados não passaram na validação." },
  servico_indisponivel: {
    tom: "erro",
    texto: "O serviço necessário não está configurado neste ambiente.",
  },
  desconhecido: { tom: "erro", texto: "Não foi possível concluir a operação." },
};

const TOM_CONVITE: Record<StatusConvite, "neutro" | "marca" | "sucesso" | "alerta"> = {
  pendente: "alerta",
  aceito: "sucesso",
  recusado: "neutro",
  expirado: "neutro",
};

const ROTULO_CONVITE: Record<StatusConvite, string> = {
  pendente: "Aguardando resposta",
  aceito: "Na equipe",
  recusado: "Recusado",
  expirado: "Expirado",
};

const TOM_SAQUE: Record<StatusSaque, "neutro" | "marca" | "sucesso" | "alerta" | "perigo"> = {
  solicitado: "alerta",
  aprovado: "marca",
  pago: "sucesso",
  recusado: "perigo",
  cancelado: "neutro",
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
  tom?: "neutro" | "marca" | "alerta";
}) {
  const fundo =
    tom === "marca"
      ? "bg-primary-soft text-primary-soft-fg"
      : tom === "alerta"
        ? "bg-warning-soft text-warning"
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

export default async function GerentePage(props: PageProps<typeof ROTA>) {
  // Papel é checado no servidor, contra o banco — nunca contra um claim do token.
  const usuario = await exigirPapel(["manager"]);
  const { aviso: avisoBruto } = await props.searchParams;

  const codigoAviso = typeof avisoBruto === "string" ? avisoBruto : null;
  const aviso = codigoAviso ? AVISOS[codigoAviso] : undefined;

  const painel = await painelDoGerente(usuario.id);

  const pendentes = painel.convites.filter((c) => c.status === "pendente");
  const saquesAbertos = painel.saquesDaEquipe.filter(
    (s) => s.status === "solicitado" || s.status === "aprovado",
  );

  return (
    <>
      <PageHeader
        titulo={PAGINAS[ROTA].titulo}
        descricao="Sua equipe de afiliados, os convites em aberto e o que a equipe produziu — em números agregados."
        acoes={
          <Link
            href="/afiliado"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Meu saldo e saque
          </Link>
        }
      />

      {aviso && (
        <Alerta tom={aviso.tom} className="mb-6">
          {aviso.texto}
        </Alerta>
      )}

      {usuario.demo && (
        <Alerta tom="info" className="mb-6">
          Esta sessão é do modo demo. A equipe abaixo é um exemplo para a tela
          poder ser vista — nenhum dado veio do banco.
        </Alerta>
      )}

      <section>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            icone={Percent}
            tom="marca"
            rotulo="Sua taxa de gerente"
            valor={painel.taxa ? percentual(painel.taxa.percentual) : "—"}
            detalhe={
              painel.baseDaComissao === "pagamento"
                ? "Sobre o valor da venda"
                : "Sobre a comissão do afiliado da equipe"
            }
          />
          <Tile
            icone={Users}
            rotulo="Na equipe"
            valor={numero(painel.agregado.membros)}
            detalhe={`${numero(pendentes.length)} convite(s) aguardando`}
          />
          <Tile
            icone={UserPlus}
            rotulo="Indicados da equipe"
            valor={numero(painel.agregado.indicadosDaEquipe)}
            detalhe="Somados todos os membros"
          />
          <Tile
            icone={TrendingUp}
            rotulo="Volume da equipe"
            valor={dinheiro(painel.agregado.volumeCentavos)}
            detalhe={`${numero(painel.agregado.vendas)} venda(s) confirmada(s)`}
          />
        </div>

        {painel.taxa?.provisorio && (
          <Alerta tom="info" className="mt-4 bg-warning-soft text-warning">
            A taxa de gerente está marcada como <strong>provisória</strong> no
            banco. Ela incide{" "}
            {painel.baseDaComissao === "pagamento" ? (
              <>
                sobre o <strong>valor da venda</strong> — nesta configuração a
                soma dos três níveis mais o gerente pode passar de 100% da
                receita, e a apuração falha de propósito em vez de pagar
                prejuízo.
              </>
            ) : (
              <>
                sobre a <strong>comissão do afiliado</strong> da equipe, e não
                sobre a venda — é uma fração de uma fração, e é isso que mantém a
                soma de todos os níveis abaixo da receita.
              </>
            )}
          </Alerta>
        )}
      </section>

      {/* A regra de privacidade fica na tela, não só no código: quem opera
          precisa saber por que não vê o extrato de outra pessoa. */}
      <Alerta tom="info" className="mt-6">
        <strong className="font-semibold">O que este painel não mostra.</strong>{" "}
        Da sua equipe você vê nome de exibição, tempo de casa e contagem de
        indicados. E-mail, CPF, telefone e o extrato individual de cada afiliado
        não aparecem aqui — o faturamento de cada um é dado dele, e o que você
        precisa para gerenciar são os números agregados (docs/PLANO.md §7).
      </Alerta>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardTitulo>Seus ganhos como gerente</CardTitulo>
          <CardDescricao>
            Este é o seu dinheiro, com o detalhe todo. Ele nasce da venda paga de
            um afiliado da equipe e segue a mesma regra de todo mundo: pendente
            por 30 dias, estornado junto se a venda voltar.
          </CardDescricao>

          <Propriedades className="mt-3" colunas={2}>
            <Propriedade
              rotulo="Comissão acumulada"
              numerica
              valor={dinheiro(painel.ganhos.totalCentavos)}
            />
            <Propriedade
              rotulo="Lançamentos"
              numerica
              valor={numero(painel.ganhos.lancamentos)}
            />
            <Propriedade
              rotulo="Pendente (D+30)"
              numerica
              valor={dinheiro(painel.ganhos.pendenteCentavos)}
            />
            <Propriedade
              rotulo="Disponível"
              numerica
              valor={dinheiro(painel.ganhos.disponivelCentavos)}
            />
            <Propriedade
              rotulo="Já pago em saque"
              numerica
              valor={dinheiro(painel.ganhos.pagaCentavos)}
            />
            <Propriedade
              rotulo="Reservado em saque"
              numerica
              valor={dinheiro(painel.saldo.bloqueado)}
            />
          </Propriedades>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href="/afiliado"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
            >
              <Wallet className="mr-2 size-4" aria-hidden />
              Extrato e saque
            </Link>
            <p className="text-xs text-fg-subtle">
              O pedido de saque é o mesmo para gerente e afiliado, e fica numa
              tela só.
            </p>
          </div>
        </Card>

        <Card>
          <CardTitulo>Convidar para a equipe</CardTitulo>
          <CardDescricao>
            O convite é feito pelo <strong>código de indicação</strong> da pessoa,
            nunca por e-mail ou @usuário: um campo que responde “existe / não
            existe” para qualquer e-mail digitado vira uma lista de clientes na
            mão de quem insistir. O código é a pessoa quem entrega.
          </CardDescricao>

          <form action={convidar} className="mt-4 space-y-3">
            <Campo
              rotulo="Código de indicação"
              htmlFor="convite-codigo"
              dica={`O convite vale por ${painel.diasDeConvite} dias.`}
            >
              <Input
                id="convite-codigo"
                name="codigo"
                placeholder="A1B2C3D4"
                autoComplete="off"
                className="font-[family-name:var(--font-mono)] tracking-widest uppercase"
                required
              />
            </Campo>

            <Campo rotulo="Mensagem (opcional)" htmlFor="convite-mensagem">
              <AreaTexto
                id="convite-mensagem"
                name="mensagem"
                maximo={400}
                placeholder="Por que vale a pena entrar no seu time."
                classNameCampo="min-h-20"
              />
            </Campo>

            <Button type="submit" bloco>
              <MailPlus className="size-4" aria-hidden />
              Enviar convite
            </Button>
          </form>
        </Card>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Equipe</h2>
          {painel.equipe.length > 0 && (
            <Badge>
              <span className="num">{numero(painel.equipe.length)}</span>
              <span className="ml-1">pessoa(s)</span>
            </Badge>
          )}
        </div>

        {painel.equipe.length === 0 ? (
          <EstadoVazio
            icone={Users}
            titulo="Sua equipe está vazia"
            texto="Peça o código de indicação de quem você quer gerenciar e mande o convite no cartão acima. Aceitar o convite não muda a rede de indicação de ninguém — só diz quem acompanha o trabalho."
          />
        ) : (
          <Card>
            <Tabela
              rotulo="Afiliados da sua equipe"
              cabecalho={
                <Cabecalho
                  colunas={[
                    "Pessoa",
                    "Papel",
                    "Na equipe desde",
                    { rotulo: "Indicados", numerica: true },
                    "",
                  ]}
                />
              }
            >
              {painel.equipe.map((membro) => (
                <Linha key={membro.id}>
                  <Celula linha quebrar>
                    {membro.nome}
                  </Celula>
                  <Celula>
                    {membro.papel === "user" ? (
                      <Badge>Usuário</Badge>
                    ) : (
                      <Badge tom="marca">
                        <Star className="mr-1 size-3" aria-hidden />
                        Afiliado PRO
                      </Badge>
                    )}
                  </Celula>
                  <Celula className="text-fg-muted">{dataCurta(membro.desde)}</Celula>
                  <Celula numerica>{numero(membro.indicadosDiretos)}</Celula>
                  <Celula>
                    {membro.podePromover && (
                      <form action={promover}>
                        <input type="hidden" name="alvoId" value={membro.id} />
                        <Button type="submit" variante="secondary" tamanho="sm">
                          Promover a Afiliado PRO
                        </Button>
                      </form>
                    )}
                  </Celula>
                </Linha>
              ))}
            </Tabela>
          </Card>
        )}

        <p className="mt-3 flex items-start gap-2 text-xs text-fg-subtle">
          <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Promover dá acesso ao painel de Afiliado PRO da própria pessoa. Não dá
            acesso a nada da conta dela, e não pode ser desfeito por aqui — voltar
            atrás é operação de administrador, com registro de quem pediu.
          </span>
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Convites</h2>

        {painel.convites.length === 0 ? (
          <EstadoVazio
            icone={MailPlus}
            titulo="Nenhum convite enviado"
            texto="Os convites que você mandar aparecem aqui com o estado de cada um."
          />
        ) : (
          <Card>
            <Tabela
              rotulo="Convites enviados"
              cabecalho={
                <Cabecalho colunas={["Pessoa", "Estado", "Enviado em", "Prazo", ""]} />
              }
            >
              {painel.convites.map((convite) => (
                <Linha key={convite.id}>
                  <Celula linha quebrar>
                    {convite.nome}
                  </Celula>
                  <Celula>
                    <Badge tom={TOM_CONVITE[convite.status]}>
                      {ROTULO_CONVITE[convite.status]}
                    </Badge>
                  </Celula>
                  <Celula className="text-fg-muted">{dataCurta(convite.criadoEm)}</Celula>
                  <Celula className="text-fg-muted">
                    {convite.status === "pendente" ? (
                      <>
                        expira em{" "}
                        <span className="num">{numero(diasAte(convite.expiraEm))}</span>{" "}
                        dia(s)
                      </>
                    ) : (
                      dataCurta(convite.respondidoEm)
                    )}
                  </Celula>
                  <Celula>
                    {convite.status === "pendente" && (
                      <form action={cancelarConviteEnviado}>
                        <input type="hidden" name="conviteId" value={convite.id} />
                        <Button type="submit" variante="ghost" tamanho="sm">
                          Cancelar
                        </Button>
                      </form>
                    )}
                  </Celula>
                </Linha>
              ))}
            </Tabela>
          </Card>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-1 text-lg font-semibold">Saques da equipe</h2>
        <p className="mb-3 text-sm text-fg-muted">
          Por estado, somando a equipe inteira. Quanto cada afiliado pediu e para
          onde o dinheiro dele foi não aparece aqui — é dado financeiro dele.
        </p>

        {painel.saquesDaEquipe.length === 0 ? (
          <EstadoVazio
            icone={Banknote}
            titulo="Nenhum saque na equipe"
            texto="O primeiro pedido aparece aqui quando algum afiliado seu passar do saldo mínimo."
          />
        ) : (
          <>
            <Card>
              <Tabela
                rotulo="Saques da equipe por estado"
                cabecalho={
                  <Cabecalho
                    colunas={[
                      "Estado",
                      { rotulo: "Pedidos", numerica: true },
                      { rotulo: "Total", numerica: true },
                    ]}
                  />
                }
              >
                {painel.saquesDaEquipe.map((s) => (
                  <Linha key={s.status}>
                    <Celula linha>
                      <Badge tom={TOM_SAQUE[s.status]}>{ROTULO_STATUS_SAQUE[s.status]}</Badge>
                    </Celula>
                    <Celula numerica>{numero(s.quantidade)}</Celula>
                    <Celula numerica>{dinheiro(s.totalCentavos)}</Celula>
                  </Linha>
                ))}
              </Tabela>
            </Card>

            {saquesAbertos.length > 0 && (
              <Alerta tom="info" className="mt-4">
                Há{" "}
                <span className="num">
                  {numero(saquesAbertos.reduce((soma, s) => soma + s.quantidade, 0))}
                </span>{" "}
                pedido(s) esperando decisão do financeiro. Aprovar e pagar não é
                operação de gerente: não existe gateway de transferência aqui, e
                um saque só vira <em>pago</em> com o comprovante de uma
                transferência que aconteceu de verdade.
              </Alerta>
            )}
          </>
        )}
      </section>
    </>
  );
}
