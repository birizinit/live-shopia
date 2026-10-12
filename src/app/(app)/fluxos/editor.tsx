"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { AtSign, Clock, MessageSquareReply, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { alternarFluxoAcao, removerFluxoAcao, salvarFluxoAcao, type EstadoFluxo } from "./actions";
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
import { AreaTexto, Selecao } from "@/components/ui/selecao";
import { gatilhoQueCasa, montarResposta, type ModoFluxo } from "@/lib/fluxos";
import { numero } from "@/lib/utils";
import type { Fluxo } from "@/lib/dados/fluxos";

/**
 * O editor de fluxos. Limites chegam por prop (fluxos.ts é server-only); a
 * regra do casamento vem de @/lib/fluxos, que é pura e a mesma da extensão —
 * por isso o "teste aqui" do formulário diz exatamente o que a live fará.
 */

export type LimitesFluxo = {
  quantidade: number;
  nome: number;
  resposta: number;
  respostaMarcando: number;
  atrasoMaxS: number;
  intervaloMaxS: number;
};

const INICIAL: EstadoFluxo = {};
const EXEMPLO = "Mariana";

function useRetorno(estado: EstadoFluxo, aoDarCerto?: () => void) {
  const avisos = useAvisos();
  const visto = useRef<EstadoFluxo | null>(null);
  useEffect(() => {
    if (visto.current === estado) return;
    visto.current = estado;
    if (!estado.ok) return;
    if (estado.mensagem) avisos.sucesso(estado.mensagem);
    aoDarCerto?.();
  }, [estado, avisos, aoDarCerto]);
}

const linhas = (t: string) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function espera(s: number) {
  if (s === 0) return "na hora";
  if (s < 60) return `${numero(s)} s`;
  return `${numero(Math.floor(s / 60))} min${s % 60 ? ` ${numero(s % 60)} s` : ""}`;
}

export function EditorDeFluxos({
  fluxos,
  gatilhoInicial,
  limites,
}: {
  fluxos: Fluxo[];
  gatilhoInicial: string;
  limites: LimitesFluxo;
}) {
  const [aberto, setAberto] = useState(Boolean(gatilhoInicial));
  const [emEdicao, setEmEdicao] = useState<Fluxo | null>(null);
  const cheio = fluxos.length >= limites.quantidade;

  function abrirNovo() {
    setEmEdicao(null);
    setAberto(true);
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-bg-subtle text-fg-muted" aria-hidden>
            <Workflow className="size-4" />
          </span>
          <div className="min-w-0">
            <CardTitulo>Seus fluxos</CardTitulo>
            <CardDescricao>
              Vale o primeiro da lista que casar. Tudo que a Shopia escreve entra no teto de
              mensagens por minuto da conta.
            </CardDescricao>
          </div>
        </div>
        <Button onClick={abrirNovo} disabled={cheio}>
          <Plus className="size-4" aria-hidden />
          Novo fluxo
        </Button>
      </div>

      {fluxos.length === 0 ? (
        <EstadoVazio
          className="mt-4"
          icone={Workflow}
          titulo="Nenhum fluxo ainda"
          texto="Exemplo: quando comentarem “frete”, responder “Frete grátis pra todo o Brasil!” depois de 10 segundos, marcando a pessoa."
          acao={
            <Button onClick={abrirNovo}>
              <Plus className="size-4" aria-hidden />
              Criar o primeiro
            </Button>
          }
        />
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {fluxos.map((f) => (
            <LinhaFluxo
              key={f.id}
              fluxo={f}
              aoEditar={() => {
                setEmEdicao(f);
                setAberto(true);
              }}
            />
          ))}
        </ul>
      )}

      {aberto && (
        <FormularioFluxo
          key={emEdicao?.id ?? "novo"}
          fluxo={emEdicao}
          gatilhoInicial={emEdicao ? "" : gatilhoInicial}
          limites={limites}
          aoFechar={() => setAberto(false)}
        />
      )}
    </Card>
  );
}

