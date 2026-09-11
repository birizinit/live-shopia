import type { Metadata } from "next";
import Link from "next/link";
import { Compass } from "lucide-react";
import { Tour } from "./passos";
import { PageHeader } from "@/components/layout/page-header";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { estadoDoTour } from "@/lib/dados/onboarding";
import { exigirUsuario } from "@/lib/sessao";

export const metadata: Metadata = { title: "Boas-vindas" };

/**
 * O tour da primeira sessao — para onde o cadastro manda o usuario.
 *
 * A tela nao escreve o conteudo: o texto dos passos e semeado em
 * `onboarding_passos` (db/migrations/0009) para o dono do produto reescrever o
 * aviso de risco sem deploy.
 */
export default async function BemVindoPage() {
  const usuario = await exigirUsuario("/bem-vindo");
  const tour = await estadoDoTour(usuario.id);
  const primeiroNome = (usuario.nome || usuario.usuario).split(" ")[0];

  return (
    <>
      <PageHeader
        titulo={`Boas-vindas, ${primeiroNome}`}
        descricao="Alguns minutos para entender por que a ferramenta funciona assim — principalmente o que faz o seu crédito durar o mês inteiro."
      />

      {tour.passos.length === 0 ? (
        <EstadoVazio
          icone={Compass}
          titulo="O tour ainda não foi publicado"
          texto="Nenhum passo ativo em onboarding_passos. Assim que o conteúdo for publicado, ele aparece aqui — sem precisar de nova versão do app."
          acao={
            <Link
              href="/inicio"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
            >
              Ir para o início
            </Link>
          }
        />
      ) : (
        <Tour
          passos={tour.passos}
          indiceInicial={tour.indiceInicial}
          riscoAceitoEm={tour.riscoAceitoEm}
          riscoEmDia={tour.riscoEmDia}
          versaoRisco={tour.versaoRisco}
          demo={Boolean(usuario.demo)}
        />
      )}
    </>
  );
}
