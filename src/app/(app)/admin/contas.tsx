"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/input";
import { Selecao } from "@/components/ui/selecao";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Modal } from "@/components/ui/modal";
import {
  acaoAjustarCreditos,
  acaoConcederCortesia,
  acaoEncerrarCortesia,
  acaoMudarPapel,
  type EstadoAdmin,
} from "./actions";
import type { ContaAdmin, PlanoSimples } from "@/lib/dados/admin";
import { PAPEIS } from "@/lib/roles";
import { numero } from "@/lib/utils";

const INICIAL: EstadoAdmin = {};

const ROTULO_PAPEL: Record<string, string> = {
  user: "Usuário",
  affiliate: "Afiliado",
  manager: "Gerente",
  admin: "Admin",
};

const dia = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

export function PainelContas({
  contas,
  planos,
  busca,
  meuId,
}: {
  contas: ContaAdmin[];
  planos: PlanoSimples[];
  busca: string | null;
  meuId: string;
}) {
  const [aberta, setAberta] = useState<ContaAdmin | null>(null);

  const [cortesia, acaoCortesia, concedendo] = useActionState(acaoConcederCortesia, INICIAL);
  const [encerrar, acaoEncerrar, encerrando] = useActionState(acaoEncerrarCortesia, INICIAL);
  const [papel, acaoPapel, mudandoPapel] = useActionState(acaoMudarPapel, INICIAL);
  const [credito, acaoCredito, ajustando] = useActionState(acaoAjustarCreditos, INICIAL);

  const erro = cortesia.erro ?? encerrar.erro ?? papel.erro ?? credito.erro;
  const feito = cortesia.mensagem ?? encerrar.mensagem ?? papel.mensagem ?? credito.mensagem;

  return (
    <div className="mt-4 space-y-4">
      <form className="flex gap-2" role="search">
        <Input
          name="busca"
          defaultValue={busca ?? ""}
          placeholder="Buscar por e-mail, usuário ou nome"
          aria-label="Buscar conta"
        />
        <Button type="submit" variante="secondary">
          Buscar
        </Button>
      </form>

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {feito && !erro && <Alerta tom="sucesso">{feito}</Alerta>}

      {contas.length === 0 ? (
        <EstadoVazio titulo="Nenhuma conta encontrada" texto="Tente outro termo de busca." />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {contas.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{c.email}</span>
                <span className="block truncate text-sm text-fg-subtle">
                  @{c.usuario} · <span className="num">{numero(c.creditos)}</span> caracteres
                  {c.plano ? ` · ${c.plano} até ${dia(c.planoAte)}` : " · sem acesso"}
                </span>
              </span>

              <span className="flex items-center gap-1.5">
                {c.papel !== "user" && <Badge tom="marca">{ROTULO_PAPEL[c.papel]}</Badge>}
                {c.cortesia && <Badge tom="sucesso">cortesia</Badge>}
                {!c.emailVerificado && <Badge tom="alerta">e-mail pendente</Badge>}
              </span>

              <Button
                variante="secondary"
                tamanho="sm"
                className="ml-auto"
                onClick={() => setAberta(c)}
              >
                Gerenciar
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        aberto={aberta !== null}
        aoFechar={() => setAberta(null)}
        titulo={aberta?.email ?? ""}
      >
        {aberta && (
          <div className="space-y-5">
            <form action={acaoCortesia} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="perfilId" value={aberta.id} />
              <Campo rotulo="Liberar plano" htmlFor="m-plano">
                <Selecao
                  id="m-plano"
                  name="planoId"
                  required
                  opcoes={planos.map((p) => ({ valor: p.id, rotulo: p.nome }))}
                />
              </Campo>
              <Campo rotulo="Por quantos dias" htmlFor="m-dias">
                <Input id="m-dias" name="dias" type="number" min={1} max={3650} defaultValue={30} />
              </Campo>
              <Campo rotulo="Motivo" htmlFor="m-motivo" dica="fica na auditoria">
                <Input id="m-motivo" name="motivo" placeholder="ex.: teste fechado" maxLength={200} />
              </Campo>
              <div className="sm:col-span-3 flex gap-2">
                <Button type="submit" disabled={concedendo}>
                  {concedendo ? "Liberando…" : aberta.plano ? "Estender acesso" : "Liberar acesso"}
                </Button>
                {aberta.cortesia && (
                  <Button
                    type="submit"
                    variante="ghost"
                    formAction={acaoEncerrar}
                    disabled={encerrando}
                  >
                    Encerrar cortesia
                  </Button>
                )}
              </div>
            </form>

            <form action={acaoCredito} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="perfilId" value={aberta.id} />
              <Campo
                rotulo="Ajustar crédito"
                htmlFor="m-delta"
                dica="negativo tira; entra na razão"
              >
                <Input id="m-delta" name="delta" type="number" placeholder="ex.: 30000" />
              </Campo>
              <Campo rotulo="Motivo" htmlFor="m-cmotivo">
                <Input id="m-cmotivo" name="motivo" placeholder="ex.: cortesia extra" maxLength={200} />
              </Campo>
              <div className="flex items-end">
                <Button type="submit" variante="secondary" disabled={ajustando}>
                  Aplicar
                </Button>
              </div>
            </form>

            <form action={acaoPapel} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="perfilId" value={aberta.id} />
              <Campo rotulo="Papel" htmlFor="m-papel">
                <Selecao
                  id="m-papel"
                  name="papel"
                  defaultValue={aberta.papel}
                  opcoes={PAPEIS.map((p) => ({ valor: p, rotulo: ROTULO_PAPEL[p] ?? p }))}
                />
              </Campo>
              <div className="flex items-end">
                <Button
                  type="submit"
                  variante="secondary"
                  disabled={mudandoPapel || aberta.id === meuId}
                >
                  Mudar papel
                </Button>
              </div>
              {aberta.id === meuId && (
                <p className="text-sm text-fg-subtle sm:col-span-3">
                  Você não pode mudar o próprio papel — é assim que alguém fica
                  trancado para fora da operação.
                </p>
              )}
            </form>
          </div>
        )}
      </Modal>
    </div>
  );
}
