import type { Metadata } from "next";
import Link from "next/link";
import {
  Ban,
  CircleCheck,
  CircleX,
  MonitorSmartphone,
  Puzzle,
  ShieldAlert,
} from "lucide-react";
import { esquecerInstalacaoAcao } from "./actions";
import { CaboVirtual } from "./cabo-virtual";
import { Faq } from "./faq";
import { Hero } from "./hero";
import { PainelLicenca } from "./instalacao";
import { PassoAPasso } from "./passo-a-passo";
import { Recursos } from "./recursos";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Indicador, type EstadoIndicador } from "@/components/ui/indicador";
import { Propriedade, Propriedades } from "@/components/ui/propriedades";
import { Cabecalho, Celula, Linha, Tabela } from "@/components/ui/tabela";
import {
  estadoExtensao,
  ticketDeDownload,
  type EstadoLicenca,
  type Instalacao,
  type RecursosExtensao,
} from "@/lib/dados/extensao";
import { resumoTour } from "@/lib/dados/onboarding";
import { exigirUsuario } from "@/lib/sessao";
import { numero } from "@/lib/utils";

export const metadata: Metadata = { title: "Extensão" };

const ROTULO_ESTADO: Record<EstadoLicenca, string> = {
  sem_licenca: "Sem licença",
  ativa: "Licença ativa",
  expirada: "Licença expirada",
  revogada: "Licença revogada",
};

const INDICADOR: Record<EstadoLicenca, EstadoIndicador> = {
  sem_licenca: "fora_do_ar",
  ativa: "no_ar",
  expirada: "pendente",
  revogada: "erro",
};

/** O que o PLANO libera — diferente do que a extensão faz, que está em Recursos. */
const DO_PLANO: { chave: keyof RecursosExtensao; rotulo: string; resumo: string }[] = [
  {
    chave: "mixer",
    rotulo: "Áudio no LIVE Studio",
    resumo: "Toca a montagem em laço e entrega a voz pelo cabo virtual.",
  },
  {
    chave: "chat",
    rotulo: "Respostas no chat",
    resumo: "Lê os comentários e responde com cadência humana.",
  },
  {
    chave: "camera_virtual",
    rotulo: "Câmera virtual",
    resumo: "Entrega a imagem da apresentadora como se fosse uma webcam.",
  },
  {
    chave: "sons_naturais",
    rotulo: "Sons naturais",
    resumo: "Ruído de ambiente para a live não soar sintética.",
  },
  {
    chave: "analise_live",
    rotulo: "Análise da live",
    resumo: "Manda para o painel o que aconteceu durante a transmissão.",
  },
];

