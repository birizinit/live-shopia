"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  cancelarSaque,
  cpfValido,
  estadoDeSaque,
  registrarKyc,
  salvarContaDeRecebimento,
  solicitarSaque,
  somenteDigitos,
  type TipoChavePix,
} from "@/lib/dados/afiliados";
import { ErroDominio } from "@/lib/dados/erros";
import { contarCaracteres } from "@/lib/caracteres";
import { modoDemo } from "@/lib/env";
import { exigirPapel } from "@/lib/sessao";

/**
 * Mutações de /afiliado.
 *
 * Três regras valem em todas elas:
 *
 *  1. O papel é conferido AQUI também, não só na página. Server Action é um
 *     endpoint: quem tem o id dela pode chamá-la sem nunca abrir a tela.
 *  2. O resultado volta como CÓDIGO na query. A tela tem o catálogo de frases;
 *     mandar a frase pela URL deixaria qualquer um fazer a nossa tela dizer o
 *     que ele quisesse — e este formulário funciona sem JavaScript, então não
 *     há estado de cliente onde guardar a mensagem.
 *  3. Nada aqui transfere dinheiro. `solicitar_saque` abre um pedido e reserva
 *     comissão; quem paga é uma pessoa, fora do sistema, com comprovante.
 */

const ROTA = "/afiliado";

function codigoDoErro(erro: unknown): string {
  if (erro instanceof ErroDominio) return erro.codigo;
  return "desconhecido";
}

/** Meio-dia evita que fuso empurre a data um dia para trás na conversão. */
function maiorDeIdade(nascimento: string): boolean {
  const data = new Date(`${nascimento}T12:00:00`);
  if (Number.isNaN(data.getTime())) return false;
  const anos = (Date.now() - data.getTime()) / (365.2425 * 86_400_000);
  return anos >= 18;
}

/**
 * O nome é medido com `contarCaracteres` e não com o `.min()` do zod: o CHECK
 * da tabela conta code points (`length()` do Postgres), e medir em unidade
 * UTF-16 aqui aceitaria um nome que o banco recusa.
 */
const esquemaKyc = z.object({
  nome: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => {
      const n = contarCaracteres(v);
      return n >= 3 && n <= 160;
    }),
  nascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cpf: z.string(),
});

export async function enviarKyc(formData: FormData): Promise<void> {
  const usuario = await exigirPapel(["affiliate"]);

  const bruto = {
    nome: String(formData.get("nome") ?? ""),
    nascimento: String(formData.get("nascimento") ?? ""),
    cpf: String(formData.get("cpf") ?? ""),
  };

  let aviso = "kyc_enviado";
  const parsed = esquemaKyc.safeParse(bruto);

  if (modoDemo) {
    aviso = "demo";
  } else if (!parsed.success) {
    aviso = parsed.error.issues[0]?.path[0] === "nascimento" ? "kyc_nascimento" : "kyc_nome";
  } else if (!cpfValido(parsed.data.cpf)) {
    aviso = "kyc_cpf";
  } else if (!maiorDeIdade(parsed.data.nascimento)) {
    // Maioridade não cabe num CHECK do banco (`current_date` não é imutável), e
    // a camada de dados também confere. Aqui é só para o motivo chegar exato na
    // tela em vez de virar um "dado inválido" genérico.
    aviso = "kyc_idade";
  } else {
    try {
      await registrarKyc(usuario.id, parsed.data);
    } catch (erro) {
      aviso = codigoDoErro(erro);
    }
  }

  revalidatePath(ROTA);
  redirect(`${ROTA}?aviso=${aviso}`);
}

const CHAVES_PIX: readonly TipoChavePix[] = [
  "cpf",
  "cnpj",
  "email",
  "telefone",
  "aleatoria",
];

