"use client";

import { useActionState, useState } from "react";
import { GitCompare, ListTree, RotateCcw } from "lucide-react";
import { restaurar, type EstadoRoteiro } from "./actions";
import { SECOES, SeloOrigem, dataHora, useRespostaDaAcao } from "./editor";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Selecao } from "@/components/ui/selecao";
import { Cabecalho, Celula, Linha, Tabela } from "@/components/ui/tabela";
import { duracaoEstimadaMs, formatarDuracao } from "@/lib/caracteres";
import { ROTULO_SECAO } from "@/lib/dados/tipos";
import type { SecaoRoteiro } from "@/lib/dados/tipos";
import type { VersaoRoteiro } from "@/lib/dados/roteiros";
import { cn, numero } from "@/lib/utils";

/**
 * Histórico de versões: listar, comparar e restaurar.
 *
 * Restaurar aqui NUNCA sobrescreve: a ação copia o conteúdo antigo para uma
 * versão nova (dados/roteiros.ts). É o que permite desfazer o desfazer.
 */

const INICIAL: EstadoRoteiro = {};

// -----------------------------------------------------------------------------
// Comparação palavra a palavra
// -----------------------------------------------------------------------------

type Pedaco = { tipo: "igual" | "removido" | "adicionado"; texto: string };

/**
 * Separa mantendo os espaços como peças próprias (o `(\s+)` captura), para que
 * a remontagem devolva o texto exatamente como estava — comparação que come
 * espaço faz duas versões idênticas parecerem diferentes.
 */
function palavras(texto: string): string[] {
  return texto.split(/(\s+)/).filter((pedaco) => pedaco.length > 0);
}

/** Teto da matriz de LCS. Acima disto a comparação vira bloco inteiro. */
const TETO_LCS = 250_000;

/**
 * Diferença por maior subsequência comum.
 *
 * Comparar linha inteira acusaria "mudou tudo" quando só uma palavra saiu, que
 * é o caso normal entre duas versões de um roteiro. A matriz é O(n·m); seções
 * têm dezenas de palavras, e o teto acima cobre o texto colado de fora.
 */
function diferenca(antes: string, depois: string): Pedaco[] {
  const a = palavras(antes);
  const b = palavras(depois);
  const n = a.length;
  const m = b.length;

  const saida: Pedaco[] = [];
  const empurrar = (tipo: Pedaco["tipo"], texto: string) => {
    const ultimo = saida[saida.length - 1];
    if (ultimo && ultimo.tipo === tipo) ultimo.texto += texto;
    else saida.push({ tipo, texto });
  };

  if (n * m > TETO_LCS) {
    if (antes) empurrar("removido", antes);
    if (depois) empurrar("adicionado", depois);
    return saida;
  }

  const tabela: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      tabela[i]![j] =
        a[i] === b[j]
          ? tabela[i + 1]![j + 1]! + 1
          : Math.max(tabela[i + 1]![j]!, tabela[i]![j + 1]!);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      empurrar("igual", a[i]!);
      i++;
      j++;
    } else if (tabela[i + 1]![j]! >= tabela[i]![j + 1]!) {
      empurrar("removido", a[i]!);
      i++;
    } else {
      empurrar("adicionado", b[j]!);
      j++;
    }
  }
  while (i < n) empurrar("removido", a[i++]!);
  while (j < m) empurrar("adicionado", b[j++]!);

  return saida;
}

function textoDaSecao(versao: VersaoRoteiro, secao: SecaoRoteiro): string {
  return versao.secoes.find((bloco) => bloco.secao === secao)?.texto ?? "";
}

function Diferenca({ antes, depois }: { antes: string; depois: string }) {
  const pedacos = diferenca(antes, depois);

  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg">
      {pedacos.map((pedaco, indice) => (
        <span
          key={indice}
          className={cn(
            pedaco.tipo === "removido" && "bg-danger-soft text-danger line-through",
            pedaco.tipo === "adicionado" && "bg-success-soft text-success",
          )}
        >
          {pedaco.texto}
        </span>
      ))}
    </p>
  );
}

