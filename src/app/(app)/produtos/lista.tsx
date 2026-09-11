"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  ImageOff,
  Package,
  PackageOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  Ticket,
  Trash2,
} from "lucide-react";
import {
  alternarArquivado,
  alternarFixado,
  carregarMaisProdutos,
  removerProduto,
} from "./actions";
import { ModalProduto } from "./formulario";
import { Alerta } from "@/components/ui/alerta";
import { useAvisos } from "@/components/ui/avisos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmarAcao } from "@/components/ui/confirmar-acao";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { FiltroSegmentado } from "@/components/ui/filtro-segmentado";
import { Input } from "@/components/ui/input";
import { Paginacao, juntarPaginas } from "@/components/ui/paginacao";
import type { LimitesProduto, Produto } from "@/lib/dados/produtos";
import type { Pagina, ResultadoAcao } from "@/lib/dados/tipos";
import { brl, cn, numero } from "@/lib/utils";

/**
 * A lista de produtos e tudo que se faz com um produto.
 *
 * A busca e o filtro moram na URL (formulario GET e links), nao em estado: a
 * busca fica compartilhavel, volta com o botao "voltar" e funciona mesmo antes
 * de o JavaScript carregar. O que e estado de verdade — as paginas ja
 * carregadas e as caixas abertas — fica aqui.
 */

export type ListaProdutosProps = {
  paginaInicial: Pagina<Produto>;
  busca: string;
  arquivados: boolean;
  totalArquivados: number;
  fixado: Produto | null;
  limites: LimitesProduto;
  demo: boolean;
};

type Visao = "ativos" | "arquivados";

