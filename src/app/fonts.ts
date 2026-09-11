import { Bricolage_Grotesque, IBM_Plex_Mono, Public_Sans } from "next/font/google";

/**
 * Tipografia da marca (docs/DESIGN-SYSTEM.md §4).
 * Deliberadamente não é Inter: é a fonte do concorrente e o padrão de todo SaaS.
 *
 * As variáveis entram no <html> e o globals.css as costura nos tokens
 * --font-display / --font-sans / --font-mono.
 */

export const fontDisplay = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--next-font-display",
  display: "swap",
  axes: ["opsz"],
});

export const fontSans = Public_Sans({
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

export const fontVariables = [
  fontDisplay.variable,
  fontSans.variable,
  fontMono.variable,
].join(" ");