function Comparacao({ de, para }: { de: VersaoRoteiro; para: VersaoRoteiro }) {
  const delta = para.caracteres - de.caracteres;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-fg-muted">
        <span className="num font-medium text-fg">{numero(de.caracteres)}</span> →{" "}
        <span className="num font-medium text-fg">{numero(para.caracteres)}</span>{" "}
        caracteres{" "}
        <span className={cn("num", delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "")}>
          ({delta > 0 ? "+" : ""}
          {numero(delta)})
        </span>
        {" · "}
        <span className="text-danger">riscado</span> saiu,{" "}
        <span className="text-success">realçado</span> entrou.
      </p>

      {SECOES.map((secao) => {
        const antes = textoDaSecao(de, secao);
        const depois = textoDaSecao(para, secao);
        if (!antes && !depois) return null;

        return (
          <div key={secao} className="rounded-md border border-border p-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h4 className="text-sm font-semibold text-fg">{ROTULO_SECAO[secao]}</h4>
              {antes === depois ? (
                <Badge>Sem mudança</Badge>
              ) : (
                <Badge tom="info">Alterada</Badge>
              )}
            </div>

            {antes === depois ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg-muted">
                {depois}
              </p>
            ) : (
              <Diferenca antes={antes} depois={depois} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Histórico
// -----------------------------------------------------------------------------

const COLUNAS = [
  { rotulo: "Versão", numerica: true },
  { rotulo: "Origem" },
  { rotulo: "Caracteres", numerica: true },
  { rotulo: "Fala", numerica: true },
  { rotulo: "Criada em", numerica: true },
  { rotulo: <span className="sr-only">Ações</span> },
];

export function Versoes({
  roteiroId,
  versaoAtual,
  versoes,
}: {
  roteiroId: string;
  versaoAtual: number;
  versoes: VersaoRoteiro[];
}) {
  const [estado, acao, enviando] = useActionState(restaurar, INICIAL);
  const [alvo, setAlvo] = useState<VersaoRoteiro | null>(null);
  const [resposta, setResposta] = useState(estado);
  const [comparando, setComparando] = useState(versoes.length > 1);

  const [de, setDe] = useState(() => versoes[1]?.numero ?? versoes[0]?.numero ?? 0);
  const [para, setPara] = useState(() => versoes[0]?.numero ?? 0);

  useRespostaDaAcao(estado);

  // Restaurou: a caixa sai da frente para a linha nova do histórico aparecer.
  // No corpo do render, e não num efeito — setState em efeito é render em
  // cascata, e o kit já resolve assim em ConfirmarAcao.
  if (resposta !== estado) {
    setResposta(estado);
    if (estado.mensagem) setAlvo(null);
  }

  if (versoes.length === 0) {
    return (
      <Card>
        <CardTitulo>Histórico de versões</CardTitulo>
        <EstadoVazio
          className="mt-4"
          icone={ListTree}
          titulo="Nenhuma versão ainda"
          texto="A primeira versão nasce quando a IA termina de escrever ou quando você salva o editor."
        />
      </Card>
    );
  }

  const versaoDe = versoes.find((versao) => versao.numero === de);
  const versaoPara = versoes.find((versao) => versao.numero === para);
  const opcoes = versoes.map((versao) => ({
    valor: String(versao.numero),
    rotulo: `v${versao.numero} · ${dataHora(versao.criadoEm)}`,
  }));

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitulo>Histórico de versões</CardTitulo>
          <CardDescricao>
            Nada aqui é sobrescrito. Restaurar copia o texto antigo para uma
            versão nova, e a de agora continua guardada.
          </CardDescricao>
        </div>
        <Badge tom="neutro">
          <span className="num">{versoes.length}</span>
          {versoes.length === 1 ? " versão" : " versões"}
        </Badge>
      </div>

      {estado.erro && (
        <Alerta tom="erro" className="mt-4">
          {estado.erro}
        </Alerta>
      )}

      <Tabela
        className="mt-4"
        rotulo="Versões do roteiro"
        cabecalho={<Cabecalho colunas={COLUNAS} />}
      >
        {versoes.map((versao) => {
          const atual = versao.numero === versaoAtual;

          return (
            <Linha key={versao.id} destacada={atual}>
              <Celula numerica linha>
                v{versao.numero}
              </Celula>
              <Celula>
                <span className="flex flex-wrap items-center gap-1.5">
                  <SeloOrigem origem={versao.origem} restauradaDe={versao.restauradaDe} />
                  {atual && <Badge tom="sucesso">Atual</Badge>}
                </span>
              </Celula>
              <Celula numerica>{numero(versao.caracteres)}</Celula>
              <Celula numerica>
                {formatarDuracao(duracaoEstimadaMs(versao.caracteres))}
              </Celula>
              <Celula numerica className="text-fg-muted">
                {dataHora(versao.criadoEm)}
              </Celula>
              <Celula className="text-right">
                <Button
                  tamanho="sm"
                  variante="ghost"
                  disabled={atual || enviando}
                  onClick={() => setAlvo(versao)}
                >
                  <RotateCcw className="size-4" aria-hidden />
                  {atual ? "É a atual" : "Restaurar"}
                </Button>
              </Celula>
            </Linha>
          );
        })}
      </Tabela>

      {versoes.length > 1 && (
        <div className="mt-6 border-t border-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <GitCompare className="size-4 text-fg-subtle" aria-hidden />
              Comparar versões
            </h3>
            <Button
              tamanho="sm"
              variante="ghost"
              onClick={() => setComparando((aberto) => !aberto)}
              aria-expanded={comparando}
            >
              {comparando ? "Esconder" : "Mostrar"}
            </Button>
          </div>

          {comparando && (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="comparar-de">Da versão</Label>
                  <Selecao
                    id="comparar-de"
                    value={String(de)}
                    onChange={(evento) => setDe(Number(evento.target.value))}
                    opcoes={opcoes}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="comparar-para">Para a versão</Label>
                  <Selecao
                    id="comparar-para"
                    value={String(para)}
                    onChange={(evento) => setPara(Number(evento.target.value))}
                    opcoes={opcoes}
                  />
                </div>
              </div>

              {versaoDe && versaoPara ? (
                versaoDe.numero === versaoPara.numero ? (
                  <Alerta tom="info" className="mt-4">
                    Escolha duas versões diferentes para ver o que mudou.
                  </Alerta>
                ) : (
                  <Comparacao de={versaoDe} para={versaoPara} />
                )
              ) : null}
            </>
          )}
        </div>
      )}

      <Modal
        aberto={alvo !== null}
        aoFechar={() => setAlvo(null)}
        titulo={alvo ? `Restaurar a versão ${alvo.numero}?` : "Restaurar versão"}
        tamanho="sm"
        travado={enviando}
        rodape={
          <>
            <Button variante="secondary" onClick={() => setAlvo(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button
              disabled={enviando}
              onClick={() => {
                if (!alvo) return;
                const dados = new FormData();
                dados.set("roteiroId", roteiroId);
                dados.set("numero", String(alvo.numero));
                acao(dados);
              }}
            >
              <RotateCcw className="size-4" aria-hidden />
              {enviando ? "Restaurando…" : "Restaurar"}
            </Button>
          </>
        }
      >
        <p>
          O texto da versão {alvo?.numero} entra como a versão{" "}
          <span className="num">{versaoAtual + 1}</span>. Nada é apagado: a versão{" "}
          <span className="num">{versaoAtual}</span>, que está no ar agora,
          continua no histórico e pode ser restaurada depois do mesmo jeito.
        </p>
      </Modal>
    </Card>
  );
}
