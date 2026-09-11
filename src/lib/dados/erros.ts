import "server-only";

/**
 * Tradutor central de erro de banco.
 *
 * Sem ele, cada tela inventa a sua leitura de SQLSTATE e o mesmo erro vira
 * quatro mensagens diferentes na interface. A regra: o banco e quem decide
 * (constraint), este modulo so traduz.
 */
export type CodigoErro =
  | "saldo_insuficiente"
  | "conflito"
  | "nao_encontrado"
  | "dado_invalido"
  | "sem_permissao"
  | "servico_indisponivel"
  | "desconhecido";

export class ErroDominio extends Error {
  constructor(
    readonly codigo: CodigoErro,
    mensagem: string,
    readonly causa?: unknown,
  ) {
    super(mensagem);
    this.name = "ErroDominio";
  }
}

const POR_CONSTRAINT: Record<string, [CodigoErro, string]> = {
  perfis_creditos_nao_negativo: ["saldo_insuficiente", "Créditos insuficientes para esta geração."],
  perfis_email_unico: ["conflito", "Já existe uma conta com este e-mail."],
  produtos_fixado_idx: ["conflito", "Já existe um produto fixado. Desafixe o outro primeiro."],
  montagens_ativa_idx: ["conflito", "Já existe uma montagem ativa."],
  vozes_clonada_com_consentimento: ["dado_invalido", "Falta registrar o consentimento de uso da voz."],
  arquivos_tamanho_por_linha: ["dado_invalido", "Arquivo grande demais para um bloco."],
};

const POR_SQLSTATE: Record<string, [CodigoErro, string]> = {
  "23514": ["dado_invalido", "Os dados não passaram em uma regra do sistema."],
  "23505": ["conflito", "Esse registro já existe."],
  "23503": ["nao_encontrado", "Um item relacionado não existe ou não é seu."],
  "22P02": ["dado_invalido", "Identificador inválido."],
  "22023": ["dado_invalido", "Valor inválido."],
  "40001": ["conflito", "Outra operação alterou este registro. Tente de novo."],
  "57014": ["servico_indisponivel", "A consulta demorou demais."],
};

export function traduzirErro(erro: unknown): ErroDominio {
  if (erro instanceof ErroDominio) return erro;

  const e = erro as { code?: string; constraint_name?: string; message?: string };
  const porConstraint = e?.constraint_name ? POR_CONSTRAINT[e.constraint_name] : undefined;
  if (porConstraint) return new ErroDominio(porConstraint[0], porConstraint[1], erro);

  const porEstado = e?.code ? POR_SQLSTATE[e.code] : undefined;
  if (porEstado) return new ErroDominio(porEstado[0], porEstado[1], erro);

  return new ErroDominio("desconhecido", "Não foi possível concluir a operação.", erro);
}

/** Envolve uma operação de banco traduzindo o que vier. */
export async function comTraducao<T>(operacao: () => Promise<T>): Promise<T> {
  try {
    return await operacao();
  } catch (erro) {
    throw traduzirErro(erro);
  }
}

export function exigirAchado<T>(valor: T | null | undefined, oQue = "registro"): T {
  if (valor === null || valor === undefined) {
    throw new ErroDominio("nao_encontrado", `${oQue} não encontrado.`);
  }
  return valor;
}
