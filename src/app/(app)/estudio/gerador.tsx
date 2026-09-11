"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import { AudioLines, FileText, Wand2 } from "lucide-react";
import { gerarAudio, type EstadoEstudio } from "./actions";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Campo, Input } from "@/components/ui/input";
import { Propriedade, Propriedades } from "@/components/ui/propriedades";
import { AreaTexto, Selecao } from "@/components/ui/selecao";
import {
  CHARS_POR_BLOCO,
  contarCaracteres,
  duracaoEstimadaMs,
  formatarDuracao,
} from "@/lib/caracteres";
import type { RoteiroParaFala, VozOpcao } from "@/lib/dados/audios";
import { numero } from "@/lib/utils";

/**
 * O formulário que gasta crédito.
 *
 * Fluxo em dois passos de propósito: escrever → ver o custo → confirmar. O
 * primeiro envio só pede a estimativa ao servidor (`estimar`, que lê o saldo
 * de verdade); o segundo é o que cobra.
 *
 * `chave` chega pronta do Server Component e fica num campo oculto. Ela é a
 * mesma nas duas passagens e no duplo clique — é isso que impede a segunda
 * cobrança pelo mesmo texto.
 */

const INICIAL: EstadoEstudio = {};

export type GeradorProps = {
  chave: string;
  vozes: VozOpcao[];
  roteiros: RoteiroParaFala[];
  saldo: number;
  /** false quando não há serviço de voz ou a sessão é demo. */
  podeGerar: boolean;
  motivo: string | null;
  tetoCaracteres: number;
};

