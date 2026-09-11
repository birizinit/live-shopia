"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, BellRing, Eye, Trash } from "lucide-react";
import { esquecerDispositivoAcao, salvarPreferenciasAcao, type EstadoAcao } from "./actions";
import { Alerta } from "@/components/ui/alerta";
import { useAvisos } from "@/components/ui/avisos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/input";
import { Esqueleto, RegiaoCarregando } from "@/components/ui/esqueleto";
import { Interruptor } from "@/components/ui/interruptor";
// Só o TIPO: `push.ts` é `server-only`, e importar valor de lá puxaria o
// módulo inteiro para o pacote do navegador. `import type` some na compilação.
import type { PreferenciasPush } from "@/lib/dados/push";

/**
 * A parte da tela que so existe no navegador: permissao de notificacao,
 * service worker e PushManager.
 *
 * Os tres componentes moram no mesmo modulo de proposito — `"use client"` e
 * diretiva de ARQUIVO, e separa-los criaria tres fronteiras cliente/servidor
 * para a mesma tela sem ganhar nada.
 */

const INICIAL: EstadoAcao = {};

const ENDERECO_API = "/api/push/inscrever";

type Estado =
  | "verificando"
  | "indisponivel"
  | "sem_suporte"
  | "bloqueado"
  | "desligado"
  | "fora_da_conta"
  | "inscrito";

function suportado() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * A mesma marca que o servidor calcula em `marcaDoEndpoint` — SHA-256 do
 * endpoint, 16 digitos hex. E assim que esta tela descobre se a inscricao que
 * o navegador tem em maos e uma das que estao no banco, sem que o endpoint
 * (que e credencial de envio) precise descer para ca.
 */
async function marcaDe(endpoint: string): Promise<string | null> {
  try {
    const digerido = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(endpoint),
    );
    return Array.from(new Uint8Array(digerido))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  } catch {
    // Contexto sem crypto.subtle (http fora de localhost). Sem a marca, a tela
    // confia no que o proprio navegador diz e nao fica cutucando o usuario.
    return null;
  }
}

/**
 * Le, de uma vez, tudo que o navegador tem a dizer sobre push.
 *
 * Fora do componente e num fluxo so: o estado desta tela e o reflexo de um
 * sistema externo (permissao + service worker + PushManager), e ler esse
 * sistema em pedacos espalhados pelo efeito era o que produzia render em
 * cascata a cada pedaco.
 *
 * `getRegistration` apenas OLHA. Quem registra o worker e o clique em ativar —
 * registrar durante a leitura deixaria um worker instalado em quem so passou
 * pela tela.
 */
async function lerEstadoDoNavegador(chaveMarcas: string): Promise<Estado> {
  if (!suportado()) return "sem_suporte";
  if (Notification.permission === "denied") return "bloqueado";

  const registro = await navigator.serviceWorker.getRegistration("/");
  const inscricao = registro ? await registro.pushManager.getSubscription() : null;
  if (!inscricao) return "desligado";

  const marca = await marcaDe(inscricao.endpoint);
  const conhecida = marca === null || chaveMarcas.split("|").includes(marca);
  return conhecida ? "inscrito" : "fora_da_conta";
}

/**
 * A chave VAPID viaja em base64url; o PushManager quer os bytes.
 *
 * Sem anotar o retorno de proposito: `Uint8Array` escrito a mao vira
 * `Uint8Array<ArrayBufferLike>`, que nao serve como `BufferSource`. A
 * inferencia do `new Uint8Array(n)` ja da o tipo certo.
 */
function chaveEmBytes(chave: string) {
  const preenchimento = "=".repeat((4 - (chave.length % 4)) % 4);
  const base64 = (chave + preenchimento).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = atob(base64);
  const bytes = new Uint8Array(bruto.length);
  for (let i = 0; i < bruto.length; i += 1) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}

/**
 * A inscricao que o navegador guarda foi assinada com a chave VAPID de quando
 * ela nasceu. Se a chave do servidor mudou desde entao, aquela inscricao virou
 * lixo: o envio falha para sempre e o usuario nunca entende por que parou.
 * Comparar aqui e o que permite trocar a chave sem quebrar quem ja ativou.
 */
