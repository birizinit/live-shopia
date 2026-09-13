import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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