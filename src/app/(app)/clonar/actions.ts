"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { chaveIdempotente } from "@/lib/dados/creditos";
import { ErroDominio } from "@/lib/dados/erros";
import {
  TEXTO_CONSENTIMENTO,
  analisarAmostra,
  apagarAudioDaAmostra,
  criarAmostra,
  listarAmostras,
  listarVozesClonadas,
  podeEnviarAmostra,
  type AmostraVoz,
  type GeneroVoz,
  type ModoClonagem,
  type VozClonada,
} from "@/lib/dados/clonagem";
import { servicos } from "@/lib/env";
import { exigirUsuario } from "@/lib/sessao";
import type { ResultadoAcao } from "@/lib/dados/tipos";
import { ipDoPedido } from "@/lib/rede";

export type EstadoEnvio = {
  ok?: boolean;
  erro?: string;
  mensagem?: string;
  /**
   * A chave que o PRÓXIMO envio vai usar.
   *
   * A chave deste envio veio do campo oculto que o Server Component renderizou
   * — a action nunca gera a chave que ela mesma consome, senão o duplo clique
   * viraria duas clonagens pagas. O que vai daqui é a chave do formulário
   * seguinte, e ela só muda quando o envio atual foi aceito.
   */
  proximaChave: string;
  campos?: {
    nome?: string;
    modo?: string;
    idioma?: string;
    genero?: string;
    descricao?: string;
  };
};

const esquema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "Dê um nome de pelo menos 2 caracteres para a voz")
    .max(60, "O nome da voz tem no máximo 60 caracteres"),
  modo: z.enum(["rapido", "treino"]),
  idioma: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Escolha um idioma da lista"),
  genero: z.enum(["feminina", "masculina", "neutra"]),
  descricao: z.string().trim().max(300, "A descrição tem no máximo 300 caracteres"),
});

function primeiroErro(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? "Confira os dados do formulário";
}

/**
 * De onde veio o aceite. A coluna é `inet`: valor malformado derruba o insert
 * inteiro, então só passa o que se parece com IP — sem origem o consentimento
 * ainda é válido, com origem malformada não haveria consentimento nenhum.
 */
async function ipDaRequisicao(): Promise<string | null> {
  const bruto = ipDoPedido(await headers());
  if (!bruto) return null;
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(bruto);
  const ipv6 = /^[0-9a-f:]+$/i.test(bruto) && bruto.includes(":");
  return ipv4 || ipv6 ? bruto : null;
}

