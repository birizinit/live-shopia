import { Info } from "lucide-react";

/**
 * Do LIVE Studio aberto à Shopia respondendo — a parte que faltava no passo a
 * passo.
 *
 * Foi aqui que as primeiras clientes travaram: transmitiam pelo LIVE Studio e
 * ficavam esperando a extensão agir, sem saber que o chat é lido pela página da
 * live no tiktok.com e que ela precisa do @ para achar essa página. Cada passo
 * abaixo responde a uma dessas dúvidas.
 */

const PASSOS: { titulo: string; texto: string; so?: "produtos" }[] = [
  {
    titulo: "No Chrome, abra o painel da Shopia",
    texto:
      "Clique no ícone da Shopia na barra do Chrome. O painel abre do lado direito e mostra o que falta para entrar no ar — cada item tem o botão que resolve.",
  },
  {
    titulo: "Escreva o seu @ do TikTok e clique em “Entrar no ar”",
    texto:
      "A Shopia abre a sua live sozinha na mesma janela, se ela ainda não estiver aberta, e começa a ler o chat. O cronômetro corre. Em “Encerrar sozinho depois de”, dá para programar a live para parar em 1, 2, 3 horas ou mais.",
  },
  {
    titulo: "Para fixar produto, ensine uma vez onde ficam os botões",
    so: "produtos",
    texto:
      "Na seção Produtos do painel, clique nos três passos e aponte na sua própria live: a lista, um produto e o botão de fixar. O painel de produtos do LIVE Studio muda de conta para conta — em vez de adivinhar e arriscar clicar no botão errado no meio da sua live, a Shopia pergunta. É uma vez só, fica guardado.",
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
          <p className="font-semibold">Proteção anti-restrição</p>
          <p className="mt-1">
            O painel revisa as respostas do seu manual contra o que costuma fazer o TikTok
            restringir uma live — mandar para o WhatsApp, pedir Pix, prometer resultado — e
            aponta qual corrigir, antes de você subir. No ar, as respostas saem com pausa
            de gente e limite por minuto. É proteção de conteúdo: segue as regras do
            TikTok, não esconde a automação.
          </p>
        </div>
      </div>
    </>
  );
}
