"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ShieldCheck,
} from "lucide-react";
import { aceitarRisco, verPasso, type EstadoAceite } from "./actions";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { BarraProgresso } from "@/components/ui/barra-progresso";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PassoTour } from "@/lib/dados/onboarding";
import { TODOS_OS_ITENS } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * O tour guiado.
 *
 * Cliente porque tem estado (o passo atual) e teclado. O TEXTO nao esta aqui:
 * chega pronto de `onboarding_passos`, e o progresso volta para o banco a cada
 * passo lido — quem sai no meio continua de onde parou, inclusive de outro
 * aparelho.
 */

const INICIAL: EstadoAceite = {};

/** Data do aceite com fuso fixo: o servidor e o navegador precisam escrever o
 *  mesmo texto, senao a hidratacao acusa diferenca. */
const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

const CLASSE_BOTAO_LINK =
  "inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg shadow-sm transition-colors duration-[--dur-fast] hover:bg-primary-hover";

export type TourProps = {
  passos: PassoTour[];
  indiceInicial: number;
  riscoAceitoEm: string | null;
  riscoEmDia: boolean;
  versaoRisco: number;
  demo: boolean;
};

/** O rotulo humano da rota sai da navegacao — nao existe segunda lista. */
function rotuloDaRota(rota: string) {
  return TODOS_OS_ITENS.find((item) => item.href === rota)?.rotulo ?? rota;
}

