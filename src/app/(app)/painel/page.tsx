import type { Metadata } from "next";
import Link from "next/link";
import { Radio } from "lucide-react";
import { ConsoleAoVivo, KillSwitch } from "./console";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Indicador } from "@/components/ui/indicador";
import { Propriedade, Propriedades } from "@/components/ui/propriedades";
import { consoleLive, minutosDesde } from "@/lib/dados/live";
import { exigirUsuario } from "@/lib/sessao";
import { numero } from "@/lib/utils";

export const metadata: Metadata = { title: "Painel ao vivo" };

export default async function PainelPage() {
  const usuario = await exigirUsuario("/painel");
  const { sessao, conta, cadencia, eventos, extensao } = await consoleLive(usuario.id);

  const contatoMinutos = minutosDesde(extensao.ultimoContato);
  const contatoTexto =
    contatoMinutos === null
      ? "Nunca"
      : contatoMinutos === 0
        ? "agora há pouco"
        : `há ${numero(contatoMinutos)} min`;

  return (
    <>
      <PageHeader
        titulo="Painel ao vivo"
        descricao="O que está acontecendo na transmissão agora: o chat que chega e o que a Shopia respondeu."
        acoes={
          <>
            <Indicador
              estado={sessao?.estado === "ativa" ? "no_ar" : sessao ? "pendente" : "fora_do_ar"}
              texto={
                sessao?.estado === "ativa"
                  ? "No ar"
                  : sessao
                    ? "Aguardando a extensão"
                    : "Fora do ar"
              }
              className="self-center"
            />
            <Link
              href="/live"
              className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
            >
              Sala de live
            </Link>
          </>
        }
      />

      {usuario.demo && (
        <Alerta tom="info" className="mb-4">
          Modo demonstração: os eventos abaixo são um exemplo gravado. Sem banco
          não há LISTEN/NOTIFY, então o fluxo ao vivo não abre — e fingir que
          abriu seria mentir sobre o que a tela faz.
        </Alerta>
      )}

      <div className="space-y-4">
        {sessao ? (
          <ConsoleAoVivo
            sessao={{
              id: sessao.id,
              estado: sessao.estado,
              inicio: sessao.inicio,
              vistoEm: sessao.vistoEm,
              espectadoresPico: sessao.espectadoresPico,
              fim: sessao.fim,
            }}
            eventos={eventos}
          />
        ) : (
          <Card>
            <EstadoVazio
              icone={Radio}
              titulo="Nenhuma live no ar"
              texto="O console acende quando a sessão abre. Até lá, revise o manual e deixe o kill switch à mão."
              acao={
                <Link
                  href="/live"
                  className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
                >
                  Ir para a sala de live
                </Link>
              }
              className="border-0"
            />
          </Card>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitulo>Cadência em uso</CardTitulo>
            <CardDescricao>
              Resposta instantânea e constante é o que denuncia automação. Estes
              números são a diferença entre parecer gente e parecer robô.
            </CardDescricao>

            <Propriedades className="mt-3">
              <Propriedade
                rotulo="Responder o chat"
                valor={
                  cadencia.responderChat ? (
                    <Badge tom="sucesso">Ligado</Badge>
                  ) : (
                    <Badge>Desligado</Badge>
                  )
                }
              />
              <Propriedade
                rotulo="Saudar quem entra"
                valor={
                  cadencia.saudarEntrada ? (
                    <Badge tom="sucesso">Ligado</Badge>
                  ) : (
                    <Badge>Desligado</Badge>
                  )
                }
              />
              <Propriedade
                rotulo="Espera entre respostas"
                numerica
                valor={`${cadencia.intervaloMinS}s – ${cadencia.intervaloMaxS}s`}
              />
              <Propriedade
                rotulo="Teto por minuto"
                numerica
                valor={numero(cadencia.tetoPorMinuto)}
              />
              <Propriedade
                rotulo="Conta"
                valor={
                  conta ? (
                    <span className="font-[family-name:var(--font-mono)]">
                      @{conta.usuario}
                    </span>
                  ) : (
                    "Nenhuma escolhida"
                  )
                }
              />
            </Propriedades>

            <Link
              href="/live"
              className="mt-4 inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
            >
              Ajustar a cadência
            </Link>
          </Card>

          <KillSwitch
            licenciada={extensao.licenciada}
            chatInicial={extensao.chat}
            chatDesligadoNaBase={extensao.chatDesligadoNaBase}
            contatoTexto={contatoTexto}
            versao={extensao.versao}
            temSessao={sessao !== null}
          />
        </div>
      </div>
    </>
  );
}
