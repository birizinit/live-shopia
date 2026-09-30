/**
 * Tipos que atravessam dominio.
 *
 * Existe para que `Pagina`, `Estimativa` e `JobResumo` nao nascam dentro de um
 * modulo e sejam importados de la por outros seis — o que criaria ciclo de
 * import e faria qualquer mudanca em um dominio mexer em todos.
 *
 * Sem logica e sem `server-only`: o cliente tambem precisa destes tipos.
 */

export type Pagina<T> = {
  itens: T[];
  /** Passar de volta em `cursor` para a proxima pagina. `null` = acabou. */
  proximo: string | null;
  total?: number;
};

export type Consulta = {
  busca?: string;
  cursor?: string | null;
  limite?: number;
};

export type Periodo = "hoje" | "ontem" | "7d" | "30d" | "total";

export type EstadoJob = "pendente" | "processando" | "concluido" | "falhou" | "cancelado";

/**
 * Os tipos que a fila pode DEVOLVER, não os que ela aceita.
 *
 * `roteiro`, `tts`, `montagem` e `clonagem` foram desligados na 0026 e não têm
 * mais handler — mas continuam no catálogo porque `jobs` guarda histórico
 * apontando para eles, e uma consulta de job antigo devolve esses valores.
 * Tirar daqui faria o TypeScript afirmar que não existem justamente onde eles
 * aparecem.
 */
export type TipoJob =
  | "roteiro"
  | "tts"
  | "montagem"
  | "clonagem"
  | "comissao"
  | "push"
  | "faxina";

export type JobResumo = {
  id: string;
  tipo: TipoJob;
  estado: EstadoJob;
  progresso: number;
  erro: string | null;
  criadoEm: string;
};

/**
 * O que o usuario ve ANTES de confirmar uma geracao. Mostrar o custo depois de
 * cobrar e como nao mostrar.
 */
export type Estimativa = {
  caracteres: number;
  blocos: number;
  duracaoMs: number;
  creditosDisponiveis: number;
  suficiente: boolean;
  faltam: number;
};


export type ResultadoAcao<T = void> =
  | { ok: true; dado: T }
  | { ok: false; erro: string; codigo?: string };
