/**
 * Variaveis de ambiente, num lugar so — TODAS as fases de uma vez.
 *
 * Preenchido inteiro desde ja, mesmo com valores vazios, porque este e o
 * arquivo que toda fase quer editar: deixar para depois garante conflito.
 *
 * Sem DATABASE_URL a aplicacao entra em MODO DEMO (src/lib/demo.ts): sessao
 * falsa, dados de exemplo, nada persiste. Em producao o demo e bloqueado.
 *
 * Regra sem excecao para servico externo: sem chave, a funcionalidade ou cai
 * em exemplo claramente rotulado, ou fica DESLIGADA. O que nunca acontece e
 * simular — em especial pagamento: PIX falso e fraude, nao demonstracao.
 */

const texto = (valor: string | undefined) => valor?.trim() ?? "";

const databaseUrl = texto(process.env.DATABASE_URL);

export const bancoConfigurado = Boolean(databaseUrl);

export const env = {
  databaseUrl,
  databaseSsl: process.env.DATABASE_SSL === "require",

  siteUrl: (
    texto(process.env.NEXT_PUBLIC_SITE_URL) ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "") ||
    "http://localhost:3000"
  ).replace(/\/$/, ""),

  // Fase 1 — roteiro e voz
  anthropicApiKey: texto(process.env.ANTHROPIC_API_KEY),
  anthropicModelo: texto(process.env.ANTHROPIC_MODELO) || "claude-opus-5",
  elevenlabsApiKey: texto(process.env.ELEVENLABS_API_KEY),
  elevenlabsModelo: texto(process.env.ELEVENLABS_MODELO) || "eleven_multilingual_v2",

  // Fase 2 — armazenamento
  r2Bucket: texto(process.env.R2_BUCKET),
  r2AccountId: texto(process.env.R2_ACCOUNT_ID),
  r2AccessKeyId: texto(process.env.R2_ACCESS_KEY_ID),
  r2SecretAccessKey: texto(process.env.R2_SECRET_ACCESS_KEY),

  // Fase 3 — pagamento
  gatewayNome: texto(process.env.GATEWAY_NOME),
  gatewayToken: texto(process.env.GATEWAY_TOKEN),
  gatewayWebhookSegredo: texto(process.env.GATEWAY_WEBHOOK_SEGREDO),

  // Fase 4 — push
  vapidPublica: texto(process.env.VAPID_PUBLIC_KEY),
  vapidPrivada: texto(process.env.VAPID_PRIVATE_KEY),
  // O padrão VAPID exige um contato do remetente: é por onde o serviço de push
  // do navegador fala com a gente se o nosso envio começar a dar problema.
  vapidAssunto: texto(process.env.VAPID_ASSUNTO) || "mailto:nao-responda@influpay.com.br",

  // Fase 5 — extensao
  extensaoSegredo: texto(process.env.EXTENSAO_SEGREDO),

  // Fase 6 — KYC. Pepper do HMAC de CPF: sem ele, hash de 11 digitos e
  // quebravel por forca bruta em minutos.
  kycPepper: texto(process.env.KYC_PEPPER),

  // E-mail
  emailRemetente: texto(process.env.EMAIL_REMETENTE) || "Shopia <nao-responda@shopia.app>",
  resendApiKey: texto(process.env.RESEND_API_KEY),

  // Operacao
  /**
   * A fila mora no banco, e banco de desenvolvimento apontado para produção é
   * o caso comum aqui. Se o worker ligasse sozinho em dev, uma máquina de
   * desenvolvedor passaria a processar job de cliente com código não
   * publicado — e foi exatamente o que aconteceu na primeira vez.
   *
   * Em produção liga sozinho (desligue com SHOPIA_WORKER=0); fora dela, só
   * com SHOPIA_WORKER=1 explícito.
   */
  workerLigado:
    process.env.NODE_ENV === "production"
      ? process.env.SHOPIA_WORKER !== "0"
      : process.env.SHOPIA_WORKER === "1",
  cronSegredo: texto(process.env.CRON_SEGREDO),

  producao: process.env.NODE_ENV === "production",
} as const;

const demoForcado = process.env.SHOPIA_DEMO === "1";

export const modoDemo =
  demoForcado || (!bancoConfigurado && process.env.NODE_ENV !== "production");

/** Produção sem banco: não cai em demo, falha de forma visível. */
export const configuracaoFaltando = !bancoConfigurado && !modoDemo;

/**
 * Um serviço externo está ligado? É o que as telas consultam para decidir
 * entre operar, mostrar exemplo rotulado, ou desabilitar o botão.
 */
export const servicos = {
  get roteiroIa() {
    return Boolean(env.anthropicApiKey);
  },
  get voz() {
    return Boolean(env.elevenlabsApiKey);
  },
  get pagamento() {
    return Boolean(env.gatewayToken && env.gatewayNome);
  },
  get push() {
    return Boolean(env.vapidPublica && env.vapidPrivada);
  },
  get email() {
    return Boolean(env.resendApiKey);
  },
  get kyc() {
    return Boolean(env.kycPepper);
  },
} as const;

export function exigirBanco() {
  if (configuracaoFaltando) {
    throw new Error(
      "DATABASE_URL não está definida. Copie .env.example para .env.local " +
        "(ou referencie ${{Postgres.DATABASE_URL}} no serviço da Railway).",
    );
  }
}
