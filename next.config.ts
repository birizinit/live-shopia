import type { NextConfig } from "next";

/**
 * Cabeçalhos de segurança que não mudam por requisição. O CSP muda (leva o
 * nonce) e por isso mora no proxy — ver src/lib/csp.ts.
 *
 * Câmera e microfone ficam negados no painel: nenhuma tela grava nada. Quem
 * usa áudio do sistema é a extensão, que roda na origem dela e não herda isto.
 */
const CABECALHOS_DE_SEGURANCA = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: CABECALHOS_DE_SEGURANCA }];
  },
  experimental: {
    /**
     * Cache de arquivo do Turbopack DESLIGADO no build.
     *
     * A Railway monta /app/.next/cache entre builds. Quando um build falha por
     * dependência ausente, o cache guarda o estado em que o módulo não existia
     * — e o build seguinte, já com a dependência instalada, continua falhando
     * com o mesmo hash de chunk. Foi exatamente o que aconteceu aqui: o
     * @tailwindcss/postcss passou a estar presente e o erro não mudou.
     *
     * Build de CI precisa ser determinístico mais do que precisa ser rápido.
     * O cache de desenvolvimento continua ligado.
     */
    turbopackFileSystemCacheForBuild: false,
  },
};

export default nextConfig;
