"use client";

import { useActionState, useState } from "react";
import {
  Apple,
  KeyRound,
  Monitor,
  RotateCcw,
  ShieldOff,
  TriangleAlert,
} from "lucide-react";
import {
  emitirTokenAcao,
  revogarLicencaAcao,
  type EstadoTokenForm,
} from "./actions";
import { Abas, PainelAba } from "@/components/ui/abas";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { ConfirmarAcao } from "@/components/ui/confirmar-acao";
import { BotaoCopiar } from "@/components/ui/copiar";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { useAvisos } from "@/components/ui/avisos";
import type { EstadoLicenca } from "@/lib/dados/extensao";

/**
 * A parte interativa da instalação: o token e o passo a passo.
 *
 * Os dois moram no mesmo arquivo porque `"use client"` é diretiva de MÓDULO —
 * e porque instalar começa exatamente aqui: sem token, nenhum dos passos
 * seguintes faz sentido.
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
                Guardamos apenas um resumo criptográfico dele — nem nós
                conseguimos mostrá-lo de novo.
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
          texto="A extensão prova quem é apresentando um token. É ele que libera o mixer de áudio e, conforme o plano, as respostas no chat."
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
            <Button
              variante="ghost"
              onClick={() => setConfirmando(true)}
              disabled={demo}
            >
              <ShieldOff className="size-4" aria-hidden />
              Revogar licença
            </Button>
          )}
        </div>
      )}

      {demo && (
        <Alerta tom="info">
          Modo demonstração: a licença desta tela é exemplo. Sem banco
          configurado, nada é emitido de verdade.
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
          "O mixer de áudio e as respostas no chat saem do ar em todas as máquinas",
          "O token atual deixa de valer e precisa ser gerado de novo",
        ]}
        rotuloConfirmar="Revogar"
      />
    </div>
  );
}

/**
 * Passo a passo da instalação.
 *
 * Windows e Mac em abas e não numa lista só: o caminho diverge no meio (pasta,
 * atalho de teclado, o alerta de segurança do macOS), e uma lista com "se você
 * usa Mac, pule para o passo 5" é lida errado por metade das pessoas.
 */

type Passo = { titulo: string; texto: string };

const COMUNS = (temPacote: boolean): Passo[] => [
  {
    titulo: "Gere e copie o token da licença",
    texto:
      "É o passo acima nesta mesma página. Sem ele a extensão instala, mas não opera.",
  },
  {
    titulo: temPacote ? "Baixe o pacote" : "Aguarde o pacote",
    texto: temPacote
      ? "O botão de download fica no cartão “Pacote”, aqui ao lado. O arquivo é um .zip."
      : "Nenhuma versão foi publicada até agora. Quando houver, o botão de download aparece no cartão “Pacote”.",
  },
];

const WINDOWS: Passo[] = [
  {
    titulo: "Descompacte em uma pasta definitiva",
    texto:
      "Algo como C:\\Shopia\\extensao. Se você apagar ou mover essa pasta, o Chrome desliga a extensão.",
  },
  {
    titulo: "Abra chrome://extensions",
    texto: "Cole o endereço na barra do Chrome e tecle Enter.",
  },
  {
    titulo: "Ligue o Modo do desenvolvedor",
    texto: "O interruptor fica no canto superior direito da página.",
  },
  {
    titulo: "Clique em “Carregar sem compactação”",
    texto: "Selecione a pasta que você descompactou — a pasta, não o arquivo .zip.",
  },
  {
    titulo: "Fixe a extensão na barra",
    texto:
      "Clique no ícone de peça de quebra-cabeça ao lado da barra de endereço e no alfinete da Shopia.",
  },
  {
    titulo: "Cole o token e conecte",
    texto:
      "Abra a extensão, cole o token e clique em conectar. O estado da licença aparece nesta página em até dois minutos.",
  },
];

const MAC: Passo[] = [
  {
    titulo: "Descompacte em uma pasta definitiva",
    texto:
      "Algo como ~/Aplicativos/Shopia. Evite a pasta Downloads: o macOS limpa essa pasta e a extensão desliga junto.",
  },
  {
    titulo: "Abra chrome://extensions",
    texto: "Cole o endereço na barra do Chrome e tecle Return.",
  },
  {
    titulo: "Ligue o Modo do desenvolvedor",
    texto: "O interruptor fica no canto superior direito da página.",
  },
  {
    titulo: "Clique em “Carregar sem compactação”",
    texto:
      "Se o Finder não deixar escolher a pasta descompactada, clique com a tecla Control, escolha Abrir uma vez e tente de novo.",
  },
  {
    titulo: "Autorize o microfone e o áudio do sistema",
    texto:
      "Em Ajustes do Sistema › Privacidade e Segurança, libere o Chrome. Sem isso o mixer não encontra a saída de áudio.",
  },
  {
    titulo: "Cole o token e conecte",
    texto:
      "Abra a extensão, cole o token e clique em conectar. O estado da licença aparece nesta página em até dois minutos.",
  },
];

export function PassosInstalacao({ temPacote }: { temPacote: boolean }) {
  const [sistema, setSistema] = useState("windows");

  return (
    <Abas
      abas={[
        { id: "windows", rotulo: "Windows", icone: Monitor },
        { id: "mac", rotulo: "macOS", icone: Apple },
      ]}
      ativa={sistema}
      aoMudar={setSistema}
      rotulo="Sistema operacional"
    >
      <PainelAba id="windows" className="pt-4">
        <Lista passos={[...COMUNS(temPacote), ...WINDOWS]} />
      </PainelAba>
      <PainelAba id="mac" className="pt-4">
        <Lista passos={[...COMUNS(temPacote), ...MAC]} />
      </PainelAba>
    </Abas>
  );
}

function Lista({ passos }: { passos: Passo[] }) {
  return (
    <ol className="space-y-3">
      {passos.map((passo, indice) => (
        <li key={passo.titulo} className="flex gap-3">
          <span className="num mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-border text-xs font-semibold text-fg-subtle">
            {indice + 1}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-fg">{passo.titulo}</span>
            <span className="mt-0.5 block text-sm text-fg-muted">{passo.texto}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
