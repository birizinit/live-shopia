import type { MetadataRoute } from "next";
import { THEME_COLOR } from "@/components/theme/constants";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shopia — live commerce com IA",
    short_name: "Shopia",
    description:
      "Cuida da sua live no TikTok Shop pelo Chrome: timer de encerramento, proteção contra violação, fixar produto, comentários automáticos, aviso de venda no celular e respostas pelo seu manual.",
    id: "/",
    start_url: "/inicio",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "pt-BR",
    dir: "ltr",
    background_color: THEME_COLOR.light,
    theme_color: THEME_COLOR.light,
    categories: ["business", "productivity", "shopping"],
    icons: [
      {
        src: "/icons/shopia.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/shopia.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
