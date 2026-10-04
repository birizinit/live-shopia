import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  CornerDownRight,
  MessageSquareText,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { AvisosProgramados, GatilhoDaLoja } from "./controles";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Indicador } from "@/components/ui/indicador";
import {
  configAutomacoes,
  contagemDaLive,
  listarAvisos,
  LIMITES_AVISO,
  LIMITES_GATILHO,
  SUGESTAO,
  garantirAutomacoesBasicas,
} from "@/lib/dados/automacoes";
import { sessaoAtiva } from "@/lib/dados/live";
import { exigirUsuario } from "@/lib/sessao";
import { brl, numero } from "@/lib/utils";

export const metadata: Metadata = { title: "Automações da live" };

/**
 * As automações: o que a Shopia faz na live sem ninguém pedir.
 *
 * Três famílias, e o que separa elas é o gatilho: tempo (refixar o produto,
 * avisos programados), evento (carrinho e venda, detectados no chat) e pergunta
 * (as respostas do manual, que moram em /manual).
 *
 * A tela carrega o aviso que a camada de dados carrega: intervalo é teto de
 * frequência e não promessa, e carrinho/venda são DETECTADOS pela frase que o
 * TikTok publica no chat — não é integração. Omitir isso aqui venderia uma
 * garantia que o produto não tem.
 */

const LIMITES = {
  texto: LIMITES_AVISO.texto,
  intervaloMinS: LIMITES_AVISO.intervaloMinS,
  intervaloMaxS: LIMITES_AVISO.intervaloMaxS,
  quantidade: LIMITES_AVISO.quantidade,
};

function Metrica({
  icone: Icone,
  rotulo,
  valor,
  detalhe,
}: {
  icone: React.ComponentType<{ className?: string }>;
  rotulo: string;
  valor: string;
  detalhe: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="flex items-center gap-2 text-xs text-fg-subtle">
        <Icone className="size-3.5 shrink-0" aria-hidden />
        {rotulo}
      </p>
      <p className="num mt-1 text-xl font-semibold">{valor}</p>
      <p className="mt-0.5 text-xs text-fg-muted">{detalhe}</p>
    </div>
  );
}

