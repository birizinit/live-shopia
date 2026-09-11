"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowRight,
  AudioLines,
  FileText,
  Package,
  RefreshCw,
  Save,
  Sparkles,
  Undo2,
} from "lucide-react";
import {
  arquivar,
  consultarGeracao,
  gerarRoteiro,
  maisRoteiros,
  regerarRoteiro,
  salvarEdicao,
  type EstadoRoteiro,
} from "./actions";
import { Alerta } from "@/components/ui/alerta";
import { useAvisos } from "@/components/ui/avisos";
import { Badge } from "@/components/ui/badge";
import { BarraProgresso } from "@/components/ui/barra-progresso";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { ConfirmarAcao } from "@/components/ui/confirmar-acao";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Indicador } from "@/components/ui/indicador";
import { Input, Label } from "@/components/ui/input";
import { Paginacao, juntarPaginas } from "@/components/ui/paginacao";
import { AreaTexto, ContadorCaracteres, Selecao } from "@/components/ui/selecao";
import { Cabecalho, Celula, Linha, Tabela } from "@/components/ui/tabela";
import {
  CHARS_POR_BLOCO,
  contarCaracteres,
  duracaoEstimadaMs,
  formatarDuracao,
} from "@/lib/caracteres";
import { ROTULO_SECAO } from "@/lib/dados/tipos";
import type { BlocoRoteiro, Pagina, SecaoRoteiro } from "@/lib/dados/tipos";
import type {
  EstadoGeracao,
  OrigemVersao,
  ProdutoOpcao,
  RoteiroResumo,
} from "@/lib/dados/roteiros";
import { numero } from "@/lib/utils";

/**
 * As ilhas de cliente da tela de roteiros.
 *
 * Tudo que tem estado ou evento mora aqui e em versoes.tsx; as duas páginas
 * continuam Server Components. Os blocos estão separados por faixa de
 * comentário: lista, geração e editor.
 */

const INICIAL: EstadoRoteiro = {};

/**
 * A ordem de exibição sai de ROTULO_SECAO (tipos.ts) — a mesma ordem narrativa
 * que o servidor impõe ao gravar (ORDEM_SECOES em dados/roteiros.ts). Aqui ela
 * é só visual: o que for enviado fora de ordem é reordenado na gravação.
 */
export const SECOES = Object.keys(ROTULO_SECAO) as SecaoRoteiro[];

/**
 * Fuso fixo de propósito.
 *
 * Este componente é renderizado no servidor (SSR) e de novo no navegador. Sem
 * fixar o fuso, um servidor em UTC e um navegador em BRT escrevem strings
 * diferentes e o React acusa divergência de hidratação. O banco já opera em
 * America/Sao_Paulo (src/lib/db.ts), então este é o fuso do produto.
 */
const DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function dataHora(iso: string) {
  return DATA_HORA.format(new Date(iso));
}

/** Ver o comentário de TONS em actions.ts para o porquê da lista existir duas vezes. */
const TONS = ["energético", "acolhedor", "direto ao ponto", "divertido"] as const;

const MINUTOS = [1, 2, 3, 5, 8, 10, 15];

type TomBadge = React.ComponentProps<typeof Badge>["tom"];

const SELO_ORIGEM: Record<OrigemVersao, { rotulo: string; tom: TomBadge }> = {
  ia: { rotulo: "Escrito pela IA", tom: "marca" },
  exemplo: { rotulo: "Exemplo", tom: "alerta" },
  edicao: { rotulo: "Editado por você", tom: "neutro" },
  restauracao: { rotulo: "Restaurada", tom: "info" },
};

/**
 * "Exemplo" é a etiqueta mais importante da tela: sem chave da Anthropic o
 * texto não foi escrito para o produto de ninguém, e quem for ao ar com ele
 * precisa saber disso antes, não depois.
 */
export function SeloOrigem({
  origem,
  restauradaDe,
}: {
  origem: OrigemVersao | null;
  restauradaDe?: number | null;
}) {
  if (!origem) return <Badge>Sem texto</Badge>;

  const { rotulo, tom } = SELO_ORIGEM[origem];
  const sufixo =
    origem === "restauracao" && restauradaDe ? ` da v${restauradaDe}` : "";

  return (
    <Badge tom={tom}>
      {rotulo}
      {sufixo}
    </Badge>
  );
}

