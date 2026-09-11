import { FlaskConical, Info, TriangleAlert, X } from "lucide-react";
import { modoDemo, servicos } from "@/lib/env";
import { cn } from "@/lib/utils";

/**
 * Faixa de honestidade sobre o que está ligado de verdade.
 *
 * Sem chave, a funcionalidade vira exemplo rotulado ou fica desligada
 * (src/lib/env.ts). Quem está na tela precisa saber disso ANTES de confundir
 * um roteiro de exemplo com um roteiro gerado para o produto dele.
 *
 * Mostra no máximo UM aviso, o mais grave: a faixa aparece nas 11 telas do
 * app e duas tarjas empilhadas viram moldura — ninguém lê nenhuma das duas.
 *
 * push, e-mail e KYC ficam de fora de propósito. São falhas de uma tela só
 * (a notificação não chega, o botão de verificar some) e cada tela avisa no
 * lugar certo; aqui entra só o que muda o app inteiro.
 */

const ID = "faixa-servico";
const CHAVE_SESSAO = "shopia_faixa";

type Aviso = {
  /** Vai para o sessionStorage: se a causa muda, a faixa volta a aparecer. */
  id: string;
  tom: "alerta" | "info";
  Icone: typeof Info;
  titulo: string;
  texto: string;
};

/** A ordem É a prioridade: o primeiro que casar é o único que aparece. */
function escolherAviso(): Aviso | null {
  if (modoDemo) {
    return {
      id: "demo",
      tom: "alerta",
      Icone: FlaskConical,
      titulo: "Modo demonstração.",
      texto:
        "A sessão é falsa e os dados são de exemplo. Nada do que você fizer aqui é salvo.",
    };
  }

  const semIa = !servicos.roteiroIa;
  const semVoz = !servicos.voz;

  if (semIa || semVoz) {
    return {
      id: semIa && semVoz ? "ia-voz" : semIa ? "ia" : "voz",
      tom: "alerta",
      Icone: TriangleAlert,
      titulo: "Conteúdo de exemplo.",
      texto:
        `Sem chave ${semIa && semVoz ? "de IA e de voz" : semIa ? "de IA" : "de voz"}, ` +
        `${semIa && semVoz ? "roteiros e áudios saem" : semIa ? "os roteiros saem" : "os áudios saem"} ` +
        "como exemplo — não são gerados para o seu produto.",
    };
  }

  if (!servicos.pagamento) {
    return {
      id: "pagamento",
      tom: "info",
      Icone: Info,
      titulo: "Compra desligada.",
      texto:
        "Nenhum gateway está configurado, então não há como pagar por aqui. " +
        "Os créditos que você já tem continuam valendo.",
    };
  }

  return null;
}

/**
 * Dispensar por sessão sem abrir um segundo arquivo.
 *
 * `"use client"` é diretiva de MÓDULO: um componente cliente irmão tornaria
 * este arquivo inteiro cliente, e aí `servicos` leria um process.env vazio no
 * navegador — a faixa sumiria exatamente no caso que ela existe para cobrir.
 * Como o comportamento é um clique e uma leitura de sessionStorage, sai num
 * script inline (mesmo recurso de src/components/theme/theme-script.tsx), que
 * ainda roda antes da pintura e não pisca uma faixa já dispensada.
 *
 * `style.display` em vez de `hidden`: o preflight do Tailwind v4 não declara
 * `[hidden]{display:none}`, e a classe `flex` venceria a regra do navegador.
 */
const SCRIPT = `(function(){
var e=document.getElementById(${JSON.stringify(ID)});if(!e)return;
var k=${JSON.stringify(CHAVE_SESSAO)},v=e.dataset.aviso;
try{if(sessionStorage.getItem(k)===v){e.style.display="none";return}}catch(x){}
var b=e.querySelector("[data-fechar]");
if(b){b.addEventListener("click",function(){e.style.display="none";try{sessionStorage.setItem(k,v)}catch(x){}})}
})();`;

export function FaixaServico() {
  const aviso = escolherAviso();
  if (!aviso) return null;

  const { Icone } = aviso;
  const alerta = aviso.tom === "alerta";

  return (
    <>
      <div
        id={ID}
        data-aviso={aviso.id}
        role="status"
        className={cn(
          "flex items-center gap-2.5 border-b border-border px-4 py-2 text-xs lg:px-8",
          alerta ? "bg-warning-soft" : "bg-info-soft",
        )}
      >
        <Icone
          className={cn("size-3.5 shrink-0", alerta ? "text-warning" : "text-info")}
          aria-hidden
        />
        <p className="min-w-0 flex-1 text-fg-muted">
          <span className="font-semibold text-fg">{aviso.titulo}</span> {aviso.texto}
        </p>
        <button
          type="button"
          data-fechar="1"
          aria-label="Dispensar aviso"
          aria-controls={ID}
          className="-mr-1 shrink-0 rounded-sm p-1 text-fg-subtle transition-colors duration-[--dur-fast] hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </>
  );
}
