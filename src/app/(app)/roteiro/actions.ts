"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { enfileirar } from "@/lib/dados/fila";
import { ErroDominio } from "@/lib/dados/erros";
import {
  ID_EXEMPLO,
  ORDEM_SECOES,
  arquivarRoteiro,
  criarRoteiro,
  estadoDaGeracao,
  listarRoteiros,
  restaurarVersao,
  roteiroDaChave,
  salvarRoteiro,
} from "@/lib/dados/roteiros";
import type { EstadoGeracao, RoteiroResumo } from "@/lib/dados/roteiros";
import type { BlocoRoteiro, Pagina } from "@/lib/dados/tipos";
import { modoDemo } from "@/lib/env";
import { exigirUsuario } from "@/lib/sessao";

/**
 * Ações da tela de roteiros.
 *
 * Nada aqui debita crédito, e isso é deliberado: escrever texto é chamada de
 * modelo, não de voz. O crédito é medido em caracteres de FALA e sai uma única
 * vez, por debitarEEnfileirar(), quando o roteiro virar áudio no /estudio. Se
 * esta tela cobrasse, o mesmo roteiro seria pago duas vezes.
 *
 * Arquivo "use server": todo export precisa ser função assíncrona (tipo é
 * apagado na compilação e não conta). Por isso as listas e os validadores
 * abaixo ficam privados ao módulo.
 */

export type EstadoRoteiro = {
  erro?: string;
  mensagem?: string;
  /** Número da versão recém-criada — o editor usa para se reposicionar. */
  versao?: number;
};

/**
 * Tons oferecidos no formulário.
 *
 * A lista existe também em editor.tsx. Exportar daqui quebra a regra do
 * "use server", e importar do lado cliente traria uma referência de módulo em
 * vez do array. São quatro palavras; o que não pode faltar é a validação, e
 * ela está aqui, do lado de quem grava.
 */
