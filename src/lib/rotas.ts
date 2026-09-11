/**
 * Mapa de rotas para o guard. Sem ícones e sem React de propósito: este
 * módulo é carregado pelo proxy, que roda em toda requisição.
 *
 * Regra: **privado por padrão**. Rota nova nasce protegida; só entra aqui
 * o que é deliberadamente público. O inverso (lista de privadas) esquece
 * uma rota mais cedo ou mais tarde e vaza tela.
 */

/** Acessíveis sem sessão. */
export const ROTAS_PUBLICAS = [
  "/",
  "/login",
  "/cadastro",
  "/esqueci",
  "/redefinir",
  "/planos",
] as const;

/** Públicas que não fazem sentido com sessão ativa — vão para /inicio. */
export const ROTAS_AUTENTICACAO = [
  "/login",
  "/cadastro",
  "/esqueci",
  "/redefinir",
] as const;

/** Existe no menu, ainda não existe de verdade. */
export const ROTAS_EM_BREVE = ["/assistente"] as const;

export const ROTA_POS_LOGIN = "/inicio";
export const ROTA_LOGIN = "/login";

export function ehPublica(caminho: string) {
  return ROTAS_PUBLICAS.some(
    (rota) => caminho === rota || (rota !== "/" && caminho.startsWith(`${rota}/`)),
  );
}

export function ehAutenticacao(caminho: string) {
  return ROTAS_AUTENTICACAO.some((rota) => caminho === rota);
}

export function ehEmBreve(caminho: string) {
  return ROTAS_EM_BREVE.some(
    (rota) => caminho === rota || caminho.startsWith(`${rota}/`),
  );
}
