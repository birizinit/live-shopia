import type { Metadata } from "next";
import Link from "next/link";
import { Headphones, ShieldCheck } from "lucide-react";
import { PainelClonagem } from "./enviar";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { chaveIdempotente } from "@/lib/dados/creditos";
import {
  FORMATOS_ACEITOS,
  MODOS,
  TETO_BYTES_AMOSTRA,
  TEXTO_CONSENTIMENTO,
  listarAmostras,
  listarIdiomas,
  listarVozesClonadas,
} from "@/lib/dados/clonagem";
import { servicos } from "@/lib/env";
import { PAGINAS } from "@/lib/paginas";
import { exigirUsuario } from "@/lib/sessao";

const ROTA = "/clonar" as const;

export const metadata: Metadata = { title: PAGINAS[ROTA].titulo };

const DICAS = [
  "Grave num cômodo fechado, sem ventilador, TV nem eco de parede vazia.",
  "Fale a 15 cm do microfone, no volume de uma conversa — não de uma locução.",
  "Só uma pessoa na gravação: uma segunda voz ao fundo entra na clonagem.",
  "Nada de música: o modelo aprende a trilha junto com a sua voz.",
  "Leia algo que você venderia mesmo, para a entonação sair como na live.",
] as const;

export default async function ClonarPage() {
  const usuario = await exigirUsuario(ROTA);

  const [amostras, vozes, idiomas] = await Promise.all([
    listarAmostras(usuario.id),
    listarVozesClonadas(usuario.id),
    listarIdiomas(),
  ]);

  // A chave nasce AQUI, no render, e viaja num campo oculto. Gerada dentro da
  // action, cada clique teria uma chave nova e o duplo clique mandaria a mesma
  // amostra duas vezes para o provedor — duas cobranças, duas vozes iguais.
  const chave = chaveIdempotente("clonagem");
  const servicoLigado = servicos.voz;

  return (
    <>
      <PageHeader
        titulo={PAGINAS[ROTA].titulo}
        descricao="Transforme a sua própria voz na apresentadora da live. A amostra só é aceita com o consentimento registrado."
        acoes={
          <Link
            href="/vozes"
            className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Ver catálogo de vozes
          </Link>
        }
      />

      {!servicoLigado && (
        <Alerta tom="erro" className="mb-4">
          A clonagem depende da conta de voz da ElevenLabs, e{" "}
          <code className="font-[family-name:var(--font-mono)] text-xs">
            ELEVENLABS_API_KEY
          </code>{" "}
          não está configurada neste ambiente. O envio fica desabilitado de
          propósito: aceitar a sua amostra para deixá-la parada numa fila que
          ninguém processa seria pior do que dizer que ainda não dá.
        </Alerta>
      )}

      {usuario.demo && (
        <Alerta tom="info" className="mb-4">
          Modo demonstração: as amostras e vozes abaixo são exemplos e o envio
          não grava nada. Entre com uma conta real para clonar a sua voz.
        </Alerta>
      )}

      <PainelClonagem
        chaveInicial={chave}
        servicoLigado={servicoLigado}
        demo={Boolean(usuario.demo)}
        modos={[...MODOS]}
        idiomas={idiomas}
        amostrasIniciais={amostras}
        vozesIniciais={vozes}
        textoConsentimento={TEXTO_CONSENTIMENTO}
        tetoBytes={TETO_BYTES_AMOSTRA}
        formatos={FORMATOS_ACEITOS}
        lateral={
          <>
            <Card>
              <CardTitulo className="flex items-center gap-2">
                <Headphones className="size-4 text-fg-subtle" aria-hidden />
                Amostra que clona bem
              </CardTitulo>
              <ul className="mt-3 space-y-2.5">
                {DICAS.map((dica) => (
                  <li key={dica} className="flex gap-2.5 text-sm text-fg-muted">
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong"
                      aria-hidden
                    />
                    <span>{dica}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="bg-bg-subtle shadow-none">
              <CardTitulo className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-fg-subtle" aria-hidden />
                O que fica registrado
              </CardTitulo>
              <CardDescricao>
                Junto com a amostra guardamos o texto exato do termo que você
                aceitou, a data, a hora e o endereço de IP do aceite. Esse
                registro não se reescreve depois e sobrevive à exclusão da voz —
                é ele que responde quem autorizou o uso desta voz.
              </CardDescricao>
            </Card>
          </>
        }
      />
    </>
  );
}
