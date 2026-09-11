import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronLeft, Lock } from "lucide-react";
import { PlayerAula } from "../player";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitulo } from "@/components/ui/card";
import { Propriedades } from "@/components/ui/propriedades";
import { formatarDuracao } from "@/lib/caracteres";
import { obterAula, segundosParaConcluir, type AulaDetalhe } from "@/lib/dados/aulas";
import { exigirUsuario } from "@/lib/sessao";

/**
 * `cache` porque `generateMetadata` e a pagina rodam na MESMA requisicao e
 * precisam da mesma aula: sem isto seriam duas sessoes lidas e duas consultas
 * identicas ao banco para pintar uma tela so.
 */
const carregar = cache(async (slug: string) => {
  const usuario = await exigirUsuario(`/aulas/${slug}`);
  return { usuario, aula: await obterAula(usuario.id, slug) };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { aula } = await carregar(slug);
  return { title: aula?.titulo ?? "Aula" };
}

/** Aula que o plano nao cobre: o video nao vem, o resto vem. */
function Bloqueada({ aula }: { aula: AulaDetalhe }) {
  const plano = aula.exigePlanoNome ?? "superior";

  return (
    <Card>
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-bg-subtle px-6 text-center">
        <span
          className="grid size-12 place-items-center rounded-full bg-surface text-fg-subtle"
          aria-hidden
        >
          <Lock className="size-5" />
        </span>
        <p className="text-base font-semibold">Esta aula é do plano {plano}</p>
        <p className="max-w-sm text-sm text-fg-muted">
          O vídeo só carrega para quem tem o plano. O resto da aula fica à vista
          para você decidir se vale a pena.
        </p>
      </div>

      <Alerta tom="info" className="mt-4">
        A escada de planos vale para cima: qualquer plano a partir do {plano}{" "}
        libera esta aula.
      </Alerta>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/planos"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
        >
          Ver planos
        </Link>
        <Link
          href="/aulas"
          className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
        >
          Voltar às aulas
        </Link>
      </div>
    </Card>
  );
}

function Vizinha({
  rotulo,
  titulo,
  slug,
  direcao,
}: {
  rotulo: string;
  titulo: string;
  slug: string;
  direcao: "anterior" | "proxima";
}) {
  const Icone = direcao === "anterior" ? ArrowLeft : ArrowRight;

  return (
    <Link
      href={`/aulas/${slug}`}
      className={
        "group flex items-center gap-3 rounded-lg border border-border bg-surface p-3 transition-colors duration-[--dur-fast] hover:border-primary-border hover:bg-surface-hover" +
        (direcao === "proxima" ? " text-right" : "")
      }
    >
      {direcao === "anterior" && (
        <Icone
          className="size-4 shrink-0 text-fg-subtle group-hover:text-primary"
          aria-hidden
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-xs text-fg-subtle">{rotulo}</p>
        <p className="truncate text-sm font-medium">{titulo}</p>
      </div>

      {direcao === "proxima" && (
        <Icone
          className="size-4 shrink-0 text-fg-subtle group-hover:text-primary"
          aria-hidden
        />
      )}
    </Link>
  );
}

export default async function AulaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { aula } = await carregar(slug);

  // Slug que nao existe, aula desativada, ou modo demo (que nao consulta o
  // catalogo): em todos os casos nao ha aula nenhuma para mostrar.
  if (!aula) notFound();

  const duracao = aula.duracaoS ? formatarDuracao(aula.duracaoS * 1000) : "—";

  return (
    <>
      <Link
        href="/aulas"
        className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted transition-colors duration-[--dur-fast] hover:text-primary"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Todas as aulas
      </Link>

      <PageHeader
        titulo={aula.titulo}
        descricao={aula.descricao ?? undefined}
        acoes={
          aula.concluida ? (
            <Badge tom="sucesso">Concluída</Badge>
          ) : aula.liberada ? undefined : (
            <Badge tom="alerta">Bloqueada</Badge>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {!aula.liberada ? (
            <Bloqueada aula={aula} />
          ) : aula.videoYoutube ? (
            <Card>
              <PlayerAula
                aulaId={aula.id}
                titulo={aula.titulo}
                videoYoutube={aula.videoYoutube}
                duracaoS={aula.duracaoS}
                conclusaoS={segundosParaConcluir(aula.duracaoS)}
                segundosVistos={aula.segundosVistos}
                concluida={aula.concluida}
              />
            </Card>
          ) : (
            <Card>
              <Alerta tom="erro">
                O vídeo desta aula não está cadastrado. Ela aparece aqui porque o
                catálogo já a anuncia, mas não há o que tocar ainda.
              </Alerta>
            </Card>
          )}

          {(aula.anterior || aula.proxima) && (
            <nav
              aria-label="Navegação entre aulas"
              className="mt-4 grid gap-3 sm:grid-cols-2"
            >
              {aula.anterior ? (
                <Vizinha
                  rotulo="Aula anterior"
                  titulo={aula.anterior.titulo}
                  slug={aula.anterior.slug}
                  direcao="anterior"
                />
              ) : (
                // Segura a coluna da esquerda para a "próxima" nao encostar no
                // titulo quando esta e a primeira aula do catalogo.
                <span className="hidden sm:block" />
              )}

              {aula.proxima && (
                <Vizinha
                  rotulo="Próxima aula"
                  titulo={aula.proxima.titulo}
                  slug={aula.proxima.slug}
                  direcao="proxima"
                />
              )}
            </nav>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardTitulo>Sobre a aula</CardTitulo>
            <Propriedades
              className="mt-3"
              itens={[
                { rotulo: "Módulo", valor: aula.moduloTitulo },
                { rotulo: "Duração", valor: duracao, numerica: true },
                {
                  rotulo: "Situação",
                  valor: aula.concluida ? (
                    <Badge tom="sucesso">Concluída</Badge>
                  ) : !aula.liberada ? (
                    <Badge tom="alerta">Bloqueada</Badge>
                  ) : aula.segundosVistos > 0 ? (
                    <Badge tom="info">Começada</Badge>
                  ) : (
                    <Badge>Não iniciada</Badge>
                  ),
                },
                {
                  rotulo: "Plano",
                  valor: aula.exigePlanoNome ?? "Aberta a todos",
                },
              ]}
            />
          </Card>

          <Card className="bg-bg-subtle shadow-none">
            <p className="text-sm text-fg-muted">
              O progresso fica na sua conta, não no navegador: você pode começar
              no computador e terminar no celular de onde parou.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
