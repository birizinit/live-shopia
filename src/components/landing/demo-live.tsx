"use client";

import { useEffect, useState } from "react";
import { Bell, Eye, ShieldCheck, ShoppingCart, Sparkles, Timer, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A live acontecendo, em loop: alguém pergunta, a Shopia responde marcando a
 * pessoa, alguém põe no carrinho, a venda chega no celular. É o produto
 * mostrado em vez de descrito — e são as mesmas coisas que a extensão faz.
 *
 * Com "reduzir movimento" ligado, fica parada no último quadro.
 */

type Item =
  | { tipo: "msg"; id: number; nome: string; texto: string }
  | { tipo: "resposta"; id: number; texto: string; origem: string }
  | { tipo: "digitando"; id: number }
  | { tipo: "carrinho"; id: number; texto: string };

type Passo = { ms: number; item?: Item; tira?: number; carrinho?: boolean; venda?: boolean };

const ROTEIRO: Passo[] = [
  { ms: 600, item: { tipo: "msg", id: 1, nome: "Ana", texto: "qual o frete pra SP?" } },
  { ms: 1500, item: { tipo: "digitando", id: 2 } },
  { ms: 2700, tira: 2, item: { tipo: "resposta", id: 3, texto: "@Ana Frete grátis pra todo o Brasil acima de R$ 99!", origem: "Fluxo · frete" } },
  { ms: 3900, item: { tipo: "carrinho", id: 4, texto: "Bia colocou o Sérum Vitamina C no carrinho" }, carrinho: true },
  { ms: 5100, item: { tipo: "msg", id: 5, nome: "Carla", texto: "tem cupom??" } },
  { ms: 6000, item: { tipo: "digitando", id: 6 } },
  { ms: 7200, tira: 6, item: { tipo: "resposta", id: 7, texto: "@Carla Use o cupom LIVE10 no produto fixado!", origem: "Fluxo · cupom" } },
  { ms: 8400, venda: true },
];
const CICLO_MS = 12800;

function rodar(ate: number) {
  let itens: Item[] = [];
  let carrinhos = 12;
  let vendas = 7;
  let notif = false;
  for (const p of ROTEIRO.slice(0, ate)) {
    if (p.tira) itens = itens.filter((i) => i.id !== p.tira);
    if (p.item) itens = [...itens, p.item];
    if (p.carrinho) carrinhos += 1;
    if (p.venda) {
      vendas += 1;
      notif = true;
    }
  }
  return { itens: itens.slice(-5), carrinhos, vendas, notif };
}

export function DemoLive() {
  const [passo, setPasso] = useState(ROTEIRO.length);
  const [rodada, setRodada] = useState(0);
  const [segundos, setSegundos] = useState(2 * 3600 - 28);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers = ROTEIRO.map((p, i) => setTimeout(() => setPasso(i + 1), p.ms));
    timers.push(setTimeout(() => setPasso(0), 0));
    const volta = setTimeout(() => setRodada((r) => r + 1), CICLO_MS);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(volta);
    };
  }, [rodada]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setSegundos((s) => (s > 0 ? s - 1 : 2 * 3600)), 1000);
    return () => clearInterval(t);
  }, []);

  const { itens, carrinhos, vendas, notif } = rodar(passo);
  const relogio = [Math.floor(segundos / 3600), Math.floor((segundos % 3600) / 60), segundos % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");

  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-label="Demonstração: a Shopia cuidando do chat de uma live" role="img">
      {/* Notificação de venda no celular */}
      {notif && (
        <div
          key={`notif-${rodada}`}
          className="lp-notif absolute -bottom-8 left-3 z-20 flex w-64 items-center gap-3 rounded-2xl border border-border bg-surface-raised p-3 shadow-lg sm:-left-8"
        >
          <span className="lp-onda grid size-9 shrink-0 place-items-center rounded-xl text-white" style={{ background: "var(--brand-gradient)" }}>
            <Bell className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-fg">Nova venda na live!</p>
            <p className="truncate text-xs text-fg-muted">R$ 79,90 · Sérum Vitamina C</p>
          </div>
        </div>
      )}

      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
        {/* Topo: estado da live */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2 py-0.5 font-semibold text-danger">
            <span className="lp-pulso size-1.5 rounded-full bg-danger" />
            AO VIVO
          </span>
          <span className="inline-flex items-center gap-1 text-fg-muted">
            <Eye className="size-3.5" aria-hidden />
            <span className="num">{128 + vendas * 3}</span>
          </span>
          <span className="ml-auto inline-flex items-center gap-1 font-[family-name:var(--font-mono)] text-fg-muted">
            <Timer className="size-3.5" aria-hidden />
            {relogio}
          </span>
        </div>

        <div className="grid sm:grid-cols-[1fr_150px]">
          {/* Chat */}
          <div className="flex h-[300px] flex-col justify-end gap-2.5 overflow-hidden p-4">
            {itens.map((i) => (
              <div key={`${rodada}-${i.id}`} className="lp-entra">
                {i.tipo === "msg" && (
                  <p className="text-sm">
                    <span className="font-semibold text-fg-muted">{i.nome}</span>{" "}
                    <span className="text-fg">{i.texto}</span>
                  </p>
                )}
                {i.tipo === "digitando" && (
                  <p className="lp-digitando inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-2 text-primary-soft-fg">
                    <span />
                    <span />
                    <span />
                  </p>
                )}
                {i.tipo === "resposta" && (
                  <div className="ml-6 rounded-xl rounded-tl-sm border border-primary-border bg-primary-soft px-3 py-2">
                    <p className="flex items-center gap-1 text-[11px] font-semibold text-primary-soft-fg">
                      <Sparkles className="size-3" aria-hidden /> Shopia · {i.origem}
                    </p>
                    <p className="mt-0.5 text-sm text-fg">{i.texto}</p>
                  </div>
                )}
                {i.tipo === "carrinho" && (
                  <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-3 py-1 text-xs text-fg-muted">
                    <ShoppingCart className="size-3.5 text-primary" aria-hidden />
                    {i.texto}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Painel lateral */}
          <div className="hidden flex-col gap-2 border-l border-border bg-bg-subtle p-3 sm:flex">
            <Contador rotulo="Carrinhos" valor={carrinhos} />
            <Contador rotulo="Vendas" valor={vendas} destaque />
            <div className="mt-auto space-y-1.5 text-[11px] text-fg-muted">
              <p className="flex items-center gap-1.5">
                <Workflow className="size-3.5 text-primary" aria-hidden /> 4 fluxos ligados
              </p>
              <p className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-primary" aria-hidden /> Proteção ativa
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Contador({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[10px] font-semibold tracking-wide text-fg-subtle uppercase">{rotulo}</p>
      <p key={valor} className={cn("lp-entra num text-xl font-bold", destaque ? "text-primary" : "text-fg")}>
        {valor}
      </p>
    </div>
  );
}
