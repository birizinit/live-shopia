import type { Metadata } from "next";
import Link from "next/link";
import { History, Repeat, Wallet } from "lucide-react";
import { comprar } from "./actions";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { BarraProgresso, type TomBarra } from "@/components/ui/barra-progresso";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Propriedade, Propriedades } from "@/components/ui/propriedades";
import { Cabecalho, Celula, Linha, Tabela } from "@/components/ui/tabela";
import {
  consumoRecente,
  extratoDoPerfil,
  falaDe,
  formatarData,
  formatarDataHora,
  formatarPreco,
  listarPacotes,
  podeCobrar,
  precoPorMil,
  projetar,
  saldoAtual,
  type ConsumoRecente,
  type MotivoCredito,
  type Projecao,
} from "@/lib/dados/planos";
import { exigirUsuario } from "@/lib/sessao";
import { cn, numero } from "@/lib/utils";

export const metadata: Metadata = { title: "Créditos" };

/**
 * O que cada motivo da razao significa em portugues. A coluna existe porque
 * "compra", "ajuste" e "estorno" sao nomes do banco: quem le o extrato precisa
 * saber por que o numero mexeu, nao o enum que o gerou.
 */
const MOTIVOS: Record<MotivoCredito, { rotulo: string; explicacao: string }> = {
  compra: {
    rotulo: "Compra de pacote",
    explicacao: "Pacote avulso confirmado pelo gateway e creditado na razão.",
  },
  assinatura: {
    rotulo: "Cota do plano",
    explicacao: "Cota mensal concedida uma vez por ciclo da assinatura.",
  },
  bonus: {
    rotulo: "Bônus",
    explicacao: "Crédito concedido pela operação, sem cobrança.",
  },
  consumo: {
    rotulo: "Geração de áudio",
    explicacao: "Caracteres debitados antes da chamada de voz, nunca depois.",
  },
  estorno: {
    rotulo: "Estorno",
    explicacao: "Geração que falhou de vez devolveu o que tinha cobrado.",
  },
  ajuste: {
    rotulo: "Ajuste",
    explicacao: "Correção registrada como lançamento novo — a razão não se reescreve.",
  },
};

function descreverMotivo(motivo: string) {
  return motivo in MOTIVOS
    ? MOTIVOS[motivo as MotivoCredito]
    : { rotulo: motivo, explicacao: "Lançamento registrado na razão." };
}

/** Quanto mais perto do fim, mais forte o aviso. */
function tomDaProjecao(dias: number): TomBarra {
  if (dias < 7) return "perigo";
  if (dias < 15) return "alerta";
  return "primaria";
}

function BlocoProjecao({
  saldo,
  consumo,
  projecao,
}: {
  saldo: number;
  consumo: ConsumoRecente;
  projecao: Projecao;
}) {
  return (
    <Card className="flex flex-col">
      <CardTitulo>Quanto tempo o saldo dura</CardTitulo>
      <CardDescricao>
        Conta feita com o seu consumo dos últimos {consumo.dias} dias. É um
        ritmo medido, não uma promessa: mudou o ritmo, muda o número.
      </CardDescricao>

      {projecao.tipo === "estimada" ? (
        <>
          <p className="mt-5 flex items-baseline gap-2">
            <span className="num text-4xl font-bold tracking-tight">
              {projecao.dias < 1 ? "<1" : numero(projecao.dias)}
            </span>
            <span className="text-sm text-fg-muted">
              {projecao.dias === 1 ? "dia" : "dias"}
            </span>
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            Nesse ritmo, o saldo chega até{" "}
            <span className="num font-medium text-fg">{formatarData(projecao.ate)}</span>.
          </p>

          <BarraProgresso
            className="mt-5"
            rotulo="Saldo em relação ao consumo dos últimos 30 dias"
            valor={saldo}
            maximo={consumo.caracteres}
            textoValor={`${numero(saldo)} de ${numero(consumo.caracteres)} caracteres`}
            tom={tomDaProjecao(projecao.dias)}
          />

          <p className="mt-2 text-xs text-fg-subtle">
            Média de{" "}
            <span className="num">{numero(Math.round(projecao.mediaDiaria))}</span>{" "}
            caracteres por dia, em {numero(consumo.geracoes)}{" "}
            {consumo.geracoes === 1 ? "geração" : "gerações"}.
          </p>
        </>
      ) : (
        <div className="mt-5">
          <Alerta tom="info">
            {projecao.tipo === "sem_saldo"
              ? "Saldo zerado: não há o que projetar. A próxima geração vai precisar de crédito novo."
              : `Você não consumiu nada nos últimos ${consumo.dias} dias, então não há ritmo para projetar. Um número aqui seria chute.`}
          </Alerta>
        </div>
      )}
    </Card>
  );
}

