"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Megaphone, Pencil, Pin, Plus, ShoppingCart, Trash2, Zap } from "lucide-react";
import {
  removerAvisoAcao,
  salvarAvisoAcao,
  salvarGatilhoAcao,
  salvarRefixarAcao,
  type EstadoAutomacao,
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
import { Modal } from "@/components/ui/modal";
import { AreaTexto } from "@/components/ui/selecao";
import { contarCaracteres } from "@/lib/caracteres";
import { numero } from "@/lib/utils";
import type { Aviso, ConfigAutomacoes, TipoAviso } from "@/lib/dados/automacoes";

/**
 * Os controles das automações.
 *
 * Limites e sugestões chegam por PROP, nunca por import: `automacoes.ts` é
 * `server-only` e um Client Component que importa valor de lá arrasta o módulo
 * de banco para o pacote do navegador — o build recusa, com razão. Tipo pode
 * vir com `import type`, que desaparece na compilação.
 */

export type LimitesAviso = {
  texto: number;
  intervaloMinS: number;
  intervaloMaxS: number;
  quantidade: number;
};

const INICIAL: EstadoAutomacao = {};

/** Nome de exemplo das prévias. Um nome qualquer mostra o `{nome}` funcionando. */
const EXEMPLO = "Mariana";

/**
 * Sucesso vira aviso passageiro; erro fica parado no formulário.
 *
 * Erro que some sozinho é erro que a pessoa perde justamente enquanto lê o
 * campo errado. O `aoDarCerto` é o que fecha a caixa de edição: fechar sem
 * saber se salvou faria a lista reaparecer sem a alteração.
 */
function useRetorno(estado: EstadoAutomacao, aoDarCerto?: () => void) {
  const avisos = useAvisos();
  const visto = useRef<EstadoAutomacao | null>(null);

  useEffect(() => {
    if (visto.current === estado) return;
    visto.current = estado;
    if (!estado.ok) return;
    if (estado.mensagem) avisos.sucesso(estado.mensagem);
    aoDarCerto?.();
  }, [estado, avisos, aoDarCerto]);
}

/** "a cada 3 min" lê melhor que "a cada 180 s", e é o mesmo número. */
function cadencia(segundos: number) {
  if (segundos < 60) return `${numero(segundos)} s`;
  const min = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return resto === 0 ? `${numero(min)} min` : `${numero(min)} min ${numero(resto)} s`;
}

/**
 * Passou do limite de caracteres?
 *
 * Duas contagens de propósito. A do projeto conta code points (é a que o
 * Postgres conta), mas a camada de dados apara o texto com `slice`, que conta
 * unidades UTF-16. Num texto cheio de emoji as duas divergem, e barrar o envio
 * aqui é barato — descobrir ao vivo que a frase foi cortada no meio, não.
 */
function passouDoLimite(texto: string, limite: number) {
  return contarCaracteres(texto) > limite || texto.length > limite;
}

// -----------------------------------------------------------------------------
// 1. Produto fixado
// -----------------------------------------------------------------------------

export function ProdutoFixado({
  config,
  limites,
}: {
  config: ConfigAutomacoes;
  limites: { intervaloMinS: number; intervaloMaxS: number };
}) {
  const [estado, acao, enviando] = useActionState(salvarRefixarAcao, INICIAL);
  useRetorno(estado);

  const [ativo, setAtivo] = useState(config.refixarAtivo);
  const [intervalo, setIntervalo] = useState(String(config.refixarIntervaloS));
  const [posicao, setPosicao] = useState(String(config.refixarPosicao));

  const segundos = Number(intervalo) || limites.intervaloMinS;

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-md bg-bg-subtle text-fg-muted"
          aria-hidden
        >
          <Pin className="size-4" />
        </span>
        <div className="min-w-0">
          <CardTitulo>Produto fixado</CardTitulo>
          <CardDescricao>
            O TikTok desafixa o produto sozinho quando o vendedor mexe na vitrine — abre a
            lista, troca o preço, reordena. A live continua rodando sem produto na tela, e de
            dentro do LIVE Studio ninguém percebe: quem vê a vitrine vazia é a audiência.
            Ligado, a Shopia refixa de tempo em tempo.
          </CardDescricao>
        </div>
      </div>

      {estado.erro && (
        <Alerta tom="erro" className="mt-4">
          {estado.erro}
        </Alerta>
      )}

      <form action={acao} className="mt-5 space-y-5">
        <Interruptor
          ligado={ativo}
          aoMudar={setAtivo}
          rotulo="Refixar o produto durante a live"
          descricao="Desligado, o produto fica fixado só enquanto o TikTok quiser."
        />
        {ativo && <input type="hidden" name="refixarAtivo" value="1" />}

        {/* Os campos não são desabilitados com o interruptor desligado: campo
            desabilitado não é enviado, e o valor voltaria para o padrão — ou
            seja, desligar apagaria o número que a pessoa configurou. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Refixar a cada (segundos)"
            htmlFor="refixarIntervaloS"
            dica={`de ${numero(limites.intervaloMinS)} a ${numero(limites.intervaloMaxS)} segundos`}
          >
            <Input
              id="refixarIntervaloS"
              name="refixarIntervaloS"
              type="number"
              inputMode="numeric"
              className="num"
              min={limites.intervaloMinS}
              max={limites.intervaloMaxS}
              value={intervalo}
              onChange={(evento) => setIntervalo(evento.target.value)}
            />
          </Campo>

          <Campo
            rotulo="Posição do produto na vitrine"
            htmlFor="refixarPosicao"
            dica="1 é o primeiro da lista — é essa posição que a extensão clica"
          >
            <Input
              id="refixarPosicao"
              name="refixarPosicao"
              type="number"
              inputMode="numeric"
              className="num"
              min={1}
              max={99}
              value={posicao}
              onChange={(evento) => setPosicao(evento.target.value)}
            />
          </Campo>
        </div>

        <p className="text-xs text-fg-subtle" aria-live="polite">
          {ativo ? (
            <>
              A cada <span className="num">{cadencia(segundos)}</span> a Shopia fixa de novo o
              produto da posição <span className="num">{numero(Number(posicao) || 1)}</span>.
              Refixar não escreve no chat: não gasta o teto de mensagens por minuto.
            </>
          ) : (
            "Desligado: se o TikTok desafixar no meio da live, o produto fica fora da tela."
          )}
        </p>

        <Button type="submit" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar produto fixado"}
        </Button>
      </form>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// 2 e 3. Oferta relâmpago e comentário automático
//
// Um componente para os dois: é o mesmo mecanismo — um texto que vai ao chat de
// tempo em tempo — e o que muda é o papel na live. Dois componentes iguais
// divergiriam na primeira correção feita só num deles.
// -----------------------------------------------------------------------------

const TEXTOS_AVISO: Record<
  TipoAviso,
  {
    titulo: string;
    descricao: string;
    icone: typeof Zap;
    novo: string;
    vazioTitulo: string;
    vazioTexto: string;
    rotuloTexto: string;
  }
> = {
  relampago: {
    titulo: "Oferta relâmpago",
    descricao:
      "O anúncio que cria pressa: desconto por tempo curto, repetido no chat enquanto a oferta está de pé. Depois que a oferta acabar, desligue — chat anunciando promoção que não existe mais é o que faz a audiência parar de acreditar no próximo anúncio.",
    icone: Zap,
    novo: "Nova oferta relâmpago",
    vazioTitulo: "Nenhuma oferta relâmpago",
    vazioTexto:
      "Crie uma quando for abrir promoção por tempo limitado. Ela repete o anúncio no chat sem você parar de falar.",
    rotuloTexto: "O que anunciar no chat",
  },
  aviso: {
    titulo: "Comentário automático",
    descricao:
      "O recado que se repete na live toda: como comprar, que o frete vale para todo o Brasil, que o cupom está no produto fixado. É o que você diria de dez em dez minutos se tivesse mão livre para digitar.",
    icone: Megaphone,
    novo: "Novo comentário",
    vazioTitulo: "Nenhum comentário automático",
    vazioTexto:
      "O recado que você repete toda live cabe aqui. Enquanto estiver vazio, a Shopia só fala quando alguém pergunta.",
    rotuloTexto: "O que escrever no chat",
  },
};

export function AvisosProgramados({
  tipo,
  avisos,
  totalDeAvisos,
  limites,
  sugestao,
  explicarTeto,
}: {
  tipo: TipoAviso;
  avisos: Aviso[];
  /** Avisos de TODOS os tipos: o teto da conta é somado, não por bloco. */
  totalDeAvisos: number;
  limites: LimitesAviso;
  sugestao: string;
  /** O bloco que carrega a explicação inteira do teto de cadência. */
  explicarTeto?: boolean;
}) {
  const textos = TEXTOS_AVISO[tipo];
  const Icone = textos.icone;

  const [emEdicao, setEmEdicao] = useState<Aviso | null>(null);
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState(sugestao);
  const [intervalo, setIntervalo] = useState("300");
  const [ativo, setAtivo] = useState(true);

  const fechar = () => setAberto(false);
  const [estado, acaoSalvar, salvando] = useActionState(salvarAvisoAcao, INICIAL);
  useRetorno(estado, fechar);

  function abrirNovo() {
    setEmEdicao(null);
    setTexto(sugestao);
    setIntervalo("300");
    setAtivo(true);
    setAberto(true);
  }

  function abrirEdicao(aviso: Aviso) {
    setEmEdicao(aviso);
    setTexto(aviso.texto);
    setIntervalo(String(aviso.intervaloS));
    setAtivo(aviso.ativo);
    setAberto(true);
  }

  const cheio = totalDeAvisos >= limites.quantidade;
  const segundos = Number(intervalo) || limites.intervaloMinS;
  const excedeu = passouDoLimite(texto, limites.texto);
  const curto = texto.trim().length < 2;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-md bg-bg-subtle text-fg-muted"
            aria-hidden
          >
            <Icone className="size-4" />
          </span>
          <div className="min-w-0">
            <CardTitulo>{textos.titulo}</CardTitulo>
            <CardDescricao>{textos.descricao}</CardDescricao>
          </div>
        </div>

        <Button onClick={abrirNovo} disabled={cheio}>
          <Plus className="size-4" aria-hidden />
          {textos.novo}
        </Button>
      </div>

      {cheio && (
        <p className="mt-3 text-xs text-fg-subtle">
          Você já tem <span className="num">{numero(totalDeAvisos)}</span> avisos, que é o teto
          da conta (relâmpago e comentário contam juntos). Apague um para criar outro.
        </p>
      )}

      {estado.erro && (
        <Alerta tom="erro" className="mt-4">
          {estado.erro}
        </Alerta>
      )}

      {avisos.length === 0 ? (
        <EstadoVazio
          className="mt-4"
          icone={Icone}
          titulo={textos.vazioTitulo}
          texto={textos.vazioTexto}
          acao={
            <Button onClick={abrirNovo} disabled={cheio}>
              <Plus className="size-4" aria-hidden />
              {textos.novo}
            </Button>
          }
        />
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {avisos.map((aviso) => (
            <LinhaAviso
              key={aviso.id}
              aviso={aviso}
              aoEditar={() => abrirEdicao(aviso)}
              acaoSalvar={acaoSalvar}
            />
          ))}
        </ul>
      )}

      {/* O teto de cadência vale por cima de qualquer intervalo configurado
          aqui, e dizer isso é obrigação da tela: sem este parágrafo, quem põe
          60 segundos espera uma mensagem por minuto e acha que está quebrado
          quando ela não sai.

          A explicação longa aparece uma vez por tela, no primeiro bloco: o
          mesmo parágrafo repetido dois cartões abaixo é o parágrafo que ninguém
          lê nas duas vezes. No outro bloco fica a versão curta. */}
      <div className="mt-4 rounded-lg border border-border bg-bg-subtle p-4">
        <h3 className="text-sm font-semibold">O intervalo é um teto, não uma promessa</h3>
        {explicarTeto ? (
          <p className="mt-1.5 text-sm text-fg-muted">
            O intervalo diz “no máximo tão rápido”, e não “sempre”. Quem decide por último é o
            teto de mensagens por minuto da cadência, que vale para a conta inteira — resposta
            do manual, boas-vindas, reação de venda e aviso programado dividem a mesma conta. E
            o aviso programado é o <strong className="text-fg">primeiro a calar</strong> quando
            o chat enche: ninguém está esperando um “aproveitem a oferta”, enquanto perder a
            resposta de quem perguntou o preço custa a venda.
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-fg-muted">
            Como no bloco da oferta relâmpago: o intervalo é o máximo, o teto de mensagens por
            minuto da cadência vale por cima, e o aviso programado é o primeiro a calar quando o
            chat enche.
          </p>
        )}
        <Link
          href="/live"
          className="mt-2 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          Ver o teto por minuto em Ao vivo
        </Link>
      </div>

      <Modal
        aberto={aberto}
        aoFechar={fechar}
        titulo={emEdicao ? `Editar: ${textos.titulo.toLowerCase()}` : textos.novo}
      >
        <form action={acaoSalvar} className="space-y-4">
          {emEdicao && <input type="hidden" name="id" value={emEdicao.id} />}
          <input type="hidden" name="tipo" value={tipo} />
          {ativo && <input type="hidden" name="ativo" value="1" />}

          <Campo
            rotulo={textos.rotuloTexto}
            htmlFor={`${tipo}-texto`}
            dica={`até ${numero(limites.texto)} caracteres — é isto, palavra por palavra, que a audiência lê`}
          >
            <AreaTexto
              id={`${tipo}-texto`}
              name="texto"
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              maximo={limites.texto}
              rows={3}
              aria-invalid={excedeu || undefined}
            />
          </Campo>

          <Campo
            rotulo="Repetir a cada (segundos)"
            htmlFor={`${tipo}-intervalo`}
            dica={`de ${numero(limites.intervaloMinS)} a ${numero(limites.intervaloMaxS)} segundos (dá uma vez a cada ${cadencia(segundos)}, no máximo)`}
          >
            <Input
              id={`${tipo}-intervalo`}
              name="intervaloS"
              type="number"
              inputMode="numeric"
              className="num"
              min={limites.intervaloMinS}
              max={limites.intervaloMaxS}
              value={intervalo}
              onChange={(evento) => setIntervalo(evento.target.value)}
            />
          </Campo>

          {emEdicao ? (
            <Interruptor
              ligado={ativo}
              aoMudar={setAtivo}
              rotulo="Aviso ligado"
              descricao="Desligado, ele fica guardado aqui e não vai ao chat. É assim que se pausa uma oferta que acabou."
            />
          ) : (
            <p className="text-xs text-fg-subtle">
              Nasce ligado: na próxima live ele já entra na fila.
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={salvando || excedeu || curto}>
              {salvando ? "Salvando…" : "Salvar"}
            </Button>
            <Button type="button" variante="ghost" onClick={fechar}>
              Cancelar
            </Button>
          </div>

          {excedeu && (
            <p className="text-xs text-danger">
              Passou de {numero(limites.texto)} caracteres — o campo do chat do TikTok não aceita
              mais que isso, e o texto seria cortado no meio.
            </p>
          )}
        </form>
      </Modal>
    </Card>
  );
}

function LinhaAviso({
  aviso,
  aoEditar,
  acaoSalvar,
}: {
  aviso: Aviso;
  aoEditar: () => void;
  /** A mesma ação do formulário: ligar/desligar é uma edição, não outra coisa. */
  acaoSalvar: (formData: FormData) => void;
}) {
  const [estado, acaoRemover] = useActionState(removerAvisoAcao, INICIAL);
  const [confirmando, setConfirmando] = useState(false);
  useRetorno(estado);

  return (
    <li className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tom={aviso.ativo ? "marca" : "neutro"}>
          <span className="num">a cada {cadencia(aviso.intervaloS)}</span>
        </Badge>
        {!aviso.ativo && <Badge tom="alerta">desligado</Badge>}

        <span className="ml-auto flex items-center gap-1">
          <Button variante="ghost" tamanho="sm" onClick={aoEditar}>
            <Pencil className="size-3.5" aria-hidden />
            <span className="sr-only">Editar este aviso</span>
          </Button>

          <form action={acaoSalvar}>
            <input type="hidden" name="id" value={aviso.id} />
            <input type="hidden" name="tipo" value={aviso.tipo} />
            <input type="hidden" name="texto" value={aviso.texto} />
            <input type="hidden" name="intervaloS" value={aviso.intervaloS} />
            {!aviso.ativo && <input type="hidden" name="ativo" value="1" />}
            <Button type="submit" variante="ghost" tamanho="sm">
              {aviso.ativo ? "Desligar" : "Ligar"}
            </Button>
          </form>

          <Button variante="ghost" tamanho="sm" onClick={() => setConfirmando(true)}>
            <Trash2 className="size-3.5" aria-hidden />
            <span className="sr-only">Remover este aviso</span>
          </Button>
        </span>
      </div>

      <p className="mt-1.5 text-sm text-fg">{aviso.texto}</p>

      {estado.erro && (
        <Alerta tom="erro" className="mt-2">
          {estado.erro}
        </Alerta>
      )}

      <ConfirmarAcao
        aberto={confirmando}
        aoFechar={() => setConfirmando(false)}
        titulo="Remover este aviso?"
        rotuloConfirmar="Remover"
        texto={aviso.texto}
        perdas={[
          "O texto do aviso, que precisará ser escrito de novo",
          "O intervalo configurado para ele",
        ]}
        aoConfirmar={() => {
          const dados = new FormData();
          dados.set("id", aviso.id);
          acaoRemover(dados);
          setConfirmando(false);
        }}
      />
    </li>
  );
}

// -----------------------------------------------------------------------------
// 4 e 5. Reagir a carrinho e a venda
// -----------------------------------------------------------------------------

type QualGatilho = "carrinho" | "venda";

const TEXTOS_GATILHO: Record<
  QualGatilho,
  {
    titulo: string;
    descricao: string;
    icone: typeof ShoppingCart;
    frase: string;
    rotuloInterruptor: string;
    descricaoInterruptor: string;
    rotuloTexto: string;
  }
> = {
  carrinho: {
    titulo: "Quando alguém adiciona ao carrinho",
    descricao:
      "Carrinho é intenção, não compra: a pessoa está na dúvida. Um comentário nominal na hora é o empurrão mais barato que existe numa live — e ele também mostra para quem está assistindo que outras pessoas estão comprando.",
    icone: ShoppingCart,
    frase: "adicionou ao carrinho",
    rotuloInterruptor: "Comentar no chat quando alguém adiciona ao carrinho",
    descricaoInterruptor:
      "Desligado, o carrinho continua sendo contado aqui na tela — a Shopia só não fala nada.",
    rotuloTexto: "O que escrever quando alguém adiciona ao carrinho",
  },
  venda: {
    titulo: "Quando alguém compra",
    descricao:
      "A venda anunciada no chat é prova social em tempo real: quem está em dúvida vê que alguém já comprou. Esta é a única reação que não espera — o valor dela é ser imediata, e venda não acontece de três em três segundos.",
    icone: Zap,
    frase: "comprou",
    rotuloInterruptor: "Comentar no chat quando alguém compra",
    descricaoInterruptor:
      "Desligado, a venda continua sendo contada aqui na tela — a Shopia só não comemora.",
    rotuloTexto: "O que escrever quando alguém compra",
  },
};

export function GatilhoDaLoja({
  qual,
  config,
  limiteTexto,
  sugestao,
}: {
  qual: QualGatilho;
  config: ConfigAutomacoes;
  limiteTexto: number;
  sugestao: string;
}) {
  const textos = TEXTOS_GATILHO[qual];
  const Icone = textos.icone;

  const [estado, acao, enviando] = useActionState(salvarGatilhoAcao, INICIAL);
  useRetorno(estado);

  const [ativo, setAtivo] = useState(
    qual === "carrinho" ? config.carrinhoAtivo : config.vendaAtivo,
  );
  const [texto, setTexto] = useState(
    (qual === "carrinho" ? config.carrinhoTexto : config.vendaTexto) ?? "",
  );
  const [sino, setSino] = useState(config.sinoAtivo);

  const excedeu = passouDoLimite(texto, limiteTexto);
  const previa = texto.trim().replaceAll("{nome}", EXEMPLO);

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-md bg-bg-subtle text-fg-muted"
          aria-hidden
        >
          <Icone className="size-4" />
        </span>
        <div className="min-w-0">
          <CardTitulo>{textos.titulo}</CardTitulo>
          <CardDescricao>{textos.descricao}</CardDescricao>
        </div>
      </div>

      {estado.erro && (
        <Alerta tom="erro" className="mt-4">
          {estado.erro}
        </Alerta>
      )}

      <form action={acao} className="mt-5 space-y-5">
        <input type="hidden" name="qual" value={qual} />

        <Interruptor
          ligado={ativo}
          aoMudar={setAtivo}
          rotulo={textos.rotuloInterruptor}
          descricao={textos.descricaoInterruptor}
        />
        {ativo && <input type="hidden" name="ativo" value="1" />}

        <Campo
          rotulo={textos.rotuloTexto}
          htmlFor={`${qual}-texto`}
          dica={`até ${numero(limiteTexto)} caracteres. Escreva {nome} onde deve entrar o apelido de quem agiu — quando o TikTok não manda o nome, vira “alguém”.`}
        >
          <AreaTexto
            id={`${qual}-texto`}
            name="texto"
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            maximo={limiteTexto}
            rows={2}
            placeholder={sugestao}
            aria-invalid={excedeu || undefined}
          />
        </Campo>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variante="secondary" tamanho="sm" onClick={() => setTexto(sugestao)}>
            Usar a sugestão
          </Button>
          {/* A prévia mostra o texto de verdade, nunca a sugestão: campo vazio
              não publica nada, e uma prévia otimista faria a pessoa fechar a
              tela achando que configurou. */}
          <p className="text-xs text-fg-subtle" aria-live="polite">
            {previa ? (
              <>
                No chat sai: <span className="text-fg">“{previa}”</span>
              </>
            ) : (
              "Sem texto a Shopia não fala nada — e ligar o gatilho com o campo vazio é recusado ao salvar."
            )}
          </p>
        </div>

        {qual === "venda" && (
          <>
            <Interruptor
              ligado={sino}
              aoMudar={setSino}
              rotulo="Tocar um som quando vender"
              descricao="Toca no painel da extensão, no navegador onde a live está rodando. Não é notificação no celular."
            />
            {sino && <input type="hidden" name="sino" value="1" />}
          </>
        )}

        {excedeu && (
          <p className="text-xs text-danger">
            Passou de {numero(limiteTexto)} caracteres. Encurte: o que sobra seria cortado.
          </p>
        )}

        <Button type="submit" disabled={enviando || excedeu}>
          {enviando ? "Salvando…" : "Salvar"}
        </Button>
      </form>

      {/* A detecção é por texto do chat, e quem usa isto precisa saber que ela
          pode parar sem ninguém mexer em nada. Omitir seria vender uma
          integração que não existe.

          O parágrafo inteiro fica no bloco do carrinho, que vem primeiro: o
          mesmo texto repetido no cartão seguinte é texto que ninguém lê nas
          duas vezes. No bloco da venda fica a versão curta — mais a parte que
          só vale para venda. */}
      <div className="mt-5 rounded-lg border border-border bg-bg-subtle p-4">
        <h3 className="text-sm font-semibold">Como a Shopia sabe que isso aconteceu</h3>

        {qual === "carrinho" ? (
          <>
            <p className="mt-1.5 text-sm text-fg-muted">
              Pela mensagem que o próprio TikTok publica no chat da live (“{EXEMPLO}{" "}
              {textos.frase}…”).{" "}
              <strong className="text-fg">Não é integração com o TikTok Shop</strong>: não existe
              API de vendedor nisso, e a Shopia não vê pedido, valor nem quantidade — só a frase
              passando no chat. Se o TikTok mudar essa frase, a detecção para de funcionar até a
              gente publicar o padrão novo; o conserto é do nosso lado e chega no batimento
              seguinte da extensão, sem você atualizar nada.
            </p>
            <p className="mt-2 text-sm text-fg-muted">
              O teto de mensagens por minuto também vale aqui: com o chat na rajada, a reação
              pode não sair. A contagem na tela não depende disso — ela conta mesmo com o
              gatilho desligado.
            </p>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-sm text-fg-muted">
              Pela frase que o TikTok publica no chat (“{EXEMPLO} {textos.frase}…”), como no
              carrinho. Não é integração com o TikTok Shop: se eles mudarem a frase, a detecção
              para até a gente publicar o padrão novo. O teto de mensagens por minuto também
              vale aqui; a contagem na tela, não.
            </p>
            <p className="mt-2 text-sm text-fg-muted">
              E venda detectada assim{" "}
              <strong className="text-fg">não entra no dashboard nem no ranking</strong>: lá só
              entra venda com origem verificável. Isto aqui é contador da live, não medição.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
