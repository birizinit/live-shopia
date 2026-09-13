import {
  AudioLines,
  Cable,
  HandHeart,
  MessagesSquare,
  Repeat,
  TicketPercent,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { RecursosExtensao } from "@/lib/dados/extensao";

/**
 * O que a extensão faz — e o que dela está de pé agora.
 *
 * O selo de cada cartão não é enfeite nem promessa: ele é derivado do estado
 * real. Todo recurso daqui vive DENTRO do pacote, então sem pacote publicado a
 * lista inteira é “Em breve”, sem exceção e sem letra miúda. Com pacote no ar, o
 * que decide é o plano — e “não incluso” é dito assim, não disfarçado de
 * disponível.
 */

type Estado = "disponivel" | "em_breve" | "fora_do_plano";

const SELO: Record<
  Estado,
  { rotulo: string; tom: React.ComponentProps<typeof Badge>["tom"] }
> = {
  disponivel: { rotulo: "Disponível", tom: "sucesso" },
  em_breve: { rotulo: "Em breve", tom: "alerta" },
  fora_do_plano: { rotulo: "Fora do seu plano", tom: "neutro" },
};

type Recurso = {
  icone: React.ComponentType<{ className?: string }>;
  titulo: string;
  texto: string;
  /**
   * Quando o recurso é cobrado por plano, a chave correspondente em
   * `ext_licencas.recursos`. Sem chave, o que decide é só o pacote existir.
   */
  chave?: keyof RecursosExtensao;
};

const RECURSOS: Recurso[] = [
  {
    icone: HandHeart,
    titulo: "Dá boas-vindas por nome",
    texto:
      "Quem entra é cumprimentado pelo apelido que aparece no chat, não por um “olá, pessoal” genérico que todo mundo já aprendeu a ignorar.",
    chave: "chat",
  },
  {
    icone: MessagesSquare,
    titulo: "Responde o chat sozinha",
    texto:
      "Lê os comentários e responde com cadência de gente — sem rajada de mensagens idênticas, que é o padrão que denuncia robô.",
    chave: "chat",
  },
  {
    icone: Repeat,
    titulo: "Narra o roteiro em laço",
    texto:
      "O roteiro volta ao começo quando termina e a live não fica em silêncio. Gerar a voz cobra crédito uma vez; repetir, nunca.",
    chave: "mixer",
  },
  {
    icone: Cable,
    titulo: "Joga a voz no LIVE Studio",
    texto:
      "Entrega o áudio ao cabo virtual, que o LIVE Studio enxerga como um microfone comum. É esse desvio que dispensa apontar um celular para a caixa de som.",
    chave: "mixer",
  },
  {
    icone: AudioLines,
    titulo: "Toca o áudio da live montado",
    texto:
      "A lista que você montou em Áudio da live, na ordem em que você deixou. A extensão toca bloco a bloco, sem baixar um arquivo de três horas.",
    chave: "mixer",
  },
  {
    icone: TicketPercent,
    titulo: "Aciona o cupom e fixa o produto",
    texto:
      "Solta o cupom no momento combinado e destaca na tela o produto de que a apresentadora está falando, sem ninguém clicando nada.",
  },
];

export type RecursosProps = {
  /** Sem arquivo servível, nada disto está em pé — e o cartão precisa dizer. */
  temPacote: boolean;
  /** Nulo enquanto não houver token emitido: aí o plano ainda é desconhecido. */
  recursos: RecursosExtensao | null;
  chatDesligadoNaBase: boolean;
};

export function Recursos({ temPacote, recursos, chatDesligadoNaBase }: RecursosProps) {
  function estadoDe(recurso: Recurso): Estado {
    if (!temPacote) return "em_breve";
    if (recurso.chave && recursos && recursos[recurso.chave] !== true) {
      return "fora_do_plano";
    }
    return "disponivel";
  }

  return (
    <>
      {!temPacote && (
        <p className="mb-4 rounded-md border border-border bg-bg-subtle px-4 py-3 text-sm text-fg-muted">
          <strong className="font-semibold text-fg">
            Hoje a lista inteira está em breve.
          </strong>{" "}
          Cada um destes recursos mora dentro do pacote da extensão, e o pacote ainda não
          foi publicado. É o mesmo motivo para os seis — não há um que já funcione.
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RECURSOS.map((recurso) => {
          const estado = estadoDe(recurso);
          const selo = SELO[estado];
          const Icone = recurso.icone;

          // O chat cai pela base inteira (`ext.chat_desligado`) sem derrubar o
          // áudio junto; o cartão avisa em vez de mentir que está no ar.
          const pausadoNaBase =
            recurso.chave === "chat" && estado === "disponivel" && chatDesligadoNaBase;

          return (
            <li key={recurso.titulo}>
              <Card className="flex h-full flex-col gap-3 p-4 shadow-none sm:p-4">
                <div className="flex items-start justify-between gap-2">
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-fg"
                    aria-hidden
                  >
                    <Icone className="size-4" />
                  </span>
                  <Badge tom={pausadoNaBase ? "info" : selo.tom}>
                    {pausadoNaBase ? "Pausado agora" : selo.rotulo}
                  </Badge>
                </div>

                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-fg">{recurso.titulo}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{recurso.texto}</p>
                  {pausadoNaBase && (
                    <p className="mt-1.5 text-sm text-info">
                      Desligado para toda a base neste momento.
                    </p>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
