"use client";

import { useActionState, useState } from "react";
import { KeyRound, RotateCcw, ShieldOff, TriangleAlert } from "lucide-react";
import { emitirTokenAcao, revogarLicencaAcao, type EstadoTokenForm } from "./actions";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { ConfirmarAcao } from "@/components/ui/confirmar-acao";
import { BotaoCopiar } from "@/components/ui/copiar";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { useAvisos } from "@/components/ui/avisos";
import type { EstadoLicenca } from "@/lib/dados/extensao";

/**
 * A parte interativa da licença: emitir, rotacionar e revogar o token.
 *
 * É o único pedaço desta tela que precisa de estado no cliente. Os passos de
 * instalação e o cabo virtual saíram daqui para arquivos próprios: só o cabo
 * guarda estado (a aba do sistema), e o resto virou Server Component — texto
 * que não muda não precisa atravessar o bundle.
 */

const INICIAL: EstadoTokenForm = {};

export type PainelLicencaProps = {
  estado: EstadoLicenca;
  /** Modo demo não emite nada, e o botão precisa dizer isso antes do clique. */
  demo: boolean;
};

export function PainelLicenca({ estado, demo }: PainelLicencaProps) {
  const [forma, acao, emitindo] = useActionState(emitirTokenAcao, INICIAL);
  const [confirmando, setConfirmando] = useState(false);
  const avisos = useAvisos();

  const temLicenca = estado !== "sem_licenca";

  async function revogar() {
    const resultado = await revogarLicencaAcao();
    if (resultado.ok) {
      avisos.sucesso(
        "Licença revogada",
        "A extensão para de operar no próximo contato com o servidor.",
      );
    } else {
      avisos.erro("Não deu para revogar", resultado.erro);
    }
    setConfirmando(false);
  }

  return (
    <div className="space-y-4">
      {forma.erro && <Alerta tom="erro">{forma.erro}</Alerta>}

      {forma.token && (
        <div className="rounded-md border border-primary-border bg-primary-soft p-4">
          <div className="flex items-start gap-2.5">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-primary-soft-fg"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-primary-soft-fg">
                Copie agora. Este token aparece uma vez só.
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                Guardamos apenas um resumo criptográfico dele — nem nós conseguimos
                mostrá-lo de novo.
                {forma.rotacionado &&
                  " O token anterior morreu agora: reinstale nas máquinas que usavam ele."}
              </p>

              <p className="mt-3 overflow-x-auto rounded-sm border border-primary-border bg-surface px-2.5 py-2 font-[family-name:var(--font-mono)] text-xs break-all text-fg">
                {forma.token}
              </p>

              <div className="mt-3">
                <BotaoCopiar
                  texto={forma.token}
                  rotulo="Copiar token"
                  rotuloCopiado="Token copiado"
                  aoCopiar={() =>
                    avisos.info("Token na área de transferência", "Cole na extensão.")
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {!temLicenca && !forma.token ? (
        <EstadoVazio
          icone={KeyRound}
          titulo="Nenhum token emitido"
          texto="A extensão prova quem é apresentando um token. É ele que libera o áudio no LIVE Studio e, conforme o plano, as respostas no chat."
          acao={
            <form action={acao}>
              <input type="hidden" name="jaTinha" value="0" />
              <Button type="submit" disabled={emitindo || demo}>
                {emitindo ? "Gerando…" : "Gerar token"}
              </Button>
            </form>
          }
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <form action={acao}>
            <input type="hidden" name="jaTinha" value={temLicenca ? "1" : "0"} />
            <Button
              type="submit"
              variante="secondary"
              disabled={emitindo || demo}
              title="Gera um token novo e derruba o atual"
            >
              <RotateCcw className="size-4" aria-hidden />
              {emitindo ? "Gerando…" : "Gerar token novo"}
            </Button>
          </form>

          {estado !== "revogada" && (
            <Button variante="ghost" onClick={() => setConfirmando(true)} disabled={demo}>
              <ShieldOff className="size-4" aria-hidden />
              Revogar licença
            </Button>
          )}
        </div>
      )}

      {demo && (
        <Alerta tom="info">
          Modo demonstração: a licença desta tela é exemplo. Sem banco configurado, nada é
          emitido de verdade.
        </Alerta>
      )}

      <ConfirmarAcao
        aberto={confirmando}
        aoFechar={() => setConfirmando(false)}
        aoConfirmar={revogar}
        titulo="Revogar a licença da extensão?"
        texto="Use isto quando a máquina onde a extensão está instalada não for mais sua."
        perdas={[
          "A extensão para de operar no próximo contato com o servidor",
          "O áudio no LIVE Studio e as respostas no chat saem do ar em todas as máquinas",
          "O token atual deixa de valer e precisa ser gerado de novo",
        ]}
        rotuloConfirmar="Revogar"
      />
    </div>
  );
}
