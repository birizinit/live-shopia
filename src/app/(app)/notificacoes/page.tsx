import type { Metadata } from "next";
import { MonitorSmartphone } from "lucide-react";
import { BotaoEsquecer, FormPreferencias, Inscricao } from "./inscricao";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { inscricoesDe, preferenciasDe, LIMIAR_MAXIMO } from "@/lib/dados/push";
import { env, servicos } from "@/lib/env";
import { exigirUsuario } from "@/lib/sessao";
import { numero } from "@/lib/utils";

export const metadata: Metadata = { title: "Notificações" };

const FUSO = "America/Sao_Paulo";

/** Fuso fixo: o servidor roda em UTC e "ontem às 22h" viraria hoje. */
const DIA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: FUSO,
});

const DIA_E_HORA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: FUSO,
});

export default async function NotificacoesPage() {
  const usuario = await exigirUsuario("/notificacoes");

  const [preferencias, inscricoes] = await Promise.all([
    preferenciasDe(usuario.id),
    inscricoesDe(usuario.id),
  ]);

  const ligado = servicos.push;
  const faltando = [
    env.vapidPublica ? null : "VAPID_PUBLIC_KEY",
    env.vapidPrivada ? null : "VAPID_PRIVATE_KEY",
  ].filter((chave): chave is string => chave !== null);

  return (
    <>
      <PageHeader
        titulo="Notificações"
        descricao="Venda fechada, live que caiu e crédito no fim — no celular, sem depender de você estar com o painel aberto."
        acoes={
          ligado ? (
            <Badge tom="sucesso">Push configurado</Badge>
          ) : (
            <Badge tom="alerta">Push desligado</Badge>
          )
        }
      />

      {!ligado && (
        <Alerta tom="info" className="mb-4">
          O push não está configurado neste servidor
          {faltando.length > 0 && (
            <>
              {" "}
              (falta{faltando.length > 1 ? "m" : ""}{" "}
              <code className="font-[family-name:var(--font-mono)] text-xs">
                {faltando.join(" e ")}
              </code>
              )
            </>
          )}
          . Sem as chaves VAPID nenhum aviso sai daqui, então o botão de ativar
          fica desligado — pedir a permissão do navegador à toa gastaria a
          única chance de pedir. As preferências abaixo continuam valendo para
          quando as chaves entrarem.
        </Alerta>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitulo>Este navegador</CardTitulo>
          <CardDescricao>
            A permissão é por aparelho e por navegador. Ligar aqui não liga no
            celular — e é isso que a lista de baixo mostra.
          </CardDescricao>
          <div className="mt-4">
            <Inscricao
              chaveVapid={ligado ? env.vapidPublica : null}
              demo={Boolean(usuario.demo)}
              marcas={inscricoes.map((inscricao) => inscricao.marca)}
            />
          </div>
        </Card>

        <Card>
          <CardTitulo>O que vale um aviso</CardTitulo>
          <CardDescricao>
            Vale para todos os seus aparelhos. Saldo de agora:{" "}
            <span className="num font-medium text-fg">{numero(usuario.creditos)}</span>{" "}
            caracteres.
          </CardDescricao>
          <div className="mt-4">
            <FormPreferencias
              inicial={preferencias}
              ligado={ligado}
              limiarMaximo={LIMIAR_MAXIMO}
            />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardTitulo>Aparelhos inscritos</CardTitulo>
          <CardDescricao>
            Cada navegador entra uma vez só: a inscrição é identificada pelo
            endereço que o serviço de push emite, então reativar no mesmo
            aparelho atualiza a linha em vez de criar outra.
          </CardDescricao>

          {inscricoes.length === 0 ? (
            <EstadoVazio
              className="mt-4"
              icone={MonitorSmartphone}
              titulo="Nenhum aparelho inscrito"
              texto="Ative as notificações neste navegador — ou abra a Shopia no celular e ative por lá — para o aparelho aparecer aqui."
            />
          ) : (
            <ul className="mt-4">
              {inscricoes.map((inscricao) => (
                <li
                  key={inscricao.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-3 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {inscricao.navegador}
                      {!inscricao.ativa && (
                        <Badge tom="alerta">Não responde mais</Badge>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      Inscrito em{" "}
                      <span className="num">
                        {DIA.format(new Date(inscricao.criadoEm))}
                      </span>
                      {" · "}
                      {inscricao.ultimoEnvioEm ? (
                        <>
                          último aviso em{" "}
                          <span className="num">
                            {DIA_E_HORA.format(new Date(inscricao.ultimoEnvioEm))}
                          </span>
                        </>
                      ) : (
                        "ainda sem nenhum aviso"
                      )}
                    </p>
                  </div>
                  <BotaoEsquecer id={inscricao.id} nome={inscricao.navegador} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
