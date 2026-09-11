import type { Metadata } from "next";
import { ListaProdutos } from "./lista";
import { PageHeader } from "@/components/layout/page-header";
import {
  LIMITES_PRODUTO,
  contarArquivados,
  listarProdutos,
  produtoFixado,
} from "@/lib/dados/produtos";
import { modoDemo } from "@/lib/env";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Produtos" };

/**
 * /produtos — a raiz do pipeline.
 *
 * Busca e filtro vem da URL, nao de estado do cliente: assim a primeira pintura
 * ja sai com a lista certa do servidor, o link e compartilhavel e o "voltar"
 * do navegador funciona. A consulta e sempre no escopo do dono da sessao.
 */
export default async function Page(props: PageProps<"/produtos">) {
  const usuario = await exigirUsuario("/produtos");
  const parametros = await props.searchParams;

  const busca = typeof parametros.q === "string" ? parametros.q.trim() : "";
  const arquivados = parametros.ver === "arquivados";

  // Em paralelo: sao tres consultas independentes e em serie somariam tres
  // idas ao banco antes do primeiro byte.
  const [pagina, totalArquivados, fixado] = await Promise.all([
    listarProdutos(usuario.id, { busca, arquivados }),
    contarArquivados(usuario.id),
    produtoFixado(usuario.id),
  ]);

  return (
    <>
      <PageHeader
        titulo="Produtos"
        descricao="O que vai ser vendido na live. É daqui que saem o roteiro, o áudio da apresentadora e a oferta do chat — o produto fixado é o que a live destaca."
      />

      <ListaProdutos
        paginaInicial={pagina}
        busca={busca}
        arquivados={arquivados}
        totalArquivados={totalArquivados}
        fixado={fixado}
        limites={LIMITES_PRODUTO}
        demo={modoDemo}
      />
    </>
  );
}
