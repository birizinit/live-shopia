"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  CircleStop,
  Link2Off,
  Plus,
  Radio,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import {
  aceitarRiscoAcao,
  desvincularContaAcao,
  iniciarLiveAcao,
  pararLiveAcao,
  salvarConfiguracaoAcao,
  vincularContaAcao,
  type EstadoAcao,
} from "./actions";
import { Alerta } from "@/components/ui/alerta";
import { useAvisos } from "@/components/ui/avisos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { ConfirmarAcao } from "@/components/ui/confirmar-acao";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Campo, Input } from "@/components/ui/input";
import { Interruptor } from "@/components/ui/interruptor";
import { Selecao, type OpcaoSelecao } from "@/components/ui/selecao";
import type {
  ConfigLive,
  ContaTikTok,
  MontagemOpcao,
  SessaoLive,
  VozOpcao,
} from "@/lib/dados/live";
import { formatarDuracao } from "@/lib/caracteres";

const INICIAL: EstadoAcao = {};

/**
 * Limites da cadencia repetidos aqui de proposito.
 *
 * `@/lib/dados/live` e `server-only`: importar a constante de la arrastaria o
 * modulo de banco para o pacote do navegador. Os numeros sao os mesmos CHECK de
 * `live_config` (migracao 0004) — quem recusa de verdade continua sendo o banco;
 * isto aqui só evita mandar um valor que já se sabe recusado.
 */
const LIMITES = {
  intervaloMinimoS: 5,
  intervaloMaximoS: 600,
  tetoMinimo: 1,
  tetoMaximo: 20,
} as const;

/**
 * Sucesso vira aviso passageiro; erro fica no Alerta do formulario.
 *
 * Erro que some sozinho e erro que o usuario perde enquanto le o campo errado —
 * e nesta tela o erro costuma ser justamente o que falta preencher.
 */
function useRetorno(estado: EstadoAcao) {
  const avisos = useAvisos();
  const visto = useRef<EstadoAcao | null>(null);

  useEffect(() => {
    if (visto.current === estado) return;
    visto.current = estado;
    if (estado.ok && estado.mensagem) avisos.sucesso(estado.mensagem);
  }, [estado, avisos]);
}

// -----------------------------------------------------------------------------
// Aceite de risco
// -----------------------------------------------------------------------------