export function ListaProdutos({
  paginaInicial,
  busca,
  arquivados,
  totalArquivados,
  fixado,
  limites,
  demo,
}: ListaProdutosProps) {
  const router = useRouter();
  const avisos = useAvisos();

  const [pagina, setPagina] = useState(paginaInicial);
  const [carregando, setCarregando] = useState(false);
  const [emAcao, iniciar] = useTransition();

  const [editando, setEditando] = useState<Produto | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [excluindo, setExcluindo] = useState<Produto | null>(null);

  // O servidor manda uma pagina nova a cada revalidacao. Trocar aqui, no
  // render, e nao num efeito: com efeito a tela mostraria a lista velha por um
  // quadro depois de cada salvamento.
  const [origem, setOrigem] = useState(paginaInicial);
  if (origem !== paginaInicial) {
    setOrigem(paginaInicial);
    setPagina(paginaInicial);
  }

  const visao: Visao = arquivados ? "arquivados" : "ativos";

  function irPara(proximaVisao: Visao, proximaBusca = busca) {
    const parametros = new URLSearchParams();
    if (proximaBusca) parametros.set("q", proximaBusca);
    if (proximaVisao === "arquivados") parametros.set("ver", "arquivados");
    const consulta = parametros.toString();
    router.push(consulta ? `/produtos?${consulta}` : "/produtos");
  }

  function executar(
    acao: () => Promise<ResultadoAcao<null>>,
    sucesso: { titulo: string; texto?: string },
  ) {
    iniciar(async () => {
      const resultado = await acao();
      if (resultado.ok) {
        avisos.sucesso(sucesso.titulo, sucesso.texto);
        router.refresh();
        return;
      }
      avisos.erro("Não deu para concluir", resultado.erro);
    });
  }

  async function carregarMais(cursor: string) {
    setCarregando(true);
    const resultado = await carregarMaisProdutos(cursor, busca, arquivados);
    setCarregando(false);

    if (!resultado.ok) {
      avisos.erro("Não deu para carregar mais", resultado.erro);
      return;
    }
    setPagina((atual) => juntarPaginas(atual, resultado.dado));
  }

  function abrirNovo() {
    setEditando(null);
    setFormAberto(true);
  }

  function abrirEdicao(produto: Produto) {
    setEditando(produto);
    setFormAberto(true);
  }

  const fixadoForaDaLista =
    fixado && !arquivados && !pagina.itens.some((p) => p.id === fixado.id);

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* `action` de verdade: sem JavaScript o GET vai para /produtos?q=…
            do mesmo jeito. Com JavaScript, o onSubmit troca a ida ao servidor
            por uma navegacao do roteador, que nao repinta a casca inteira. */}
        <form
          action="/produtos"
          onSubmit={(evento) => {
            evento.preventDefault();
            const dados = new FormData(evento.currentTarget);
            irPara(visao, String(dados.get("q") ?? "").trim());
          }}
          className="flex min-w-0 flex-1 gap-2 sm:max-w-sm"
        >
          {arquivados && <input type="hidden" name="ver" value="arquivados" />}
          <label htmlFor="q" className="sr-only">
            Buscar produto pelo nome
          </label>
          <Input
            id="q"
            name="q"
            key={busca}
            type="search"
            defaultValue={busca}
            placeholder="Buscar pelo nome…"
            autoComplete="off"
          />
          <Button type="submit" variante="secondary" aria-label="Buscar">
            <Search className="size-4" aria-hidden />
          </Button>
        </form>

        <div className="flex items-center gap-2">
          <FiltroSegmentado<Visao>
            rotulo="Mostrar produtos"
            valor={visao}
            aoMudar={(proxima) => irPara(proxima)}
            opcoes={[
              { valor: "ativos", rotulo: "Ativos" },
              {
                valor: "arquivados",
                rotulo: totalArquivados > 0 ? `Arquivados (${totalArquivados})` : "Arquivados",
                rotuloAcessivel: `Arquivados: ${totalArquivados}`,
              },
            ]}
          />
          <Button onClick={abrirNovo}>
            <Plus className="size-4" aria-hidden />
            Novo produto
          </Button>
        </div>
      </div>

      {demo && (
        <Alerta tom="info" className="mb-5">
          Modo demo: os produtos abaixo são exemplos e nada que você salvar fica
          gravado. Configure <code>DATABASE_URL</code> para usar o seu catálogo.
        </Alerta>
      )}

      {fixadoForaDaLista && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-md border border-primary-border bg-primary-soft px-3 py-2 text-sm text-primary-soft-fg">
          <Pin className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0">
            Fixado na live: <strong className="font-semibold">{fixado.nome}</strong>
          </span>
          <button
            type="button"
            onClick={() => irPara("ativos", fixado.nome)}
            className="ml-auto text-xs font-medium underline underline-offset-2"
          >
            Ver na lista
          </button>
        </div>
      )}

      {pagina.itens.length === 0 ? (
        <Vazio
          busca={busca}
          arquivados={arquivados}
          totalArquivados={totalArquivados}
          aoCadastrar={abrirNovo}
          aoVerArquivados={() => irPara("arquivados", "")}
          aoLimpar={() => irPara(visao, "")}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pagina.itens.map((produto) => (
            <li key={produto.id}>
              <CartaoProduto
                produto={produto}
                ocupado={emAcao}
                aoEditar={() => abrirEdicao(produto)}
                aoExcluir={() => setExcluindo(produto)}
                aoFixar={() =>
                  executar(() => alternarFixado(produto.id, !produto.fixado), {
                    titulo: produto.fixado ? "Produto desafixado" : "Produto fixado na live",
                    texto: produto.fixado
                      ? undefined
                      : "É ele que a live destaca enquanto estiver no ar.",
                  })
                }
                aoArquivar={() =>
                  executar(() => alternarArquivado(produto.id, !produto.arquivadoEm), {
                    titulo: produto.arquivadoEm ? "Produto restaurado" : "Produto arquivado",
                    texto: produto.arquivadoEm
                      ? undefined
                      : "Os roteiros e áudios dele continuam salvos.",
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      <Paginacao
        proximo={pagina.proximo}
        mostrados={pagina.itens.length}
        total={pagina.total}
        aoCarregarMais={carregarMais}
        carregando={carregando}
        itens={arquivados ? "produtos arquivados" : "produtos"}
      />

      <ModalProduto
        aberto={formAberto}
        aoFechar={() => setFormAberto(false)}
        produto={editando}
        limites={limites}
        demo={demo}
        aoSalvar={({ nome, novo, avisoImagem }) => {
          setFormAberto(false);
          avisos.sucesso(
            novo ? "Produto cadastrado" : "Produto atualizado",
            novo ? `${nome} já pode virar roteiro.` : undefined,
          );
          // O produto entrou; so a foto ficou pelo caminho. Aviso separado para
          // a pessoa saber exatamente o que falta refazer.
          if (avisoImagem) avisos.alerta("A imagem não subiu", avisoImagem);
          router.refresh();
        }}
      />

      <ConfirmarAcao
        aberto={Boolean(excluindo)}
        aoFechar={() => setExcluindo(null)}
        titulo={`Excluir ${excluindo?.nome ?? "produto"}?`}
        texto="Produto com roteiro ou áudio não pode ser excluído — nesse caso, arquive."
        perdas={[
          "O cadastro, com preço, cupom e link",
          "A imagem enviada",
          "Os benefícios e as objeções escritos para a IA",
        ]}
        rotuloConfirmar="Excluir de vez"
        aoConfirmar={async () => {
          if (!excluindo) return;
          const resultado = await removerProduto(excluindo.id);
          setExcluindo(null);

          if (resultado.ok) {
            avisos.sucesso("Produto excluído");
            router.refresh();
            return;
          }
          avisos.erro("Não deu para excluir", resultado.erro);
        }}
      />
    </>
  );
}

function CartaoProduto({
  produto,
  ocupado,
  aoEditar,
  aoExcluir,
  aoFixar,
  aoArquivar,
}: {
  produto: Produto;
  ocupado: boolean;
  aoEditar: () => void;
  aoExcluir: () => void;
  aoFixar: () => void;
  aoArquivar: () => void;
}) {
  const arquivado = Boolean(produto.arquivadoEm);
  const desconto =
    produto.precoDeCentavos && produto.precoCentavos && produto.precoDeCentavos > produto.precoCentavos
      ? Math.round(
          ((produto.precoDeCentavos - produto.precoCentavos) / produto.precoDeCentavos) * 100,
        )
      : null;

  return (
    <article
      className={cn(
        "flex h-full flex-col rounded-lg border bg-surface p-4 shadow-sm",
        produto.fixado ? "border-primary-border ring-1 ring-primary-border" : "border-border",
        arquivado && "opacity-80",
      )}
    >
      <div className="flex gap-3">
        <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md bg-bg-subtle">
          {produto.imagemId ? (
            // <img> e nao next/image: a rota exige a sessao do dono e o
            // otimizador busca a URL sem o cookie de quem esta vendo.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/produtos/${produto.id}/imagem`}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          ) : (
            <ImageOff className="size-5 text-fg-subtle" aria-hidden />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold" title={produto.nome}>
            {produto.nome}
          </h3>

          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {produto.precoCentavos !== null ? (
              <span className="num text-sm font-semibold">
                {brl(produto.precoCentavos / 100)}
              </span>
            ) : (
              <span className="text-sm text-fg-subtle">Preço só ao vivo</span>
            )}

            {produto.precoDeCentavos !== null && (
              <span className="num text-xs text-fg-subtle line-through">
                {brl(produto.precoDeCentavos / 100)}
              </span>
            )}

            {desconto !== null && (
              <Badge tom="sucesso">
                <span className="num">−{desconto}%</span>
              </Badge>
            )}
          </div>
        </div>
      </div>

      {produto.descricao && (
        <p className="mt-3 line-clamp-2 text-sm text-fg-muted">{produto.descricao}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {produto.fixado && (
          <Badge tom="marca">
            <Pin className="mr-1 size-3" aria-hidden />
            Fixado na live
          </Badge>
        )}
        {arquivado && <Badge tom="alerta">Arquivado</Badge>}
        {produto.cupom && (
          <Badge>
            <Ticket className="mr-1 size-3" aria-hidden />
            {produto.cupom}
          </Badge>
        )}
        <Badge tom={produto.roteiros > 0 ? "info" : "neutro"}>
          <span className="num">{numero(produto.roteiros)}</span>
          {produto.roteiros === 1 ? " roteiro" : " roteiros"}
        </Badge>
        {produto.beneficios.length > 0 && (
          <Badge>
            <span className="num">{numero(produto.beneficios.length)}</span> benefícios
          </Badge>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {!arquivado && (
          <Link
            href={`/roteiro?produto=${produto.id}`}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg",
              "transition-colors duration-[--dur-fast] hover:bg-primary-hover",
            )}
          >
            <Sparkles className="size-4" aria-hidden />
            Gerar roteiro
          </Link>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          {produto.link && (
            <AcaoIcone
              rotulo={`Abrir a página de ${produto.nome}`}
              href={produto.link}
              icone={ExternalLink}
            />
          )}

          {!arquivado && (
            <AcaoIcone
              rotulo={produto.fixado ? `Desafixar ${produto.nome}` : `Fixar ${produto.nome} na live`}
              icone={produto.fixado ? PinOff : Pin}
              ativo={produto.fixado}
              desabilitado={ocupado}
              aoClicar={aoFixar}
            />
          )}

          <AcaoIcone
            rotulo={`Editar ${produto.nome}`}
            icone={Pencil}
            desabilitado={ocupado}
            aoClicar={aoEditar}
          />

          <AcaoIcone
            rotulo={arquivado ? `Restaurar ${produto.nome}` : `Arquivar ${produto.nome}`}
            icone={arquivado ? ArchiveRestore : Archive}
            desabilitado={ocupado}
            aoClicar={aoArquivar}
          />

          <AcaoIcone
            rotulo={`Excluir ${produto.nome}`}
            icone={Trash2}
            perigo
            desabilitado={ocupado}
            aoClicar={aoExcluir}
          />
        </div>
      </div>
    </article>
  );
}

function AcaoIcone({
  rotulo,
  icone: Icone,
  aoClicar,
  href,
  ativo,
  perigo,
  desabilitado,
}: {
  rotulo: string;
  icone: React.ComponentType<{ className?: string }>;
  aoClicar?: () => void;
  href?: string;
  ativo?: boolean;
  perigo?: boolean;
  desabilitado?: boolean;
}) {
  const classe = cn(
    "grid size-8 place-items-center rounded-md text-fg-subtle",
    "transition-colors duration-[--dur-fast] hover:bg-surface-hover",
    ativo ? "text-primary" : perigo ? "hover:text-danger" : "hover:text-fg",
    desabilitado && "pointer-events-none opacity-50",
  );

  // O rotulo tambem vira `title`: no toque nao ha foco nem hover, e um icone
  // sem nome visivel so se explica ao ser tocado — melhor que nao se explicar.
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={rotulo}
        title={rotulo}
        className={classe}
      >
        <Icone className="size-4" />
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-label={rotulo}
      title={rotulo}
      disabled={desabilitado}
      className={classe}
    >
      <Icone className="size-4" />
    </button>
  );
}

function Vazio({
  busca,
  arquivados,
  totalArquivados,
  aoCadastrar,
  aoVerArquivados,
  aoLimpar,
}: {
  busca: string;
  arquivados: boolean;
  totalArquivados: number;
  aoCadastrar: () => void;
  aoVerArquivados: () => void;
  aoLimpar: () => void;
}) {
  if (busca) {
    return (
      <EstadoVazio
        icone={Search}
        titulo={`Nada com “${busca}”`}
        texto={
          arquivados
            ? "Nenhum produto arquivado tem esse nome."
            : "Nenhum produto ativo tem esse nome. Ele pode estar arquivado."
        }
        acao={
          <>
            <Button variante="secondary" onClick={aoLimpar}>
              Limpar busca
            </Button>
            <Button onClick={aoCadastrar}>
              <Plus className="size-4" aria-hidden />
              Cadastrar “{busca}”
            </Button>
          </>
        }
      />
    );
  }

  if (arquivados) {
    return (
      <EstadoVazio
        icone={Archive}
        titulo="Nenhum produto arquivado"
        texto="Produto que já virou roteiro não se exclui: arquiva. Ele sai da lista de ativos e o material gerado continua no lugar."
      />
    );
  }

  // Catalogo inteiro arquivado nao e comeco de jornada: quem ja cadastrou nao
  // precisa da aula, precisa do caminho de volta.
  if (totalArquivados > 0) {
    return (
      <EstadoVazio
        icone={Package}
        titulo="Nenhum produto ativo"
        texto={`Você tem ${totalArquivados} produto${totalArquivados > 1 ? "s" : ""} arquivado${totalArquivados > 1 ? "s" : ""}. Restaure um deles ou cadastre outro para gerar roteiro.`}
        acao={
          <>
            <Button onClick={aoCadastrar}>
              <Plus className="size-4" aria-hidden />
              Novo produto
            </Button>
            <Button variante="secondary" onClick={aoVerArquivados}>
              <Archive className="size-4" aria-hidden />
              Ver arquivados
            </Button>
          </>
        }
      />
    );
  }

  return (
    <EstadoVazio
      icone={PackageOpen}
      titulo="Comece pelo produto"
      texto={
        "O produto é o ponto de partida da live: é dele que saem o roteiro, o áudio " +
        "da apresentadora e a oferta que aparece no chat. Cadastre nome, preço, " +
        "benefícios e objeções — quanto mais concreto, melhor a IA escreve."
      }
      acao={
        <>
          <Button onClick={aoCadastrar}>
            <Plus className="size-4" aria-hidden />
            Cadastrar primeiro produto
          </Button>
          <Link
            href="/inicio"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Ver os 6 passos da live
          </Link>
        </>
      }
    />
  );
}
