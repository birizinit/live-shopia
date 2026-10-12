import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { EditorDeFluxos } from "./editor";
import { LIMITES_FLUXO, listarFluxos } from "@/lib/dados/fluxos";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Fluxos de resposta" };

/**
 * Fluxos: "quando comentarem X, responda Y depois de N segundos".
 *
 * A pessoa monta aqui; a extensão executa na aba da live (Início → Fluxos de
 * resposta). `?gatilho=` chega da lista de perguntas sem resposta do manual e
 * abre o formulário já com a frase preenchida.
 */
export default async function PaginaFluxos({
  searchParams,
}: {
  searchParams: Promise<{ gatilho?: string | string[] }>;
}) {
  const usuario = await exigirUsuario("/fluxos");
  const pedido = (await searchParams).gatilho;
  const gatilho = typeof pedido === "string" ? pedido.trim().slice(0, LIMITES_FLUXO.gatilho) : "";
  const fluxos = await listarFluxos(usuario.id);

  return (
    <>
      <PageHeader
        titulo="Fluxos de resposta"
        descricao="Quando alguém comentar uma palavra ou frase, a Shopia responde o que você escreveu, no tempo que você escolher, marcando a pessoa ou não."
      />
      <div className="space-y-4">
        <Alerta tom="info">
          Os fluxos rodam <strong>na extensão</strong>: ligue a extensão e o card{" "}
          <strong>Fluxos de resposta</strong> na aba Início. Não precisa de “Ler a tela” nem gasta
          crédito. Quando um fluxo responde um comentário, o manual não responde o mesmo — ninguém
          recebe duas respostas.
        </Alerta>
        <EditorDeFluxos
          fluxos={fluxos}
          gatilhoInicial={gatilho}
          limites={{
            quantidade: LIMITES_FLUXO.quantidade,
            nome: LIMITES_FLUXO.nome,
            resposta: LIMITES_FLUXO.resposta,
            respostaMarcando: LIMITES_FLUXO.respostaMarcando,
            atrasoMaxS: LIMITES_FLUXO.atrasoMaxS,
            intervaloMaxS: LIMITES_FLUXO.intervaloMaxS,
          }}
        />
      </div>
    </>
  );
}