/**
 * Avisa por toast a cada resposta nova da ação, sem repetir a mesma duas vezes.
 *
 * `aoResponder` é para conversar com sistemas de fora do React — invalidar uma
 * consulta, por exemplo. Fechar caixa e mexer em estado NÃO entram aqui:
 * setState dentro de efeito provoca render em cascata. Quem precisa disso faz a
 * comparação no corpo do render, como ConfirmarAcao já faz no kit.
 */
export function useRespostaDaAcao(
  estado: EstadoRoteiro,
  aoResponder?: (estado: EstadoRoteiro) => void,
) {
  const avisos = useAvisos();
  const ultimo = useRef<EstadoRoteiro | null>(null);

  useEffect(() => {
    if (estado === ultimo.current) return;
    ultimo.current = estado;

    if (estado.erro) avisos.erro("Não deu certo", estado.erro);
    else if (estado.mensagem) avisos.sucesso("Pronto", estado.mensagem);

    if (estado.erro || estado.mensagem) aoResponder?.(estado);
  }, [estado, avisos, aoResponder]);
}

// =============================================================================
// Lista
// =============================================================================

export function FormGerarRoteiro({
  produtos,
  referencia,
  temIa,
}: {
  produtos: ProdutoOpcao[];
  /** Chave de idempotência gerada no RENDER do Server Component. */
  referencia: string;
  temIa: boolean;
}) {
  const [estado, acao, enviando] = useActionState(gerarRoteiro, INICIAL);

  return (
    <Card id="gerar">
      <CardTitulo>Gerar um roteiro</CardTitulo>
      <CardDescricao>
        A IA escreve gancho, oferta, prova, objeções e chamada para ação a partir
        do produto. Gerar texto não gasta crédito — crédito é de voz, e só sai
        quando o roteiro virar áudio.
      </CardDescricao>

      <form action={acao} className="mt-4 space-y-4">
        {/*
          A chave viaja num campo oculto porque precisa ser a MESMA em todos os
          cliques deste formulário. Chave criada dentro da ação mudaria a cada
          clique, e o duplo clique viraria dois roteiros e dois jobs.
        */}
        <input type="hidden" name="referencia" value={referencia} />

        {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}

        {!temIa && (
          <Alerta tom="info">
            Sem <code className="font-[family-name:var(--font-mono)] text-xs">
              ANTHROPIC_API_KEY
            </code>{" "}
            o texto sai de exemplo e fica marcado como tal na lista e no
            histórico. Nada é apresentado como se a IA tivesse escrito.
          </Alerta>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-1">
            <Label htmlFor="produtoId">Produto</Label>
            <Selecao
              id="produtoId"
              name="produtoId"
              defaultValue=""
              opcoes={[
                { valor: "", rotulo: "Sem produto" },
                ...produtos.map((produto) => ({
                  valor: produto.id,
                  rotulo: produto.nome,
                })),
              ]}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="minutos">Duração alvo da leitura</Label>
            <Selecao
              id="minutos"
              name="minutos"
              defaultValue="3"
              opcoes={MINUTOS.map((m) => ({
                valor: String(m),
                rotulo: m === 1 ? "1 minuto" : `${m} minutos`,
              }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tom">Tom da fala</Label>
            <Selecao
              id="tom"
              name="tom"
              defaultValue=""
              opcoes={[
                { valor: "", rotulo: "Deixar a IA escolher" },
                ...TONS.map((tom) => ({ valor: tom, rotulo: tom })),
              ]}
            />
          </div>
        </div>

        {produtos.length === 0 && (
          <p className="text-sm text-fg-muted">
            Você ainda não cadastrou um produto. Dá para gerar sem ele, mas com o
            produto a IA usa nome, preço, cupom e objeções —{" "}
            <Link
              href="/produtos"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              cadastrar produto
            </Link>
            .
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={enviando}>
            <Sparkles className="size-4" aria-hidden />
            {enviando ? "Enfileirando…" : "Gerar roteiro"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

const COLUNAS = [
  { rotulo: "Roteiro" },
  { rotulo: "Estado" },
  { rotulo: "Versão", numerica: true },
  { rotulo: "Caracteres", numerica: true },
  { rotulo: "Fala", numerica: true },
  { rotulo: "Atualizado", numerica: true },
];

export function ListaRoteiros({ inicial }: { inicial: Pagina<RoteiroResumo> }) {
  const router = useRouter();
  const avisos = useAvisos();
  const [servidor, setServidor] = useState(inicial);
  const [pagina, setPagina] = useState(inicial);
  const [carregando, setCarregando] = useState(false);

  // O servidor mandou uma lista nova (revalidate ou refresh): o que estava
  // acumulado das páginas seguintes é dado velho e sai de cena junto.
  if (servidor !== inicial) {
    setServidor(inicial);
    setPagina(inicial);
  }

  const gerando = pagina.itens.some(
    (roteiro) => roteiro.jobEstado === "pendente" || roteiro.jobEstado === "processando",
  );

  /**
   * A lista é do servidor, e o worker não avisa ninguém quando termina. Com
   * algum roteiro na fila vale reperguntar; sem nenhum, o intervalo some — e
   * uma tela parada não fica batendo no banco à toa.
   */
  useEffect(() => {
    if (!gerando) return;
    const relogio = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(relogio);
  }, [gerando, router]);

  async function carregarMais(cursor: string) {
    setCarregando(true);
    try {
      const proxima = await maisRoteiros(cursor);
      setPagina((atual) => juntarPaginas(atual, proxima));
    } catch {
      // Sem isto o botão só voltaria ao normal e ninguém saberia o que houve.
      avisos.erro("Não deu para carregar mais", "Tente de novo em alguns segundos.");
    } finally {
      setCarregando(false);
    }
  }

  if (pagina.itens.length === 0) {
    return (
      <EstadoVazio
        icone={FileText}
        titulo="Nenhum roteiro ainda"
        texto="O roteiro é o texto que a apresentadora vai falar em loop na live. Comece gerando um a partir de um produto."
        acao={
          <a
            href="#gerar"
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
          >
            <Sparkles className="size-4" aria-hidden />
            Gerar o primeiro
          </a>
        }
      />
    );
  }

  return (
    <>
      <Tabela rotulo="Seus roteiros" cabecalho={<Cabecalho colunas={COLUNAS} />}>
        {pagina.itens.map((roteiro) => {
          const naFila =
            roteiro.jobEstado === "pendente" || roteiro.jobEstado === "processando";

          return (
            <Linha key={roteiro.id}>
              <Celula linha quebrar className="max-w-[22rem]">
                <Link
                  href={`/roteiro/${roteiro.id}`}
                  className="font-medium text-fg underline-offset-4 hover:text-primary hover:underline"
                >
                  {roteiro.titulo}
                </Link>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs font-normal text-fg-subtle">
                  <Package className="size-3.5 shrink-0" aria-hidden />
                  {roteiro.produtoNome ?? "Sem produto"}
                </span>
              </Celula>

              <Celula>
                {naFila ? (
                  <Indicador
                    estado="pendente"
                    texto={roteiro.jobEstado === "processando" ? "Escrevendo" : "Na fila"}
                  />
                ) : (
                  <SeloOrigem origem={roteiro.origem} />
                )}
              </Celula>

              <Celula numerica>
                {roteiro.versaoAtual > 0 ? `v${roteiro.versaoAtual}` : "—"}
              </Celula>
              <Celula numerica>{numero(roteiro.caracteres)}</Celula>
              <Celula numerica>
                {roteiro.caracteres > 0
                  ? formatarDuracao(duracaoEstimadaMs(roteiro.caracteres))
                  : "—"}
              </Celula>
              <Celula numerica className="text-fg-muted">
                {dataHora(roteiro.atualizadoEm)}
              </Celula>
            </Linha>
          );
        })}
      </Tabela>

      <Paginacao
        proximo={pagina.proximo}
        mostrados={pagina.itens.length}
        total={pagina.total}
        carregando={carregando}
        aoCarregarMais={carregarMais}
        itens="roteiros"
      />
    </>
  );
}

// =============================================================================
// Geração e acompanhamento
// =============================================================================

export function PainelGeracao({
  roteiroId,
  referencia,
  versaoAtual,
  estadoInicial,
  temIa,
}: {
  roteiroId: string;
  referencia: string;
  versaoAtual: number;
  estadoInicial: EstadoGeracao | null;
  temIa: boolean;
}) {
  const router = useRouter();
  const avisos = useAvisos();
  const cliente = useQueryClient();
  const [estado, acao, enviando] = useActionState(regerarRoteiro, INICIAL);

  const chave = ["roteiro", roteiroId, "geracao"];

  /**
   * TanStack Query com refetch curto — a escolha está justificada em
   * consultarGeracao() (actions.ts). O intervalo só existe enquanto o job está
   * vivo: `refetchInterval` devolvendo false encerra a repetição sozinho, sem
   * um efeito paralelo para limpar.
   */
  const { data } = useQuery({
    queryKey: chave,
    queryFn: () => consultarGeracao(roteiroId),
    initialData: estadoInicial,
    refetchInterval: (consulta) => (consulta.state.data?.ativo ? 2000 : false),
    refetchOnWindowFocus: true,
    // O dado do servidor vale por um instante: sem isto o componente já monta
    // disparando uma consulta que repete o que acabou de chegar no HTML.
    staleTime: 2000,
    retry: 1,
  });

  const jaAtualizou = useRef(false);

  // Versão nova entrou pelo servidor: libera o próximo refresh automático.
  useEffect(() => {
    jaAtualizou.current = false;
  }, [versaoAtual]);

  /**
   * O texto pronto mora no Server Component. Quando o job termina, o que esta
   * ilha faz é UM refresh — e não montar o roteiro por conta própria com o que
   * veio da consulta.
   */
  useEffect(() => {
    if (!data || data.ativo || jaAtualizou.current) return;
    if (data.versaoAtual <= versaoAtual) return;

    jaAtualizou.current = true;
    avisos.sucesso("Roteiro pronto", `A versão ${data.versaoAtual} chegou.`);
    router.refresh();
  }, [data, versaoAtual, router, avisos]);

  useRespostaDaAcao(estado, (resposta) => {
    if (resposta.erro) return;
    // Acabou de entrar na fila: a consulta precisa ver isso já, e não daqui a
    // trinta segundos.
    jaAtualizou.current = false;
    void cliente.invalidateQueries({ queryKey: chave });
  });

  if (data?.ativo) {
    return (
      <Card className="border-primary-border bg-primary-soft/40">
        <div className="flex items-center justify-between gap-4">
          <CardTitulo>A IA está escrevendo</CardTitulo>
          <Indicador
            estado="pendente"
            texto={data.estado === "processando" ? "Escrevendo" : "Na fila"}
          />
        </div>
        <CardDescricao>
          Pode sair desta tela: o trabalho continua na fila e o texto entra aqui
          sozinho quando terminar.
        </CardDescricao>
        <BarraProgresso
          className="mt-4"
          valor={data.progresso}
          rotulo="Progresso da geração"
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardTitulo>Gerar de novo</CardTitulo>
      <CardDescricao>
        A saída entra como uma versão a mais. Nenhuma versão é sobrescrita.
      </CardDescricao>

      <form action={acao} className="mt-4 space-y-3">
        <input type="hidden" name="roteiroId" value={roteiroId} />
        <input type="hidden" name="referencia" value={referencia} />

        {data?.estado === "falhou" && (
          <Alerta tom="erro">
            A última geração falhou{data.erro ? `: ${data.erro}` : "."} O texto
            que já estava salvo continua intacto.
          </Alerta>
        )}

        {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}

        {!temIa && (
          <Alerta tom="info">
            Sem chave da Anthropic o texto sai de exemplo, rotulado como exemplo.
          </Alerta>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="regerar-minutos">Duração alvo</Label>
          <Selecao
            id="regerar-minutos"
            name="minutos"
            defaultValue="3"
            opcoes={MINUTOS.map((m) => ({
              valor: String(m),
              rotulo: m === 1 ? "1 minuto" : `${m} minutos`,
            }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="regerar-tom">Tom da fala</Label>
          <Selecao
            id="regerar-tom"
            name="tom"
            defaultValue=""
            opcoes={[
              { valor: "", rotulo: "Deixar a IA escolher" },
              ...TONS.map((tom) => ({ valor: tom, rotulo: tom })),
            ]}
          />
        </div>

        <Button type="submit" variante="secondary" bloco disabled={enviando}>
          <RefreshCw className="size-4" aria-hidden />
          {enviando ? "Enfileirando…" : "Gerar nova versão"}
        </Button>
      </form>
    </Card>
  );
}

export function BotaoArquivar({
  roteiroId,
  titulo,
  versoes,
}: {
  roteiroId: string;
  titulo: string;
  versoes: number;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, enviando] = useActionState(arquivar, INICIAL);
  const [resposta, setResposta] = useState(estado);

  useRespostaDaAcao(estado);

  // A ação respondeu: fecha a caixa. No corpo do render, e não num efeito —
  // o sucesso aqui é um redirect, então o que chega é erro, e a mensagem vai
  // no toast enquanto a caixa sai da frente.
  if (resposta !== estado) {
    setResposta(estado);
    if (aberto) setAberto(false);
  }

  return (
    <>
      <Button variante="ghost" onClick={() => setAberto(true)}>
        <Archive className="size-4" aria-hidden />
        Arquivar
      </Button>

      <ConfirmarAcao
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        rotuloConfirmar={enviando ? "Arquivando…" : "Arquivar"}
        titulo="Arquivar este roteiro?"
        texto={`"${titulo}" sai da lista e dos seletores das outras telas.`}
        perdas={[
          "O roteiro some da lista e de qualquer seleção",
          versoes === 1
            ? "A versão guardada fica inacessível pela tela"
            : `As ${versoes} versões guardadas ficam inacessíveis pela tela`,
          "Áudios já gerados a partir dele continuam existindo",
        ]}
        aoConfirmar={() => {
          const dados = new FormData();
          dados.set("roteiroId", roteiroId);
          acao(dados);
        }}
      />
    </>
  );
}

// =============================================================================
// Editor por seção
// =============================================================================

type TextosPorSecao = Record<SecaoRoteiro, string>;

const DICA: Record<SecaoRoteiro, string> = {
  gancho: "Os primeiros segundos. Quem acabou de chegar fica ou sai aqui.",
  oferta: "O que é, quanto custa e qual é a condição da live.",
  prova: "Por que acreditar: avaliação, comentário, demonstração.",
  objecoes: "O que trava a compra — tamanho, prazo, dúvida que sempre volta.",
  cta: "O que fazer agora, numa frase. Sem marca de tempo: isto roda em loop.",
};

function mapear(secoes: BlocoRoteiro[]): TextosPorSecao {
  const textos = Object.fromEntries(SECOES.map((secao) => [secao, ""])) as TextosPorSecao;
  for (const bloco of secoes) textos[bloco.secao] = bloco.texto;
  return textos;
}

/**
 * A mesma junção de textoDeSecoes() em dados/roteiros.ts. Ela precisa bater
 * caractere a caractere: é este número que vira a estimativa mostrada aqui e o
 * débito cobrado lá no estúdio.
 */
function juntar(textos: TextosPorSecao): string {
  return SECOES.map((secao) => textos[secao].trim())
    .filter(Boolean)
    .join("\n\n");
}

export function EditorRoteiro({
  roteiroId,
  titulo,
  versaoAtual,
  secoes,
}: {
  roteiroId: string;
  titulo: string;
  versaoAtual: number;
  secoes: BlocoRoteiro[];
}) {
  const [estado, acao, enviando] = useActionState(salvarEdicao, INICIAL);

  /**
   * O que o servidor mandou, resumido numa string.
   *
   * O texto só muda quando o número da versão muda, mas o título muda sozinho
   * (renomear não versiona). Comparar as duas coisas é o que faz o editor
   * perceber tanto "salvei o nome" quanto "chegou versão nova" — comparar a
   * identidade de `secoes` não serviria: o array é novo a cada render do
   * servidor, e qualquer refresh apagaria o que está sendo escrito.
   */
  const assinatura = `${versaoAtual}::${titulo}`;

  const [base, setBase] = useState(() => ({
    assinatura,
    titulo,
    textos: mapear(secoes),
  }));
  const [tituloAtual, setTitulo] = useState(base.titulo);
  const [textos, setTextos] = useState(base.textos);
  const [chegouVersao, setChegouVersao] = useState(false);

  const alterado =
    tituloAtual !== base.titulo ||
    SECOES.some((secao) => textos[secao] !== base.textos[secao]);

  /**
   * Chegou conteúdo novo do servidor (o próprio salvamento, ou uma geração que
   * terminou).
   *
   * Quando o que chegou é igual ao que está na tela — o caso do salvamento —
   * o editor só se reposiciona. Quando é diferente E havia edição pendente, ele
   * NÃO adota: jogar fora o que a pessoa acabou de escrever para exibir o que a
   * IA escreveu seria perder trabalho sem pedir licença. O aviso explica que
   * salvar agora cria a próxima versão a partir do que está na tela.
   */
  if (base.assinatura !== assinatura) {
    const proximo = { assinatura, titulo, textos: mapear(secoes) };
    // Comparação com trim: o servidor grava o texto aparado, e um espaço solto
    // no fim de uma seção não é conflito de conteúdo — acusá-lo faria o aviso
    // de "chegou versão nova" aparecer depois do próprio salvamento.
    const conflita =
      tituloAtual.trim() !== proximo.titulo.trim() ||
      SECOES.some((secao) => textos[secao].trim() !== proximo.textos[secao].trim());

    setBase(proximo);

    if (alterado && conflita) {
      setChegouVersao(true);
    } else {
      setTitulo(proximo.titulo);
      setTextos(proximo.textos);
      setChegouVersao(false);
    }
  }

  useRespostaDaAcao(estado);

  const completo = juntar(textos);
  const total = contarCaracteres(completo);
  const blocos = total === 0 ? 0 : Math.ceil(total / CHARS_POR_BLOCO);

  function descartar() {
    setTitulo(base.titulo);
    setTextos(base.textos);
    setChegouVersao(false);
  }

  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="roteiroId" value={roteiroId} />

      {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}

      {chegouVersao && (
        <Alerta tom="info">
          Chegou a versão {versaoAtual} enquanto você editava. O texto da tela é
          o seu — salvar agora cria a versão {versaoAtual + 1} a partir dele. A
          versão {versaoAtual} continua no histórico.
        </Alerta>
      )}

      <Card>
        <div className="space-y-1.5">
          <Label htmlFor="titulo">Título do roteiro</Label>
          <Input
            id="titulo"
            name="titulo"
            value={tituloAtual}
            onChange={(evento) => setTitulo(evento.target.value)}
            maxLength={140}
            placeholder="Como você vai reconhecer este roteiro depois"
          />
          <p className="text-xs text-fg-subtle">
            Renomear não cria versão nova — só o texto versiona.
          </p>
        </div>
      </Card>

      {SECOES.map((secao) => {
        const texto = textos[secao];
        const caracteres = contarCaracteres(texto);

        return (
          <Card key={secao}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <Label htmlFor={`secao-${secao}`}>{ROTULO_SECAO[secao]}</Label>
              <span className="text-xs text-fg-subtle">{DICA[secao]}</span>
            </div>

            <AreaTexto
              id={`secao-${secao}`}
              name={`secao_${secao}`}
              value={texto}
              onChange={(evento) =>
                setTextos((atual) => ({ ...atual, [secao]: evento.target.value }))
              }
              placeholder={`Escreva a parte de ${ROTULO_SECAO[secao].toLowerCase()}…`}
              auxiliar={
                caracteres > 0
                  ? `≈ ${formatarDuracao(duracaoEstimadaMs(caracteres))} de fala`
                  : "Seção vazia não entra no áudio."
              }
            />
          </Card>
        );
      })}

      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-1 text-sm text-fg">
            {/* O contador do kit conta com contarCaracteres(), a mesma regra do
                CHECK do banco e do débito — nunca `.length`. */}
            <ContadorCaracteres texto={completo} className="text-sm font-semibold text-fg" />
            <span>caracteres ·</span>
            <span className="num font-semibold">{numero(blocos)}</span>
            <span>{blocos === 1 ? "bloco ·" : "blocos ·"}</span>
            <span className="num font-semibold">
              {formatarDuracao(duracaoEstimadaMs(total))}
            </span>
            <span>de fala</span>
          </p>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Bloco é o teto de {numero(CHARS_POR_BLOCO)} caracteres por chamada de
            voz. Salvar não gasta crédito.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {alterado && <Badge tom="alerta">Não salvo</Badge>}
          <Button
            type="button"
            variante="ghost"
            onClick={descartar}
            disabled={!alterado || enviando}
          >
            <Undo2 className="size-4" aria-hidden />
            Descartar
          </Button>
          <Button type="submit" disabled={!alterado || enviando || total === 0}>
            <Save className="size-4" aria-hidden />
            {enviando ? "Salvando…" : "Salvar nova versão"}
          </Button>
        </div>
      </Card>
    </form>
  );
}

/** Atalho para o estúdio, com o roteiro já escolhido. */
export function AtalhoEstudio({
  roteiroId,
  desabilitado,
}: {
  roteiroId: string;
  desabilitado: boolean;
}) {
  if (desabilitado) {
    return (
      <Button variante="secondary" disabled title="Escreva ou gere o texto antes.">
        <AudioLines className="size-4" aria-hidden />
        Gerar áudio
      </Button>
    );
  }

  return (
    <Link
      href={`/estudio?roteiro=${roteiroId}`}
      className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg shadow-sm hover:bg-primary-hover"
    >
      <AudioLines className="size-4" aria-hidden />
      Gerar áudio deste roteiro
      <ArrowRight className="size-4" aria-hidden />
    </Link>
  );
}
