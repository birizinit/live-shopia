import Link from "next/link";
import { ArrowRight, Cable, Download, Hourglass, PackageOpen } from "lucide-react";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { VersaoExtensao } from "@/lib/dados/extensao";

/**
 * Abertura da tela da extensão.
 *
 * Selo, título e área de download moram juntos porque respondem à mesma
 * pergunta — “existe isto para eu instalar hoje?” — e a resposta muda os três
 * ao mesmo tempo. Nenhum ramo daqui inventa um botão: onde não há pacote no ar,
 * o espaço do download passa a ser ocupado pelo que dá para fazer sem ele.
 *
 * Quando uma linha for publicada em `ext_versoes` com o arquivo servível, o
 * primeiro ramo assume sozinho. Não há nada para trocar no código.
 */

function dataLonga(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

export type HeroProps = {
  versao: VersaoExtensao | null;
  /** O arquivo existe e está servível — a versão estar no catálogo não basta. */
  temPacote: boolean;
  /** Assinado no render e válido por minutos; nulo quando falta EXTENSAO_SEGREDO. */
  ticket: string | null;
};

export function Hero({ versao, temPacote, ticket }: HeroProps) {
  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <div className="p-5 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          {versao ? (
            <>
              <Badge tom="marca">
                <span className="num">v{versao.versao}</span>
                {versao.canal === "canario" && " · canário"}
              </Badge>
              {versao.publicadaEm && (
                <span className="text-xs text-fg-subtle">
                  publicada em {dataLonga(versao.publicadaEm)}
                </span>
              )}
            </>
          ) : (
            <Badge tom="alerta">
              <Hourglass className="mr-1 size-3" aria-hidden />
              Ainda não publicada
            </Badge>
          )}
        </div>

        <h1 className="mt-4 text-[28px] leading-tight font-bold text-balance sm:text-[40px]">
          A extensão que põe a sua live no ar
        </h1>

        <p className="mt-3 max-w-2xl text-base text-fg-muted sm:text-lg">
          Ela mora no Chrome: entrega a voz da apresentadora ao TikTok LIVE Studio pelo
          cabo virtual, toca em laço o áudio que você montou e responde o chat enquanto
          você cuida de outra coisa.
        </p>
      </div>

      <div className="border-t border-border bg-bg-subtle p-5 sm:p-8">
        <AreaDeDownload versao={versao} temPacote={temPacote} ticket={ticket} />
      </div>
    </Card>
  );
}