function LinhaFluxo({ fluxo, aoEditar }: { fluxo: Fluxo; aoEditar: () => void }) {
  const [estadoAlternar, acaoAlternar] = useActionState(alternarFluxoAcao, INICIAL);
  const [estadoRemover, acaoRemover] = useActionState(removerFluxoAcao, INICIAL);
  const [confirmando, setConfirmando] = useState(false);
  useRetorno(estadoAlternar);
  useRetorno(estadoRemover);
  const erro = estadoAlternar.erro ?? estadoRemover.erro;

  return (
    <li className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-fg">{fluxo.nome}</span>
        <Badge tom={fluxo.modo === "exato" ? "info" : "marca"}>
          {fluxo.modo === "exato" ? "mensagem exata" : "contém"}
        </Badge>
        <Badge tom="neutro">
          <Clock className="size-3" aria-hidden /> {espera(fluxo.atrasoS)}
        </Badge>
        {fluxo.marcar && (
          <Badge tom="neutro">
            <AtSign className="size-3" aria-hidden /> marca
          </Badge>
        )}
        {!fluxo.ativo && <Badge tom="alerta">desligado</Badge>}
        {fluxo.vezesUsado > 0 && (
          <span className="num text-xs text-fg-subtle">respondeu {numero(fluxo.vezesUsado)}×</span>
        )}

        <span className="ml-auto flex items-center gap-1">
          <Button variante="ghost" tamanho="sm" onClick={aoEditar}>
            <Pencil className="size-3.5" aria-hidden />
            <span className="sr-only">Editar o fluxo {fluxo.nome}</span>
          </Button>
          <form action={acaoAlternar}>
            <input type="hidden" name="id" value={fluxo.id} />
            <input type="hidden" name="ligar" value={fluxo.ativo ? "0" : "1"} />
            <Button type="submit" variante="ghost" tamanho="sm">
              {fluxo.ativo ? "Desligar" : "Ligar"}
            </Button>
          </form>
          <Button variante="ghost" tamanho="sm" onClick={() => setConfirmando(true)}>
            <Trash2 className="size-3.5" aria-hidden />
            <span className="sr-only">Remover o fluxo {fluxo.nome}</span>
          </Button>
        </span>
      </div>

      <p className="mt-1.5 text-sm text-fg-muted">
        Quando comentarem{" "}
        {fluxo.gatilhos.map((g, i) => (
          <span key={g}>
            {i > 0 && (i === fluxo.gatilhos.length - 1 ? " ou " : ", ")}
            <strong className="text-fg">“{g}”</strong>
          </span>
        ))}
      </p>
      <p className="mt-1 flex items-start gap-1.5 text-sm text-fg">
        <MessageSquareReply className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <span>
          {fluxo.respostas[0]}
          {fluxo.respostas.length > 1 && (
            <span className="text-fg-subtle"> (+{numero(fluxo.respostas.length - 1)} variação)</span>
          )}
        </span>
      </p>

      {erro && (
        <Alerta tom="erro" className="mt-2">
          {erro}
        </Alerta>
      )}

      <ConfirmarAcao
        aberto={confirmando}
        aoFechar={() => setConfirmando(false)}
        titulo={`Remover o fluxo “${fluxo.nome}”?`}
        rotuloConfirmar="Remover"
        texto={fluxo.respostas[0] ?? ""}
        perdas={["Os gatilhos e as respostas deste fluxo", "A contagem de vezes que ele respondeu"]}
        aoConfirmar={() => {
          const dados = new FormData();
          dados.set("id", fluxo.id);
          startTransition(() => acaoRemover(dados));
          setConfirmando(false);
        }}
      />
    </li>
  );
}

