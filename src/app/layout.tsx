import type { Metadata, Viewport } from "next";
import { ThemeScript } from "@/components/theme/theme-script";
import { THEME_COLOR } from "@/components/theme/constants";
import { fontVariables } from "./fonts";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Shopia — sua apresentadora de IA que vende ao vivo",
    template: "%s · Shopia",
  },
  description:
    "Gera o roteiro de vendas, sintetiza a voz da apresentadora e monta o áudio contínuo da live — com acompanhamento de vendas em tempo real.",
  applicationName: "Shopia",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Shopia", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // O ThemeScript reescreve este valor antes da primeira pintura conforme o
  // tema resolvido; aqui fica o padrão claro para o meta existir no HTML.
  themeColor: THEME_COLOR.light,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={fontVariables}>
      <body className="min-h-dvh bg-bg text-fg antialiased">
        <ThemeScript />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
