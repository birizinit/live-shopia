import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CircleCheck, Pencil, Puzzle, RotateCcw } from "lucide-react";
import { regerarRoteiro } from "@/app/(app)/roteiro/actions";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatarDuracao } from "@/lib/caracteres";
import { audioDoPerfil, vozesDisponiveis, type VozOpcao } from "@/lib/dados/audios";
import { chaveIdempotente } from "@/lib/dados/creditos";
import { jornadaDaLive } from "@/lib/dados/criacao";
import { configuracaoLive } from "@/lib/dados/live";
import { listarMontagens, montagemDoPerfil } from "@/lib/dados/montagens";
import { LIMITES_PRODUTO, listarProdutos, obterProduto } from "@/lib/dados/produtos";
import { estadoDaGeracao, estimativaDeFala, obterRoteiro } from "@/lib/dados/roteiros";
import { servicos } from "@/lib/env";
import { brl } from "@/lib/utils";
import { AcompanharAudio } from "./acompanhar-audio";
import { AcompanharRoteiro } from "./acompanhar-roteiro";
import { ColocarNaLive } from "./colocar-na-live";
import { EscolherVoz } from "./escolher-voz";
import { FormularioProduto } from "./formulario-produto";
import { Passos } from "./passos";
import { RevisaoRestricao } from "./revisao-restricao";

/**
 * As três etapas do assistente. Cada uma lê o próprio estado do banco — a URL
 * só diz QUAL roteiro ou áudio; o que fazer com ele, o servidor decide.
 */

const ROTULO_SECAO: Record<string, string> = {
  gancho: "Gancho",
  oferta: "Oferta",
  prova: "Prova",
  objecoes: "Dúvidas",
  cta: "Chamada para comprar",
};

// ------------------------------------------------------------------ passo 1

