import { RefreshCw, TriangleAlert } from "lucide-react";
import { BotaoCopiar } from "@/components/ui/copiar";

/**
 * Instalação em modo desenvolvedor, do zip até a conta conectada.
 *
 * Uma lista só, e não abas por sistema: até o pacote existir, o caminho é
 * idêntico no Windows e no Mac. O que de fato diverge entre os dois é o cabo
 * virtual — e isso tem seção própria, logo abaixo, com abas de verdade.
 */

const ENDERECO = "chrome://extensions";

type Passo = { titulo: string; texto: string; extra?: React.ReactNode };

const PASSOS: Passo[] = [
  {
    titulo: "Baixe o pacote e extraia numa pasta definitiva",
    texto:
      "Escolha um lugar onde a pasta possa ficar para sempre — algo como C:\\Shopia\\extensao ou ~/Aplicativos/Shopia. Fuja da pasta Downloads: ela é limpa de tempos em tempos.",
  },
  {
    titulo: "Não apague nem mova essa pasta",
    texto:
      "O Chrome não copia a extensão para dentro dele: ele lê os arquivos onde você deixou, toda vez que abre. Sumiu a pasta, morreu a extensão — e é o motivo número um de chamado no suporte.",
  },
  {
    titulo: "Abra o gerenciador de extensões do Chrome",
    texto:
      "Cole o endereço na barra do Chrome e tecle Enter. Endereço chrome:// não abre por link — por isso aqui tem botão de copiar e não um link clicável.",
    extra: (
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <code className="rounded-sm border border-border bg-bg-subtle px-2 py-1 font-[family-name:var(--font-mono)] text-xs text-fg">
          {ENDERECO}
        </code>
        <BotaoCopiar
          texto={ENDERECO}
          rotulo="Copiar endereço"
          rotuloCopiado="Endereço copiado"
        />
      </div>
    ),
  },
  {
    titulo: "Ligue o Modo do desenvolvedor",
    texto:
      "O interruptor fica no canto superior direito dessa página. Sem ele ligado, o botão do passo seguinte nem aparece.",
  },
  {
    titulo: "Clique em Carregar sem compactação e escolha a pasta",
    texto:
      "Selecione a PASTA que você extraiu, não o arquivo .zip. Se o Chrome reclamar de manifesto, é sinal de que você apontou para a pasta errada — a certa é a que tem o arquivo manifest.json dentro.",
  },
  {
    titulo: "Fixe a extensão na barra",
    texto:
      "Clique na peça de quebra-cabeça ao lado da barra de endereço e no alfinete da Shopia. Fixada, ela fica a um clique durante a live, que é quando você não quer procurar nada.",
  },
  {
    titulo: "Entre com a sua conta",
    texto:
      "Abra a extensão e cole o token da licença. É o mesmo token da seção Licença, mais acima nesta página — ele aparece uma vez só, na hora em que você gera.",
  },
];

export function PassoAPasso({ temPacote }: { temPacote: boolean }) {
  return (
    <>
      {!temPacote && (
        <p className="mb-4 rounded-md border border-border bg-bg-subtle px-4 py-3 text-sm text-fg-muted">
          Estes passos valem a partir do momento em que o pacote existir. Deixamos o
          roteiro à vista agora porque ele é curto e dá para ler antes, no celular, e
          depois só executar no computador.
        </p>
      )}

      <ol className="space-y-4">
        {PASSOS.map((passo, indice) => (
          <li key={passo.titulo} className="flex gap-3 sm:gap-4">
            <span className="num mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-xs font-semibold text-fg-subtle">
              {indice + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">{passo.titulo}</p>
              <p className="mt-0.5 text-sm text-fg-muted">{passo.texto}</p>
              {passo.extra}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex gap-3 rounded-md bg-warning-soft px-4 py-3 text-warning">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">
            Instalada assim, a extensão não se atualiza sozinha.
          </p>
          <p className="mt-1">
            Extensão da Web Store recebe versão nova em silêncio. Esta não: carregada sem
            compactação, ela fica exatamente na versão dos arquivos que estão na sua
            pasta. Quando sair uma versão nova, você vai precisar baixar o pacote,
            substituir o conteúdo da mesma pasta e clicar em{" "}
            <RefreshCw className="inline size-3.5" aria-hidden /> recarregar em{" "}
            <span className="font-[family-name:var(--font-mono)] text-xs">
              {ENDERECO}
            </span>
            .
          </p>
          <p className="mt-1">
            É o maior custo deste caminho e a gente não vai fingir o contrário. Em troca,
            um conserto urgente chega no mesmo dia, sem esperar revisão de loja. Esta
            página avisa quando a sua máquina estiver rodando versão antiga.
          </p>
        </div>
      </div>
    </>
  );
}
