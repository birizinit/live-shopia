import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { chaveIdempotente } from "@/lib/dados/creditos";
import {
  estadoDaGeracao,
  estimativaDeFala,
  listarVersoes,
  obterRoteiro,
} from "@/lib/dados/roteiros";
import { formatarDuracao } from "@/lib/caracteres";
import { servicos } from "@/lib/env";
import { exigirUsuario } from "@/lib/sessao";
import { numero } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { Propriedades } from "@/components/ui/propriedades";
import {
  AtalhoEstudio,
  BotaoArquivar,
  EditorRoteiro,
  PainelGeracao,
  SeloOrigem,
} from "../editor";
import { Versoes } from "../versoes";

export const metadata: Metadata = { title: "Roteiro" };

export default async function RoteiroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const usuario = await exigirUsuario(`/roteiro/${id}`);

  // O dono é conferido dentro da consulta: id da URL nunca vira confiança.
  const roteiro = await obterRoteiro(usuario.id, id);
  if (!roteiro) notFound();

  const [versoes, geracao] = await Promise.all([
    listarVersoes(usuario.id, id),
    estadoDaGeracao(usuario.id, id),
  ]);

  // O saldo já veio na sessão, lido do banco nesta mesma requisição.
  const estimativa = estimativaDeFala(roteiro.versao?.texto ?? "", usuario.creditos);
  const referencia = chaveIdempotente("roteiro");
  const semTexto = !roteiro.versao;

  return (
    <>
      <Link
        href="/roteiro"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Todos os roteiros
      </Link>

      <PageHeader
        titulo={roteiro.titulo}
        descricao={
          roteiro.produtoNome
            ? `Roteiro de ${roteiro.produtoNome}.`
            : "Sem produto vinculado — a IA escreve com o que estiver no pedido."
        }
        acoes={
          <>
            <AtalhoEstudio roteiroId={roteiro.id} desabilitado={semTexto} />
            <BotaoArquivar
              roteiroId={roteiro.id}
              titulo={roteiro.titulo}
              versoes={versoes.length}
            />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          {semTexto && (
            <Alerta tom="info">
              Este roteiro ainda não tem texto. Peça para a IA escrever no painel
              ao lado, ou escreva você mesmo aqui embaixo — a versão 1 nasce do
              que for salvo.
            </Alerta>
          )}

          <EditorRoteiro
            roteiroId={roteiro.id}
            titulo={roteiro.titulo}
            versaoAtual={roteiro.versaoAtual}
            secoes={roteiro.versao?.secoes ?? []}
          />
        </div>

        <div className="space-y-4">
          <PainelGeracao
            roteiroId={roteiro.id}
            referencia={referencia}
            versaoAtual={roteiro.versaoAtual}
            estadoInicial={geracao}
            temIa={servicos.roteiroIa}
          />

          <Card>
            <CardTitulo>Quando virar áudio</CardTitulo>
            <CardDescricao>
              Escrever o texto não gastou crédito. O crédito é de voz e sai uma
              vez só, no estúdio — repetir o áudio na live depois é de graça.
            </CardDescricao>

            <Propriedades
              className="mt-3"
              itens={[
                {
                  rotulo: "Caracteres",
                  valor: numero(estimativa.caracteres),
                  numerica: true,
                },
                { rotulo: "Blocos de voz", valor: numero(estimativa.blocos), numerica: true },
                {
                  rotulo: "Fala estimada",
                  valor: formatarDuracao(estimativa.duracaoMs),
                  numerica: true,
                },
                {
                  rotulo: "Seu saldo",
                  valor: numero(estimativa.creditosDisponiveis),
                  numerica: true,
                },
              ]}
            />

            {estimativa.caracteres > 0 && !estimativa.suficiente && (
              <Alerta tom="info" className="mt-3">
                Faltam <span className="num">{numero(estimativa.faltam)}</span>{" "}
                caracteres de crédito para gerar este áudio inteiro.{" "}
                <Link
                  href="/creditos"
                  className="font-medium underline underline-offset-4"
                >
                  Comprar créditos
                </Link>
                .
              </Alerta>
            )}
          </Card>

          <Card>
            <CardTitulo>Versão em uso</CardTitulo>
            <Propriedades
              className="mt-3"
              itens={[
                {
                  rotulo: "Versão",
                  valor: roteiro.versaoAtual > 0 ? `v${roteiro.versaoAtual}` : "—",
                  numerica: true,
                },
                {
                  rotulo: "Origem",
                  valor: (
                    <SeloOrigem
                      origem={roteiro.versao?.origem ?? null}
                      restauradaDe={roteiro.versao?.restauradaDe}
                    />
                  ),
                },
                {
                  rotulo: "Produto",
                  valor: roteiro.produtoNome ?? "Sem produto",
                },
                ...(roteiro.versao?.origem === "ia" && roteiro.versao.modelo
                  ? [{ rotulo: "Modelo", valor: roteiro.versao.modelo }]
                  : []),
              ]}
            />
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <Versoes
          roteiroId={roteiro.id}
          versaoAtual={roteiro.versaoAtual}
          versoes={versoes}
        />
      </div>
    </>
  );
}
