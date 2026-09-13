import Link from "next/link";
import { ChevronDown } from "lucide-react";

/**
 * Perguntas frequentes.
 *
 * `<details>` e `<summary>` nativos, sem estado nosso: abre e fecha com teclado,
 * é anunciado como botão expansível por leitor de tela e — o que importa aqui —
 * o Ctrl+F do navegador encontra a resposta mesmo com o bloco fechado. Um
 * acordeão feito à mão perde as três coisas.
 */

function Pergunta({
  pergunta,
  children,
}: {
  pergunta: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-md border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
        {pergunta}
        <ChevronDown
          className="size-4 shrink-0 text-fg-subtle transition-transform duration-[--dur-base] ease-[--ease-out] group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="space-y-2.5 border-t border-border px-4 py-3.5 text-sm text-fg-muted">
        {children}
      </div>
    </details>
  );
}

export function Faq() {
  return (
    <div className="space-y-2.5">
      <Pergunta pergunta="Preciso deixar o computador ligado durante a live?">
        <p>
          Precisa. A live roda na sua máquina, com o Chrome e o TikTok LIVE Studio abertos
          o tempo todo. Não existe servidor nosso transmitindo no seu lugar: a extensão é
          quem toca o áudio e responde o chat, e ela só existe enquanto o navegador está
          aberto.
        </p>
        <p>
          Na prática: desligue a suspensão automática e o desligamento de tela por
          inatividade antes de subir. Computador que dorme derruba a transmissão, e o
          TikTok encerra a live sozinho depois de um tempo sem sinal.
        </p>
      </Pergunta>

      <Pergunta pergunta="Funciona em Mac e em Windows?">
        <p>
          Nos dois. O Chrome é o mesmo, a extensão é a mesma e o LIVE Studio existe para
          os dois sistemas. O que muda é o cabo virtual: VB-Cable no Windows, BlackHole no
          macOS — cada um com o seu passo a passo{" "}
          <a
            href="#cabo-virtual"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            na seção acima
          </a>
          .
        </p>
        <p>
          Há uma diferença que vale saber antes de escolher a máquina: no Windows dá para
          mandar só o som do Chrome para o cabo; no Mac, o roteamento é do sistema inteiro
          e todo som do computador entra na live.
        </p>
        <p>
          Em celular e tablet não roda. O LIVE Studio é programa de computador e o Chrome
          do celular não aceita extensão.
        </p>
      </Pergunta>

      <Pergunta pergunta="Como atualizo quando sair uma versão nova?">
        <p>
          Na mão, e isso é de propósito — instalação em modo desenvolvedor não recebe
          atualização automática. São três passos: baixe o novo pacote nesta página,
          substitua o conteúdo da mesma pasta de sempre e clique em recarregar no
          gerenciador de extensões do Chrome.
        </p>
        <p>
          Use a mesma pasta, não uma nova: o Chrome guarda a extensão pelo caminho da
          pasta. O seu token continua valendo, não precisa gerar outro nem reconectar.
        </p>
        <p>
          Você não precisa ficar de olho. Cada máquina se apresenta para a gente de poucos
          em poucos minutos, e a lista de{" "}
          <a
            href="#instalacoes"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            máquinas conectadas
          </a>{" "}
          marca como desatualizada a que estiver para trás.
        </p>
      </Pergunta>

      <Pergunta pergunta="A IA responde qualquer coisa no chat?">
        <p>
          Não. Ela responde sobre os temas que você cadastrou — os seus produtos, o
          roteiro daquela live, o cupom, prazo e frete que você preencheu. Fora desse
          cerco, ela desconversa e devolve a pessoa para a oferta, em vez de improvisar.
        </p>
        <p>
          A regra é essa porque inventar preço ou prazo custa caro: vira reclamação, e o
          prejuízo é seu. Se a resposta não estiver no que você cadastrou em{" "}
          <Link
            href="/produtos"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Produtos
          </Link>{" "}
          e em{" "}
          <Link
            href="/roteiro"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Roteiro
          </Link>
          , ela não inventa uma.
        </p>
        <p>
          Quanto mais completo o cadastro, menos ela desconversa. É o ajuste que mais muda
          a qualidade do chat.
        </p>
      </Pergunta>
    </div>
  );
}
