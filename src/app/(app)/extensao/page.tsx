import type { Metadata } from "next";
import Link from "next/link";
import {
  Ban,
  CircleCheck,
  CircleX,
  Download,
  MonitorSmartphone,
  PackageOpen,
  Puzzle,
  Wrench,
} from "lucide-react";
import { esquecerInstalacaoAcao } from "./actions";
import { PainelLicenca, PassosInstalacao } from "./instalacao";
import { PageHeader } from "@/components/layout/page-header";
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

/** Os recursos na ordem em que o cliente pensa neles. */
const RECURSOS: { chave: keyof RecursosExtensao; rotulo: string; resumo: string }[] = [
  {
    chave: "mixer",
    rotulo: "Mixer de áudio",
    resumo: "Cria a saída virtual e toca o loop dentro do LIVE Studio.",
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

/** "há 3 min", "em 4 dias". Prazo em dias é o que o cliente lê nesta tela. */
function quando(iso: string) {
  const diferencaMs = new Date(iso).getTime() - Date.now();
  const formato = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const minutos = Math.round(diferencaMs / 60_000);

  if (Math.abs(minutos) < 60) return formato.format(minutos, "minute");
  const horas = Math.round(diferencaMs / 3_600_000);
  if (Math.abs(horas) < 48) return formato.format(horas, "hour");
  return formato.format(Math.round(diferencaMs / 86_400_000), "day");
}

export default async function ExtensaoPage() {
  const usuario = await exigirUsuario("/extensao");
  const estado = await estadoExtensao(usuario.id);

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
      <PageHeader
        titulo="Extensão"
        descricao="É ela que joga o áudio no LIVE Studio e responde o chat. Aqui ficam a licença, o pacote e o passo a passo da instalação."
        acoes={
          versao ? (
            <Badge tom="marca">
              <span className="num">v{versao.versao}</span>
              {versao.canal === "canario" && " · canário"}
            </Badge>
          ) : (
            <Badge>Sem versão publicada</Badge>
          )
        }
      />

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
          <strong>A janela offline acabou.</strong> A extensão parou de operar. A janela
          só é renovada enquanto a assinatura está ativa —{" "}
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
          As respostas automáticas no chat estão desligadas para toda a base neste
          momento. O mixer de áudio continua funcionando normalmente.
        </Alerta>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitulo>Licença</CardTitulo>
                <CardDescricao>
                  A extensão prova quem é apresentando um token. Guardamos só um
                  resumo criptográfico dele, como fazemos com a sua sessão.
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
                <Propriedade rotulo="Emitida em" valor={data(licenca.emitidaEm)} numerica />
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
                é empurrada a cada contato <strong>enquanto houver assinatura ativa</strong>
                ; sem assinatura, ela corre até o fim e a extensão para.
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
                {RECURSOS.map((recurso) => {
                  const ligadoNoPlano = licenca.recursos[recurso.chave] === true;
                  // O chat morre por conta (`ext_licencas.chat`) ou na base
                  // inteira (`ext.chat_desligado`) sem derrubar o mixer junto.
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

          <Card>
            <CardTitulo>Instalação</CardTitulo>
            <CardDescricao>
              O caminho muda entre Windows e Mac no meio do processo. Escolha o seu.
            </CardDescricao>
            <div className="mt-4">
              <PassosInstalacao temPacote={temPacote} />
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitulo>Suas máquinas</CardTitulo>
                <CardDescricao>
                  Cada instalação se apresenta a cada{" "}
                  <span className="num">{estado.heartbeatSegundos}</span> segundos. É
                  esse contato que nos deixa avisar de uma quebra antes de você
                  perceber.
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

        <div className="space-y-4">
          <Card>
            <CardTitulo>Pacote</CardTitulo>

            {versao ? (
              <>
                <Propriedades className="mt-3">
                  <Propriedade rotulo="Versão" valor={`v${versao.versao}`} numerica />
                  <Propriedade
                    rotulo="Canal"
                    valor={versao.canal === "canario" ? "Canário" : "Estável"}
                  />
                  {versao.publicadaEm && (
                    <Propriedade
                      rotulo="Publicada em"
                      valor={data(versao.publicadaEm)}
                      numerica
                    />
                  )}
                </Propriedades>

                {versao.notas && (
                  <p className="mt-3 text-sm text-fg-muted">{versao.notas}</p>
                )}

                {versao.obrigatoria && (
                  <Alerta tom="info" className="mt-3">
                    Atualização obrigatória: versões anteriores param de operar.
                  </Alerta>
                )}

                <div className="mt-4">
                  {!temPacote ? (
                    // Honestidade acima de conveniência: um botão que baixa nada
                    // é pior do que não ter botão.
                    <Alerta tom="info">
                      O arquivo desta versão ainda não está disponível para download.
                      Assim que o pacote for publicado, o botão aparece aqui.
                    </Alerta>
                  ) : ticket ? (
                    <a
                      href={`/api/ext/baixar?t=${encodeURIComponent(ticket)}`}
                      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg shadow-sm transition-colors duration-[--dur-fast] hover:bg-primary-hover"
                    >
                      <Download className="size-4" aria-hidden />
                      Baixar v{versao.versao}
                    </a>
                  ) : (
                    <>
                      <Button bloco disabled>
                        <Download className="size-4" aria-hidden />
                        Baixar v{versao.versao}
                      </Button>
                      <Alerta tom="info" className="mt-2">
                        O download pelo navegador precisa de{" "}
                        <code className="font-[family-name:var(--font-mono)] text-xs">
                          EXTENSAO_SEGREDO
                        </code>{" "}
                        no ambiente — é ele que assina o link temporário. Sem essa
                        variável, o botão fica desligado em vez de servir um arquivo
                        sem nenhuma prova de quem pediu.
                      </Alerta>
                    </>
                  )}
                </div>
              </>
            ) : (
              <EstadoVazio
                icone={PackageOpen}
                titulo="Nenhuma versão publicada"
                texto="O pacote da extensão ainda não foi publicado. Não há nada para baixar até lá — e preferimos dizer isso a oferecer um botão que não faz nada."
                className="mt-3 border-0 px-0 py-6"
              />
            )}
          </Card>

          <Card>
            <CardTitulo>Mapa de seletores</CardTitulo>
            <CardDescricao>
              A extensão não traz os pontos de ancoragem do TikTok compilados dentro
              dela: busca o mapa no servidor. Quando o TikTok muda o layout, o conserto
              vai ao ar em minutos, sem reinstalação.
            </CardDescricao>
            <Propriedades className="mt-3">
              <Propriedade
                rotulo="Versão no ar"
                valor={estado.mapaVersao !== null ? `#${estado.mapaVersao}` : "Nenhum"}
                numerica
              />
            </Propriedades>
          </Card>

          <Card className="bg-bg-subtle shadow-none">
            <div className="flex gap-3">
              <Wrench className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
              <p className="text-sm text-fg-muted">
                Automatizar ações na sua conta contraria os Termos do TikTok, e o risco
                de bloqueio é seu. O mixer de áudio e as respostas no chat são recursos
                separados justamente para você poder desligar o segundo sem perder o
                primeiro.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
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
                <Badge tom="alerta" className="ml-2" title="Instalada em modo desenvolvedor">
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
        Esquecer só limpa a lista. Uma máquina que ainda roda a extensão volta a aparecer
        no próximo contato — use para a máquina que você não usa mais.
      </p>
    </>
  );
}