export async function salvarConta(formData: FormData): Promise<void> {
  const usuario = await exigirPapel(["affiliate"]);

  const tipo = String(formData.get("tipo") ?? "pix") === "conta" ? "conta" : "pix";
  const chaveTipoBruto = String(formData.get("chaveTipo") ?? "");
  const chaveTipo = CHAVES_PIX.find((c) => c === chaveTipoBruto) ?? null;

  const chave = String(formData.get("chave") ?? "").trim();
  const titularNome = String(formData.get("titularNome") ?? "").trim();
  const titularCpf = String(formData.get("titularCpf") ?? "");
  const bancoIspb = String(formData.get("bancoIspb") ?? "").trim();
  const agencia = String(formData.get("agencia") ?? "").trim();
  const conta = String(formData.get("conta") ?? "").trim();

  // Chave PIX do tipo CPF É o titular: aceitar dois números diferentes abriria
  // a porta para receber no CPF de outra pessoa.
  const cpfDoTitular =
    tipo === "pix" && chaveTipo === "cpf" ? somenteDigitos(chave) : somenteDigitos(titularCpf);

  let aviso = "conta_salva";

  if (modoDemo) {
    aviso = "demo";
  } else if (contarCaracteres(titularNome) < 3 || contarCaracteres(titularNome) > 160) {
    aviso = "conta_incompleta";
  } else if (tipo === "pix" && !(chaveTipo && chave)) {
    aviso = "conta_incompleta";
  } else if (tipo === "conta" && !(bancoIspb && agencia && conta)) {
    aviso = "conta_incompleta";
  } else if (!cpfValido(cpfDoTitular)) {
    aviso = "conta_cpf";
  } else {
    try {
      await salvarContaDeRecebimento(usuario.id, {
        tipo,
        chaveTipo,
        chave,
        bancoIspb,
        bancoNome: String(formData.get("bancoNome") ?? ""),
        agencia,
        conta,
        contaDigito: String(formData.get("contaDigito") ?? ""),
        titularNome,
        titularCpf: cpfDoTitular,
      });
    } catch (erro) {
      aviso = codigoDoErro(erro);
    }
  }

  revalidatePath(ROTA);
  redirect(`${ROTA}?aviso=${aviso}`);
}

export async function pedirSaque(formData: FormData): Promise<void> {
  const usuario = await exigirPapel(["affiliate"]);

  const contaId = String(formData.get("contaId") ?? "").trim();
  // Veio do render da página, num campo oculto. Se sumiu, o formulário está
  // velho — abrir um saque sem ela seria abrir um por clique.
  const referencia = String(formData.get("referencia") ?? "").trim();

  let aviso = "saque_solicitado";

  if (modoDemo) {
    aviso = "demo";
  } else if (!contaId || !referencia) {
    aviso = "dado_invalido";
  } else {
    // Reconfere as condições no servidor antes de chamar: o botão desabilitado
    // da tela não autoriza nada, e assim o motivo que volta é o específico em
    // vez do "valor inválido" genérico que o SQLSTATE do banco daria.
    const estado = await estadoDeSaque(usuario.id);

    if (estado.impedimento) {
      aviso = estado.impedimento.codigo;
    } else {
      try {
        await solicitarSaque(usuario.id, { contaId, referencia });
      } catch (erro) {
        aviso = codigoDoErro(erro);
      }
    }
  }

  revalidatePath(ROTA);
  redirect(`${ROTA}?aviso=${aviso}`);
}

export async function desistirDoSaque(formData: FormData): Promise<void> {
  const usuario = await exigirPapel(["affiliate"]);

  const saqueId = String(formData.get("saqueId") ?? "").trim();
  let aviso = "saque_cancelado";

  if (modoDemo) {
    aviso = "demo";
  } else if (!saqueId) {
    aviso = "dado_invalido";
  } else {
    try {
      // O dono é conferido dentro do `update` (perfil_id no where): o id vindo
      // do formulário não autoriza nada sozinho.
      await cancelarSaque(usuario.id, saqueId);
    } catch (erro) {
      aviso = codigoDoErro(erro);
    }
  }

  revalidatePath(ROTA);
  redirect(`${ROTA}?aviso=${aviso}`);
}