export function AvisoDeRisco({
  pendente,
  aceitoEm,
  versao,
}: {
  pendente: boolean;
  aceitoEm: string | null;
  versao: number;
}) {
  const [estado, acao, enviando] = useActionState(aceitarRiscoAcao, INICIAL);
  const [confirmado, setConfirmado] = useState(false);
  useRetorno(estado);

  if (!pendente) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitulo>Aviso de automação</CardTitulo>
            <CardDescricao>
              Aceito em{" "}
              {aceitoEm
                ? new Date(aceitoEm).toLocaleDateString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })
                : "—"}{" "}
              · versão {versao} do texto. O registro fica na auditoria, com data,
              IP e navegador.
            </CardDescricao>
          </div>
          <Badge tom="sucesso">Aceito</Badge>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-danger">
      <div className="flex gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger"
          aria-hidden
        >
          <ShieldAlert className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <CardTitulo>Antes de subir: o risco é seu, e ele é real</CardTitulo>
          <CardDescricao>
            Leia inteiro. Este texto não é formalidade jurídica — é o que
            realmente acontece.
          </CardDescricao>

          <ul className="mt-4 space-y-2.5 text-sm text-fg-muted">
            <li className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <span>
                Os <strong className="text-fg">Termos de Serviço do TikTok</strong>{" "}
                proíbem operar a conta por automação. Usar a Shopia numa live
                contraria esses termos.
              </span>
            </li>
            <li className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <span>
                A consequência possível é{" "}
                <strong className="text-fg">
                  limitação de alcance, suspensão ou perda da conta
                </strong>
                . A conta é sua; a perda também.
              </span>
            </li>
            <li className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <span>
                Não temos parceria, API oficial nem acordo com o TikTok. A
                extensão roda no seu navegador, com a sua sessão.
              </span>
            </li>
            <li className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <span>
                A cadência humana de resposta <strong className="text-fg">reduz</strong>{" "}
                o risco de ser detectado. Não elimina.
              </span>
            </li>
            <li className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <span>
                Crédito consumido não é devolvido por bloqueio de conta, e o
                TikTok pode mudar as regras sem aviso.
              </span>
            </li>
          </ul>

          {estado.erro && (
            <Alerta tom="erro" className="mt-4">
              {estado.erro}
            </Alerta>
          )}

          <form action={acao} className="mt-5 space-y-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-fg">
              <input
                type="checkbox"
                name="confirmo"
                checked={confirmado}
                onChange={(evento) => setConfirmado(evento.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span>
                Li, entendi e assumo o risco de automatizar a minha conta do
                TikTok.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!confirmado || enviando}>
                {enviando ? "Registrando…" : "Registrar o aceite"}
              </Button>
              <span className="text-xs text-fg-subtle">
                Fica gravado com data, versão do texto, IP e navegador.
              </span>
            </div>
          </form>
        </div>
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Contas do TikTok
// -----------------------------------------------------------------------------

export function ContasDoTikTok({
  contas,
  contaAtivaId,
  limite,
}: {
  contas: ContaTikTok[];
  contaAtivaId: string | null;
  limite: number;
}) {
  const [estado, acao, enviando] = useActionState(vincularContaAcao, INICIAL);
  useRetorno(estado);

  const cheio = contas.length >= limite;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitulo>Conta do TikTok</CardTitulo>
          <CardDescricao>
            O vínculo é por conta da Shopia, e não global de propósito: sem prova
            de posse, uma trava mundial deixaria qualquer um registrar o @ dos
            maiores vendedores só para bloqueá-los.
          </CardDescricao>
        </div>
        <Badge>
          <span className="num">
            {contas.length} de {limite}
          </span>
        </Badge>
      </div>

      {contas.length === 0 ? (
        <EstadoVazio
          className="mt-4"
          titulo="Nenhuma conta vinculada"
          texto="Informe o @ da conta que vai transmitir. É ele que a extensão procura no LIVE Studio."
        />
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {contas.map((conta) => (
            <LinhaConta key={conta.id} conta={conta} emUso={conta.id === contaAtivaId} />
          ))}
        </ul>
      )}

      {estado.erro && (
        <Alerta tom="erro" className="mt-4">
          {estado.erro}
        </Alerta>
      )}

      <form action={acao} className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Campo rotulo="@ da conta" htmlFor="usuario" dica="Sem o arroba, ou com — tanto faz.">
          <Input
            id="usuario"
            name="usuario"
            placeholder="loja.exemplo"
            autoComplete="off"
            spellCheck={false}
            maxLength={25}
            required
            disabled={cheio}
          />
        </Campo>

        <Campo rotulo="Apelido (opcional)" htmlFor="apelido">
          <Input
            id="apelido"
            name="apelido"
            placeholder="Loja Exemplo"
            autoComplete="off"
            maxLength={60}
            disabled={cheio}
          />
        </Campo>

        <Button type="submit" disabled={enviando || cheio}>
          <Plus className="size-4" aria-hidden />
          {enviando ? "Vinculando…" : "Vincular"}
        </Button>
      </form>

      {cheio && (
        <p className="mt-2 text-xs text-fg-subtle">
          Seu plano cobre <span className="num">{limite}</span> conta(s). Remova
          uma para vincular outra.
        </p>
      )}
    </Card>
  );
}

function LinhaConta({ conta, emUso }: { conta: ContaTikTok; emUso: boolean }) {
  const [estado, acao] = useActionState(desvincularContaAcao, INICIAL);
  const [aberto, setAberto] = useState(false);
  useRetorno(estado);

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          <span className="font-[family-name:var(--font-mono)]">@{conta.usuario}</span>
        </p>
        <p className="truncate text-xs text-fg-subtle">
          {conta.apelido ?? "Sem apelido"}
          {conta.verificadaEm ? " · verificada" : " · não verificada"}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {emUso && <Badge tom="marca">Em uso na live</Badge>}
        <Button
          variante="ghost"
          tamanho="sm"
          onClick={() => setAberto(true)}
          aria-label={`Desvincular @${conta.usuario}`}
        >
          <Link2Off className="size-4" aria-hidden />
        </Button>
      </div>

      <ConfirmarAcao
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        titulo={`Desvincular @${conta.usuario}?`}
        rotuloConfirmar="Desvincular"
        perdas={[
          "O vínculo desta conta com a Shopia",
          "A escolha dela como conta da live, se estiver em uso",
          "O histórico de lives fica, mas sem apontar para a conta",
        ]}
        aoConfirmar={() => {
          const dados = new FormData();
          dados.set("contaId", conta.id);
          acao(dados);
          setAberto(false);
        }}
      />
    </li>
  );
}

// -----------------------------------------------------------------------------
// Voz, montagem e cadência
// -----------------------------------------------------------------------------

