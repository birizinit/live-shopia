"use client";

import { useActionState, useState } from "react";
import { MessageCircleQuestion, Pencil, Plus, Trash2 } from "lucide-react";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/input";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Modal } from "@/components/ui/modal";
import { Selecao } from "@/components/ui/selecao";
import { alternarItem, removerItem, salvarItem, type EstadoManual } from "./actions";
import type { ItemManual } from "@/lib/dados/manual";
import { numero } from "@/lib/utils";

const INICIAL: EstadoManual = {};

export function EditorDoManual({
  itens,
  produtos,
  limites,
}: {
  itens: ItemManual[];
  produtos: { id: string; nome: string }[];
  /**
   * Vêm por prop, e não por import: `manual.ts` é `server-only`, e Client
   * Component que importa de lá arrasta o módulo inteiro para o navegador — o
   * build recusa, com razão. Mesmo caminho que o formulário de produto usa.
   */
  limites: { rotulo: number; resposta: number };
}) {
  const [emEdicao, setEmEdicao] = useState<ItemManual | null>(null);
  const [criando, setCriando] = useState(false);
  const [estado, acaoSalvar, salvando] = useActionState(salvarItem, INICIAL);

  const aberto = criando || emEdicao !== null;
  const fechar = () => {
    setCriando(false);
    setEmEdicao(null);
  };

  return (
    <div className="space-y-4">
      {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {itens.length === 0
            ? "Nenhuma pergunta ainda."
            : `${numero(itens.length)} pergunta(s) que a Shopia sabe responder.`}
        </p>
        <Button onClick={() => setCriando(true)}>
          <Plus className="size-4" aria-hidden />
          Nova pergunta
        </Button>
      </div>

      {itens.length === 0 ? (
        <EstadoVazio
          icone={MessageCircleQuestion}
          titulo="O manual está vazio"
          texto="Sem manual, a Shopia cala em toda pergunta — ela nunca inventa resposta. Cadastre a primeira."
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {itens.map((item) => (
            <li key={item.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.rotulo}</span>
                {!item.ativo && <Badge tom="alerta">desligada</Badge>}
                {item.produtoNome && <Badge tom="marca">só com {item.produtoNome}</Badge>}
                {item.vezesUsado > 0 && (
                  <span className="text-xs text-fg-subtle">
                    respondeu <span className="num">{numero(item.vezesUsado)}</span>×
                  </span>
                )}

                <span className="ml-auto flex items-center gap-1">
                  <Button variante="ghost" tamanho="sm" onClick={() => setEmEdicao(item)}>
                    <Pencil className="size-3.5" aria-hidden />
                    <span className="sr-only">Editar {item.rotulo}</span>
                  </Button>
                  <form action={alternarItem}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="ativo" value={item.ativo ? "0" : "1"} />
                    <Button type="submit" variante="ghost" tamanho="sm">
                      {item.ativo ? "Desligar" : "Ligar"}
                    </Button>
                  </form>
                  <form action={removerItem}>
                    <input type="hidden" name="id" value={item.id} />
                    <Button type="submit" variante="ghost" tamanho="sm">
                      <Trash2 className="size-3.5" aria-hidden />
                      <span className="sr-only">Remover {item.rotulo}</span>
                    </Button>
                  </form>
                </span>
              </div>

              <p className="mt-1 text-sm text-fg-muted">{item.resposta}</p>

              <p className="mt-1.5 flex flex-wrap gap-1">
                {item.gatilhos.map((g) => (
                  <code
                    key={g}
                    className="rounded-sm bg-bg-subtle px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-fg-subtle"
                  >
                    {g}
                  </code>
                ))}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Modal
        aberto={aberto}
        aoFechar={fechar}
        titulo={emEdicao ? emEdicao.rotulo : "Nova pergunta"}
      >
        <form action={acaoSalvar} className="space-y-4">
          {emEdicao && <input type="hidden" name="id" value={emEdicao.id} />}

          <Campo rotulo="Qual é a pergunta" htmlFor="m-rotulo" dica="só para você achar na lista">
            <Input
              id="m-rotulo"
              name="rotulo"
              defaultValue={emEdicao?.rotulo ?? ""}
              maxLength={limites.rotulo}
              placeholder="ex.: Serve em quem calça 40?"
              required
            />
          </Campo>

          <Campo
            rotulo="Palavras que a audiência usa"
            htmlFor="m-gatilhos"
            dica="separe por vírgula; a Shopia responde quando o comentário tiver qualquer uma"
          >
            <Input
              id="m-gatilhos"
              name="gatilhos"
              defaultValue={emEdicao?.gatilhos.join(", ") ?? ""}
              placeholder="ex.: 40, numero 40, calço 40, tamanho"
              required
            />
          </Campo>

          <Campo
            rotulo="O que responder no chat"
            htmlFor="m-resposta"
            dica={`até ${limites.resposta} caracteres — é isto, palavra por palavra, que vai aparecer`}
          >
            <textarea
              id="m-resposta"
              name="resposta"
              defaultValue={emEdicao?.resposta ?? ""}
              maxLength={limites.resposta}
              rows={3}
              required
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle hover:border-border-strong"
              placeholder="Serve sim! Esse modelo veste normal, pode pedir o seu número de sempre."
            />
          </Campo>

          <Campo
            rotulo="Vale só para um produto?"
            htmlFor="m-produto"
            dica="deixe em branco para responder em qualquer live"
          >
            <Selecao
              id="m-produto"
              name="produtoId"
              defaultValue={emEdicao?.produtoId ?? ""}
              placeholder="Qualquer produto"
              opcoes={produtos.map((p) => ({ valor: p.id, rotulo: p.nome }))}
            />
          </Campo>

          <div className="flex gap-2">
            <Button type="submit" disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar no manual"}
            </Button>
            <Button type="button" variante="ghost" onClick={fechar}>
              Cancelar
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
