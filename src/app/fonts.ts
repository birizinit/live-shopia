import { IBM_Plex_Mono, TikTok_Sans } from "next/font/google";

/**
 * Tipografia: TikTok Sans, a fonte do próprio TikTok (licença OFL, no Google
 * Fonts). Uma família só para título e texto, como no app do TikTok; a mono
 * fica para código e números alinhados.
 *
 * As variáveis entram no <html> e o globals.css as costura nos tokens
 * --font-display / --font-sans / --font-mono.
 */

const tiktokSans = TikTok_Sans({
  subsets: ["latin"],
  variable: "--next-font-sans",
  display: "swap",
});

export const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--next-font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const fontVariables = [tiktokSans.variable, fontMono.variable].join(" ");
