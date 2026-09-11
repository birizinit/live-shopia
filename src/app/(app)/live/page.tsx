import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheckBig, CircleDashed, Puzzle, Radio } from "lucide-react";
import {
  AvisoDeRisco,
  ConfiguracaoDaLive,
  ContasDoTikTok,
  Transmissao,
} from "./controle";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Indicador, type EstadoIndicador } from "@/components/ui/indicador";
import { Propriedade, Propriedades } from "@/components/ui/propriedades";
import { Cabecalho, Celula, Linha, Tabela } from "@/components/ui/tabela";
import { formatarDuracao } from "@/lib/caracteres";
import { minutosDesde, salaLive, type SessaoLive } from "@/lib/dados/live";
import { exigirUsuario } from "@/lib/sessao";
import { numero } from "@/lib/utils";

export const metadata: Metadata = { title: "Live IA" };

const FUSO = "America/Sao_Paulo";

function hora(instante: string) {
  return new Date(instante).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FUSO,
  });
}

function dataHora(instante: string) {
  return new Date(instante).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FUSO,
  });
}

const ROTULO_ESTADO: Record<SessaoLive["estado"], string> = {
  iniciando: "Aguardando a extensão",
  ativa: "No ar",
  caiu: "Caiu",
  encerrada: "Encerrada",
};

function indicadorDa(sessao: SessaoLive | null): { estado: EstadoIndicador; texto: string } {
  if (!sessao) return { estado: "fora_do_ar", texto: "Fora do ar" };
  if (sessao.erro) return { estado: "erro", texto: "Com erro" };
  if (sessao.estado === "ativa") return { estado: "no_ar", texto: "No ar" };
  return { estado: "pendente", texto: ROTULO_ESTADO[sessao.estado] };
}

