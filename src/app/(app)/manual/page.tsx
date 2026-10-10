import type { Metadata } from "next";
import { CircleHelp } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { Alerta } from "@/components/ui/alerta";
import { exigirUsuario } from "@/lib/sessao";
import {
  LIMITES_MANUAL,
  garantirManualBasico,
  listarManual,
  perguntasSemResposta,
} from "@/lib/dados/manual";
import { listarProdutos } from "@/lib/dados/produtos";
import { numero } from "@/lib/utils";
import { EditorDoManual } from "./editor";

export const metadata: Metadata = { title: "Manual do produto" };

/**
 * O manual: o que a Shopia sabe responder.
 *
 * É a tela mais importante do produto. Tudo o que a Shopia escreve no chat sai
 * daqui, palavra por palavra — ela não gera resposta, ela escolhe uma que você
 * escreveu. É o que sustenta a promessa de "nunca inventa": não existe caminho
 * pelo qual uma frase que você não aprovou chegue à sua audiência.
 */
export default async function ManualPage() {
  const usuario = await exigirUsuario("/manual");

  const criados = await garantirManualBasico(usuario.id);
  const [itens, produtos, semResposta] = await Promise.all([
    listarManual(usuario.id),
    listarProdutos(usuario.id, { limite: 50 }),
    perguntasSemResposta(usuario.id),
  ]);

  return (
    <>
      <PageHeader
        titulo="Manual do produto"
        descricao="O que a Shopia responde no chat — com “Ler a tela” ligado no ✦ IA da extensão. Ela nunca inventa: se a pergunta não estiver aqui, ela cala e te avisa."
      />

      {criados > 0 && (
        <Alerta tom="sucesso" className="mb-4">
          Começamos o seu manual com <span className="num">{numero(criados)}</span> perguntas que
          aparecem em toda live — preço, frete, cupom, tamanho, estoque e como comprar. Leia cada
          resposta e ajuste para o seu produto: elas estão genéricas de propósito.
        </Alerta>
      )}

      <Card>
        <EditorDoManual
          itens={itens}
          produtos={produtos.itens.map((p) => ({ id: p.id, nome: p.nome }))}
          limites={{ rotulo: LIMITES_MANUAL.rotulo, resposta: LIMITES_MANUAL.resposta }}
        />
      </Card>

      <section className="mt-6">
        <Card>
          <CardTitulo>O que perguntaram e você ainda não respondeu</CardTitulo>
          <CardDescricao>
            Comentários das suas lives que não casaram com nenhuma linha do manual. Cada um destes
            é alguém que ficou sem resposta — e uma pergunta que vale cadastrar antes da próxima.
          </CardDescricao>

          {semResposta.length === 0 ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-fg-muted">
              <CircleHelp className="size-4 shrink-0" aria-hidden />
              Nada aqui ainda. Depois da sua primeira live, esta lista mostra o que faltou.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
              {semResposta.map((p) => (
                <li key={p.texto} className="flex items-center gap-3 p-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-fg">{p.texto}</span>
                  <span className="num shrink-0 text-xs text-fg-subtle">
                    {numero(p.vezes)}× {p.vezes === 1 ? "vez" : "vezes"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}
