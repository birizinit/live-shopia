"use client";

import { useState } from "react";
import { LogIn, ShieldOff } from "lucide-react";
import { revogarLicencaAcao } from "./actions";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { ConfirmarAcao } from "@/components/ui/confirmar-acao";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { useAvisos } from "@/components/ui/avisos";
import type { EstadoLicenca } from "@/lib/dados/extensao";

/**
 * A conta conectada na extensão.
 *
 * Desde a 3.0 a extensão entra com e-mail e senha (/api/ext/entrar), e é esse
 * login que emite — e rotaciona — o token da licença. Ninguém copia nem cola
 * token. Daqui só se DESCONECTA: útil quando a máquina não é mais sua.
 */

export type PainelLicencaProps = {
  estado: EstadoLicenca;
  /** Modo demo não revoga nada, e o botão precisa dizer isso antes do clique. */
  demo: boolean;
};

export function PainelLicenca({ estado, demo }: PainelLicencaProps) {
  const [confirmando, setConfirmando] = useState(false);
  const avisos = useAvisos();

  const conectada = estado === "ativa";

  async function desconectar() {
    const resultado = await revogarLicencaAcao();
    if (resultado.ok) {
      avisos.sucesso(
        "Extensão desconectada",
        "Ela sai da sua conta no próximo contato com o servidor.",
      );
    } else {
      avisos.erro("Não deu para desconectar", resultado.erro);
    }
    setConfirmando(false);
  }

  return (
    <div className="space-y-4">
      {!conectada ? (
        <EstadoVazio
          icone={LogIn}
          titulo="Nenhuma extensão conectada"
          texto="Instale a extensão, clique no ícone da Shopia e entre com o mesmo e-mail e senha do app. 1 conta = 1 dispositivo: entrar em outra máquina desconecta a anterior."
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variante="ghost" onClick={() => setConfirmando(true)} disabled={demo}>
            <ShieldOff className="size-4" aria-hidden />
            Desconectar a extensão
          </Button>
        </div>
      )}

      {demo && (
        <Alerta tom="info">
          Modo demonstração: a conta desta tela é exemplo. Sem banco configurado, nada é
          desconectado de verdade.
        </Alerta>
      )}

      <ConfirmarAcao
        aberto={confirmando}
        aoFechar={() => setConfirmando(false)}
        aoConfirmar={desconectar}
        titulo="Desconectar a extensão?"
        texto="Use isto quando a máquina onde a extensão está instalada não for mais sua."
        perdas={[
          "A extensão sai da sua conta no próximo contato com o servidor",
          "Timer, fixar produto e respostas no chat param naquela máquina",
          "Para voltar, entre de novo com e-mail e senha no painel da extensão",
        ]}
        rotuloConfirmar="Desconectar"
      />
    </div>
  );
}
