import { Info } from "lucide-react";

/**
 * Da live aberta à Shopia cuidando dela — o roteiro do painel da extensão.
 *
 * A transmissão é da pessoa (LIVE Studio ou app). A extensão age na PÁGINA da
 * live aberta no Chrome: é de lá que ela lê o chat e as vendas, fixa o
 * produto e, se for o caso, encerra a live.
 */

const PASSOS: { titulo: string; texto: string; so?: "produtos" }[] = [
  {
    titulo: "Comece a transmissão e deixe a página da live aberta no Chrome",
    texto:
      "Transmita como você já faz. No Chrome, deixe aberta a página da sua live no tiktok.com — é dela que a Shopia lê o chat, as vendas e os avisos do TikTok.",
  },
  {
    titulo: "Abra o painel da Shopia e toque em “Ligar a extensão”",
    texto:
      "Clique no ícone da Shopia na barra do Chrome. Em “Timer de Encerramento”, escolha 1h a 8h (ou digite os minutos): quando zerar, ela encerra a live sozinha. Ligada, ela detecta a live, lê as vendas e vigia o aviso de violação do TikTok.",
  },
  {
    titulo: "Escolha o que fazer se o TikTok mandar aviso de violação",
    texto:
      "Em “Proteção Contra Violação”: encerrar a live na hora, ou continuar por 10, 20, 30 minutos (ou o tempo que quiser) e então encerrar.",
  },
  {
    titulo: "Para responder o chat, ligue “Ler a tela” no botão ✦ IA",
    texto:
      "Cada comentário vai para o servidor, que escolhe a resposta no seu manual e a escreve no chat. Antes, aceite o aviso de automação na página Ao vivo do app.",
  },
  {
    titulo: "Fixar produto: agora, automático ou com cupom",
    so: "produtos",
    texto:
      "“Fixar produto agora” ou ligue o automático (refixa a cada 18–30 s). Tem cupom no 1º item da lista? Ligue “Tem cupom na lista”. Se o botão não funcionar na sua conta, ensine uma vez em Central → Configurações: aponte a lista, um produto e o botão de fixar.",
  },
];

const ETIQUETA = {
  produtos: "só para fixar produto",
} as const;

export function NoAr() {
  return (
    <>
      <ol className="space-y-4">
        {PASSOS.map((passo, indice) => (
          <li key={passo.titulo} className="flex gap-3 sm:gap-4">
            <span className="num mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-xs font-semibold text-fg-subtle">
              {indice + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">
                {passo.titulo}
                {passo.so && (
                  <span className="ml-2 rounded-full border border-border px-2 py-0.5 align-middle text-[11px] font-normal text-fg-subtle">
                    {ETIQUETA[passo.so]}
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-sm text-fg-muted">{passo.texto}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex gap-3 rounded-md bg-info-soft px-4 py-3 text-info">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">Proteção anti-restrição (no app)</p>
          <p className="mt-1">
            O app revisa, na página Manual, as respostas do seu manual contra o que costuma fazer o TikTok
            restringir uma live — mandar para o WhatsApp, pedir Pix, prometer resultado — e
            aponta qual corrigir, antes de você subir. No ar, as respostas saem com pausa
            de gente e limite por minuto. É proteção de conteúdo: segue as regras do
            TikTok, não esconde a automação. É diferente da “Proteção Contra Violação” da
            extensão, que encerra a live quando o TikTok mostra um aviso.
          </p>
        </div>
      </div>
    </>
  );
}
