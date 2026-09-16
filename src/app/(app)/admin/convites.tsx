"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/input";
import { Selecao } from "@/components/ui/selecao";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { BotaoCopiar } from "@/components/ui/copiar";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { acaoCriarConvite, acaoRevogarConvite, type EstadoAdmin } from "./actions";
import type { ConviteAdmin, PlanoSimples } from "@/lib/dados/admin";

const INICIAL: EstadoAdmin = {};

function linkDoConvite(codigo: string) {
  // Origem do próprio navegador: em desenvolvimento o link precisa apontar para
  // localhost, e fixar o domínio de produção aqui geraria um link que não
  // funciona justamente para quem está testando.
  const base = typeof window === "undefined" ? "" : window.location.origin;
  return `${base}/cadastro?convite=${codigo}`;
}

export function PainelConvites({
  convites,
  planos,
}: {
  convites: ConviteAdmin[];
  planos: PlanoSimples[];
}) {
  const [criar, acaoCriar, criando] = useActionState(acaoCriarConvite, INICIAL);
  const [revogar, acaoRevogar, revogando] = useActionState(acaoRevogarConvite, INICIAL);

  return (
    <div className="mt-4 space-y-5">
      <form action={acaoCriar} className="grid gap-3 sm:grid-cols-5">
        <Campo rotulo="Plano" htmlFor="planoId">
          <Selecao
            id="planoId"
            name="planoId"
            required
            opcoes={planos.map((p) => ({ valor: p.id, rotulo: p.nome }))}
          />
        </Campo>

        <Campo rotulo="Dias de acesso" htmlFor="dias" dica="por pessoa">
          <Input id="dias" name="dias" type="number" min={1} max={3650} defaultValue={30} />
        </Campo>

        <Campo rotulo="Quantas pessoas" htmlFor="usosMax">
          <Input id="usosMax" name="usosMax" type="number" min={1} max={1000} defaultValue={1} />
        </Campo>

        <Campo rotulo="Código vale por" htmlFor="validadeDias" dica="dias">
          <Input id="validadeDias" name="validadeDias" type="number" min={1} max={365} defaultValue={30} />
        </Campo>

        <Campo rotulo="Para quem" htmlFor="observacao" dica="só você vê">
          <Input id="observacao" name="observacao" placeholder="ex.: teste fechado" maxLength={200} />
        </Campo>

        <div className="sm:col-span-5">
          <Button type="submit" disabled={criando || planos.length === 0}>
            {criando ? "Gerando…" : "Gerar convite"}
          </Button>
        </div>
      </form>

      {criar.erro && <Alerta tom="erro">{criar.erro}</Alerta>}
      {criar.codigo && (
        <Alerta tom="sucesso">
          Convite <strong className="font-[family-name:var(--font-mono)]">{criar.codigo}</strong>{" "}
          criado. Mande este link para a pessoa:
          <span className="mt-2 flex items-center gap-2">
            <code className="truncate rounded-sm bg-surface px-2 py-1 font-[family-name:var(--font-mono)] text-xs">
              {linkDoConvite(criar.codigo)}
            </code>
            <BotaoCopiar texto={linkDoConvite(criar.codigo)} />
          </span>
        </Alerta>
      )}
      {revogar.erro && <Alerta tom="erro">{revogar.erro}</Alerta>}

      {convites.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum convite ainda"
          texto="Gere um código acima e mande o link para quem você quer liberar."
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {convites.map((c) => {
            const morto = !c.ativo || c.esgotado || c.vencido;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
                <code className="font-[family-name:var(--font-mono)] font-semibold tracking-wider">
                  {c.codigo}
                </code>

                {!c.ativo ? (
                  <Badge tom="perigo">revogado</Badge>
                ) : c.vencido ? (
                  <Badge tom="alerta">vencido</Badge>
                ) : c.esgotado ? (
                  <Badge tom="alerta">esgotado</Badge>
                ) : (
                  <Badge tom="sucesso">no ar</Badge>
                )}

                <span className="text-sm text-fg-muted">
                  {c.plano} · {c.dias} dias ·{" "}
                  <span className="num">
                    {c.usos}/{c.usosMax}
                  </span>{" "}
                  {c.usos === 1 ? "uso" : "usos"}
                </span>

                {c.observacao && (
                  <span className="text-sm text-fg-subtle">— {c.observacao}</span>
                )}

                <span className="ml-auto flex items-center gap-2">
                  {!morto && <BotaoCopiar texto={linkDoConvite(c.codigo)} rotulo="Copiar link" />}
                  {c.ativo && (
                    <form action={acaoRevogar}>
                      <input type="hidden" name="conviteId" value={c.id} />
                      <Button
                        type="submit"
                        variante="ghost"
                        tamanho="sm"
                        disabled={revogando}
                      >
                        Revogar
                      </Button>
                    </form>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