export async function EtapaProduto({ perfilId, produtoId }: { perfilId: string; produtoId: string | null }) {
  const produto = produtoId ? await obterProduto(perfilId, produtoId) : null;
  const recentes = produto ? [] : (await listarProdutos(perfilId, { limite: 6 })).itens;

  const resumo = produto
    ? [produto.precoCentavos !== null ? brl(produto.precoCentavos / 100) : null, produto.cupom ? `cupom ${produto.cupom}` : null]
        .filter(Boolean)
        .join(" · ") || null
    : null;

  return (
    <>
      <Passos atual={1} />
      <Card>
        <FormularioProduto
          referencia={chaveIdempotente("roteiro")}
          produto={produto ? { id: produto.id, nome: produto.nome, resumo } : null}
          limiteDescricao={LIMITES_PRODUTO.descricao}
        />
      </Card>

      {recentes.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-fg-muted">Ou use um produto que você já cadastrou</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {recentes.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/criar?produto=${p.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-fg-muted transition-colors duration-[--dur-fast] hover:border-primary-border hover:text-fg"
                >
                  {p.nome}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ------------------------------------------------------------------ passo 2

/** Vozes em português primeiro — e as clonadas da própria pessoa antes de todas. */
function vozesParaLive(vozes: VozOpcao[]): VozOpcao[] {
  const emPortugues = vozes.filter((v) => v.origem === "clonada" || v.idioma.toLowerCase().startsWith("pt"));
  return emPortugues.length > 0 ? emPortugues : vozes;
}

export async function EtapaRoteiro({
  perfilId,
  roteiroId,
  saldo,
  aviso,
}: {
  perfilId: string;
  roteiroId: string;
  /** Resultado do "Escrever outra versão" que não gerou versão nova. */
  aviso?: "andamento" | "falhou" | null;
  /** Saldo que a sessão já leu nesta requisição — a ação que cobra confere de novo no banco. */
  saldo: number;
}) {
  const [roteiro, geracao] = await Promise.all([
    obterRoteiro(perfilId, roteiroId),
    estadoDaGeracao(perfilId, roteiroId),
  ]);

  if (!roteiro || !geracao) {
    return (
      <>
        <Passos atual={2} />
        <Alerta tom="erro">
          Roteiro não encontrado. <Link href="/criar" className="underline">Comece de novo</Link>.
        </Alerta>
      </>
    );
  }

  // Escrevendo (primeira vez ou "escrever outra versão"), ou a primeira escrita
  // falhou: a espera — ou o "tentar de novo" — é a tela.
  if (geracao.ativo || !roteiro.versao) {
    return (
      <>
        <Passos atual={2} />
        <AcompanharRoteiro
          roteiroId={roteiroId}
          inicial={geracao}
          referenciaNovaTentativa={chaveIdempotente("roteiro")}
        />
      </>
    );
  }

  const versao = roteiro.versao;
  const [vozes, config] = await Promise.all([vozesDisponiveis(perfilId), configuracaoLive(perfilId)]);
  const estimativa = estimativaDeFala(versao.texto, saldo);
  const lista = vozesParaLive(vozes);
  const vozPadrao = lista.some((v) => v.id === config.vozId) ? config.vozId : (lista[0]?.id ?? null);

  return (
    <>
      <Passos atual={2} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-fg-subtle">Roteiro pronto</p>
              <h2 className="text-lg font-semibold">{roteiro.titulo}</h2>
            </div>
            {versao.origem === "exemplo" && <Badge tom="alerta">Exemplo — sem IA ligada</Badge>}
          </div>

          <ol className="space-y-3">
            {versao.secoes.map((secao, indice) => (
              <li key={`${secao.secao}-${indice}`}>
                <p className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                  {ROTULO_SECAO[secao.secao] ?? secao.secao}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed">{secao.texto}</p>
              </li>
            ))}
          </ol>

          <RevisaoRestricao texto={versao.texto} />

          {aviso && (
            <Alerta tom="erro">
              {aviso === "andamento"
                ? "Já tem uma versão sendo escrita para este roteiro. Espere ela terminar."
                : "Não deu para escrever outra versão agora. Tente de novo em instantes."}
            </Alerta>
          )}

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <form action={regerarRoteiroSemEstado}>
              <input type="hidden" name="roteiroId" value={roteiroId} />
              <input type="hidden" name="referencia" value={chaveIdempotente("roteiro")} />
              {/* Sem isto a ação lê "" como 0 e escreve um roteiro de 1 minuto. */}
              <input type="hidden" name="minutos" value={minutosDoTexto(versao.caracteres)} />
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-hover"
              >
                <RotateCcw className="size-4" aria-hidden />
                Escrever outra versão
              </button>
            </form>
            <Link
              href={`/roteiro/${roteiroId}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              <Pencil className="size-4" aria-hidden />
              Editar o texto
            </Link>
          </div>
        </Card>

        <Card>
          <EscolherVoz
            vozes={lista}
            vozPadrao={vozPadrao}
            estimativa={estimativa}
            chave={chaveIdempotente("tts")}
            roteiroId={roteiroId}
            versaoId={versao.id}
            vozLigada={servicos.voz}
          />
        </Card>
      </div>
    </>
  );
}

/** A versão nova sai do mesmo tamanho da atual (a fala é de ~600 caracteres por minuto). */
function minutosDoTexto(caracteres: number) {
  return String(Math.min(10, Math.max(1, Math.round(caracteres / 600))));
}

/**
 * `regerarRoteiro` foi escrita para `useActionState` (recebe o estado anterior
 * primeiro). Aqui ela é chamada por um formulário simples, e a página inteira
 * se refaz em seguida — por isso o adaptador.
 */
async function regerarRoteiroSemEstado(formData: FormData) {
  "use server";
  const resultado = await regerarRoteiro({}, formData);
  const roteiroId = encodeURIComponent(String(formData.get("roteiroId") ?? ""));
  // O erro não pode sumir: a página voltaria igual, como se o clique não tivesse
  // feito nada. Vai um CÓDIGO na URL, nunca o texto — texto livre na URL deixaria
  // qualquer um montar um link com mensagem falsa dentro da nossa página.
  const aviso = !resultado.erro ? "" : /andamento/i.test(resultado.erro) ? "&aviso=andamento" : "&aviso=falhou";
  redirect(`/criar?roteiro=${roteiroId}${aviso}`);
}

// ------------------------------------------------------------------ passo 3

async function liveAtual(perfilId: string) {
  const ativa = (await listarMontagens(perfilId)).find((m) => m.ativa) ?? null;
  if (!ativa) return { resumo: null, audios: [] as string[] };
  const detalhe = await montagemDoPerfil(perfilId, ativa.id);
  return { resumo: { nome: ativa.nome, falas: ativa.itens }, audios: detalhe?.audios ?? [] };
}

export async function EtapaAudio({ perfilId, audioId }: { perfilId: string; audioId: string }) {
  const audio = await audioDoPerfil(perfilId, audioId);

  if (!audio) {
    return (
      <>
        <Passos atual={3} />
        <Alerta tom="erro">
          Áudio não encontrado. <Link href="/criar" className="underline">Comece de novo</Link>.
        </Alerta>
      </>
    );
  }

  const falhou =
    audio.estado === "falhou" || audio.aoVivo.job?.estado === "falhou" || audio.aoVivo.job?.estado === "cancelado";

  if (falhou) {
    return (
      <>
        <Passos atual={3} />
        <Card className="space-y-3">
          <Alerta tom="erro">
            A geração da voz falhou e os créditos foram devolvidos
            {audio.aoVivo.job?.erro ? ` (${audio.aoVivo.job.erro})` : ""}.
          </Alerta>
          <Link href="/criar" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Tentar de novo
          </Link>
        </Card>
      </>
    );
  }

  if (audio.estado !== "pronto") {
    return (
      <>
        <Passos atual={3} />
        <AcompanharAudio audioId={audioId} inicial={audio.aoVivo} />
      </>
    );
  }

  const live = await liveAtual(perfilId);
  const naLive = live.audios.includes(audioId);

  return (
    <>
      <Passos atual={3} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <Card className="space-y-4">
          <div>
            <p className="text-xs text-fg-subtle">Áudio pronto · {formatarDuracao(audio.duracaoMs)} de fala</p>
            <h2 className="text-lg font-semibold">{audio.titulo}</h2>
          </div>
          {naLive ? <LiveMontada perfilId={perfilId} /> : <ColocarNaLive audioId={audioId} liveAtual={live.resumo} />}
        </Card>

        <Card className="space-y-3">
          <h2 className="text-base font-semibold">Revisão do que vai ao ar</h2>
          <RevisaoRestricao texto={audio.texto} />
        </Card>
      </div>
    </>
  );
}

async function LiveMontada({ perfilId }: { perfilId: string }) {
  const jornada = await jornadaDaLive(perfilId);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md bg-success-soft px-4 py-3 text-success">
        <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">Este áudio está na sua live</p>
          <p className="mt-0.5">
            {jornada.audio.falas} {jornada.audio.falas === 1 ? "áudio" : "áudios"}, cerca de{" "}
            {formatarDuracao(jornada.audio.duracaoMs)} por volta. A extensão repete em laço
            pelo tempo que você quiser, sem gastar créditos.
          </p>
          {jornada.audio.falas < 2 && (
            <p className="mt-1.5">
              Dica: crie mais uma versão do roteiro deste produto e escolha “Tocar junto”. Com
              dois ou mais áudios, a ordem muda a cada volta e a live não soa repetida.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {jornada.extensao.instalada ? (
          <Link
            href="/inicio"
            className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-base font-medium text-primary-fg hover:bg-primary-hover"
          >
            Ver como entrar no ar
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <Link
            href="/extensao"
            className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-base font-medium text-primary-fg hover:bg-primary-hover"
          >
            <Puzzle className="size-4" aria-hidden />
            Próximo: instalar a extensão
          </Link>
        )}
        <Link
          href="/criar"
          className="inline-flex h-12 items-center rounded-md border border-border bg-surface px-5 text-sm font-medium hover:bg-surface-hover"
        >
          Criar áudio de outro produto
        </Link>
      </div>
    </div>
  );
}
