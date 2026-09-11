export const THEME_STORAGE_KEY = "shopia_theme";

/** Barra do navegador no PWA. Espelha --bg do tokens.css em cada tema. */
export const THEME_COLOR = {
  light: "#F6FAF7",
  dark: "#0A100D",
} as const;

export type Theme = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
