"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  THEME_COLOR,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type Theme,
} from "./constants";

type ThemeContextValue = {
  /** O que o usuário escolheu — "system" é o padrão. */
  theme: Theme;
  /** O que está de fato na tela depois de resolver "system". */
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const QUERY = "(prefers-color-scheme: dark)";

/**
 * A preferência mora fora do React (localStorage + media query do SO), então
 * quem lê é useSyncExternalStore. Ler num efeito e chamar setState provoca
 * render em cascata e briga com a hidratação.
 *
 * O snapshot é uma string "escolha:resolvido" de propósito: precisa ser
 * comparável por valor a cada leitura.
 */
const ouvintes = new Set<() => void>();

function assinar(aoMudar: () => void) {
  ouvintes.add(aoMudar);
  const mq = window.matchMedia(QUERY);
  const emOutraAba = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) aoMudar();
  };

  mq.addEventListener("change", aoMudar);
  window.addEventListener("storage", emOutraAba);

  return () => {
    ouvintes.delete(aoMudar);
    mq.removeEventListener("change", aoMudar);
    window.removeEventListener("storage", emOutraAba);
  };
}

function lerPreferencia(): Theme {
  try {
    const bruto = localStorage.getItem(THEME_STORAGE_KEY);
    if (bruto === "dark" || bruto === "light") return bruto;
  } catch {
    // localStorage bloqueado (janela privada, cookies desativados)
  }
  return "system";
}

function instantaneo() {
  const escolha = lerPreferencia();
  const resolvido =
    escolha === "system"
      ? window.matchMedia(QUERY).matches
        ? "dark"
        : "light"
      : escolha;
  return `${escolha}:${resolvido}`;
}

/** No servidor não há SO nem localStorage; o ThemeScript acerta antes da pintura. */
function instantaneoServidor() {
  return "system:light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const bruto = useSyncExternalStore(assinar, instantaneo, instantaneoServidor);
  const [theme, resolved] = bruto.split(":") as [Theme, ResolvedTheme];

  // Efeito sincronizando sistema externo (DOM) com o estado — que é para
  // isto que efeito serve.
  useEffect(() => {
    const raiz = document.documentElement;
    if (theme === "system") delete raiz.dataset.theme;
    else raiz.dataset.theme = theme;

    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", THEME_COLOR[resolved]);
  }, [theme, resolved]);

  const setTheme = useCallback((proximo: Theme) => {
    try {
      if (proximo === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, proximo);
    } catch {
      // Não persiste, mas a sessão atual muda do mesmo jeito.
    }
    for (const ouvinte of ouvintes) ouvinte();
  }, []);

  const value = useMemo(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme precisa estar dentro de <ThemeProvider>");
  return ctx;
}
