export const THEME_STORAGE_KEY = "shopia_theme";

/** Barra do navegador no PWA. Espelha --bg do tokens.css em cada tema. */
export const THEME_COLOR = {
  light: "#FFFFFF",
  dark: "#121212",
} as const;

export type Theme = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
