import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ThemeScript } from "@/components/theme/theme-script";
import { THEME_COLOR } from "@/components/theme/constants";
import { fontVariables } from "./fonts";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Shopia — quem responde o chat da sua live",
    template: "%s · Shopia",
  },
  description:
    "Responde os comentários da sua live no TikTok usando o manual que você cadastrou, dá boas-vindas pelo nome e fixa o produto na tela. Nunca inventa resposta.",
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Gerado pelo proxy a cada requisição (src/lib/csp.ts).
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="pt-BR" suppressHydrationWarning className={fontVariables}>
      <body className="min-h-dvh bg-bg text-fg antialiased">
        <ThemeScript nonce={nonce} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