function AreaDeDownload({ versao, temPacote, ticket }: HeroProps) {
  // Sem linha publicada em `ext_versoes` não existe pacote nenhum. É o estado
  // de hoje, e é o único ramo que precisa oferecer um caminho alternativo.
  if (!versao) {
    return (
      <>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <PackageOpen className="size-5 shrink-0 text-fg-subtle" aria-hidden />
          O pacote ainda não foi publicado
        </h2>

        <Alerta tom="info" className="mt-3">
          Não existe arquivo para baixar hoje, e a gente prefere dizer isso a te dar um
          botão que não faz nada. Quando a primeira versão sair, ela aparece aqui — nesta
          mesma tela, sem você precisar procurar.
        </Alerta>

        <EnquantoIsso />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-base font-semibold">
          Baixar a <span className="num">v{versao.versao}</span>
        </h2>
        {versao.canal === "canario" && (
          <Badge tom="alerta">Canal canário — versão de teste</Badge>
        )}
      </div>

      {versao.notas && (
        <div className="mt-3 rounded-md border border-border bg-surface p-3">
          <p className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            O que mudou
          </p>
          <p className="mt-1.5 text-sm text-fg-muted">{versao.notas}</p>
        </div>
      )}

      {versao.obrigatoria && (
        <Alerta tom="info" className="mt-3">
          Atualização obrigatória: as versões anteriores param de operar.
        </Alerta>
      )}

      <div className="mt-4">
        {!temPacote ? (
          // A versão está no catálogo, mas o arquivo dela não está servível —
          // linha de `arquivos` removida, por exemplo. Botão aqui baixaria nada.
          <Alerta tom="info">
            Esta versão está no catálogo, mas o arquivo dela não está disponível para
            download neste momento. Estamos resolvendo; o botão volta sozinho.
          </Alerta>
        ) : ticket ? (
          <>
            <a
              href={`/api/ext/baixar?t=${encodeURIComponent(ticket)}`}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-fg shadow-sm transition-colors duration-[--dur-fast] hover:bg-primary-hover sm:w-auto"
            >
              <Download className="size-4" aria-hidden />
              Baixar a extensão (<span className="num">v{versao.versao}</span>)
            </a>
            <p className="mt-2.5 text-sm text-fg-muted">
              Chrome, Windows e Mac. Incluso no seu plano.
            </p>
            <p className="mt-1 text-xs text-fg-subtle">
              O link vale por alguns minutos e é só seu — se expirar, atualize a página.
            </p>
          </>
        ) : (
          <>
            <Button bloco disabled className="h-11 sm:w-auto">
              <Download className="size-4" aria-hidden />
              Baixar a extensão
            </Button>
            <Alerta tom="info" className="mt-2.5">
              O download pelo navegador precisa de{" "}
              <code className="font-[family-name:var(--font-mono)] text-xs">
                EXTENSAO_SEGREDO
              </code>{" "}
              no ambiente — é ela que assina o link temporário. Sem essa variável o botão
              fica desligado, em vez de servir um arquivo sem prova de quem pediu.
            </Alerta>
          </>
        )}
      </div>
    </>
  );
}

/**
 * O caminho manual.
 *
 * Não é consolo: o cabo virtual é a MESMA peça que a extensão usa por baixo, e
 * quem instalar agora não vai refazer nada depois. O que este caminho não faz
 * está dito na última linha, com todas as letras.
 */
function EnquantoIsso() {
  return (
    <div className="mt-4 rounded-lg border border-primary-border bg-primary-soft p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-primary-soft-fg">
        <Cable className="size-4 shrink-0" aria-hidden />
        O que dá para fazer enquanto isso
      </p>

      <p className="mt-2 text-sm text-fg-muted">
        Levar a voz da Shopia para o LIVE Studio na mão, com o cabo virtual. São três
        passos e nenhum deles depende da extensão existir.
      </p>

      <ol className="mt-3 space-y-2.5">
        <li className="flex gap-3">
          <span className="num mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-primary-border bg-surface text-xs font-semibold text-primary-soft-fg">
            1
          </span>
          <span className="min-w-0 text-sm text-fg-muted">
            Monte a lista em{" "}
            <Link
              href="/audio"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Áudio da live
            </Link>{" "}
            e deixe o player tocando em laço numa aba do Chrome.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="num mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-primary-border bg-surface text-xs font-semibold text-primary-soft-fg">
            2
          </span>
          <span className="min-w-0 text-sm text-fg-muted">
            Instale o cabo virtual e mande o som do Chrome para dentro dele — o passo a
            passo está{" "}
            <a
              href="#cabo-virtual"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              mais abaixo nesta página
            </a>
            .
          </span>
        </li>
        <li className="flex gap-3">
          <span className="num mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-primary-border bg-surface text-xs font-semibold text-primary-soft-fg">
            3
          </span>
          <span className="min-w-0 text-sm text-fg-muted">
            No LIVE Studio, escolha o cabo como microfone. A apresentadora entra no ar.
          </span>
        </li>
      </ol>

      <p className="mt-3 flex gap-2 text-sm text-fg-muted">
        <ArrowRight className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
        <span>
          O que falta neste caminho é justamente o que só a extensão faz: responder o
          chat, chamar a pessoa pelo nome, acionar o cupom na hora. Áudio no ar você já
          consegue hoje.
        </span>
      </p>
    </div>
  );
}
