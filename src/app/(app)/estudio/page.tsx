import type { Metadata } from "next";
import Link from "next/link";
import { AudioLines, Coins, Plus } from "lucide-react";
import { Gerador } from "./gerador";
import { Progresso } from "./progresso";
import { DicaPrimeiraVez } from "@/components/layout/dica-primeira-vez";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { Propriedades } from "@/components/ui/propriedades";
import { formatarDuracao } from "@/lib/caracteres";
import {
  TETO_CARACTERES_AUDIO,
  audioDoPerfil,
  audiosRecentes,
  roteirosParaFala,
  vozesDisponiveis,
  type AudioResumo,
} from "@/lib/dados/audios";
import { chaveIdempotente } from "@/lib/dados/creditos";
import type { EstadoAudio } from "@/lib/dados/tipos";
import { modoDemo, servicos } from "@/lib/env";
import { PAGINAS } from "@/lib/paginas";
import { exigirUsuario } from "@/lib/sessao";
import { cn, numero } from "@/lib/utils";

export const metadata: Metadata = { title: PAGINAS["/estudio"].titulo };

/**
 * Estúdio de voz — a tela que gasta crédito.
 *
 * A chave de idempotência nasce AQUI, no render, e desce para o formulário num
 * campo oculto. Gerada dentro da ação ela seria outra a cada clique, e o duplo
 * clique cobraria duas vezes pelo mesmo texto (db/migrations/0004_estudio.sql,
 * função debitar_e_enfileirar).
 */

const ROTULO_ESTADO: Record<EstadoAudio, string> = {
  rascunho: "Rascunho",
  na_fila: "Na fila",
  gerando: "Gerando",
  pronto: "Pronto",
  falhou: "Falhou",
};

const TOM_ESTADO: Record<EstadoAudio, "neutro" | "info" | "sucesso" | "perigo"> = {
  rascunho: "neutro",
  na_fila: "info",
  gerando: "info",
  pronto: "sucesso",
  falhou: "perigo",
};

const AVISOS = {
  novo: {
    tom: "sucesso",
    texto:
      "Geração enviada para a fila e crédito debitado. Pode fechar a página: o trabalho continua.",
  },
  andamento: {
    tom: "info",
    texto:
      "Essa geração já estava em andamento — nenhum crédito novo foi gasto.",
  },
  reuso: {
    tom: "sucesso",
    texto:
      "Você já tinha este mesmo texto nesta voz. Reaproveitamos o áudio pronto, sem gastar de novo.",
  },
} as const;

const DATA = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function motivoDeBloqueio(): string | null {
  if (modoDemo) {
    return (
      "Modo demonstração: o áudio ao lado é exemplo e a geração está desligada — " +
      "não há banco nem conta de voz por trás desta sessão."
    );
  }
  if (!servicos.voz) {
    return (
      "A geração está desligada porque não há chave da ElevenLabs configurada. " +
      "Ligar assim gastaria crédito de verdade para receber um áudio de exemplo."
    );
  }
  return null;
}

