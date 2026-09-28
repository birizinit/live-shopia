import { Info } from "lucide-react";

/**
 * Do LIVE Studio aberto à apresentadora falando — a parte que faltava no
 * passo a passo.
 *
 * Foi aqui que as primeiras clientes travaram: transmitiam pelo LIVE Studio,
 * abriam a extensão e viam "(sem nome)" no cabo, sem nada para tocar e sem
 * saber que o chat é lido pela página da live no tiktok.com. Cada passo abaixo
 * responde a uma dessas dúvidas.
 */

const PASSOS: { titulo: string; texto: string }[] = [
  {
    titulo: "No LIVE Studio, escolha o cabo como microfone",
    texto:
      "Nas configurações de áudio, o microfone é o cabo virtual: CABLE Output no Windows, BlackHole 2ch no Mac. Pode começar a transmitir normalmente.",
  },
  {
    titulo: "No Chrome, abra o painel da Shopia",
    texto:
      "Clique no ícone da Shopia na barra do Chrome. O painel mostra o que falta para entrar no ar — áudio, cabo e chat — e cada item tem o botão que resolve.",
  },
  {
    titulo: "Na primeira vez, clique em “Liberar acesso”",
    texto:
      "Sem essa permissão o Chrome esconde o nome das saídas de áudio e o cabo aparece como “sem nome”. Abre uma aba, você clica em Permitir e volta: o cabo passa a ser achado sozinho.",
  },
  {
    titulo: "Abra a página da sua live no tiktok.com",
    texto:
      "Use o botão “Abrir minha live no TikTok” do painel, na mesma janela do Chrome. É por essa página que a Shopia lê o chat para dar boas-vindas e responder. O áudio funciona mesmo sem ela.",
  },
  {
    titulo: "Clique em “Entrar no ar”",
    texto:
      "A apresentadora começa a falar e o cronômetro corre. Em “Encerrar sozinho depois de”, dá para programar a live para parar em 1, 2, 3 horas ou mais.",
  },
];

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
              <p className="text-sm font-medium text-fg">{passo.titulo}</p>
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
            O painel revisa o texto do áudio contra o que costuma fazer o TikTok restringir
            uma live — mandar para o WhatsApp, pedir Pix, prometer resultado — e aponta o
            trecho para corrigir. As respostas do chat saem com pausa de gente e limite por
            minuto. É proteção de conteúdo: segue as regras do TikTok, não esconde a
            automação.
          </p>
        </div>
      </div>
    </>
  );
}
