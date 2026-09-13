"use client";

import { useState } from "react";
import { Apple, ExternalLink, Headphones, Monitor, TriangleAlert } from "lucide-react";
import { Abas, PainelAba } from "@/components/ui/abas";
import { BotaoCopiar } from "@/components/ui/copiar";

/**
 * Cabo virtual e LIVE Studio.
 *
 * A seção que mais gera dúvida, então ela começa explicando POR QUE o cabo
 * existe antes de mandar instalar coisa nenhuma: quem não entende que o LIVE
 * Studio só aceita microfone erra o passo da seleção e conclui que o produto
 * não funciona.
 *
 * Abas e não uma lista com desvio no meio: os dois caminhos divergem do
 * primeiro passo ao último, inclusive no que cada sistema NÃO consegue fazer.
 */

type Passo = { titulo: string; texto: string; extra?: React.ReactNode };

function LinkExterno({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden />
      <span className="sr-only">(abre em outra aba)</span>
    </a>
  );
}

const WINDOWS: Passo[] = [
  {
    titulo: "Baixe o VB-Cable",
    texto:
      "É gratuito e é o driver que praticamente todo mundo usa no Windows. O arquivo vem como VBCABLE_Driver_Pack.zip.",
    extra: (
      <p className="mt-2 text-sm">
        <LinkExterno href="https://vb-audio.com/Cable/">vb-audio.com/Cable</LinkExterno>
      </p>
    ),
  },
  {
    titulo: "Extraia o zip antes de instalar",
    texto:
      "Rodar o instalador de dentro do zip falha sem explicar direito o motivo. Extraia primeiro, depois entre na pasta.",
  },
  {
    titulo: "Rode o instalador como administrador",
    texto:
      "Clique com o botão direito em VBCABLE_Setup_x64.exe, escolha Executar como administrador e depois clique em Install Driver. Driver de áudio sem permissão de administrador não instala.",
  },
  {
    titulo: "Reinicie o computador",
    texto:
      "Não é frescura do instalador: antes de reiniciar, o Windows não lista o cabo em lugar nenhum. É aqui que a maioria desiste achando que deu errado.",
  },
  {
    titulo: "Mande só o som do Chrome para o cabo",
    texto:
      "Em Configurações › Sistema › Som › Mixer de volume, ache o Chrome e troque a saída dele para CABLE Input (VB-Audio Virtual Cable). O resto do computador continua saindo no seu fone, como sempre.",
  },
  {
    titulo: "Escolha o cabo como microfone no LIVE Studio",
    texto:
      "Nas configurações de áudio do TikTok LIVE Studio, no campo de microfone, selecione CABLE Output (VB-Audio Virtual Cable). Repare: na saída é Input, no microfone é Output. Trocar os dois é o erro clássico.",
  },
  {
    titulo: "Ligue a escuta para você também ouvir",
    texto:
      "Painel de Controle de Som › Gravação › CABLE Output › Propriedades › Ouvir, marque Ouvir este dispositivo e aponte para o seu fone. Sem isso, tudo funciona mas você fica no escuro — e no escuro ninguém confia que está no ar.",
  },
];