function dataHora(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

function data(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

/** “há 3 min”, “em 4 dias”. Prazo em dias é o que o cliente lê nesta tela. */
function quando(iso: string) {
  const diferencaMs = new Date(iso).getTime() - Date.now();
  const formato = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const minutos = Math.round(diferencaMs / 60_000);

  if (Math.abs(minutos) < 60) return formato.format(minutos, "minute");
  const horas = Math.round(diferencaMs / 3_600_000);
  if (Math.abs(horas) < 48) return formato.format(horas, "hour");
  return formato.format(Math.round(diferencaMs / 86_400_000), "day");
}

/**
 * Cabeçalho de seção.
 *
 * A página virou documento longo — a maioria chega nela pelo celular, antes de
 * ir para o computador instalar. Um <h2> com âncora própria é o que deixa a
 * rolagem ter marcos e os links internos da página funcionarem.
 */
function Secao({
  id,
  titulo,
  descricao,
  children,
}: {
  id: string;
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="mt-10 scroll-mt-6">
      <h2 id={`${id}-titulo`} className="text-xl font-semibold sm:text-2xl">
        {titulo}
      </h2>
      {descricao && <p className="mt-1.5 max-w-2xl text-sm text-fg-muted">{descricao}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function ExtensaoPage() {
  const usuario = await exigirUsuario("/extensao");

  // Duas consultas independentes: o aceite do aviso de risco vive no tour, e é
  // ele que decide se a seção 7 chega gritando ou apenas presente.
  const [estado, tour] = await Promise.all([
    estadoExtensao(usuario.id),
    resumoTour(usuario.id),
  ]);

  const { licenca, versao, instalacoes } = estado;
  const estadoLicenca: EstadoLicenca = licenca?.estado ?? "sem_licenca";
  const temPacote = versao?.temPacote === true;

  // O ticket nasce no RENDER e vale 15 minutos: um `<a href>` não manda
  // cabeçalho, e o token da licença na URL ficaria no histórico e no log.
  const ticket = temPacote && versao ? ticketDeDownload(usuario.id, versao.versao) : null;

  const paradas = instalacoes.filter((i) => i.desligada);
  const desatualizadas = versao
    ? instalacoes.filter((i) => i.viva && i.versao !== versao.versao)
    : [];

  return (
    <>
      {paradas.length > 0 && (
        <Alerta tom="erro" className="mb-4">
          <strong>Desligamos a versão que você está rodando.</strong>{" "}
          {paradas[0]?.desligadaMotivo ??
            "A extensão foi parada remotamente por segurança."}{" "}
          Atualize para a {versao ? `v${versao.versao}` : "próxima versão publicada"} para
          voltar a operar.
        </Alerta>
      )}

      {estadoLicenca === "expirada" && (
        <Alerta tom="erro" className="mb-4">
          <strong>A janela offline acabou.</strong> A extensão parou de operar. A janela só
          é renovada enquanto a assinatura está ativa —{" "}
          <Link href="/planos" className="font-medium underline underline-offset-2">
            confira o seu plano
          </Link>
          .
        </Alerta>
      )}

      {estadoLicenca === "revogada" && (
        <Alerta tom="erro" className="mb-4">
          <strong>Licença revogada.</strong>{" "}
          {licenca?.revogadaMotivo ?? "Fale com o suporte para reativar."} Gerar um token
          novo reativa a licença.
        </Alerta>
      )}

      {estado.chatDesligadoNaBase && (
        <Alerta tom="info" className="mb-4">
          As respostas automáticas no chat estão desligadas para toda a base neste momento.
          O áudio no LIVE Studio continua funcionando normalmente.
        </Alerta>
      )}

      {/* 1 — Hero: selo da versão, o que a extensão faz e a área de download. */}
      <Hero versao={versao} temPacote={temPacote} ticket={ticket} />

      {/* 2 — O que a extensão faz, com o selo que a realidade permite. */}
      <Secao
        id="recursos"
        titulo="O que a extensão faz"
        descricao="Cada cartão diz em que pé está de verdade — nada aqui é marcado como pronto por otimismo."
      >
        <Recursos
          temPacote={temPacote}
          recursos={licenca?.recursos ?? null}
          chatDesligadoNaBase={estado.chatDesligadoNaBase}
        />
      </Secao>

      {/* 3 — Licença, plano e máquinas: o que já operava antes desta reescrita. */}
      <Secao
        id="licenca"
        titulo="Licença e instalações"
        descricao="O token que prova quem você é, o que o seu plano libera e as máquinas que já se apresentaram."
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitulo>Licença</CardTitulo>
                  <CardDescricao>
                    A extensão prova quem é apresentando um token. Guardamos só um resumo
                    criptográfico dele, como fazemos com a sua sessão.
                  </CardDescricao>
                </div>
                <Indicador
                  estado={INDICADOR[estadoLicenca]}
                  texto={ROTULO_ESTADO[estadoLicenca]}
                />
              </div>

              {licenca && (
                <Propriedades className="mt-4" colunas={2}>
                  <Propriedade
                    rotulo="Token"
                    valor={
                      licenca.dica ? (
                        <span className="font-[family-name:var(--font-mono)]">
                          shpx_…{licenca.dica}
                        </span>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <Propriedade
                    rotulo="Canal"
                    valor={licenca.canal === "canario" ? "Canário" : "Estável"}
                  />
                  <Propriedade
                    rotulo="Emitida em"
                    valor={data(licenca.emitidaEm)}
                    numerica
                  />
                  <Propriedade
                    rotulo="Rotacionada em"
                    valor={licenca.rotacionadaEm ? data(licenca.rotacionadaEm) : "Nunca"}
                    numerica
                  />
                  <Propriedade
                    rotulo="Janela offline"
                    valor={`${data(licenca.expiraEm)} (${quando(licenca.expiraEm)})`}
                    numerica
                  />
                  <Propriedade
                    rotulo="Contas TikTok"
                    valor={numero(licenca.recursos.contas_tiktok)}
                    numerica
                  />
                </Propriedades>
              )}

              <div className="mt-4">
                <PainelLicenca estado={estadoLicenca} demo={usuario.demo === true} />
              </div>

              {licenca && !estado.assinaturaAtiva && (
                <p className="mt-4 text-xs text-fg-subtle">
                  A janela offline é o quanto a extensão aguenta sem falar com a gente. Ela
                  é empurrada a cada contato{" "}
                  <strong>enquanto houver assinatura ativa</strong>; sem assinatura, ela
                  corre até o fim e a extensão para.
                </p>
              )}
            </Card>

            <Card>
              <CardTitulo>Recursos liberados</CardTitulo>
              <CardDescricao>
                O retrato do plano no momento em que o token foi emitido. Mudar de plano
                exige gerar um token novo para a extensão enxergar a diferença.
              </CardDescricao>

              {licenca ? (
                <ul className="mt-4 space-y-2.5">
                  {DO_PLANO.map((recurso) => {
                    const ligadoNoPlano = licenca.recursos[recurso.chave] === true;
                    // O chat morre por conta (`ext_licencas.chat`) ou na base
                    // inteira (`ext.chat_desligado`) sem derrubar o áudio junto.
                    const ligado =
                      recurso.chave === "chat"
                        ? ligadoNoPlano && licenca.chat && !estado.chatDesligadoNaBase
                        : ligadoNoPlano;

                    return (
                      <li key={recurso.chave} className="flex gap-3">
                        {ligado ? (
                          <CircleCheck
                            className="mt-0.5 size-4 shrink-0 text-success"
                            aria-hidden
                          />
                        ) : (
                          <CircleX
                            className="mt-0.5 size-4 shrink-0 text-fg-subtle"
                            aria-hidden
                          />
                        )}
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-fg">
                            {recurso.rotulo}
                            <span className="sr-only">
                              {ligado ? " — liberado" : " — não liberado"}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-sm text-fg-muted">
                            {recurso.resumo}
                            {recurso.chave === "chat" &&
                              ligadoNoPlano &&
                              estado.chatDesligadoNaBase &&
                              " Desligado para toda a base agora."}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-fg-muted">
                  Gere o token acima para ver o que o seu plano libera.
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tom={licenca?.recursos.plano ? "marca" : "neutro"}>
                  {usuario.plano ?? "Sem plano"}
                </Badge>
                <Link
                  href="/planos"
                  className="text-sm text-fg-muted underline-offset-4 hover:text-primary hover:underline"
                >
                  Comparar planos
                </Link>
              </div>
            </Card>

            <Card id="instalacoes" className="scroll-mt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitulo>Suas máquinas</CardTitulo>
                  <CardDescricao>
                    Cada instalação se apresenta a cada{" "}
                    <span className="num">{estado.heartbeatSegundos}</span> segundos. É
                    esse contato que nos deixa avisar de uma quebra antes de você perceber.
                  </CardDescricao>
                </div>
                {desatualizadas.length > 0 && (
                  <Badge tom="alerta">
                    <span className="num">{desatualizadas.length}</span> desatualizada
                    {desatualizadas.length > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>

              <div className="mt-4">
                {instalacoes.length === 0 ? (
                  <EstadoVazio
                    icone={MonitorSmartphone}
                    titulo="Nenhuma máquina conectada"
                    texto="Depois de instalar a extensão e colar o token, a máquina aparece aqui em até dois minutos."
                  />
                ) : (
                  <TabelaInstalacoes
                    instalacoes={instalacoes}
                    versaoPublicada={versao?.versao ?? null}
                    demo={usuario.demo === true}
                  />
                )}
              </div>
            </Card>
          </div>

          <Card className="lg:sticky lg:top-6">
            <CardTitulo>Mapa de seletores</CardTitulo>
            <CardDescricao>
              A extensão não traz os pontos de ancoragem do TikTok compilados dentro dela:
              busca o mapa no servidor. Quando o TikTok muda o layout, o conserto vai ao ar
              em minutos, sem reinstalação.
            </CardDescricao>
            <Propriedades className="mt-3">
              <Propriedade
                rotulo="Versão no ar"
                valor={estado.mapaVersao !== null ? `#${estado.mapaVersao}` : "Nenhum"}
                numerica
              />
            </Propriedades>
          </Card>
        </div>
      </Secao>

      {/* 4 — Instalação passo a passo. */}
      <Secao
        id="instalacao"
        titulo="Passo a passo da instalação"
        descricao="Do arquivo baixado até a conta conectada. Leva uns dez minutos na primeira vez."
      >
        <Card>
          <PassoAPasso temPacote={temPacote} />
        </Card>
      </Secao>

      {/* 5 — A seção que mais gera dúvida. */}
      <Secao
        id="cabo-virtual"
        titulo="Cabo virtual e LIVE Studio"
        descricao="É a peça que leva a voz da Shopia até a transmissão. Funciona com ou sem a extensão instalada."
      >
        <Card>
          <CaboVirtual />
        </Card>
      </Secao>

      {/* 6 — Perguntas frequentes. */}
      <Secao id="faq" titulo="Perguntas frequentes">
        <Faq />
      </Secao>

      {/* 7 — Aviso de risco. Nunca no rodapé, nunca em letra miúda. */}
      <Secao id="risco" titulo="Antes de automatizar: o risco é seu">
        <AvisoDeRisco aceito={tour.riscoEmDia} />
      </Secao>
    </>
  );
}

/**
 * O aviso que não pode ser encontrado por acaso.
 *
 * Sem aceite registrado ele chega com peso de erro, porque é informação que
 * muda a decisão de usar o produto e precisa ser lida ANTES da primeira live,
 * não depois do primeiro bloqueio. Com aceite, continua visível — some da tela
 * só o que o cliente já leu e assinou, e isso aqui não some.
 */
function AvisoDeRisco({ aceito }: { aceito: boolean }) {
  return (
    <div
      className={
        aceito
          ? "rounded-lg border border-border bg-bg-subtle p-5 sm:p-6"
          : "rounded-lg border-2 border-danger bg-danger-soft p-5 sm:p-6"
      }
    >
      <div className="flex gap-3">
        <ShieldAlert
          className={`mt-0.5 size-5 shrink-0 ${aceito ? "text-fg-subtle" : "text-danger"}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={`text-base font-semibold ${aceito ? "text-fg" : "text-danger"}`}
            >
              Automatizar o LIVE Studio pode custar a sua conta do TikTok
            </h3>
            {aceito && <Badge tom="sucesso">Aceite registrado</Badge>}
          </div>

          <p className="mt-2 text-sm text-fg-muted">
            Não existe modo oficial de automatizar o LIVE Studio. Fazer isso tende a violar
            os Termos de Serviço do TikTok, e a consequência — restrição de alcance,
            suspensão da live ou bloqueio da conta — recai sobre{" "}
            <strong className="font-semibold text-fg">a sua conta</strong>, não sobre a
            Shopia. Não temos como recorrer por você nem como devolver uma conta bloqueada.
          </p>

          <p className="mt-2.5 text-sm text-fg-muted">
            A gente reduz o que dá para reduzir: cadência variável no chat em vez de rajada,
            áudio e chat em módulos separados para você desligar um sem perder o outro, e
            um botão de parar que não depende de nós. Reduzir não é eliminar, e quem decide
            correr o risco é você, sabendo disto.
          </p>

          {!aceito && (
            <>
              <p className="mt-3 text-sm font-medium text-danger">
                O seu aceite ainda não está registrado.
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                Leia o texto completo e registre o aceite — fica gravado com data e versão,
                para você e para a gente.
              </p>
              {/* Link estilizado, e não <Button> dentro de <Link>: âncora com
                  botão dentro é interativo aninhado, e o teclado para em dois. */}
              <Link
                href="/bem-vindo"
                className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-md bg-danger px-4 text-sm font-medium text-fg-inverse transition-[filter] duration-[--dur-fast] hover:brightness-110 sm:w-auto"
              >
                Ler o aviso e registrar o aceite
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TabelaInstalacoes({
  instalacoes,
  versaoPublicada,
  demo,
}: {
  instalacoes: Instalacao[];
  versaoPublicada: string | null;
  demo: boolean;
}) {
  return (
    <>
      <Tabela
        rotulo="Instalações da extensão"
        cabecalho={
          <Cabecalho
            colunas={[
              "Máquina",
              "Versão",
              "Último contato",
              { rotulo: "Ação", className: "text-right" },
            ]}
          />
        }
      >
        {instalacoes.map((instalacao) => (
          <Linha key={instalacao.id}>
            <Celula linha quebrar>
              <span className="block">{instalacao.sistema ?? "Sistema não informado"}</span>
              <span className="mt-0.5 block text-xs font-normal text-fg-subtle">
                {instalacao.navegador ?? "Navegador não informado"}
              </span>
            </Celula>

            <Celula>
              <span className="num">v{instalacao.versao}</span>
              {instalacao.desligada ? (
                <Badge tom="perigo" className="ml-2">
                  <Ban className="mr-1 size-3" aria-hidden />
                  Desligada
                </Badge>
              ) : !instalacao.conhecida ? (
                <Badge
                  tom="alerta"
                  className="ml-2"
                  title="Instalada em modo desenvolvedor"
                >
                  Fora do catálogo
                </Badge>
              ) : versaoPublicada && instalacao.versao !== versaoPublicada ? (
                <Badge tom="alerta" className="ml-2">
                  Desatualizada
                </Badge>
              ) : null}
            </Celula>

            <Celula>
              <Indicador
                estado={instalacao.viva ? "no_ar" : "fora_do_ar"}
                texto={quando(instalacao.ultimoContato)}
              />
              <span className="sr-only">{dataHora(instalacao.ultimoContato)}</span>
            </Celula>

            <Celula className="text-right">
              <form action={esquecerInstalacaoAcao} className="inline">
                <input type="hidden" name="instalacao" value={instalacao.id} />
                <Button
                  type="submit"
                  variante="ghost"
                  tamanho="sm"
                  disabled={demo}
                  aria-label={`Esquecer a máquina ${instalacao.sistema ?? instalacao.chave}`}
                >
                  Esquecer
                </Button>
              </form>
            </Celula>
          </Linha>
        ))}
      </Tabela>

      <p className="mt-3 text-xs text-fg-subtle">
        <Puzzle className="mr-1 inline size-3" aria-hidden />
        Esquecer só limpa a lista. Uma máquina que ainda roda a extensão volta a aparecer no
        próximo contato — use para a máquina que você não usa mais.
      </p>
    </>
  );
}
