/**
 * Variáveis de ambiente, num lugar só.
 *
 * A aplicação sobe sem o Supabase configurado: sem as chaves ela entra em
 * MODO DEMO (src/lib/demo.ts), com sessão falsa e dados de exemplo, para dar
 * para ver e navegar a interface antes de existir um projeto Supabase.
 * O modo demo é bloqueado em produção a menos que explicitamente ligado.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const supabaseConfigurado = Boolean(url && anon);

export const env = {
  supabaseUrl: url ?? "",
  supabaseAnonKey: anon ?? "",
  /** Só no servidor. Ignora RLS — nunca importar em Client Component. */
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "",
  siteUrl:
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "http://localhost:3000",
  producao: process.env.NODE_ENV === "production",
} as const;

const demoForcado = process.env.SHOPIA_DEMO === "1";

export const modoDemo =
  demoForcado || (!supabaseConfigurado && process.env.NODE_ENV !== "production");

/** Produção sem chaves: não cai em modo demo (isso seria um bypass de login). */
export const configuracaoFaltando = !supabaseConfigurado && !modoDemo;

/**
 * Chamado por quem vai de fato falar com o Supabase. O erro é lançado no uso,
 * não no import: assim `next build` conclui sem as chaves e a falha aparece
 * na requisição, com mensagem clara, em vez de quebrar o build.
 */
export function exigirSupabase() {
  if (configuracaoFaltando) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY não estão definidas. " +
        "Copie .env.example para .env.local (ou configure as variáveis no deploy).",
    );
  }
}