export async function enviarAmostra(
  _anterior: EstadoEnvio,
  formData: FormData,
): Promise<EstadoEnvio> {
  const usuario = await exigirUsuario("/clonar");

  const chave = String(formData.get("chave") ?? "").trim();
  if (!chave) {
    return {
      erro: "O formulário expirou. Recarregue a página e envie de novo.",
      proximaChave: chaveIdempotente("clonagem"),
    };
  }

  const campos = {
    nome: String(formData.get("nome") ?? "").trim(),
    modo: String(formData.get("modo") ?? "rapido"),
    idioma: String(formData.get("idioma") ?? "pt-BR"),
    genero: String(formData.get("genero") ?? "feminina"),
    descricao: String(formData.get("descricao") ?? "").trim(),
  };

  /** Erro devolve a MESMA chave: a tentativa é a mesma, não uma nova. */
  const recusar = (erro: string): EstadoEnvio => ({ erro, proximaChave: chave, campos });

  // Sem chave de voz a clonagem nunca sai da fila. Aceitar 8 MB de upload para
  // deixar o job apodrecer seria enganar o usuário e ocupar a conta dele.
  if (!servicos.voz) {
    return recusar(
      "A clonagem depende da conta de voz (ELEVENLABS_API_KEY), que não está " +
        "configurada neste ambiente. Nada é enviado até a chave existir.",
    );
  }

  if (usuario.demo) {
    return recusar(
      "Modo demonstração: a sessão não tem conta no banco, então o envio não " +
        "seria gravado. Entre com uma conta real para clonar sua voz.",
    );
  }

  const parsed = esquema.safeParse(campos);
  if (!parsed.success) return recusar(primeiroErro(parsed.error));

  if (formData.get("consentimento") !== "on") {
    return recusar(
      "Sem o aceite do termo não dá para clonar a voz. Leia e marque a caixa de consentimento.",
    );
  }

  const arquivo = formData.get("amostra");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return recusar("Escolha o arquivo de áudio da amostra.");
  }

  const informada = Number(formData.get("duracao_ms") ?? 0);
  const duracaoInformadaMs = Number.isFinite(informada) && informada > 0 ? Math.round(informada) : null;

  try {
    const conteudo = Buffer.from(await arquivo.arrayBuffer());

    const analise = analisarAmostra({
      conteudo,
      nomeArquivo: arquivo.name,
      mime: arquivo.type,
      modo: parsed.data.modo as ModoClonagem,
      duracaoInformadaMs,
    });

    // O teto entra aqui, e não antes de ler o arquivo: o que precisa ser
    // protegido é a chamada paga no provedor, e errar o formato cinco vezes
    // não pode trancar a conta por uma hora.
    if (!(await podeEnviarAmostra(usuario.id))) {
      return recusar(
        "Muitos envios em pouco tempo. Espere alguns minutos antes de mandar outra amostra.",
      );
    }

    const envio = await criarAmostra(usuario.id, {
      nome: parsed.data.nome,
      modo: parsed.data.modo as ModoClonagem,
      idioma: parsed.data.idioma,
      genero: parsed.data.genero as GeneroVoz,
      descricao: parsed.data.descricao || null,
      conteudo,
      mime: analise.mime,
      duracaoMs: analise.duracaoMs,
      consentimentoTexto: TEXTO_CONSENTIMENTO,
      ip: await ipDaRequisicao(),
      chave,
    });

    revalidatePath("/clonar");
    revalidatePath("/vozes");

    return {
      ok: true,
      mensagem: envio.repetido
        ? "Este envio já estava registrado — nada foi clonado duas vezes."
        : "Amostra recebida com o consentimento registrado. A clonagem entrou na fila.",
      // Envio aceito: o próximo formulário precisa de chave nova.
      proximaChave: chaveIdempotente("clonagem"),
    };
  } catch (erro) {
    if (erro instanceof ErroDominio) return recusar(erro.message);
    console.error("[clonar] envio falhou:", erro);
    return recusar("Não foi possível enviar a amostra. Tente de novo.");
  }
}

export type Sincronizacao = { amostras: AmostraVoz[]; vozes: VozClonada[] };

/** Estado dos envios abertos — chamada em intervalo pelo acompanhamento. */
export async function sincronizarClonagem(): Promise<Sincronizacao> {
  const usuario = await exigirUsuario("/clonar");
  const [amostras, vozes] = await Promise.all([
    listarAmostras(usuario.id),
    listarVozesClonadas(usuario.id),
  ]);
  return { amostras, vozes };
}

export async function apagarAudio(amostraId: string): Promise<ResultadoAcao> {
  const usuario = await exigirUsuario("/clonar");

  if (usuario.demo) {
    return { ok: false, erro: "Modo demonstração: nada é apagado de verdade." };
  }

  try {
    // O id vem da tela, mas quem manda é o par (id, perfilId) lá dentro.
    await apagarAudioDaAmostra(usuario.id, amostraId);
    revalidatePath("/clonar");
    return { ok: true, dado: undefined };
  } catch (erro) {
    if (erro instanceof ErroDominio) return { ok: false, erro: erro.message, codigo: erro.codigo };
    console.error("[clonar] apagar áudio falhou:", erro);
    return { ok: false, erro: "Não foi possível apagar o áudio." };
  }
}
