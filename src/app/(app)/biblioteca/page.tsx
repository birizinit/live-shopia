import type { Metadata } from "next";
import Link from "next/link";
import { Library, Repeat2, Zap } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { BarraProgresso } from "@/components/ui/barra-progresso";
import { Card } from "@/components/ui/card";
import { formatarDuracao } from "@/lib/caracteres";
import {
  detalheBiblioteca,
  listarBiblioteca,
  normalizarFiltros,
  opcoesDeFiltro,
  resumoBiblioteca,
  type FiltrosBiblioteca,
  type TipoItem,
} from "@/lib/dados/biblioteca";
import { exigirUsuario } from "@/lib/sessao";
import { numero } from "@/lib/utils";
import { Lista } from "./lista";

export const metadata: Metadata = { title: "Biblioteca" };

/**
 * Próxima página da lista.
 *
 * O perfil vem da SESSÃO, nunca do cliente — o que chega daqui é só o recorte,
 * e ele passa por `normalizarFiltros` antes de virar SQL. Um id forjado no
 * parâmetro filtra nada; ele não alcança a biblioteca de outra pessoa.
 */
async function maisItens(consulta: string, cursor: string) {
  "use server";
  const usuario = await exigirUsuario("/biblioteca");
  const filtros = normalizarFiltros(Object.fromEntries(new URLSearchParams(consulta)));
  return listarBiblioteca(usuario.id, filtros, cursor);
}

/** O texto completo só sai do banco quando alguém abre o item. */
async function abrirItem(tipo: TipoItem, id: string) {
  "use server";
  const usuario = await exigirUsuario("/biblioteca");
  return detalheBiblioteca(usuario.id, tipo, id);
}

function semFiltro(filtros: FiltrosBiblioteca) {
  return (
    filtros.tipo === "todos" &&
    filtros.periodo === "total" &&
    !filtros.produtoId &&
    !filtros.vozId &&
    !filtros.busca
  );
}

export default async function BibliotecaPage(props: PageProps<"/biblioteca">) {
  const usuario = await exigirUsuario("/biblioteca");
  const filtros = normalizarFiltros(await props.searchParams);

  const [pagina, resumo, opcoes] = await Promise.all([
    listarBiblioteca(usuario.id, filtros),
    resumoBiblioteca(usuario.id, filtros),
    opcoesDeFiltro(usuario.id),
  ]);

  // Quanto do que foi ao ar saiu de graça. O denominador é o que teria sido
  // cobrado sem reaproveitamento nenhum — gerar tudo, toda vez.
  const total = resumo.caracteresGerados + resumo.caracteresPoupados;
  const aproveitamento = total > 0 ? Math.round((resumo.caracteresPoupados / total) * 100) : 0;

  return (
    <>
      <PageHeader
        titulo="Biblioteca"
        descricao="Tudo que você já gerou, num lugar só. Áudio pronto se repete de graça — é assim que o crédito dura."
        acoes={
          <>
            <Link
              href="/roteiro"
              className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
            >
              Novo roteiro
            </Link>
            <Link
              href="/estudio"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
            >
              Gerar áudio
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-bg-subtle text-fg-subtle">
            <Library className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-fg-subtle">No recorte</p>
            <p className="num truncate font-semibold">{numero(resumo.itens)} itens</p>
            <p className="num mt-0.5 text-xs text-fg-muted">
              {numero(resumo.audios)} áudios · {numero(resumo.roteiros)} roteiros
            </p>
          </div>
        </Card>

        <Card className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-fg">
            <Zap className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-fg-subtle">Custou gerar</p>
            <p className="num truncate font-semibold">
              {numero(resumo.caracteresGerados)}
            </p>
            <p className="num mt-0.5 text-xs text-fg-muted">
              caracteres · {formatarDuracao(resumo.duracaoMs)} de fala
            </p>
          </div>
        </Card>

        <Card className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-success-soft text-success">
            <Repeat2 className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-fg-subtle">Reaproveitado sem gerar de novo</p>
            <p className="num truncate font-semibold text-success">
              {numero(resumo.caracteresPoupados)}
            </p>
            <p className="num mt-0.5 text-xs text-fg-muted">
              caracteres em {numero(resumo.reusos)}{" "}
              {resumo.reusos === 1 ? "reuso" : "reusos"}
            </p>
          </div>
        </Card>
      </div>

      {resumo.caracteresGerados > 0 && (
        <Card className="mt-4">
          <BarraProgresso
            valor={aproveitamento}
            rotulo="Aproveitamento do crédito"
            rotuloVisivel
            tom={aproveitamento >= 50 ? "sucesso" : "primaria"}
          />
          <p className="mt-2 text-sm text-fg-muted">
            {aproveitamento > 0 ? (
              <>
                <span className="num font-medium text-fg">{aproveitamento}%</span> do que
                foi ao ar saiu de graça: o áudio já existia e só foi repetido. Gerar tudo
                de novo teria custado{" "}
                <span className="num font-medium text-fg">{numero(total)}</span> caracteres.
              </>
            ) : (
              <>
                Nada foi reaproveitado ainda. Coloque um áudio pronto numa montagem em{" "}
                <Link href="/audio" className="font-medium text-primary hover:underline">
                  Áudio da live
                </Link>{" "}
                — repetir não gasta crédito nenhum, gerar de novo gasta tudo outra vez.
              </>
            )}
          </p>
        </Card>
      )}

      <Lista
        inicial={pagina}
        filtros={filtros}
        total={resumo.itens}
        opcoes={opcoes}
        vaziaDeVerdade={resumo.itens === 0 && semFiltro(filtros)}
        carregarMais={maisItens}
        abrir={abrirItem}
      />
    </>
  );
}
