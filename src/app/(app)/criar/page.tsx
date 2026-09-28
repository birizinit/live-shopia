import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { exigirUsuario } from "@/lib/sessao";
import { EtapaAudio, EtapaProduto, EtapaRoteiro } from "./etapas";

export const metadata: Metadata = { title: "Criar live" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(valor: string | string[] | undefined): string | null {
  return typeof valor === "string" && UUID.test(valor) ? valor : null;
}

/**
 * O caminho curto: do nome do produto ao áudio tocando na extensão.
 *
 * A URL guarda onde a pessoa está (?roteiro=, ?audio=). Recarregar, voltar,
 * ou chegar pelo botão "Criar o áudio agora" da extensão cai no passo certo.
 */
export default async function CriarPage(props: PageProps<"/criar">) {
  const usuario = await exigirUsuario("/criar");
  const busca = await props.searchParams;

  const audioId = id(busca.audio);
  const roteiroId = id(busca.roteiro);
  const produtoId = id(busca.produto);

  return (
    <>
      <PageHeader
        titulo="Criar a live"
        descricao="Três passos: o que vender, o roteiro com a voz, e o áudio que a extensão toca em laço."
      />

      {audioId ? (
        <EtapaAudio perfilId={usuario.id} audioId={audioId} />
      ) : roteiroId ? (
        <EtapaRoteiro perfilId={usuario.id} roteiroId={roteiroId} saldo={usuario.creditos}
          aviso={busca.aviso === "andamento" || busca.aviso === "falhou" ? busca.aviso : null}
        />
      ) : (
        <EtapaProduto perfilId={usuario.id} produtoId={produtoId} />
      )}
    </>
  );
}
