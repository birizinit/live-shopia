"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Avisos passageiros (toast).
 *
 * Tres decisoes que nao sao cosmeticas:
 *
 * 1. A regiao existe vazia desde o primeiro render. Leitor de tela so anuncia
 *    mudanca dentro de um aria-live que JA estava no DOM — regiao criada junto
 *    com a primeira mensagem nao e lida.
 * 2. A fila tem teto. Quatro avisos empilhados ninguem le, e o mais novo (que
 *    e o que responde ao ultimo clique) seria o mais escondido.
 * 3. O relogio pausa no ponteiro e no foco. Aviso que some enquanto a pessoa
 *    esta lendo, ou enquanto o teclado esta dentro dele, e o mesmo que nao ter
 *    aparecido.
 */

export type TomAviso = "sucesso" | "erro" | "alerta" | "info";

export type Aviso = {
  id: string;
  tom: TomAviso;
  titulo: string;
  texto?: string;
  /** 0 mantem na tela ate fecharem no X — para erro que precisa ser lido. */
  duracaoMs?: number;
  acao?: { rotulo: string; aoClicar: () => void };
};

export type NovoAviso = Omit<Aviso, "id">;

export type ApiAvisos = {
  mostrar: (aviso: NovoAviso) => string;
  sucesso: (titulo: string, texto?: string) => string;
  erro: (titulo: string, texto?: string) => string;
  alerta: (titulo: string, texto?: string) => string;
  info: (titulo: string, texto?: string) => string;
  fechar: (id: string) => void;
};

const LIMITE = 3;
const DURACAO_PADRAO = 5000;
/** Erro fica mais tempo: costuma trazer o que fazer a seguir. */
const DURACAO_ERRO = 9000;

const ESTILOS: Record<TomAviso, { Icone: typeof Info; icone: string; borda: string }> = {
  sucesso: { Icone: CircleCheck, icone: "text-success", borda: "border-l-success" },
  erro: { Icone: CircleAlert, icone: "text-danger", borda: "border-l-danger" },
  alerta: { Icone: TriangleAlert, icone: "text-warning", borda: "border-l-warning" },
  info: { Icone: Info, icone: "text-info", borda: "border-l-info" },
};

type Relogio = {
  temporizador: ReturnType<typeof setTimeout> | null;
  restanteMs: number;
  iniciadoEm: number;
};

type ContextoLista = {
  avisos: Aviso[];
  fechar: (id: string) => void;
  pausar: () => void;
  retomar: () => void;
};

const ContextoApi = createContext<ApiAvisos | null>(null);
const ContextoDados = createContext<ContextoLista | null>(null);

export function useAvisos(): ApiAvisos {
  const api = useContext(ContextoApi);
  if (!api) throw new Error("useAvisos precisa de <ProvedorAvisos> acima na árvore.");
  return api;
}

export type ProvedorAvisosProps = {
  children: React.ReactNode;
  /** false quando a RegiaoAvisos for posicionada a mao em outro ponto da arvore. */
  regiao?: boolean;
};

