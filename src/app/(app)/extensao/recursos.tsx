import {
  BellRing,
  MessageSquareText,
  MessagesSquare,
  MonitorCheck,
  Pin,
  ShieldAlert,
  ShieldCheck,
  Timer,
  UserX,
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
    icone: Timer,
    titulo: "Timer de encerramento",
    texto:
      "Você escolhe a duração (1h a 8h, ou os minutos que quiser) e ela encerra a live sozinha quando zerar. Dá para pausar e retomar no meio.",
  },
  {
    icone: ShieldAlert,
    titulo: "Proteção contra violação",
    texto:
      "Vigia a tela da live e, se o TikTok mostrar aviso de violação, encerra na hora — ou continua pelo tempo que você escolher e então encerra.",
  },
  {
    icone: Pin,
    titulo: "Fixa o produto na tela",
    texto:
      "Na página da sua live: agora, ou automático a cada 18–30 s. Com “Tem cupom na lista”, pula o card do cupom e fixa o produto de baixo. Se a sua conta tiver um layout diferente, você ensina o botão uma vez.",
  },
  {
    icone: MessageSquareText,
    titulo: "Comentários automáticos",
    texto:
      "Uma mensagem por linha, postadas em rodízio no chat com intervalo aleatório entre o mínimo e o máximo que você definir.",
  },
  {
    icone: UserX,
    titulo: "Bloqueio por nome",
    texto:
      "Quem entra na live com uma palavra da sua lista no nome (“sorteio”, “promo”, “link”) é bloqueado na hora. A lista dos bloqueados fica para baixar.",
  },
  {
    icone: BellRing,
    titulo: "Aviso de venda no celular",
    texto:
      "Cada venda que aparece na tela da live vira notificação no app Shopia do seu celular, com som de caixa registradora no computador.",
  },
  {
    icone: MessagesSquare,
    titulo: "Responde o chat pelo manual",
    texto:
      "Com “Ler a tela” ligado, cada comentário vai ao servidor, que escolhe a resposta no seu manual — sem mudar uma palavra — e dá boas-vindas pelo nome. Pergunta fora do manual ela deixa passar e anota.",
    chave: "chat",
  },
  {
    icone: ShieldCheck,
    titulo: "Revisa o manual antes da live",
    texto:
      "Procura no manual as frases que costumam fazer o TikTok restringir a live — mandar para o WhatsApp, pedir Pix por fora, prometer resultado — e aponta qual resposta corrigir.",
  },
  {
    icone: MonitorCheck,
    titulo: "Roda só no navegador",
    texto:
      "Nada de driver, cabo de áudio ou programa instalado no sistema. O Chrome com a página da sua live aberta é tudo de que ela precisa.",
  },
];

export type RecursosProps = {
  /** Sem arquivo servível, nada disto está em pé — e o cartão precisa dizer. */
  temPacote: boolean;
  /** Nulo enquanto a extensão não entrou na conta: aí o plano ainda é desconhecido. */
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
          foi publicado. É o mesmo motivo para todos — não há um que já funcione.
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RECURSOS.map((recurso) => {
          const estado = estadoDe(recurso);
          const selo = SELO[estado];
          const Icone = recurso.icone;

          // O chat cai pela base inteira por `ext.chat_desligado`; o cartão avisa
          // em vez de mentir que está no ar.
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