export function Gerador({
  chave,
  vozes,
  roteiros,
  saldo,
  podeGerar,
  motivo,
  tetoCaracteres,
}: GeradorProps) {
  const [estado, acao, enviando] = useActionState(gerarAudio, INICIAL);

  const [titulo, setTitulo] = useState("");
  const [vozId, setVozId] = useState(vozes[0]?.id ?? "");
  const [texto, setTexto] = useState("");
  const [origem, setOrigem] = useState<{ id: string; texto: string } | null>(null);
  const [escolhaRoteiro, setEscolhaRoteiro] = useState("");
  const [dispensado, setDispensado] = useState(false);
  const [respostaVista, setRespostaVista] = useState(estado);
  const areaTexto = useRef<HTMLTextAreaElement>(null);

  // Resposta nova do servidor reabre a confirmação que o "Alterar texto" fechou.
  // Ajuste durante o render, e não num efeito: por efeito a confirmação nova
  // apareceria fechada por um quadro, piscando na cara de quem clicou.
  if (respostaVista !== estado) {
    setRespostaVista(estado);
    if (dispensado) setDispensado(false);
  }

  const limpo = texto.trim();

  // Contagem só pela função canônica: `.length` contaria unidades UTF-16 e o
  // "🔥" de um roteiro de vendas já faria a tela mentir sobre o custo.
  const caracteres = useMemo(() => contarCaracteres(limpo), [limpo]);
  const blocos = Math.max(1, Math.ceil(caracteres / CHARS_POR_BLOCO));
  const duracaoMs = duracaoEstimadaMs(caracteres);
  const cobre = caracteres > 0 && saldo >= caracteres;

  // O roteiro só continua sendo a origem enquanto o texto for o dele.
  const roteiroId = origem && origem.texto === texto ? origem.id : "";

  const estimativa = estado.estimativa;
  const confirmando =
    estado.etapa === "confirmar" &&
    !dispensado &&
    estado.campos?.texto === limpo &&
    estado.campos?.vozId === vozId;

  if (vozes.length === 0) {
    return (
      <Card>
        <EstadoVazio
          icone={AudioLines}
          titulo="Nenhuma voz disponível"
          texto="O estúdio precisa de uma voz para falar. Escolha uma no catálogo ou clone a sua."
          acao={
            <Link
              href="/vozes"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
            >
              Ver vozes
            </Link>
          }
        />
      </Card>
    );
  }

  function usarRoteiro() {
    const roteiro = roteiros.find((r) => r.id === escolhaRoteiro);
    if (!roteiro) return;
    setTexto(roteiro.texto);
    setOrigem({ id: roteiro.id, texto: roteiro.texto });
    if (!titulo) setTitulo(roteiro.titulo);
    areaTexto.current?.focus();
  }

  return (
    <Card>
      <CardTitulo>Novo áudio</CardTitulo>
      <CardDescricao>
        O texto é fatiado em blocos de até {numero(CHARS_POR_BLOCO)} caracteres — o teto de
        uma chamada de voz. O player toca a lista em ordem, sem emenda audível.
      </CardDescricao>

      <form
        action={acao}
        className="mt-5 space-y-4"
        onKeyDown={(evento) => {
          // Enter confirma formulário por padrão. Aqui o envio confirmado gasta
          // crédito: ele tem que ser um clique deliberado, não um Enter perdido
          // no campo de título.
          if (evento.key === "Enter" && confirmando && evento.target instanceof HTMLInputElement) {
            evento.preventDefault();
          }
        }}
      >
        <input type="hidden" name="chave" value={chave} />
        <input type="hidden" name="roteiroId" value={roteiroId} />

        {estado.erro && (
          <Alerta tom="erro">
            {estado.erro}
            {estado.codigo === "saldo_insuficiente" && (
              <>
                {" "}
                <Link href="/creditos" className="font-medium underline underline-offset-2">
                  Comprar créditos
                </Link>
                .
              </>
            )}
          </Alerta>
        )}

        {!podeGerar && motivo && <Alerta tom="info">{motivo}</Alerta>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Título" htmlFor="titulo" dica="Opcional — vira o começo do texto.">
            <Input
              id="titulo"
              name="titulo"
              value={titulo}
              onChange={(evento) => setTitulo(evento.target.value)}
              placeholder="Kit de panelas — oferta relâmpago"
              maxLength={120}
            />
          </Campo>

          <Campo rotulo="Voz da apresentadora" htmlFor="vozId">
            <Selecao
              id="vozId"
              name="vozId"
              value={vozId}
              onChange={(evento) => setVozId(evento.target.value)}
              placeholder="Escolha a voz"
              required
              opcoes={vozes.map((voz) => ({
                valor: voz.id,
                rotulo: `${voz.nome}${voz.origem === "clonada" ? " (sua voz)" : ""} · ${voz.genero} · ${voz.idioma}`,
              }))}
            />
          </Campo>
        </div>

        {roteiros.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Campo
                rotulo="Começar de um roteiro salvo"
                htmlFor="roteiro"
                dica="O texto entra no campo abaixo e continua editável."
              >
                <Selecao
                  id="roteiro"
                  value={escolhaRoteiro}
                  onChange={(evento) => setEscolhaRoteiro(evento.target.value)}
                  placeholder="Nenhum"
                  opcoes={roteiros.map((roteiro) => ({
                    valor: roteiro.id,
                    rotulo: `${roteiro.titulo} · ${numero(roteiro.caracteres)} caracteres`,
                  }))}
                />
              </Campo>
            </div>
            <Button
              variante="secondary"
              onClick={usarRoteiro}
              disabled={!escolhaRoteiro}
              className="mb-0.5"
            >
              <FileText className="size-4" aria-hidden />
              Usar roteiro
            </Button>
          </div>
        )}

        <Campo rotulo="Texto da fala" htmlFor="texto">
          <AreaTexto
            id="texto"
            name="texto"
            ref={areaTexto}
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            maximo={tetoCaracteres}
            rows={12}
            placeholder="Cole aqui o roteiro que a apresentadora vai falar na live."
            classNameCampo="min-h-56"
            auxiliar={
              caracteres > 0 ? (
                <span className="num">
                  ≈ {formatarDuracao(duracaoMs)} de fala · {numero(blocos)}{" "}
                  {blocos === 1 ? "bloco" : "blocos"}
                </span>
              ) : (
                "1 caractere = 1 crédito."
              )
            }
          />
        </Campo>

        {caracteres > 0 && !confirmando && (
          <div className="rounded-md border border-border bg-bg-subtle px-4 py-1">
            <Propriedades colunas={2}>
              <Propriedade rotulo="Custo estimado" valor={`${numero(caracteres)} créditos`} numerica />
              <Propriedade rotulo="Seu saldo" valor={numero(saldo)} numerica />
            </Propriedades>
            {!cobre && (
              <p className="pb-3 text-xs text-warning">
                O saldo não cobre este texto.{" "}
                <Link href="/creditos" className="font-medium underline underline-offset-2">
                  Comprar créditos
                </Link>
                .
              </p>
            )}
          </div>
        )}

        {confirmando && estimativa && (
          <div className="rounded-lg border border-primary-border bg-bg-subtle p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-fg">Confirmar geração</h3>
              <Badge tom="marca">Antes de cobrar</Badge>
            </div>

            <Propriedades colunas={2} className="mt-2">
              <Propriedade
                rotulo="Caracteres"
                valor={numero(estimativa.caracteres)}
                numerica
              />
              <Propriedade rotulo="Blocos" valor={numero(estimativa.blocos)} numerica />
              <Propriedade
                rotulo="Duração estimada"
                valor={formatarDuracao(estimativa.duracaoMs)}
                numerica
              />
              <Propriedade
                rotulo="Saldo hoje"
                valor={numero(estimativa.creditosDisponiveis)}
                numerica
              />
              <Propriedade
                rotulo="Saldo depois"
                valor={numero(
                  Math.max(0, estimativa.creditosDisponiveis - estimativa.caracteres),
                )}
                numerica
              />
            </Propriedades>

            {!estimativa.suficiente && (
              <Alerta tom="erro" className="mt-3">
                Faltam {numero(estimativa.faltam)} créditos.{" "}
                <Link href="/creditos" className="font-medium underline underline-offset-2">
                  Comprar créditos
                </Link>
                .
              </Alerta>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="submit"
                name="confirmado"
                value="1"
                disabled={enviando || !estimativa.suficiente || !podeGerar}
              >
                <Wand2 className="size-4" aria-hidden />
                {enviando ? "Gerando…" : `Confirmar e gastar ${numero(estimativa.caracteres)}`}
              </Button>
              <Button variante="ghost" onClick={() => setDispensado(true)}>
                Alterar texto
              </Button>
            </div>
          </div>
        )}

        {!confirmando && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={enviando || caracteres === 0 || !podeGerar}>
              <AudioLines className="size-4" aria-hidden />
              {enviando ? "Calculando…" : "Ver o custo"}
            </Button>
            <p className="text-xs text-fg-subtle">
              Nada é cobrado neste passo: o crédito só sai depois que você confirmar.
            </p>
          </div>
        )}
      </form>
    </Card>
  );
}