export default async function LivePage() {
  const usuario = await exigirUsuario("/live");
  const sala = await salaLive(usuario.id);

  const { sessao, config, extensao } = sala;
  const marcador = indicadorDa(sessao);
  const contaEmUso = sala.contas.find((conta) => conta.id === config.contaId) ?? null;
  const montagemEmUso = sala.montagens.find((m) => m.id === config.montagemId) ?? null;
  const pendencias = sala.checklist.filter((item) => !item.ok);
  const contatoMinutos = minutosDesde(extensao.ultimoContato);

  return (
    <>
      <PageHeader
        titulo="Live IA"
        descricao="A apresentadora narra a montagem em laço e responde o chat com cadência humana."
        acoes={
          <>
            <Indicador estado={marcador.estado} texto={marcador.texto} className="self-center" />
            <Link
              href="/painel"
              className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
            >
              Painel ao vivo
            </Link>
          </>
        }
      />

      {usuario.demo && (
        <Alerta tom="info" className="mb-4">
          Modo demonstração: tudo abaixo é exemplo, nada é gravado e nenhuma live
          sobe de verdade.
        </Alerta>
      )}

      <div className="space-y-4">
        <AvisoDeRisco
          pendente={sala.riscoPendente}
          aceitoEm={config.riscoAceitoEm}
          versao={sala.versaoRisco}
        />

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-4">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitulo>Transmissão</CardTitulo>
                  <CardDescricao>
                    Subir a live abre a sessão aqui; quem entra no ar de fato é a
                    extensão, dentro do LIVE Studio.
                  </CardDescricao>
                </div>
                <Indicador estado={marcador.estado} texto={marcador.texto} />
              </div>

              <Propriedades className="mt-4">
                <Propriedade
                  rotulo="Conta"
                  valor={
                    contaEmUso ? (
                      <span className="font-[family-name:var(--font-mono)]">
                        @{contaEmUso.usuario}
                      </span>
                    ) : (
                      "Nenhuma escolhida"
                    )
                  }
                />
                <Propriedade
                  rotulo="Montagem"
                  valor={montagemEmUso ? montagemEmUso.nome : "Nenhuma escolhida"}
                />
                <Propriedade
                  rotulo="Duração do laço"
                  numerica
                  valor={montagemEmUso ? formatarDuracao(montagemEmUso.duracaoMs) : "—"}
                />
                {sessao && (
                  <>
                    <Propriedade rotulo="No ar desde" numerica valor={hora(sessao.inicio)} />
                    <Propriedade
                      rotulo="Pico de espectadores"
                      numerica
                      valor={numero(sessao.espectadoresPico)}
                    />
                    <Propriedade
                      rotulo="Último sinal da extensão"
                      valor={
                        minutosDesde(sessao.vistoEm) === 0
                          ? "agora há pouco"
                          : `há ${numero(minutosDesde(sessao.vistoEm) ?? 0)} min`
                      }
                    />
                  </>
                )}
              </Propriedades>

              {sessao?.erro && (
                <Alerta tom="erro" className="mt-4">
                  {sessao.erro}
                </Alerta>
              )}

              <div className="mt-5 space-y-3">
                <Transmissao
                  sessao={sessao}
                  contaId={config.contaId}
                  montagemId={config.montagemId}
                  bloqueios={pendencias.map((item) => item.rotulo.toLowerCase())}
                />
              </div>
            </Card>

            <ContasDoTikTok
              contas={sala.contas}
              contaAtivaId={config.contaId}
              limite={sala.limiteContas}
            />

            <ConfiguracaoDaLive
              config={config}
              contas={sala.contas}
              vozes={sala.vozes}
              montagens={sala.montagens}
            />

            <Card>
              <CardTitulo>Últimas transmissões</CardTitulo>
              {sala.historico.length === 0 ? (
                <EstadoVazio
                  className="mt-4"
                  icone={Radio}
                  titulo="Nenhuma live encerrada ainda"
                  texto="Quando a primeira transmissão terminar, ela aparece aqui com pico de espectadores e duração."
                />
              ) : (
                <Tabela
                  className="mt-4"
                  rotulo="Últimas transmissões"
                  cabecalho={
                    <Cabecalho
                      colunas={[
                        "Início",
                        "Estado",
                        { rotulo: "Duração", numerica: true },
                        { rotulo: "Pico", numerica: true },
                      ]}
                    />
                  }
                >
                  {sala.historico.map((antiga) => (
                    <Linha key={antiga.id}>
                      <Celula linha>{dataHora(antiga.inicio)}</Celula>
                      <Celula>
                        <Badge tom={antiga.estado === "caiu" ? "alerta" : "neutro"}>
                          {ROTULO_ESTADO[antiga.estado]}
                        </Badge>
                      </Celula>
                      <Celula numerica>
                        {antiga.fim
                          ? formatarDuracao(
                              new Date(antiga.fim).getTime() - new Date(antiga.inicio).getTime(),
                            )
                          : "—"}
                      </Celula>
                      <Celula numerica>{numero(antiga.espectadoresPico)}</Celula>
                    </Linha>
                  ))}
                </Tabela>
              )}
            </Card>
          </div>

          <aside className="min-w-0 space-y-4">
            <Card>
              <div className="flex items-center justify-between gap-3">
                <CardTitulo>Antes de subir</CardTitulo>
                <Badge tom={pendencias.length === 0 ? "sucesso" : "alerta"}>
                  <span className="num">
                    {sala.checklist.length - pendencias.length} de {sala.checklist.length}
                  </span>
                </Badge>
              </div>

              <ul className="mt-4 space-y-3">
                {sala.checklist.map((item) => (
                  <li key={item.chave} className="flex gap-3">
                    {item.ok ? (
                      <CircleCheckBig className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    ) : (
                      <CircleDashed className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {item.rotulo}
                        <span className="sr-only">{item.ok ? " — pronto" : " — pendente"}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-fg-muted">{item.detalhe}</p>
                      {!item.ok && item.href !== "/live" && (
                        <Link
                          href={item.href}
                          className="mt-1 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
                        >
                          Ir para {item.rotuloHref}
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <div className="flex items-center justify-between gap-3">
                <CardTitulo>Extensão</CardTitulo>
                <Puzzle className="size-4 text-fg-subtle" aria-hidden />
              </div>
              <CardDescricao>
                É ela que toca o áudio no LIVE Studio e lê o chat. Sem sinal dela,
                a live não existe do lado do TikTok.
              </CardDescricao>

              <Propriedades className="mt-3">
                <Propriedade
                  rotulo="Licença"
                  valor={
                    extensao.licenciada ? (
                      <Badge tom="sucesso">Ativa</Badge>
                    ) : (
                      <Badge tom="perigo">Sem licença</Badge>
                    )
                  }
                />
                <Propriedade
                  rotulo="Último contato"
                  valor={
                    contatoMinutos === null
                      ? "Nunca"
                      : contatoMinutos === 0
                        ? "agora há pouco"
                        : `há ${numero(contatoMinutos)} min`
                  }
                />
                <Propriedade rotulo="Versão" valor={extensao.versao ?? "—"} />
                <Propriedade
                  rotulo="Instalações"
                  numerica
                  valor={numero(extensao.instalacoes)}
                />
              </Propriedades>

              {extensao.chatDesligadoNaBase && (
                <Alerta tom="info" className="mt-3">
                  A automação de chat está desligada para toda a base agora. O
                  mixer de áudio continua funcionando.
                </Alerta>
              )}

              <Link
                href="/extensao"
                className="mt-4 inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
              >
                Abrir a extensão
              </Link>
            </Card>
          </aside>
        </div>
      </div>
    </>
  );
}
