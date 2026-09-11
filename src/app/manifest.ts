import type { MetadataRoute } from "next";
import { THEME_COLOR } from "@/components/theme/constants";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shopia — live commerce com IA",
    short_name: "Shopia",
    description:
      "Roteiro de vendas por IA, voz da apresentadora e áudio contínuo da live, com vendas em tempo real.",
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
