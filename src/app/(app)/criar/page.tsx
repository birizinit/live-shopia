import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { exigirUsuario } from "@/lib/sessao";
import { EtapaLive, EtapaManual, EtapaProduto } from "./etapas";

export const metadata: Metadata = { title: "Criar live" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(valor: string | string[] | undefined): string | null {
  return typeof valor === "string" && UUID.test(valor) ? valor : null;
}

/**
 * O caminho curto: do nome do produto até a Shopia respondendo na live.
 *
 * A URL guarda onde a pessoa está (?produto=, &passo=live). Recarregar, voltar,
 * ou chegar por link da extensão cai no passo certo.
 */
export default async function CriarPage(props: PageProps<"/criar">) {
  const usuario = await exigirUsuario("/criar");
  const busca = await props.searchParams;

  const produtoId = id(busca.produto);
  const naLive = busca.passo === "live";

  return (
    <>
      <PageHeader
        titulo="Preparar a live"
        descricao="Três passos: o que vender, o que a Shopia responde sobre isso, e ligar na sua transmissão."
      />

      {produtoId && naLive ? (
        <EtapaLive perfilId={usuario.id} />
      ) : produtoId ? (
        <EtapaManual perfilId={usuario.id} produtoId={produtoId} />
      ) : (
        <EtapaProduto perfilId={usuario.id} produtoId={null} />
      )}
    </>
  );
}