export function Tour({
  passos,
  indiceInicial,
  riscoAceitoEm,
  riscoEmDia,
  versaoRisco,
  demo,
}: TourProps) {
  const [indice, setIndice] = useState(indiceInicial);
  const [marcado, setMarcado] = useState(false);
  const [estadoAceite, enviarAceite, enviandoAceite] = useActionState(
    aceitarRisco,
    INICIAL,
  );

  const titulo = useRef<HTMLHeadingElement>(null);
  const primeiraPintura = useRef(true);
  /** O que ja foi mandado para o banco nesta sessao, para nao repetir a ida. */
  const enviados = useRef<Set<string>>(new Set());
  const idAceite = useId();

  const ultimo = passos.length - 1;
  const passo = passos[indice];

  const aceito = riscoEmDia || estadoAceite.ok === true;

  // O passo de aceite trava o que vem depois: esta e a unica parte do tour que
  // e obrigatoria, e pular por cima dela esvaziaria o registro do aceite.
  const indiceTrava = passos.findIndex((item) => item.exigeAceite);
  const limite = indiceTrava >= 0 && !aceito ? indiceTrava : ultimo;
  const travadoNoAceite = indiceTrava >= 0 && !aceito && indice >= indiceTrava;

  const irPara = useCallback(
    (alvo: number) => {
      setIndice(Math.min(Math.max(alvo, 0), Math.max(limite, 0)));
    },
    [limite],
  );

  const avancar = useCallback(() => irPara(indice + 1), [irPara, indice]);
  const voltar = useCallback(() => irPara(indice - 1), [irPara, indice]);

  /**
   * Passo lido vira linha no banco assim que aparece.
   *
   * O passo de aceite fica de fora: quem marca ele e
   * `aceitar_risco_automacao()`, e nao a simples passagem de olho. Marcar aqui
   * o tiraria de `tour_pendente()` sem que ninguem tivesse aceitado nada.
   */
  useEffect(() => {
    const atual = passos[indice];
    if (!atual || atual.exigeAceite) return;
    if (atual.vistoEm || enviados.current.has(atual.chave)) return;

    enviados.current.add(atual.chave);
    // Falhar aqui so adia o registro para a proxima visita — e o insert do
    // banco e `on conflict do nothing`, entao repetir nao machuca.
    verPasso(atual.chave).catch(() => {});
  }, [indice, passos]);

  // Foco no titulo a cada troca: o leitor de tela precisa ser levado ao texto
  // novo. Na primeira pintura nao, para nao roubar o foco de quem acabou de
  // chegar na pagina.
  useEffect(() => {
    if (primeiraPintura.current) {
      primeiraPintura.current = false;
      return;
    }
    titulo.current?.focus();
  }, [indice]);

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.defaultPrevented) return;
      if (evento.metaKey || evento.ctrlKey || evento.altKey) return;

      // Dentro de campo de texto a seta move o cursor, nao o tour.
      const alvo = evento.target as HTMLElement | null;
      const etiqueta = alvo?.tagName;
      if (alvo?.isContentEditable) return;
      if (etiqueta === "INPUT" || etiqueta === "TEXTAREA" || etiqueta === "SELECT") return;

      if (evento.key === "ArrowRight") {
        evento.preventDefault();
        avancar();
      } else if (evento.key === "ArrowLeft") {
        evento.preventDefault();
        voltar();
      } else if (evento.key === "Home") {
        evento.preventDefault();
        irPara(0);
      } else if (evento.key === "End") {
        evento.preventDefault();
        irPara(limite);
      }
    }

    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [avancar, voltar, irPara, limite]);

  if (!passo) return null;

  /**
   * Passo resolvido, sem estado extra: o de aceite depende do aceite; os
   * outros, de ja terem sido lidos — numa sessao anterior (`vistoEm`) ou nesta,
   * o que quer dizer estar para tras do passo atual.
   */
  function resolvido(item: PassoTour, posicao: number) {
    return item.exigeAceite ? aceito : item.vistoEm !== null || posicao < indice;
  }

  // O corpo vem do banco como texto corrido; quebra de linha vira paragrafo
  // para o dia em que o aviso for reescrito em mais de um bloco.
  const paragrafos = passo.corpo.split(/\n+/).filter((trecho) => trecho.trim());

  return (
    <div className="space-y-4">
      {demo && (
        <Alerta tom="info">
          Modo demo: estes textos são um resumo do que está semeado em{" "}
          <code className="font-[family-name:var(--font-mono)] text-xs">
            onboarding_passos
          </code>
          . Nada é salvo aqui — numa conta de verdade o progresso e o aceite ficam
          guardados na conta.
        </Alerta>
      )}

      <Card className="p-0">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <BarraProgresso
            rotulo="Progresso do tour"
            valor={indice + 1}
            maximo={passos.length}
            textoValor={`Passo ${indice + 1} de ${passos.length}`}
            tamanho="sm"
          />

          <ol className="mt-3 flex flex-wrap gap-1.5">
            {passos.map((item, posicao) => {
              const atual = posicao === indice;
              const bloqueado = posicao > limite;

              return (
                <li key={item.chave}>
                  <button
                    type="button"
                    onClick={() => irPara(posicao)}
                    disabled={bloqueado}
                    aria-current={atual ? "step" : undefined}
                    aria-label={`Passo ${posicao + 1} de ${passos.length}: ${item.titulo}`}
                    className={cn(
                      "num grid size-8 place-items-center rounded-full border text-xs font-semibold",
                      "transition-colors duration-[--dur-fast]",
                      "disabled:cursor-not-allowed disabled:opacity-40",
                      atual
                        ? "border-primary bg-primary text-primary-fg"
                        : resolvido(item, posicao)
                          ? "border-primary-border bg-primary-soft text-primary-soft-fg"
                          : "border-border text-fg-subtle hover:border-border-strong hover:text-fg",
                    )}
                  >
                    {resolvido(item, posicao) && !atual ? (
                      <Check className="size-4" aria-hidden />
                    ) : (
                      posicao + 1
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="px-5 py-6 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            {passo.obrigatorio && <Badge tom="alerta">Obrigatório</Badge>}
            {passo.exigeAceite && aceito && <Badge tom="sucesso">Aceite registrado</Badge>}
            {!passo.exigeAceite && passo.vistoEm && <Badge>Você já leu este passo</Badge>}
          </div>

          <h2
            ref={titulo}
            tabIndex={-1}
            className={cn(
              "text-xl font-semibold text-balance text-fg sm:text-2xl",
              (passo.obrigatorio || passo.vistoEm || (passo.exigeAceite && aceito)) &&
                "mt-3",
            )}
          >
            {passo.titulo}
          </h2>

          <div className="mt-3 max-w-2xl space-y-3 text-[15px] leading-relaxed text-fg-muted">
            {paragrafos.map((trecho, posicao) => (
              <p key={posicao}>{trecho}</p>
            ))}
          </div>

          {passo.rotaAlvo && (
            <Link
              href={passo.rotaAlvo}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Ver em {rotuloDaRota(passo.rotaAlvo)}
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          )}

          {passo.exigeAceite &&
            (aceito ? (
              <div className="mt-5 flex items-start gap-3 rounded-md border border-border bg-success-soft p-4">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-fg">Aceite registrado</p>
                  <p className="mt-0.5 text-fg-muted">
                    {riscoAceitoEm
                      ? `Em ${FORMATO_DATA.format(new Date(riscoAceitoEm))}, na versão ${estadoAceite.versao ?? versaoRisco} deste aviso.`
                      : `Versão ${estadoAceite.versao ?? versaoRisco} deste aviso.`}{" "}
                    Se o texto for reescrito, pedimos o aceite de novo.
                  </p>
                </div>
              </div>
            ) : (
              <form
                action={enviarAceite}
                className="mt-5 space-y-3 rounded-md border border-warning bg-bg-subtle p-4"
              >
                {estadoAceite.erro && <Alerta tom="erro">{estadoAceite.erro}</Alerta>}

                <div className="flex items-start gap-3">
                  <input
                    id={idAceite}
                    type="checkbox"
                    name="aceite"
                    value="sim"
                    checked={marcado}
                    onChange={(evento) => setMarcado(evento.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <label htmlFor={idAceite} className="text-sm text-fg">
                    Li o aviso acima, entendi que o risco de restrição recai sobre a
                    minha conta do TikTok e quero continuar mesmo assim.
                  </label>
                </div>

                <Button type="submit" disabled={!marcado || enviandoAceite}>
                  {enviandoAceite ? "Registrando…" : "Registrar meu aceite"}
                </Button>

                <p className="text-xs text-fg-subtle">
                  O aceite fica registrado com data e com a versão {versaoRisco} deste
                  texto. O tour só segue depois dele — é o único passo obrigatório.
                </p>
              </form>
            ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-bg-subtle px-5 py-4 sm:px-6">
          <Link
            href="/inicio"
            className="text-sm font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
          >
            Pular o tour
          </Link>

          <div className="flex gap-2">
            <Button variante="secondary" onClick={voltar} disabled={indice === 0}>
              <ArrowLeft className="size-4" aria-hidden />
              Anterior
            </Button>

            {/* "Concluir" nao aparece em cima de um aceite pendente: se um dia o
                passo obrigatorio for reordenado para o fim, sair por aqui seria
                a saida de emergencia que esvazia o aceite. */}
            {indice === ultimo && !travadoNoAceite ? (
              <Link href="/inicio" className={CLASSE_BOTAO_LINK}>
                Concluir
                <Check className="size-4" aria-hidden />
              </Link>
            ) : (
              <Button onClick={avancar} disabled={travadoNoAceite || indice >= limite}>
                Próximo
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </Card>

      <p className="text-center text-xs text-fg-subtle">
        Use as setas ← e → para navegar. O progresso fica na sua conta, não no
        navegador: dá para sair agora e continuar amanhã, do celular.
      </p>
    </div>
  );
}
