import type { Metadata } from "next";
import { DicaPrimeiraVez } from "@/components/layout/dica-primeira-vez";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import {
  TETO_CATALOGO,
  TETO_ITENS,
  audiosProntos,
  listarMontagens,
  listarTrilhas,
  montagemDoPerfil,
} from "@/lib/dados/montagens";
import { exigirUsuario } from "@/lib/sessao";
import { Montador } from "./montador";

export const metadata: Metadata = { title: "Áudio da live" };

export default async function AudioPage({ searchParams }: PageProps<"/audio">) {
  const usuario = await exigirUsuario("/audio");
  const { m } = await searchParams;

  const pedida = typeof m === "string" ? m : null;
  const montagens = await listarMontagens(usuario.id);

  // O id da URL não escolhe nada sozinho: ele só serve para achar uma linha
  // dentro da lista que já veio filtrada por perfil_id. Id de outra pessoa
  // simplesmente não casa e a tela cai na montagem ativa.
  const escolhida =
    montagens.find((montagem) => montagem.id === pedida) ??
    montagens.find((montagem) => montagem.ativa) ??
    montagens[0] ??
    null;

  const [montagem, trilhas] = await Promise.all([
    escolhida ? montagemDoPerfil(usuario.id, escolhida.id) : Promise.resolve(null),
    listarTrilhas(),
  ]);

  // Os áudios da montagem aberta entram no catálogo mesmo que sejam antigos:
  // item sem título e sem prévia na lista seria pior que lista cortada.
  const catalogo = await audiosProntos(usuario.id, montagem?.audios ?? []);
  const ativa = montagens.find((outra) => outra.ativa) ?? null;

  return (
    <>
      <PageHeader
        titulo="Áudio da live"
        descricao="A live não toca um arquivo de três horas: toca esta lista de áudios, em laço. Gerar a voz cobra crédito uma vez — repetir a lista, nunca."
        acoes={
          ativa ? (
            <Badge tom="sucesso">No ar: {ativa.nome}</Badge>
          ) : (
            <Badge>Nenhuma montagem no ar</Badge>
          )
        }
      />

      <DicaPrimeiraVez
        chave="audio.loop-gratis"
        caminho="/audio"
        titulo="Repetir não custa nada"
      >
        Gerar áudio consome crédito uma vez. A montagem toca essa lista em laço por horas sem gastar de novo — é isso que faz o plano durar. Só gere de novo quando o texto mudar.
      </DicaPrimeiraVez>

      <Montador
        montagem={montagem}
        montagens={montagens}
        catalogo={catalogo}
        trilhas={trilhas}
        tetoItens={TETO_ITENS}
        demo={Boolean(usuario.demo)}
        catalogoCortado={catalogo.length >= TETO_CATALOGO}
      />
    </>
  );
}