export function ProvedorAvisos({ children, regiao = true }: ProvedorAvisosProps) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const sequencia = useRef(0);
  const relogios = useRef(new Map<string, Relogio>());

  const fechar = useCallback((id: string) => {
    setAvisos((lista) => lista.filter((aviso) => aviso.id !== id));
  }, []);

  const mostrar = useCallback(
    (aviso: NovoAviso) => {
      sequencia.current += 1;
      const id = `aviso-${sequencia.current}`;
      const duracaoMs =
        aviso.duracaoMs ?? (aviso.tom === "erro" ? DURACAO_ERRO : DURACAO_PADRAO);

      setAvisos((lista) => [...lista, { ...aviso, id }].slice(-LIMITE));

      if (duracaoMs > 0) {
        relogios.current.set(id, {
          temporizador: setTimeout(() => fechar(id), duracaoMs),
          restanteMs: duracaoMs,
          iniciadoEm: Date.now(),
        });
      }

      return id;
    },
    [fechar],
  );

  // A limpeza mora fora do atualizador de estado: em StrictMode o atualizador
  // roda duas vezes, e cancelar temporizador la dentro mataria o de um aviso vivo.
  useEffect(() => {
    const vivos = new Set(avisos.map((aviso) => aviso.id));
    for (const [id, relogio] of relogios.current) {
      if (vivos.has(id)) continue;
      if (relogio.temporizador) clearTimeout(relogio.temporizador);
      relogios.current.delete(id);
    }
  }, [avisos]);

  useEffect(() => {
    const mapa = relogios.current;
    return () => {
      for (const relogio of mapa.values()) {
        if (relogio.temporizador) clearTimeout(relogio.temporizador);
      }
      mapa.clear();
    };
  }, []);

  const pausar = useCallback(() => {
    for (const [id, relogio] of relogios.current) {
      if (!relogio.temporizador) continue;
      clearTimeout(relogio.temporizador);
      relogios.current.set(id, {
        temporizador: null,
        restanteMs: Math.max(500, relogio.restanteMs - (Date.now() - relogio.iniciadoEm)),
        iniciadoEm: 0,
      });
    }
  }, []);

  const retomar = useCallback(() => {
    for (const [id, relogio] of relogios.current) {
      if (relogio.temporizador) continue;
      relogios.current.set(id, {
        temporizador: setTimeout(() => fechar(id), relogio.restanteMs),
        restanteMs: relogio.restanteMs,
        iniciadoEm: Date.now(),
      });
    }
  }, [fechar]);

  const api = useMemo<ApiAvisos>(
    () => ({
      mostrar,
      sucesso: (titulo, texto) => mostrar({ tom: "sucesso", titulo, texto }),
      erro: (titulo, texto) => mostrar({ tom: "erro", titulo, texto }),
      alerta: (titulo, texto) => mostrar({ tom: "alerta", titulo, texto }),
      info: (titulo, texto) => mostrar({ tom: "info", titulo, texto }),
      fechar,
    }),
    [mostrar, fechar],
  );

  const dados = useMemo<ContextoLista>(
    () => ({ avisos, fechar, pausar, retomar }),
    [avisos, fechar, pausar, retomar],
  );

  return (
    <ContextoApi.Provider value={api}>
      <ContextoDados.Provider value={dados}>
        {children}
        {regiao && <RegiaoAvisos />}
      </ContextoDados.Provider>
    </ContextoApi.Provider>
  );
}

export function RegiaoAvisos({ className }: { className?: string }) {
  const dados = useContext(ContextoDados);
  if (!dados) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        // bottom-20 no celular: a barra de abas mora embaixo e cobriria o aviso.
        "pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4",
        "sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end",
        className,
      )}
    >
      {dados.avisos.map((aviso) => (
        <Cartao
          key={aviso.id}
          aviso={aviso}
          aoFechar={() => dados.fechar(aviso.id)}
          pausar={dados.pausar}
          retomar={dados.retomar}
        />
      ))}
    </div>
  );
}

function Cartao({
  aviso,
  aoFechar,
  pausar,
  retomar,
}: {
  aviso: Aviso;
  aoFechar: () => void;
  pausar: () => void;
  retomar: () => void;
}) {
  const { Icone, icone, borda } = ESTILOS[aviso.tom];
  const [entrou, setEntrou] = useState(false);

  // Entrada por transicao e nao por animacao: transicao ja e desligada pelo
  // prefers-reduced-motion global, sem precisar de keyframe novo.
  useEffect(() => {
    const quadro = requestAnimationFrame(() => setEntrou(true));
    return () => cancelAnimationFrame(quadro);
  }, []);

  return (
    <div
      onMouseEnter={pausar}
      onMouseLeave={retomar}
      onFocus={pausar}
      onBlur={retomar}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm gap-3 rounded-md border border-l-4 border-border bg-surface-raised p-3 shadow-lg",
        "transition-[opacity,transform] duration-[--dur-base] ease-[--ease-out]",
        borda,
        entrou ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
      )}
    >
      <Icone className={cn("mt-0.5 size-4 shrink-0", icone)} aria-hidden />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{aviso.titulo}</p>
        {aviso.texto && <p className="mt-0.5 text-xs text-fg-muted">{aviso.texto}</p>}
        {aviso.acao && (
          <button
            type="button"
            onClick={() => {
              aviso.acao?.aoClicar();
              aoFechar();
            }}
            className="mt-2 text-xs font-medium text-primary underline underline-offset-2 hover:text-primary-hover"
          >
            {aviso.acao.rotulo}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={aoFechar}
        aria-label="Fechar aviso"
        className="-mt-0.5 -mr-0.5 grid size-6 shrink-0 place-items-center rounded-full text-fg-subtle transition-colors duration-[--dur-fast] hover:bg-surface-hover hover:text-fg"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