export default async function EstudioPage({ searchParams }: PageProps<"/estudio">) {
  const usuario = await exigirUsuario("/estudio");
  const params = await searchParams;

  const pedido = typeof params.audio === "string" ? params.audio : null;
  const marca = typeof params.estado === "string" ? params.estado : null;
  const aviso = marca && marca in AVISOS ? AVISOS[marca as keyof typeof AVISOS] : null;

  const [vozes, roteiros, recentes, audio] = await Promise.all([
    vozesDisponiveis(usuario.id),
    roteirosParaFala(usuario.id, 8),
    audiosRecentes(usuario.id, 8),
    pedido ? audioDoPerfil(usuario.id, pedido) : Promise.resolve(null),
  ]);

  const motivo = motivoDeBloqueio();
  const chave = chaveIdempotente("tts");

  return (
    <>
      <PageHeader
        titulo={PAGINAS["/estudio"].titulo}
        descricao="Transforma o roteiro em fala contínua, em blocos, com a voz da apresentadora."
        acoes={
          audio ? (
            <Link
              href="/estudio"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
            >
              <Plus className="size-4" aria-hidden />
              Novo áudio
            </Link>
          ) : (
            <Link
              href="/creditos"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
            >
              <Coins className="size-4" aria-hidden />
              <span className="num">{numero(usuario.creditos)}</span> créditos
            </Link>
          )
        }
      />

      <DicaPrimeiraVez
        chave="estudio.custo-antes"
        caminho="/estudio"
        titulo="O custo aparece antes de você confirmar"
      >
        A estimativa mostra caracteres, duração e quanto sobra de saldo. O débito só acontece quando você confirma — e crédito é medido em caracteres, não em minutos de live.
      </DicaPrimeiraVez>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {aviso && <Alerta tom={aviso.tom}>{aviso.texto}</Alerta>}

          {pedido && !audio && (
            <Alerta tom="erro">
              Este áudio não existe ou não é seu. Comece um novo abaixo.
            </Alerta>
          )}

          {audio ? (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitulo>{audio.titulo}</CardTitulo>
                  <CardDescricao>
                    Voz {audio.vozNome} · criado em {DATA.format(new Date(audio.criadoEm))}
                  </CardDescricao>
                </div>
                <Badge tom={TOM_ESTADO[audio.estado]}>{ROTULO_ESTADO[audio.estado]}</Badge>
              </div>

              <div className="mt-5">
                <Progresso
                  audioId={audio.id}
                  titulo={audio.titulo}
                  inicial={audio.aoVivo}
                  exemplo={modoDemo}
                />
              </div>

              <Propriedades
                colunas={2}
                className="mt-5"
                itens={[
                  { rotulo: "Caracteres", valor: numero(audio.caracteres), numerica: true },
                  {
                    rotulo: "Blocos",
                    valor: `${numero(audio.blocosProntos)} de ${numero(audio.blocosTotal)}`,
                    numerica: true,
                  },
                  {
                    rotulo: "Duração gerada",
                    valor: formatarDuracao(audio.duracaoMs),
                    numerica: true,
                  },
                  {
                    rotulo: "Créditos gastos",
                    valor: audio.creditosGastos > 0 ? numero(audio.creditosGastos) : "—",
                    numerica: true,
                  },
                ]}
              />

              <details className="mt-4 rounded-md border border-border">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-fg-muted">
                  Ver o texto falado
                </summary>
                <p className="max-h-64 overflow-y-auto border-t border-border px-3 py-3 text-sm leading-relaxed whitespace-pre-wrap text-fg-muted">
                  {audio.texto}
                </p>
              </details>

              <p className="mt-4 text-xs text-fg-subtle">
                Este áudio pode ir ao ar quantas vezes você quiser: a montagem da live
                repete a lista de blocos em laço e isso não gasta crédito de novo.
              </p>
            </Card>
          ) : (
            <Gerador
              chave={chave}
              vozes={vozes}
              roteiros={roteiros}
              saldo={usuario.creditos}
              podeGerar={!motivo}
              motivo={motivo}
              tetoCaracteres={TETO_CARACTERES_AUDIO}
            />
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardTitulo>Seu saldo</CardTitulo>
            <p className="num mt-2 text-3xl font-bold">{numero(usuario.creditos)}</p>
            <CardDescricao>
              1 caractere de fala = 1 crédito. O bloco tem até 2.400 caracteres.
            </CardDescricao>
            <Link
              href="/creditos"
              className="mt-4 inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
            >
              Comprar créditos
            </Link>
          </Card>

          <Card>
            <CardTitulo>Áudios recentes</CardTitulo>
            <CardDescricao>Abrir um já gerado não gasta crédito nenhum.</CardDescricao>
            <ListaRecentes itens={recentes} atual={audio?.id ?? null} />
          </Card>
        </aside>
      </div>
    </>
  );
}

function ListaRecentes({ itens, atual }: { itens: AudioResumo[]; atual: string | null }) {
  if (itens.length === 0) {
    return (
      <p className="mt-4 rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-fg-muted">
        Nenhum áudio gerado ainda. O primeiro aparece aqui.
      </p>
    );
  }

  return (
    <ul className="mt-3 space-y-1.5">
      {itens.map((item) => {
        const selecionado = item.id === atual;
        return (
          <li key={item.id}>
            <Link
              href={`/estudio?audio=${item.id}`}
              aria-current={selecionado ? "page" : undefined}
              className={cn(
                "flex flex-col gap-1 rounded-md border px-3 py-2.5 transition-colors duration-[--dur-fast]",
                selecionado
                  ? "border-primary-border bg-primary-soft"
                  : "border-border hover:bg-surface-hover",
              )}
            >
              <span className="flex items-start gap-2">
                <AudioLines className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {item.titulo}
                </span>
              </span>
              <span className="flex items-center justify-between gap-2 pl-6">
                <Badge tom={TOM_ESTADO[item.estado]}>{ROTULO_ESTADO[item.estado]}</Badge>
                <span className="num text-xs text-fg-subtle">
                  {item.vozNome} ·{" "}
                  {item.duracaoMs > 0
                    ? formatarDuracao(item.duracaoMs)
                    : `${numero(item.caracteres)} caracteres`}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