function mesmaChave(inscricao: PushSubscription, chave: Uint8Array) {
  const atual = inscricao.options.applicationServerKey;
  if (!atual) return false;
  const bytes = new Uint8Array(atual);
  return bytes.length === chave.length && bytes.every((byte, i) => byte === chave[i]);
}

async function erroDaResposta(resposta: Response): Promise<string | null> {
  const corpo = (await resposta.json().catch(() => null)) as
    | { ok?: boolean; erro?: string }
    | null;
  if (resposta.ok && corpo?.ok) return null;
  return corpo?.erro ?? "O servidor recusou a inscrição.";
}

/** Mostra o resultado da Server Action uma vez por envio. */
function useAvisoDoEstado(estado: EstadoAcao) {
  const avisos = useAvisos();

  useEffect(() => {
    if (!estado.tom || !estado.mensagem) return;
    avisos[estado.tom](estado.mensagem);
  }, [estado, avisos]);
}

export type InscricaoProps = {
  /** null quando faltam as chaves VAPID: aqui isso DESLIGA, nao simula. */
  chaveVapid: string | null;
  demo: boolean;
  /** Marcas das inscricoes que ja estao no banco desta conta. */
  marcas: string[];
};

export function Inscricao({ chaveVapid, demo, marcas }: InscricaoProps) {
  const [detectado, setDetectado] = useState<Estado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const avisos = useAvisos();
  const router = useRouter();

  const desligado = !chaveVapid || demo;
  // String em vez do array: prop nova a cada render do servidor reexecutaria o
  // efeito sem que nada tenha mudado de verdade.
  const chaveMarcas = marcas.join("|");

  // Sem chave nao se detecta nada — nem o suporte do navegador. E decisao do
  // servidor, entao ela sai do render e nao de um efeito.
  const estado: Estado = desligado ? "indisponivel" : (detectado ?? "verificando");

  useEffect(() => {
    if (desligado) return;

    let vivo = true;

    lerEstadoDoNavegador(chaveMarcas)
      .then((proximo) => {
        if (vivo) setDetectado(proximo);
      })
      .catch(() => {
        if (vivo) setDetectado("desligado");
      });

    return () => {
      vivo = false;
    };
  }, [desligado, chaveMarcas]);

  const enviarAoServidor = useCallback(async (inscricao: PushSubscription) => {
    const dados = inscricao.toJSON();
    const resposta = await fetch(ENDERECO_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: dados.endpoint,
        p256dh: dados.keys?.p256dh,
        auth: dados.keys?.auth,
      }),
    });

    const erro = await erroDaResposta(resposta);
    if (erro) throw new Error(erro);
  }, []);

  async function ativar() {
    if (!chaveVapid || ocupado) return;
    setOcupado(true);

    try {
      // O pedido de permissao vem ANTES de qualquer outro await: o Safari so
      // aceita `requestPermission` dentro do gesto do usuario, e um await no
      // meio ja perde esse gesto.
      const permissao = await Notification.requestPermission();

      if (permissao !== "granted") {
        setDetectado(permissao === "denied" ? "bloqueado" : "desligado");
        avisos.alerta(
          "Permissão não concedida",
          "Sem ela o navegador não deixa nenhuma notificação aparecer.",
        );
        return;
      }

      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      // `ready` devolve o registro com worker ATIVO; o de `register` pode
      // ainda estar instalando, e assinar nele falha em parte dos navegadores.
      const registro = await navigator.serviceWorker.ready;

      const chave = chaveEmBytes(chaveVapid);
      const existente = await registro.pushManager.getSubscription();

      // Inscricao de chave antiga sai antes: `subscribe` com outra chave sobre
      // uma inscricao viva estoura InvalidStateError em boa parte dos
      // navegadores.
      if (existente && !mesmaChave(existente, chave)) await existente.unsubscribe();

      const inscricao =
        existente && mesmaChave(existente, chave)
          ? existente
          : await registro.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: chave,
            });

      await enviarAoServidor(inscricao);

      setDetectado("inscrito");
      avisos.sucesso("Notificações ligadas", "Este navegador já pode receber avisos.");
      router.refresh();
    } catch (erro) {
      avisos.erro(
        "Não deu para ativar",
        erro instanceof Error ? erro.message : "Tente de novo em alguns segundos.",
      );
    } finally {
      setOcupado(false);
    }
  }

  async function desativar() {
    if (ocupado) return;
    setOcupado(true);

    try {
      const registro = await navigator.serviceWorker.getRegistration("/");
      const inscricao = registro ? await registro.pushManager.getSubscription() : null;

      if (inscricao) {
        // Apaga no servidor ANTES de cancelar no navegador: depois do
        // `unsubscribe` ninguem mais sabe qual linha do banco era esta.
        const resposta = await fetch(ENDERECO_API, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: inscricao.endpoint }),
        });
        const erro = await erroDaResposta(resposta);
        if (erro) throw new Error(erro);

        await inscricao.unsubscribe();
      }

      setDetectado("desligado");
      avisos.sucesso("Notificações desligadas", "Este navegador não recebe mais avisos.");
      router.refresh();
    } catch (erro) {
      avisos.erro(
        "Não deu para desligar",
        erro instanceof Error ? erro.message : "Tente de novo em alguns segundos.",
      );
    } finally {
      setOcupado(false);
    }
  }

  /**
   * Notificacao montada aqui mesmo, para conferir permissao e visual. NAO e um
   * push: nao sai do aparelho e nao prova que o servidor consegue entregar —
   * e por isso o rotulo diz exatamente isso.
   */
  async function verExemplo() {
    try {
      const registro = await navigator.serviceWorker.getRegistration("/");
      if (!registro) return;
      await registro.showNotification("Venda confirmada", {
        body: "Exemplo local · 2× Kit Facial — R$ 129,80",
        icon: "/icons/shopia.svg",
        badge: "/icons/shopia.svg",
        tag: "shopia-exemplo",
        lang: "pt-BR",
        data: { url: "/painel" },
      });
    } catch {
      avisos.erro("O navegador não mostrou o exemplo", "A permissão pode ter mudado.");
    }
  }

  if (estado === "verificando") {
    return (
      <RegiaoCarregando
        carregando
        rotulo="Verificando este navegador"
        className="space-y-2"
      >
        <Esqueleto className="h-5 w-44" />
        <Esqueleto className="h-10 w-56" />
      </RegiaoCarregando>
    );
  }

  if (estado === "indisponivel") {
    return (
      <div className="space-y-3">
        <Button disabled>
          <Bell className="size-4" aria-hidden />
          Ativar neste navegador
        </Button>
        <p className="text-sm text-fg-muted">
          {demo
            ? "No modo demonstração não há onde guardar a inscrição, então o navegador nem é consultado."
            : "Sem as chaves VAPID o aviso nunca sairia — e pedir a permissão à toa queima a única chance de pedir."}
        </p>
      </div>
    );
  }

  if (estado === "sem_suporte") {
    return (
      <Alerta tom="info">
        Este navegador não faz Web Push. No iPhone e no iPad funciona a partir do
        iOS 16.4, e só depois de adicionar a Shopia à tela de início.
      </Alerta>
    );
  }

  if (estado === "bloqueado") {
    return (
      <div className="space-y-3">
        <Alerta tom="info">
          As notificações deste site estão bloqueadas. Abra o cadeado ao lado do
          endereço, permita notificações e recarregue a página — o navegador não
          deixa o site pedir de novo por conta própria.
        </Alerta>
        <Button disabled>
          <BellOff className="size-4" aria-hidden />
          Bloqueado pelo navegador
        </Button>
      </div>
    );
  }

  if (estado === "inscrito") {
    return (
      <div className="space-y-3">
        <Badge tom="sucesso">
          <BellRing className="mr-1.5 size-3.5" aria-hidden />
          Ativo neste navegador
        </Badge>
        <div className="flex flex-wrap gap-2">
          <Button variante="secondary" onClick={desativar} disabled={ocupado}>
            {ocupado ? "Desligando…" : "Desligar aqui"}
          </Button>
          <Button variante="ghost" onClick={verExemplo} disabled={ocupado}>
            <Eye className="size-4" aria-hidden />
            Ver como aparece
          </Button>
        </div>
        <p className="text-xs text-fg-subtle">
          O exemplo é montado pelo seu próprio navegador. Ele confirma a
          permissão e o visual, não que o servidor consegue entregar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {estado === "fora_da_conta" && (
        <Alerta tom="info">
          Este navegador tem uma inscrição que não está nesta conta — costuma
          ser sobra de outro login aqui. Ative de novo para ela voltar a valer
          para você.
        </Alerta>
      )}
      <Button onClick={ativar} disabled={ocupado}>
        <Bell className="size-4" aria-hidden />
        {ocupado
          ? "Ativando…"
          : estado === "fora_da_conta"
            ? "Reativar neste navegador"
            : "Ativar neste navegador"}
      </Button>
      <p className="text-sm text-fg-muted">
        O navegador vai perguntar se aceita notificações. É uma pergunta só, e
        ela vale apenas para este aparelho.
      </p>
    </div>
  );
}

