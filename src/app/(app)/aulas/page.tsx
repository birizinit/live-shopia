import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clapperboard, CircleCheck, Lock, Play } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { BarraProgresso } from "@/components/ui/barra-progresso";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { formatarDuracao } from "@/lib/caracteres";
import { listarModulos, resumir, type AulaResumo, type ModuloAulas } from "@/lib/dados/aulas";
import { exigirUsuario } from "@/lib/sessao";
import { numero } from "@/lib/utils";

export const metadata: Metadata = { title: "Aulas" };

function duracaoDe(segundos: number | null) {
  return segundos ? formatarDuracao(segundos * 1000) : null;
}

/** Aula liberada: o cartao inteiro leva para o player. */
function AulaAberta({ aula }: { aula: AulaResumo }) {
  const duracao = duracaoDe(aula.duracaoS);
  const emAndamento = !aula.concluida && aula.segundosVistos > 0;

  return (
    <Link
      href={`/aulas/${aula.slug}`}
      className="group flex h-full items-start gap-3 rounded-lg border border-border bg-surface p-4 transition-colors duration-[--dur-fast] hover:border-primary-border hover:bg-surface-hover"
    >
      <span
        className={
          aula.concluida
            ? "grid size-8 shrink-0 place-items-center rounded-full bg-success-soft text-success"
            : "grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-soft-fg"
        }
        aria-hidden
      >
        {aula.concluida ? <CircleCheck className="size-4" /> : <Play className="size-4" />}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{aula.titulo}</p>

        {aula.descricao && (
          <p className="mt-0.5 line-clamp-2 text-sm text-fg-muted">{aula.descricao}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
          {duracao && <span className="num">{duracao}</span>}
          {aula.concluida && <Badge tom="sucesso">Concluída</Badge>}
          {emAndamento && <Badge tom="info">Começada</Badge>}
        </div>

        {emAndamento && aula.duracaoS && (
          <BarraProgresso
            className="mt-2"
            tamanho="sm"
            mostrarValor={false}
            rotulo={`Progresso de ${aula.titulo}`}
            valor={Math.min(aula.segundosVistos, aula.duracaoS)}
            maximo={aula.duracaoS}
          />
        )}
      </div>

      <ArrowRight
        className="mt-1 size-4 shrink-0 text-fg-subtle transition-transform duration-[--dur-fast] group-hover:translate-x-0.5 group-hover:text-primary"
        aria-hidden
      />
    </Link>
  );
}

/**
 * Aula bloqueada. Aparece com titulo e descricao a mostra, e nao escondida:
 * quem nao sabe o que esta perdendo nao tem motivo nenhum para mudar de plano.
 */
function AulaBloqueada({ aula }: { aula: AulaResumo }) {
  const duracao = duracaoDe(aula.duracaoS);

  return (
    <Link
      href="/planos"
      className="group flex h-full items-start gap-3 rounded-lg border border-dashed border-border bg-bg-subtle p-4 transition-colors duration-[--dur-fast] hover:border-primary-border hover:bg-surface-hover"
    >
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full bg-surface text-fg-subtle"
        aria-hidden
      >
        <Lock className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg-muted">{aula.titulo}</p>

        {aula.descricao && (
          <p className="mt-0.5 line-clamp-2 text-sm text-fg-subtle">{aula.descricao}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
          {duracao && <span className="num">{duracao}</span>}
          <Badge tom="alerta">
            {aula.exigePlanoNome ? `Plano ${aula.exigePlanoNome}` : "Plano superior"}
          </Badge>
        </div>

        <p className="mt-2 text-xs font-medium text-primary">
          Ver planos para desbloquear
        </p>
      </div>

      <ArrowRight
        className="mt-1 size-4 shrink-0 text-fg-subtle transition-transform duration-[--dur-fast] group-hover:translate-x-0.5 group-hover:text-primary"
        aria-hidden
      />
    </Link>
  );
}

function Modulo({ modulo }: { modulo: ModuloAulas }) {
  const concluidas = modulo.aulas.filter((aula) => aula.concluida).length;

  return (
    <section className="mt-8 first:mt-0">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{modulo.titulo}</h2>
          {modulo.descricao && (
            <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">{modulo.descricao}</p>
          )}
        </div>

        {modulo.aulas.length > 0 && (
          <Badge tom={concluidas === modulo.aulas.length ? "sucesso" : "neutro"}>
            <span className="num">
              {concluidas} de {modulo.aulas.length}
            </span>
          </Badge>
        )}
      </div>

      {modulo.aulas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-fg-subtle">
          As aulas deste módulo estão sendo gravadas.
        </p>
      ) : (
        <ol className="grid gap-3 sm:grid-cols-2">
          {modulo.aulas.map((aula) => (
            <li key={aula.id}>
              {aula.liberada ? <AulaAberta aula={aula} /> : <AulaBloqueada aula={aula} />}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default async function AulasPage() {
  const usuario = await exigirUsuario("/aulas");
  const modulos = await listarModulos(usuario.id);
  const resumo = resumir(modulos);

  return (
    <>
      <PageHeader
        titulo="Aulas"
        descricao="O passo a passo em vídeo: do cadastro do produto até a live no ar."
        acoes={
          resumo.total > 0 ? (
            <Badge tom="marca">
              <span className="num">
                {resumo.concluidas} de {resumo.total}
              </span>
              <span className="ml-1">concluídas</span>
            </Badge>
          ) : undefined
        }
      />

      {resumo.total === 0 ? (
        <>
          <EstadoVazio
            icone={Clapperboard}
            titulo="O conteúdo está sendo gravado"
            texto={
              usuario.demo
                ? "O catálogo de aulas vem do banco, e a sessão demo não tem banco. Com o projeto conectado, os vídeos aparecem aqui."
                : "Nenhuma aula foi publicada ainda. Assim que os vídeos entrarem no ar, eles aparecem aqui — com o seu progresso em cada um."
            }
            acao={
              <Link
                href="/inicio"
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
              >
                Ver os seis passos da live
              </Link>
            }
          />

          {modulos.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">Módulos previstos</h2>
              <p className="mt-0.5 text-sm text-fg-muted">
                A ordem do treinamento já está definida. O que falta é o vídeo.
              </p>

              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {modulos.map((modulo) => (
                  <li key={modulo.id}>
                    <Card className="h-full">
                      <CardTitulo>{modulo.titulo}</CardTitulo>
                      {modulo.descricao && (
                        <CardDescricao>{modulo.descricao}</CardDescricao>
                      )}
                      <div className="mt-3">
                        <Badge>Em gravação</Badge>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <>
          <Card>
            <BarraProgresso
              rotulo="Aulas concluídas"
              rotuloVisivel
              valor={resumo.concluidas}
              maximo={resumo.total}
              tom={resumo.concluidas === resumo.total ? "sucesso" : "primaria"}
              textoValor={`${numero(resumo.concluidas)} de ${numero(resumo.total)}`}
            />

            {resumo.bloqueadas > 0 && (
              <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-fg-muted">
                  <span className="num font-medium text-fg">
                    {numero(resumo.bloqueadas)}
                  </span>{" "}
                  {resumo.bloqueadas === 1 ? "aula depende" : "aulas dependem"} de um
                  plano superior
                  {resumo.planoQueDestrava ? ` — a partir do ${resumo.planoQueDestrava}` : ""}.
                </p>

                <Link
                  href="/planos"
                  className="inline-flex h-9 shrink-0 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
                >
                  Ver planos
                </Link>
              </div>
            )}
          </Card>

          <div className="mt-8">
            {modulos.map((modulo) => (
              <Modulo key={modulo.id} modulo={modulo} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