export default async function AutomacoesPage() {
  const usuario = await exigirUsuario("/automacoes");

  // `sessaoAtiva` e não `salaLive`: a sala monta oito consultas para a tela de
  // live inteira, e aqui só interessa saber se há transmissão aberta.
  // Semeia antes de ler: conta nova abre a tela já com texto pronto, do mesmo
  // jeito que o manual. Configuração vazia é indistinguível de recurso
  // quebrado para quem está vendo pela primeira vez.
  await garantirAutomacoesBasicas(usuario.id);

  const [avisos, config, sessao] = await Promise.all([
    listarAvisos(usuario.id),
    configAutomacoes(usuario.id),
    sessaoAtiva(usuario.id),
  ]);
  // Sem live aberta não há o que contar, e `contagemDaLive` já devolve vazio
  // com sessão nula — mas aí seria uma consulta ao banco para nada.
  const contagem = sessao ? await contagemDaLive(usuario.id, sessao.id) : null;

  const relampagos = avisos.filter((a) => a.tipo === "relampago");
  const comentarios = avisos.filter((a) => a.tipo === "aviso");

  return (
    <>
      <PageHeader
        titulo="Automações"
        descricao="O que a Shopia faz sozinha durante a live: refixa o produto, repete os seus avisos no chat e reage a carrinho e venda. Mudança feita no meio da transmissão vale a partir do próximo contato da extensão."
        acoes={
          sessao ? (
            <Indicador estado="no_ar" texto="Live no ar" className="self-center" />
          ) : (
            <Indicador estado="fora_do_ar" className="self-center" />
          )
        }
      />

      <div className="space-y-4">

        <AvisosProgramados
          tipo="relampago"
          avisos={relampagos}
          totalDeAvisos={avisos.length}
          limites={LIMITES}
          sugestao={SUGESTAO.relampago}
          explicarTeto
        />

        <AvisosProgramados
          tipo="aviso"
          avisos={comentarios}
          totalDeAvisos={avisos.length}
          limites={LIMITES}
          sugestao={SUGESTAO.aviso}
        />

        <GatilhoDaLoja
          qual="carrinho"
          config={config}
          limiteTexto={LIMITES_GATILHO.texto}
          sugestao={SUGESTAO.carrinho}
        />

        <GatilhoDaLoja
          qual="venda"
          config={config}
          limiteTexto={LIMITES_GATILHO.texto}
          sugestao={SUGESTAO.venda}
        />

        <Card>
          <CardTitulo>Contador da live</CardTitulo>
          <CardDescricao>
            O que a Shopia detectou nesta transmissão. Zera a cada live: é sinal do momento,
            para você decidir se repete a oferta ou troca o produto fixado.
          </CardDescricao>

          {contagem === null ? (
            <EstadoVazio
              className="mt-4"
              icone={Activity}
              titulo="O contador acende durante a transmissão"
              texto="Carrinho, venda, comentário e resposta são contados por sessão de live. Sem live no ar não há o que contar — e o número da live anterior não fica aqui de propósito: ele seria lido como o de agora."
              acao={
                <Link
                  href="/live"
                  className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
                >
                  Ir para Ao vivo
                </Link>
              }
            />
          ) : (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metrica
                  icone={ShoppingCart}
                  rotulo="Carrinhos"
                  valor={numero(contagem.carrinhos)}
                  detalhe="Intenção de compra detectada no chat"
                />
                <Metrica
                  icone={ShoppingBag}
                  rotulo="Vendas detectadas"
                  valor={numero(contagem.vendas)}
                  detalhe="Frases de compra que passaram no chat"
                />
                <Metrica
                  icone={MessageSquareText}
                  rotulo="Comentários"
                  valor={numero(contagem.comentarios)}
                  detalhe="O que a audiência escreveu"
                />
                <Metrica
                  icone={CornerDownRight}
                  rotulo="Respostas no chat"
                  valor={numero(contagem.respostas)}
                  detalhe="O que a Shopia respondeu pelo seu manual"
                />
              </div>

              <div className="mt-4 rounded-lg border border-border bg-bg-subtle p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">Faturamento estimado</h3>
                  <Badge tom="alerta">estimativa</Badge>
                </div>

                {contagem.faturamentoEstimadoCentavos === null ? (
                  <>
                    <p className="mt-1.5 text-sm text-fg-muted">
                      Não há como estimar agora: falta um produto fixado com preço cadastrado.
                      Sem preço, o único número possível seria zero — e zero aqui seria lido
                      como “não vendeu nada”, que é diferente de “não sei quanto”.
                    </p>
                    <Link
                      href="/produtos"
                      className="mt-2 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Cadastrar o preço e fixar o produto
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="num mt-1 text-2xl font-semibold">
                      {brl(contagem.faturamentoEstimadoCentavos / 100)}
                    </p>
                    <p className="mt-1.5 text-sm text-fg-muted">
                      É uma conta de guardanapo:{" "}
                      <span className="num">{numero(contagem.vendas)}</span>{" "}
                      {contagem.vendas === 1 ? "venda detectada" : "vendas detectadas"} × o preço
                      do produto fixado. <strong className="text-fg">Não é faturamento
                      medido</strong>: a mensagem do chat anuncia que alguém comprou, não quanto
                      pagou nem quantas unidades levou. Cupom, frete, taxa do TikTok e quem leva
                      duas unidades fazem o número real divergir.
                    </p>
                  </>
                )}
              </div>

              <Alerta tom="info" className="mt-4">
                Este contador é da live, não é medição. Venda detectada pelo chat não alimenta o
                dashboard nem o ranking — lá só entra venda com origem verificável. Os dois
                números vão divergir, e quando divergirem o que vale é o do dashboard.
              </Alerta>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
