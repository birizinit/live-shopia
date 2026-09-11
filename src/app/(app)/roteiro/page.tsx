import type { Metadata } from "next";
import { chaveIdempotente } from "@/lib/dados/creditos";
import { listarRoteiros, produtosParaRoteiro } from "@/lib/dados/roteiros";
import { servicos } from "@/lib/env";
import { exigirUsuario } from "@/lib/sessao";
import { PageHeader } from "@/components/layout/page-header";
import { FormGerarRoteiro, ListaRoteiros } from "./editor";

export const metadata: Metadata = { title: "Roteiros" };

export default async function RoteirosPage() {
  const usuario = await exigirUsuario("/roteiro");

  const [pagina, produtos] = await Promise.all([
    listarRoteiros(usuario.id),
    produtosParaRoteiro(usuario.id),
  ]);

  /**
   * A chave de idempotência nasce AQUI, no render, e desce para o formulário
   * num campo oculto (ver chaveIdempotente em dados/creditos.ts). Gerada dentro
   * da ação, cada clique teria uma chave nova e o duplo clique criaria dois
   * roteiros e dois jobs para o mesmo pedido.
   */
  const referencia = chaveIdempotente("roteiro");

  return (
    <>
      <PageHeader
        titulo="Roteiros"
        descricao="O texto que a apresentadora vai falar em loop: gancho, oferta, prova, objeções e chamada para ação."
      />

      <div className="space-y-6">
        <FormGerarRoteiro
          produtos={produtos}
          referencia={referencia}
          temIa={servicos.roteiroIa}
        />

        <section>
          <h2 className="mb-3 text-lg font-semibold">Seus roteiros</h2>
          <ListaRoteiros inicial={pagina} />
        </section>
      </div>
    </>
  );
}