const MAC: Passo[] = [
  {
    titulo: "Baixe o BlackHole 2ch",
    texto:
      "É gratuito e de código aberto. O site pede um e-mail antes do download; quem já usa Homebrew pula essa parte.",
    extra: (
      <div className="mt-2 space-y-2">
        <p className="text-sm">
          <LinkExterno href="https://existential.audio/blackhole/">
            existential.audio/blackhole
          </LinkExterno>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-sm border border-border bg-bg-subtle px-2 py-1 font-[family-name:var(--font-mono)] text-xs text-fg">
            brew install blackhole-2ch
          </code>
          <BotaoCopiar
            texto="brew install blackhole-2ch"
            rotulo="Copiar comando"
            rotuloCopiado="Comando copiado"
          />
        </div>
      </div>
    ),
  },
  {
    titulo: "Rode o instalador .pkg",
    texto:
      "Se o macOS barrar por ser de desenvolvedor não identificado, vá em Ajustes do Sistema › Privacidade e Segurança e clique em Abrir mesmo assim. Depois reinicie.",
  },
  {
    titulo: "Abra o Configuração de Áudio e MIDI",
    texto:
      "Está em Aplicativos › Utilitários. É o painel do macOS onde se montam dispositivos de áudio combinados.",
  },
  {
    titulo: "Crie um Dispositivo de Saída Múltipla",
    texto:
      "No + do canto inferior esquerdo, escolha Criar Dispositivo de Saída Múltipla e marque BlackHole 2ch junto com o seu fone ou alto-falante. É esse truque que faz o som ir para a live e para o seu ouvido ao mesmo tempo.",
  },
  {
    titulo: "Aponte a saída do Mac para esse dispositivo",
    texto:
      "Em Ajustes do Sistema › Som › Saída, selecione o dispositivo múltiplo que você acabou de criar.",
  },
  {
    titulo: "Escolha o BlackHole como microfone no LIVE Studio",
    texto:
      "Nas configurações de áudio do TikTok LIVE Studio, no campo de microfone, selecione BlackHole 2ch. Pronto: o que o Chrome tocar, a live transmite.",
  },
];

export function CaboVirtual() {
  const [sistema, setSistema] = useState("windows");

  return (
    <>
      <div className="rounded-lg border border-border bg-bg-subtle p-4 sm:p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Headphones className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          O que é um cabo virtual, em uma frase
        </h3>
        <p className="mt-2 text-sm text-fg-muted">
          É uma placa de som de mentira: tudo que um programa <em>toca</em> nela, outro
          programa <em>escuta</em> como se fosse um microfone. O cabo é de software, não
          tem ponta nem entra em buraco nenhum do computador.
        </p>
        <p className="mt-2.5 text-sm text-fg-muted">
          Ele existe porque o TikTok LIVE Studio só aceita microfone como fonte de voz —
          não existe nele a opção “transmitir o som desta aba”. Sem o cabo, a saída seria
          apontar um microfone de verdade para a caixa de som, com o chiado do quarto
          junto. Com o cabo, o áudio vai digital e limpo: a Shopia toca de um lado, o LIVE
          Studio ouve do outro.
        </p>
      </div>

      <Abas
        className="mt-5"
        abas={[
          { id: "windows", rotulo: "Windows", icone: Monitor },
          { id: "mac", rotulo: "macOS", icone: Apple },
        ]}
        ativa={sistema}
        aoMudar={setSistema}
        rotulo="Sistema operacional para o cabo virtual"
      >
        <PainelAba id="windows" className="pt-5">
          <Lista passos={WINDOWS} />
        </PainelAba>

        <PainelAba id="mac" className="pt-5">
          <Lista passos={MAC} />

          <div className="mt-5 flex gap-3 rounded-md bg-warning-soft px-4 py-3 text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0 text-sm">
              <span className="font-semibold">No Mac vai tudo, não só o Chrome.</span> O
              macOS roteia áudio por sistema, não por aplicativo: qualquer som que tocar no
              computador entra na live junto. Silencie as notificações antes de subir, ou
              use um segundo perfil do macOS só para transmitir.
            </p>
          </div>
        </PainelAba>
      </Abas>

      <p className="mt-5 text-sm text-fg-muted">
        Vale instalar o cabo mesmo antes de a extensão existir: ele é a mesma peça nos dois
        caminhos. Quem configurar agora para tocar o áudio na mão não vai refazer nada
        quando o pacote sair — a extensão apenas passa a ocupar o lugar do seu clique.
      </p>
    </>
  );
}

function Lista({ passos }: { passos: Passo[] }) {
  return (
    <ol className="space-y-4">
      {passos.map((passo, indice) => (
        <li key={passo.titulo} className="flex gap-3 sm:gap-4">
          <span className="num mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-xs font-semibold text-fg-subtle">
            {indice + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">{passo.titulo}</p>
            <p className="mt-0.5 text-sm text-fg-muted">{passo.texto}</p>
            {passo.extra}
          </div>
        </li>
      ))}
    </ol>
  );
}