const TONS: readonly string[] = ["energético", "acolhedor", "direto ao ponto", "divertido"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Formato de chaveIdempotente("roteiro") — gerada no render, nunca na ação. */
const CHAVE = /^roteiro:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AVISO_DEMO =
  "Modo demonstração: a sessão é falsa e nada é gravado. Configure DATABASE_URL para salvar de verdade.";

function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function lerUuid(valor: FormDataEntryValue | null): string | null {
  const bruto = texto(valor);
  return UUID.test(bruto) ? bruto : null;
}

function lerChave(valor: FormDataEntryValue | null): string | null {
  const bruto = texto(valor);
  return CHAVE.test(bruto) ? bruto : null;
}

/** Fora da faixa vira o padrão, e não erro: é uma dica de tamanho, não um dado. */
function lerMinutos(valor: FormDataEntryValue | null): number {
  const numero = Number(texto(valor));
  if (!Number.isFinite(numero)) return 3;
  return Math.min(15, Math.max(1, Math.round(numero)));
}

function lerTom(valor: FormDataEntryValue | null): string | null {
  const bruto = texto(valor);
  return TONS.includes(bruto) ? bruto : null;
}

function mensagemDe(erro: unknown): string {
  if (erro instanceof ErroDominio) {
    // Duas gravações simultâneas batem na unicidade (roteiro_id, numero). O
    // texto genérico de conflito não diz o que fazer; este diz.
    if (erro.codigo === "conflito") {
      return "Outra edição salvou uma versão ao mesmo tempo. Recarregue a página e tente de novo.";
    }
    return erro.message;
  }
  console.error(erro);
  return "Não foi possível concluir a operação. Tente de novo.";
}

// -----------------------------------------------------------------------------
// Geração
// -----------------------------------------------------------------------------

/**
 * Cria o roteiro e põe o job na fila. O texto aparece quando o worker termina.
 *
 * Sem ANTHROPIC_API_KEY a integração devolve um roteiro de exemplo e grava
 * `modelo = 'exemplo'` (src/lib/integracoes/claude.ts). Não existe geração
 * simulada: a tela rotula a versão como exemplo, e quem está olhando sabe que
 * a IA não escreveu aquilo.
 */
export async function gerarRoteiro(
  _anterior: EstadoRoteiro,
  formData: FormData,
): Promise<EstadoRoteiro> {
  const usuario = await exigirUsuario("/roteiro");

  // redirect() lança para o Next; por isso mora fora de qualquer try/catch.
  if (modoDemo) redirect(`/roteiro/${ID_EXEMPLO}`);

  const referencia = lerChave(formData.get("referencia"));
  if (!referencia) return { erro: "Formulário expirado. Recarregue a página." };

  const produtoId = lerUuid(formData.get("produtoId"));
  const minutos = lerMinutos(formData.get("minutos"));
  const tom = lerTom(formData.get("tom"));

  let destino: string;

  try {
    // O segundo clique reencontra o roteiro da primeira submissão em vez de
    // criar outro. O job já estava protegido pelo índice único da chave.
    const existente = await roteiroDaChave(usuario.id, referencia);
    const roteiroId = existente ?? (await criarRoteiro(usuario.id, { produtoId })).id;

    await enfileirar(usuario.id, "roteiro", {
      referencia,
      entrada: { roteiro_id: roteiroId, minutos_alvo: minutos, ...(tom ? { tom } : {}) },
    });

    destino = `/roteiro/${roteiroId}`;
  } catch (erro) {
    return { erro: mensagemDe(erro) };
  }

  revalidatePath("/roteiro");
  redirect(destino);
}

/** Regerar não apaga nada: a saída do worker entra como uma versão a mais. */
export async function regerarRoteiro(
  _anterior: EstadoRoteiro,
  formData: FormData,
): Promise<EstadoRoteiro> {
  const usuario = await exigirUsuario("/roteiro");
  if (modoDemo) return { erro: AVISO_DEMO };

  const roteiroId = lerUuid(formData.get("roteiroId"));
  if (!roteiroId) return { erro: "Roteiro não encontrado." };

  const referencia = lerChave(formData.get("referencia"));
  if (!referencia) return { erro: "Formulário expirado. Recarregue a página." };

  const minutos = lerMinutos(formData.get("minutos"));
  const tom = lerTom(formData.get("tom"));

  try {
    // Confere o dono antes de enfileirar: o worker confia no par
    // (perfil_id, roteiro_id) que sai daqui.
    const estado = await estadoDaGeracao(usuario.id, roteiroId);
    if (!estado) return { erro: "Roteiro não encontrado." };
    if (estado.ativo) {
      return { erro: "Já existe uma geração em andamento para este roteiro." };
    }

    await enfileirar(usuario.id, "roteiro", {
      referencia,
      entrada: { roteiro_id: roteiroId, minutos_alvo: minutos, ...(tom ? { tom } : {}) },
    });
  } catch (erro) {
    return { erro: mensagemDe(erro) };
  }

  revalidatePath(`/roteiro/${roteiroId}`);
  return { mensagem: "Geração na fila. O texto aparece aqui assim que ficar pronto." };
}

/**
 * Acompanhamento do job — a leitura que a tela repete enquanto a IA escreve.
 *
 * Escolha: TanStack Query com refetch curto, e NÃO revalidação por Server
 * Action. O worker roda num laço de fundo dentro do processo
 * (src/lib/worker/index.ts) e nunca toca no cache do React; no instante em que
 * o texto fica pronto não existe nada para invalidar — alguém precisa
 * perguntar. Perguntar do cliente, em vez de suspender um Server Component, é
 * também o que mantém o editor e o formulário vivos durante a espera: dá para
 * continuar mexendo na tela em vez de encarar um esqueleto.
 *
 * Esta função devolve só o estado. Quando ele termina, o componente chama
 * router.refresh() UMA vez e o texto novo entra pelo Server Component — que é
 * de onde ele deve vir.
 */
export async function consultarGeracao(roteiroId: string): Promise<EstadoGeracao | null> {
  const usuario = await exigirUsuario("/roteiro");
  return estadoDaGeracao(usuario.id, roteiroId);
}

// -----------------------------------------------------------------------------
// Edição e versões
// -----------------------------------------------------------------------------

export async function salvarEdicao(
  _anterior: EstadoRoteiro,
  formData: FormData,
): Promise<EstadoRoteiro> {
  const usuario = await exigirUsuario("/roteiro");
  if (modoDemo) return { erro: AVISO_DEMO };

  const roteiroId = lerUuid(formData.get("roteiroId"));
  if (!roteiroId) return { erro: "Roteiro não encontrado." };

  const secoes: BlocoRoteiro[] = ORDEM_SECOES.map((secao) => ({
    secao,
    texto: String(formData.get(`secao_${secao}`) ?? ""),
  }));

  try {
    const { numero, criouVersao } = await salvarRoteiro(usuario.id, roteiroId, {
      titulo: String(formData.get("titulo") ?? ""),
      secoes,
    });

    revalidatePath(`/roteiro/${roteiroId}`);
    revalidatePath("/roteiro");

    return {
      versao: numero,
      mensagem: criouVersao
        ? `Versão ${numero} salva.`
        : "O texto não mudou, então nenhuma versão nova foi criada.",
    };
  } catch (erro) {
    return { erro: mensagemDe(erro) };
  }
}

export async function restaurar(
  _anterior: EstadoRoteiro,
  formData: FormData,
): Promise<EstadoRoteiro> {
  const usuario = await exigirUsuario("/roteiro");
  if (modoDemo) return { erro: AVISO_DEMO };

  const roteiroId = lerUuid(formData.get("roteiroId"));
  if (!roteiroId) return { erro: "Roteiro não encontrado." };

  const numero = Number(texto(formData.get("numero")));
  if (!Number.isInteger(numero) || numero < 1) return { erro: "Versão inválida." };

  try {
    const { numero: nova, de } = await restaurarVersao(usuario.id, roteiroId, numero);

    revalidatePath(`/roteiro/${roteiroId}`);
    revalidatePath("/roteiro");

    return {
      versao: nova,
      mensagem: `Versão ${de} restaurada como versão ${nova}. Nenhuma versão foi apagada.`,
    };
  } catch (erro) {
    return { erro: mensagemDe(erro) };
  }
}

export async function arquivar(
  _anterior: EstadoRoteiro,
  formData: FormData,
): Promise<EstadoRoteiro> {
  const usuario = await exigirUsuario("/roteiro");
  if (modoDemo) return { erro: AVISO_DEMO };

  const roteiroId = lerUuid(formData.get("roteiroId"));
  if (!roteiroId) return { erro: "Roteiro não encontrado." };

  try {
    await arquivarRoteiro(usuario.id, roteiroId);
  } catch (erro) {
    return { erro: mensagemDe(erro) };
  }

  revalidatePath("/roteiro");
  redirect("/roteiro");
}

// -----------------------------------------------------------------------------
// Lista
// -----------------------------------------------------------------------------

/** Próxima página da lista. O cursor é o par (atualizado_em, id) do último item. */
export async function maisRoteiros(cursor: string): Promise<Pagina<RoteiroResumo>> {
  const usuario = await exigirUsuario("/roteiro");
  return listarRoteiros(usuario.id, { cursor });
}