export default async function CreditosPage() {
  const usuario = await exigirUsuario("/creditos");

  const [saldo, consumo, pacotes, lancamentos] = await Promise.all([
    saldoAtual(usuario.id),
    consumoRecente(usuario.id, 30),
    listarPacotes(),
    extratoDoPerfil(usuario.id),
  ]);

  const projecao = projetar(saldo, consumo);
  const cobrancaLigada = podeCobrar();

  return (
    <>
      <PageHeader
        titulo="Créditos"
        descricao="Saldo, para onde ele foi e quanto ele ainda dura. Tudo medido em caracteres."
      />

      {!cobrancaLigada && (
        <div className="mb-6">
          <Alerta tom="info">
            <strong className="font-semibold">
              O meio de pagamento ainda não está ativo.
            </strong>{" "}
            Nenhum gateway foi configurado, então comprar está desabilitado: não
            geramos PIX, QR nem cobrança por aqui. O saldo e o extrato abaixo são
            os seus dados reais.
          </Alerta>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col">
          <div className="flex items-start gap-3">
            <span
              className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-fg"
              aria-hidden
            >
              <Wallet className="size-5" />
            </span>
            <div className="min-w-0">
              <CardTitulo>Saldo</CardTitulo>
              <CardDescricao>
                O saldo é consequência da razão de lançamentos, não um campo que
                alguém sobrescreve.
              </CardDescricao>
            </div>
          </div>

          <p className="mt-5 flex items-baseline gap-2">
            <span className="num text-4xl font-bold tracking-tight">
              {numero(saldo)}
            </span>
            <span className="text-sm text-fg-muted">caracteres</span>
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            Dá para gerar cerca de{" "}
            <span className="font-medium text-fg">{falaDe(saldo)}</span> de fala.
          </p>

          <Propriedades className="mt-5">
            <Propriedade
              rotulo={`Consumo em ${consumo.dias} dias`}
              valor={`${numero(consumo.caracteres)} caracteres`}
              numerica
            />
            <Propriedade
              rotulo={`Gerações em ${consumo.dias} dias`}
              valor={numero(consumo.geracoes)}
              numerica
            />
          </Propriedades>
        </Card>

        <BlocoProjecao saldo={saldo} consumo={consumo} projecao={projecao} />
      </div>

      <section className="mt-8">
        <h2 className="mb-1 text-lg font-semibold">Pacotes avulsos</h2>
        <p className="mb-3 text-sm text-fg-muted">
          Crédito sem trocar de plano. O que você compra entra na mesma razão do
          resto e não vence.
        </p>

        {pacotes.length === 0 ? (
          <EstadoVazio
            titulo="Nenhum pacote à venda"
            texto="Não há pacote ativo no catálogo. Quem publica a vitrine é a operação, não esta tela."
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {pacotes.map((pacote) => {
                const porMil = precoPorMil(pacote.precoCentavos, pacote.caracteres);

                return (
                  <Card key={pacote.id} className="flex flex-col">
                    <CardTitulo>{pacote.nome}</CardTitulo>

                    <p className="num mt-3 text-2xl font-bold tracking-tight">
                      {numero(pacote.caracteres)}
                    </p>
                    <p className="text-xs text-fg-subtle">
                      caracteres · ~{falaDe(pacote.caracteres)} de fala
                    </p>

                    <p className="num mt-4 text-lg font-semibold">
                      {formatarPreco(pacote.precoCentavos)}
                    </p>
                    {porMil && (
                      <p className="text-xs text-fg-subtle">
                        <span className="num">{porMil}</span> por mil caracteres
                      </p>
                    )}

                    <form action={comprar} className="mt-auto pt-4">
                      <input type="hidden" name="pacoteId" value={pacote.id} />
                      <Button type="submit" bloco disabled={!cobrancaLigada}>
                        Comprar
                      </Button>
                    </form>
                  </Card>
                );
              })}
            </div>

            {!cobrancaLigada && (
              <p className="mt-3 text-xs text-fg-subtle">
                Comprar fica desabilitado enquanto não houver meio de pagamento
                ativo.
              </p>
            )}
          </>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-lg font-semibold">Extrato</h2>
        <p className="mb-3 text-sm text-fg-muted">
          Cada linha é um lançamento da razão, na ordem em que aconteceu. Nada
          aqui é editado depois: correção vira lançamento novo.
        </p>

        {lancamentos.length === 0 ? (
          <EstadoVazio
            icone={History}
            titulo="Nenhum lançamento ainda"
            texto="Assim que você gerar o primeiro áudio, o débito aparece aqui — com data, motivo e quantos caracteres saíram."
            acao={
              <Link
                href="/estudio"
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
              >
                Ir para o estúdio
              </Link>
            }
          />
        ) : (
          <Card>
            <Tabela
              rotulo="Extrato de créditos"
              cabecalho={
                <Cabecalho
                  colunas={[
                    "Lançamento",
                    "O que representa",
                    { rotulo: "Quando", numerica: true },
                    { rotulo: "Caracteres", numerica: true },
                  ]}
                />
              }
            >
              {lancamentos.map((lancamento) => {
                const motivo = descreverMotivo(lancamento.motivo);
                const entrou = lancamento.delta > 0;

                return (
                  <Linha key={lancamento.id}>
                    <Celula linha>{motivo.rotulo}</Celula>
                    <Celula quebrar className="text-fg-muted">
                      {lancamento.detalhe ?? motivo.explicacao}
                    </Celula>
                    <Celula numerica className="text-fg-muted">
                      {formatarDataHora(lancamento.criadoEm)}
                    </Celula>
                    <Celula
                      numerica
                      className={cn(
                        "font-medium",
                        entrou ? "text-success" : "text-fg",
                      )}
                    >
                      {/* Sinal em ASCII: o "−" tipográfico não tem largura
                          tabular, e a coluna deixaria de alinhar. */}
                      {entrou ? "+" : "-"}
                      {numero(Math.abs(lancamento.delta))}
                    </Celula>
                  </Linha>
                );
              })}
            </Tabela>
          </Card>
        )}
      </section>

      <Card className="mt-8 bg-bg-subtle shadow-none">
        <div className="flex items-start gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-md bg-surface text-fg-muted"
            aria-hidden
          >
            <Repeat className="size-5" />
          </span>
          <div className="min-w-0">
            <CardTitulo>Como o crédito é medido</CardTitulo>
            <CardDescricao>
              Ler isto uma vez evita a conta errada na hora de comprar.
            </CardDescricao>
          </div>
        </div>

        <ul className="mt-4 space-y-2.5 text-sm text-fg-muted">
          <li>
            Crédito é medido em{" "}
            <strong className="font-medium text-fg">caracteres</strong>, não em
            minutos nem em número de gerações — é a unidade que a geração de voz
            cobra. Cerca de 600 caracteres viram um minuto de fala.
          </li>
          <li>
            <strong className="font-medium text-fg">
              Repetir o áudio em laço não consome nada.
            </strong>{" "}
            O loop toca um arquivo que já existe: você paga uma vez pelo texto e
            roda a live inteira em cima dele. Reaproveitar um áudio da biblioteca
            também é de graça.
          </li>
          <li>
            O débito acontece <em>antes</em> da chamada de voz, no mesmo commit
            que enfileira o trabalho: ou você foi cobrado e o áudio está na fila,
            ou nada aconteceu.
          </li>
          <li>
            Geração que falhou em todas as tentativas devolve o que cobrou, como
            lançamento de estorno.
          </li>
          <li>
            Editar o texto e gerar de novo é uma geração nova, e cobra de novo —
            só o texto mudado custa.
          </li>
        </ul>
      </Card>
    </>
  );
}