function FormularioFluxo({
  fluxo,
  gatilhoInicial,
  limites,
  aoFechar,
}: {
  fluxo: Fluxo | null;
  gatilhoInicial: string;
  limites: LimitesFluxo;
  aoFechar: () => void;
}) {
  const [estado, acaoSalvar, salvando] = useActionState(salvarFluxoAcao, INICIAL);
  useRetorno(estado, aoFechar);

  const [nome, setNome] = useState(fluxo?.nome ?? (gatilhoInicial ? gatilhoInicial.slice(0, limites.nome) : ""));
  const [modo, setModo] = useState<ModoFluxo>(fluxo?.modo ?? "contem");
  const [gatilhos, setGatilhos] = useState(fluxo?.gatilhos.join("\n") ?? gatilhoInicial);
  const [respostas, setRespostas] = useState(fluxo?.respostas.join("\n") ?? "");
  const [atraso, setAtraso] = useState(String(fluxo?.atrasoS ?? 10));
  const [intervalo, setIntervalo] = useState(String(fluxo?.intervaloS ?? 20));
  const [marcar, setMarcar] = useState(fluxo?.marcar ?? true);
  const [umaVez, setUmaVez] = useState(fluxo?.umaVezPorPessoa ?? true);
  const [ativo, setAtivo] = useState(fluxo?.ativo ?? true);
  const [teste, setTeste] = useState("");

  const regra = { modo, gatilhos: linhas(gatilhos), respostas: linhas(respostas), marcar };
  const teto = marcar ? limites.respostaMarcando : limites.resposta;
  const longa = regra.respostas.find((r) => r.length > teto);
  const casou = teste.trim() ? gatilhoQueCasa(regra, teste) : null;
  const previa = montarResposta(regra, EXEMPLO, 0);

  return (
    <Modal aberto aoFechar={aoFechar} titulo={fluxo ? `Editar: ${fluxo.nome}` : "Novo fluxo"}>
      <form action={acaoSalvar} className="space-y-4">
        {fluxo && <input type="hidden" name="id" value={fluxo.id} />}
        <input type="hidden" name="modo" value={modo} />
        {marcar && <input type="hidden" name="marcar" value="1" />}
        {umaVez && <input type="hidden" name="umaVez" value="1" />}
        {ativo && <input type="hidden" name="ativo" value="1" />}

        <Campo rotulo="Nome do fluxo" htmlFor="fluxo-nome" dica="Só para você achar na lista. Ex.: Frete, Tamanho, Preço">
          <Input id="fluxo-nome" name="nome" value={nome} maxLength={limites.nome} onChange={(e) => setNome(e.target.value)} />
        </Campo>

        <Campo rotulo="Quando o comentário…" htmlFor="fluxo-modo">
          <Selecao
            id="fluxo-modo"
            value={modo}
            onChange={(e) => setModo(e.target.value === "exato" ? "exato" : "contem")}
            opcoes={[
              { valor: "contem", rotulo: "contém a palavra ou frase" },
              { valor: "exato", rotulo: "é exatamente a palavra ou frase" },
            ]}
          />
        </Campo>

        <Campo
          rotulo="Palavras ou frases (uma por linha)"
          htmlFor="fluxo-gatilhos"
          dica="Maiúscula, acento e pontuação não importam: “frete” casa com “FRETE?” e “Frete!”."
        >
          <AreaTexto
            id="fluxo-gatilhos"
            name="gatilhos"
            rows={3}
            value={gatilhos}
            onChange={(e) => setGatilhos(e.target.value)}
            placeholder={"frete\nentrega\nchega quando"}
          />
        </Campo>

        <Campo
          rotulo="Responder (uma por linha; com mais de uma, a Shopia sorteia)"
          htmlFor="fluxo-respostas"
          dica={`até ${numero(teto)} caracteres cada${marcar ? " (o @nome usa o resto)" : ""} · {nome} vira o nome de quem comentou`}
        >
          <AreaTexto
            id="fluxo-respostas"
            name="respostas"
            rows={3}
            value={respostas}
            onChange={(e) => setRespostas(e.target.value)}
            placeholder="Frete grátis pra todo o Brasil acima de R$ 99!"
            aria-invalid={longa ? true : undefined}
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Esperar antes de responder (s)" htmlFor="fluxo-atraso" dica={`0 a ${numero(limites.atrasoMaxS)} · sugestão: 8 a 15`}>
            <Input
              id="fluxo-atraso"
              name="atrasoS"
              type="number"
              inputMode="numeric"
              className="num"
              min={0}
              max={limites.atrasoMaxS}
              value={atraso}
              onChange={(e) => setAtraso(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Intervalo entre respostas deste fluxo (s)" htmlFor="fluxo-intervalo" dica="Evita 10 respostas iguais seguidas">
            <Input
              id="fluxo-intervalo"
              name="intervaloS"
              type="number"
              inputMode="numeric"
              className="num"
              min={0}
              max={limites.intervaloMaxS}
              value={intervalo}
              onChange={(e) => setIntervalo(e.target.value)}
            />
          </Campo>
        </div>

        <div className="space-y-3">
          <Interruptor ligado={marcar} aoMudar={setMarcar} rotulo="Marcar a pessoa" descricao="A resposta começa com @nome de quem comentou." />
          <Interruptor
            ligado={umaVez}
            aoMudar={setUmaVez}
            rotulo="Uma vez por pessoa"
            descricao="Quem repetir o gatilho na mesma live não recebe a resposta de novo."
          />
          <Interruptor ligado={ativo} aoMudar={setAtivo} rotulo="Fluxo ligado" />
        </div>

        <div className="rounded-lg border border-border bg-bg-subtle p-3 text-sm">
          <p className="font-semibold">Prévia</p>
          <p className="mt-1 text-fg-muted">
            {EXEMPLO} comenta, e depois de {espera(Number(atraso) || 0)} sai:
          </p>
          <p className="mt-1 text-fg">{previa ?? "—"}</p>
          <label className="mt-3 block text-xs font-medium text-fg-muted" htmlFor="fluxo-teste">
            Teste um comentário
          </label>
          <Input
            id="fluxo-teste"
            className="mt-1"
            value={teste}
            onChange={(e) => setTeste(e.target.value)}
            placeholder="ex.: qual o frete pra SP?"
          />
          {teste.trim() && (
            <p className={casou ? "mt-1 text-xs text-success" : "mt-1 text-xs text-fg-subtle"}>
              {casou ? `Responde (casou com “${casou}”).` : "Não responde: nenhum gatilho casou."}
            </p>
          )}
        </div>

        {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}
        {longa && (
          <p className="text-xs text-danger">
            Uma resposta passou de {numero(teto)} caracteres — o chat do TikTok cortaria no meio.
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={salvando || Boolean(longa) || !regra.gatilhos.length || !regra.respostas.length || !nome.trim()}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
          <Button type="button" variante="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