export function ConfiguracaoDaLive({
  config,
  contas,
  vozes,
  montagens,
}: {
  config: ConfigLive;
  contas: ContaTikTok[];
  vozes: VozOpcao[];
  montagens: MontagemOpcao[];
}) {
  const [estado, acao, enviando] = useActionState(salvarConfiguracaoAcao, INICIAL);
  useRetorno(estado);

  const [responderChat, setResponderChat] = useState(config.responderChat);
  const [saudarEntrada, setSaudarEntrada] = useState(config.saudarEntrada);
  const [minS, setMinS] = useState(String(config.intervaloMinS));
  const [maxS, setMaxS] = useState(String(config.intervaloMaxS));
  const [teto, setTeto] = useState(String(config.tetoPorMinuto));

  const opcoesConta: OpcaoSelecao[] = [
    { valor: "", rotulo: "— escolher a conta —" },
    ...contas.map((conta) => ({ valor: conta.id, rotulo: `@${conta.usuario}` })),
  ];

  const opcoesVoz: OpcaoSelecao[] = [
    { valor: "", rotulo: "— escolher a voz —" },
    ...vozes.map((voz) => ({
      valor: voz.id,
      rotulo: `${voz.nome}${voz.propria ? " (sua voz)" : ""}${voz.premium ? " · premium" : ""}`,
    })),
  ];

  const opcoesMontagem: OpcaoSelecao[] = [
    { valor: "", rotulo: "— escolher a montagem —" },
    ...montagens.map((montagem) => ({
      valor: montagem.id,
      rotulo: `${montagem.nome} · ${montagem.itens} bloco(s) · ${formatarDuracao(montagem.duracaoMs)}`,
    })),
  ];

  const minimo = Number(minS) || LIMITES.intervaloMinimoS;
  const maximo = Number(maxS) || minimo;
  const porMinuto = Number(teto) || 1;
  const invertido = maximo < minimo;

  return (
    <Card>
      <CardTitulo>Voz, montagem e cadência</CardTitulo>
      <CardDescricao>
        Tudo aqui vale para a próxima live. Mudança no meio da transmissão só
        chega no próximo contato da extensão.
      </CardDescricao>

      {estado.erro && (
        <Alerta tom="erro" className="mt-4">
          {estado.erro}
        </Alerta>
      )}

      <form action={acao} className="mt-5 space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Conta que transmite" htmlFor="contaId">
            <Selecao
              id="contaId"
              name="contaId"
              opcoes={opcoesConta}
              defaultValue={config.contaId ?? ""}
            />
          </Campo>

          <Campo rotulo="Voz ativa" htmlFor="vozId">
            <Selecao
              id="vozId"
              name="vozId"
              opcoes={opcoesVoz}
              defaultValue={config.vozId ?? ""}
            />
          </Campo>

          <Campo rotulo="Montagem ativa" htmlFor="montagemId">
            <Selecao
              id="montagemId"
              name="montagemId"
              opcoes={opcoesMontagem}
              defaultValue={config.montagemId ?? ""}
            />
          </Campo>
        </div>

        <div className="rounded-lg border border-border bg-bg-subtle p-4">
          <h3 className="text-sm font-semibold">Por que existe limite de resposta</h3>
          <p className="mt-1.5 text-sm text-fg-muted">
            Responder na hora, sempre, a todo mundo, é a assinatura mais óbvia de
            automação — nenhuma vendedora humana lê e responde em dois segundos
            durante três horas seguidas. O intervalo é sorteado dentro da faixa
            abaixo e o teto por minuto corta a rajada quando o chat esquenta. É o
            que faz a apresentadora parecer gente, e é a única defesa que está na
            sua mão.
          </p>

          <div className="mt-4 space-y-4">
            <Interruptor
              ligado={responderChat}
              aoMudar={setResponderChat}
              rotulo="Responder o chat"
              descricao="Desligado, a apresentadora só narra a montagem e ignora os comentários."
            />
            {responderChat && <input type="hidden" name="responderChat" value="1" />}

            <Interruptor
              ligado={saudarEntrada}
              aoMudar={setSaudarEntrada}
              rotulo="Saudar quem entra"
              descricao="Cumprimenta pelo @ na entrada. Em live cheia, é o que mais gasta a cota de fala."
            />
            {saudarEntrada && <input type="hidden" name="saudarEntrada" value="1" />}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Espera mínima (s)" htmlFor="intervaloMinS">
              <Input
                id="intervaloMinS"
                name="intervaloMinS"
                type="number"
                inputMode="numeric"
                className="num"
                min={LIMITES.intervaloMinimoS}
                max={LIMITES.intervaloMaximoS}
                value={minS}
                onChange={(evento) => setMinS(evento.target.value)}
                disabled={!responderChat}
              />
            </Campo>

            <Campo
              rotulo="Espera máxima (s)"
              htmlFor="intervaloMaxS"
              erro={invertido ? "A máxima não pode ser menor que a mínima." : undefined}
            >
              <Input
                id="intervaloMaxS"
                name="intervaloMaxS"
                type="number"
                inputMode="numeric"
                className="num"
                min={LIMITES.intervaloMinimoS}
                max={LIMITES.intervaloMaximoS}
                value={maxS}
                onChange={(evento) => setMaxS(evento.target.value)}
                aria-invalid={invertido || undefined}
                disabled={!responderChat}
              />
            </Campo>

            <Campo rotulo="Teto por minuto" htmlFor="tetoPorMinuto">
              <Input
                id="tetoPorMinuto"
                name="tetoPorMinuto"
                type="number"
                inputMode="numeric"
                className="num"
                min={LIMITES.tetoMinimo}
                max={LIMITES.tetoMaximo}
                value={teto}
                onChange={(evento) => setTeto(evento.target.value)}
                disabled={!responderChat}
              />
            </Campo>
          </div>

          <p className="mt-3 text-xs text-fg-subtle" aria-live="polite">
            {responderChat ? (
              <>
                No máximo <span className="num">{porMinuto}</span> resposta(s) por
                minuto, com espera sorteada entre{" "}
                <span className="num">{minimo}</span> e{" "}
                <span className="num">{Math.max(minimo, maximo)}</span> segundos.
              </>
            ) : (
              "Respostas desligadas: a apresentadora não escreve no chat."
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar configuração"}
          </Button>
          {estado.ok && estado.mensagem && (
            <span className="text-xs text-success">{estado.mensagem}</span>
          )}
        </div>
      </form>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Iniciar e parar
// -----------------------------------------------------------------------------

export function Transmissao({
  sessao,
  contaId,
  montagemId,
  bloqueios,
}: {
  sessao: SessaoLive | null;
  contaId: string | null;
  montagemId: string | null;
  /** O que impede de subir. Vazio = pode. */
  bloqueios: string[];
}) {
  const [estadoInicio, iniciar, iniciando] = useActionState(iniciarLiveAcao, INICIAL);
  const [estadoParada, parar, parando] = useActionState(pararLiveAcao, INICIAL);
  const [confirmando, setConfirmando] = useState(false);
  useRetorno(estadoInicio);
  useRetorno(estadoParada);

  const noAr = sessao !== null;
  const sessaoId = sessao?.id ?? "";
  const erro = estadoInicio.erro ?? estadoParada.erro;

  return (
    <>
      {erro && <Alerta tom="erro">{erro}</Alerta>}

      {!noAr && bloqueios.length > 0 && (
        <Alerta tom="info">
          Falta{bloqueios.length > 1 ? "m" : ""} {bloqueios.length} item
          {bloqueios.length > 1 ? "s" : ""} antes de subir: {bloqueios.join(", ")}.
        </Alerta>
      )}

      {noAr ? (
        <>
          <Button
            variante="danger"
            tamanho="lg"
            bloco
            onClick={() => setConfirmando(true)}
            disabled={parando}
          >
            <CircleStop className="size-5" aria-hidden />
            {parando ? "Encerrando…" : "Encerrar a live"}
          </Button>

          <ConfirmarAcao
            aberto={confirmando}
            aoFechar={() => setConfirmando(false)}
            titulo="Encerrar a transmissão?"
            rotuloConfirmar="Encerrar agora"
            texto="A sessão é fechada na hora e entra no histórico."
            perdas={[
              "A apresentadora para de narrar imediatamente",
              "A extensão deixa de responder o chat desta live",
              "O painel ao vivo fecha o fluxo de eventos",
            ]}
            aoConfirmar={() => {
              const dados = new FormData();
              dados.set("sessaoId", sessaoId);
              parar(dados);
              setConfirmando(false);
            }}
          />
        </>
      ) : (
        <form action={iniciar}>
          <input type="hidden" name="contaId" value={contaId ?? ""} />
          <input type="hidden" name="montagemId" value={montagemId ?? ""} />
          <Button
            type="submit"
            tamanho="lg"
            bloco
            disabled={iniciando || bloqueios.length > 0}
          >
            <Radio className="size-5" aria-hidden />
            {iniciando ? "Abrindo a sessão…" : "Subir a live"}
          </Button>
        </form>
      )}
    </>
  );
}
