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
          Precisa. A Shopia roda na sua máquina, com a página da sua live aberta no Chrome
          o tempo todo. A extensão lê o chat e a tela; com “Ler a tela” ligado, a resposta é
          escolhida no servidor a partir do seu manual — mas quem a escreve no chat é a
          extensão, e ela só existe enquanto o navegador está aberto.
        </p>
        <p>
          Na prática: desligue a suspensão automática e o desligamento de tela por
          inatividade antes de subir. Computador que dorme derruba a transmissão, e o
          TikTok encerra a live sozinho depois de um tempo sem sinal.
        </p>
      </Pergunta>

      <Pergunta pergunta="Preciso instalar algum programa ou driver no computador?">
        <p>
          Não. A extensão vive dentro do Chrome e trabalha em cima das páginas que você já
          abriria de qualquer jeito — a sua live no tiktok.com. Não há cabo
          de áudio virtual, driver nem programa de fundo para instalar.
        </p>
        <p>
          O único arquivo que sai daqui é o pacote da extensão, e ele fica numa pasta que
          você escolhe. Desinstalar é remover a extensão do Chrome e apagar a pasta.
        </p>
      </Pergunta>

      <Pergunta pergunta="Funciona em Mac e em Windows?">
        <p>
          Nos dois, sem diferença de passo a passo. O Chrome é o mesmo, a extensão é a
          mesma — e como nada é instalado
          fora do navegador, não há nada que se comporte diferente entre eles.
        </p>
        <p>
          Em celular e tablet não roda: o Chrome do celular não aceita extensão. Você pode
          transmitir pelo celular e deixar a página da live aberta no Chrome do computador.
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
          pasta. Sua conta continua conectada; não precisa entrar de novo. E o painel da
          extensão avisa quando sai versão nova, com o link para baixar.
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

      <Pergunta pergunta="A Shopia responde qualquer coisa no chat?">
        <p>
          Não, e ela não escreve resposta nenhuma por conta própria. Cada linha do{" "}
          <Link
            href="/manual"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            manual
          </Link>{" "}
          é uma pergunta, as palavras que a disparam e a resposta que você escreveu. O que
          ela faz é escolher qual linha cabe no comentário e devolver aquele texto.
        </p>
        <p>
          Quando nenhuma linha casa, ela cala. Não improvisa preço, prazo nem promessa —
          inventar isso vira reclamação, e o prejuízo é seu. O comentário sem resposta vai
          para uma lista no manual, para você cadastrar antes da próxima live.
        </p>
        <p>
          Quanto mais completo o manual, menos gente fica sem resposta. É o ajuste que
          mais muda a qualidade do chat — bem mais do que qualquer coisa que a gente possa
          fazer do nosso lado.
        </p>
      </Pergunta>

      <Pergunta pergunta="Ela demora para responder. Isso é problema?">
        <p>
          É de propósito. Cada resposta sai depois de uma espera sorteada, e há um teto de
          respostas por minuto. Rajada de mensagem idêntica no mesmo segundo é a assinatura
          mais óbvia de automação, e é justamente o que faz o TikTok olhar para a sua live.
        </p>
        <p>
          O efeito colateral é que, em live movimentada, algum comentário passa sem
          resposta. A gente prefere isso a responder todos e atrair atenção.
        </p>
      </Pergunta>
    </div>
  );
}
