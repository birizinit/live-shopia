import type { Metadata } from "next";
import Link from "next/link";
import { MicVocal } from "lucide-react";
import { BotaoSincronizar, Catalogo } from "./catalogo";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { paginaDeVozes } from "@/lib/dados/vozes";
import { servicos } from "@/lib/env";
import { temPapel } from "@/lib/roles";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Vozes" };

/**
 * Catálogo de vozes e escolha da apresentadora da live.
 *
 * Server Component: a leitura é do banco e a tela nasce pronta. O que tem
 * estado — filtro, prévia tocando, botão de definir — mora no cliente
 * (./catalogo.tsx), e a mutação é Server Action (./actions.ts).
 *
 * A promessa desta tela em src/lib/paginas.ts é "prévia de cada voz ANTES de
 * gastar crédito". Ela é cumprida ao pé da letra: nenhum caminho daqui até o
 * áudio de prévia passa pela razão de créditos, e a síntese acontece uma vez
 * por voz — a segunda pessoa a clicar ouve o arquivo que a primeira gerou.
 */
export default async function VozesPage() {
  const usuario = await exigirUsuario("/vozes");
  const { catalogo, minhas, vozAtiva, exemplo } = await paginaDeVozes(usuario.id);

  const admin = temPapel(usuario.papel, ["admin"]);
  const detalhe = vozAtiva
    ? [vozAtiva.idiomaNome, vozAtiva.sotaque, vozAtiva.categoria].filter(Boolean).join(" · ")
    : null;

  return (
    <>
      <PageHeader
        titulo="Vozes"
        descricao="Escute antes de escolher. A prévia não gasta crédito — quem gasta é a geração do áudio, no estúdio."
        acoes={admin ? <BotaoSincronizar vozLigada={servicos.voz} /> : undefined}
      />

      {!servicos.voz && (
        <Alerta tom="info" className="mb-6">
          {exemplo ? (
            <>
              <strong className="font-semibold">Catálogo de exemplo.</strong> Sem a chave
              da ElevenLabs (<code className="font-[family-name:var(--font-mono)] text-xs">ELEVENLABS_API_KEY</code>
              ) não há catálogo real para mostrar, então estas oito vozes existem só para a
              tela ter o que mostrar — nenhuma delas foi gerada por IA e nenhuma pode virar
              a voz da live. A prévia toca um tom rotulado, não um timbre.
            </>
          ) : (
            <>
              <strong className="font-semibold">Síntese desligada.</strong> Sem a chave da
              ElevenLabs, as vozes abaixo continuam valendo como escolha, mas a prévia que
              ainda não existir sai como tom rotulado em vez do timbre real.
            </>
          )}
        </Alerta>
      )}

      <Card className="mb-6 flex flex-wrap items-center gap-4">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-full bg-primary-soft text-xl text-primary-soft-fg"
          aria-hidden
        >
          {vozAtiva ? vozAtiva.bandeira : <MicVocal className="size-5" />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-xs text-fg-subtle">Voz ativa da live</p>

          {vozAtiva ? (
            <>
              <p className="flex flex-wrap items-center gap-2">
                <span className="truncate text-lg font-semibold">{vozAtiva.nome}</span>
                {vozAtiva.origem === "clonada" && <Badge>Clonada</Badge>}
                {vozAtiva.premium && <Badge tom="alerta">Premium</Badge>}
              </p>
              {detalhe && <p className="truncate text-sm text-fg-muted">{detalhe}</p>}
            </>
          ) : (
            <p className="text-sm text-fg-muted">
              Nenhuma escolhida ainda. Ouça as prévias abaixo e clique em{" "}
              <span className="font-medium text-fg">Usar na live</span> na que combinar com
              o seu produto.
            </p>
          )}
        </div>

        {vozAtiva && (
          <Link
            href="/estudio"
            className="inline-flex h-9 shrink-0 items-center rounded-md border border-border px-4 text-sm font-medium transition-colors duration-[--dur-fast] hover:bg-surface-hover"
          >
            Gerar áudio com ela
          </Link>
        )}
      </Card>

      <Catalogo catalogo={catalogo} minhas={minhas} vozAtivaId={vozAtiva?.id ?? null} />
    </>
  );
}
