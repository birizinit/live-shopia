/**
 * Variáveis de ambiente, num lugar só.
 *
 * Sem DATABASE_URL a aplicação entra em MODO DEMO (src/lib/demo.ts): sessão
 * falsa, dados de exemplo, nada persiste — serve para mexer na interface antes
 * de existir banco. Em produção o modo demo é bloqueado: seria bypass de login.
 */

const databaseUrl = process.env.DATABASE_URL?.trim();

export const bancoConfigurado = Boolean(databaseUrl);

export const env = {
  databaseUrl: databaseUrl ?? "",
  /** Railway expõe o Postgres na rede interna sem TLS; o proxy público aceita. */
  databaseSsl: process.env.DATABASE_SSL === "require",
  siteUrl: (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "http://localhost:3000")
  ).replace(/\/$/, ""),
  emailRemetente: process.env.EMAIL_REMETENTE?.trim() ?? "Shopia <nao-responda@shopia.app>",
  resendApiKey: process.env.RESEND_API_KEY?.trim() ?? "",
  producao: process.env.NODE_ENV === "production",
} as const;

const demoForcado = process.env.SHOPIA_DEMO === "1";

export const modoDemo =
  demoForcado || (!bancoConfigurado && process.env.NODE_ENV !== "production");

/** Produção sem banco: não cai em demo, falha de forma visível. */
export const configuracaoFaltando = !bancoConfigurado && !modoDemo;

/**
 * Chamado por quem vai de fato falar com o banco. O erro sai no uso e não no
 * import: assim `next build` conclui sem DATABASE_URL e a falha aparece na
 * requisição, com mensagem clara, em vez de quebrar o build.
 */
export function exigirBanco() {
  if (configuracaoFaltando) {
    throw new Error(
      "DATABASE_URL não está definida. Copie .env.example para .env.local " +
        "(ou referencie ${{Postgres.DATABASE_URL}} no serviço da Railway).",
    );
  }
}