export type FormPreferenciasProps = {
  inicial: PreferenciasPush;
  /** false quando faltam as chaves: as escolhas ficam guardadas mesmo assim. */
  ligado: boolean;
  /** Teto do campo, vindo do servidor — é lá que a regra mora. */
  limiarMaximo: number;
};

export function FormPreferencias({
  inicial,
  ligado,
  limiarMaximo,
}: FormPreferenciasProps) {
  const [estado, acao, enviando] = useActionState(salvarPreferenciasAcao, INICIAL);
  useAvisoDoEstado(estado);

  const [venda, setVenda] = useState(inicial.venda);
  const [queda, setQueda] = useState(inicial.quedaLive);
  const [creditos, setCreditos] = useState(inicial.creditosBaixos);
  const [limiar, setLimiar] = useState(String(inicial.creditosLimiar));

  const mudou =
    venda !== inicial.venda ||
    queda !== inicial.quedaLive ||
    creditos !== inicial.creditosBaixos ||
    limiar.trim() !== String(inicial.creditosLimiar);

  return (
    <form action={acao} className="space-y-5">
      {/* O Interruptor e um <button role="switch">, entao quem leva o valor
          para a action e o campo oculto ao lado dele. */}
      <input type="hidden" name="venda" value={venda ? "1" : "0"} />
      <input type="hidden" name="quedaLive" value={queda ? "1" : "0"} />
      <input type="hidden" name="creditosBaixos" value={creditos ? "1" : "0"} />

      <div className="space-y-4">
        <Interruptor
          ligado={venda}
          aoMudar={setVenda}
          rotulo="Venda confirmada"
          descricao="Cada pedido fechado durante a live, com valor e quantidade."
        />
        <Interruptor
          ligado={queda}
          aoMudar={setQueda}
          rotulo="Queda da live"
          descricao="A extensão parou de responder e a transmissão saiu do ar."
        />
        <Interruptor
          ligado={creditos}
          aoMudar={setCreditos}
          rotulo="Crédito acabando"
          descricao="Aviso antes de faltar áudio no meio de uma transmissão."
        />
      </div>

      <div className="max-w-xs">
        <Campo
          rotulo="Avisar quando o saldo ficar abaixo de"
          htmlFor="limiar"
          dica="Em caracteres — a mesma unidade do saldo e da cobrança."
        >
          <Input
            id="limiar"
            name="limiar"
            type="number"
            inputMode="numeric"
            className="num"
            min={0}
            max={limiarMaximo}
            step={500}
            value={limiar}
            onChange={(evento) => setLimiar(evento.target.value)}
            disabled={!creditos}
            required
          />
        </Campo>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={enviando || !mudou}>
          {enviando ? "Salvando…" : "Salvar preferências"}
        </Button>
        {!ligado && (
          <p className="text-xs text-fg-subtle">
            Ficam guardadas e passam a valer quando o push for ligado.
          </p>
        )}
      </div>
    </form>
  );
}

export function BotaoEsquecer({ id, nome }: { id: string; nome: string }) {
  const [estado, acao, enviando] = useActionState(esquecerDispositivoAcao, INICIAL);
  useAvisoDoEstado(estado);

  return (
    <form action={acao}>
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variante="ghost"
        tamanho="sm"
        disabled={enviando}
        aria-label={`Esquecer ${nome}`}
      >
        <Trash className="size-4" aria-hidden />
        {enviando ? "Esquecendo…" : "Esquecer"}
      </Button>
    </form>
  );
}
