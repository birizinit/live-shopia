"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Aparece ao entrar na tela. Só esconde o que está ABAIXO da dobra no momento
 * em que a página monta: o que já está à vista nunca pisca, e sem JavaScript
 * tudo fica visível.
 */
export function Revelar({
  children,
  atraso = 0,
  className,
  como: Tag = "div",
}: {
  children: React.ReactNode;
  atraso?: number;
  className?: string;
  como?: "div" | "li" | "section";
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    el.setAttribute("data-espera", "");
    const obs = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          el.removeAttribute("data-espera");
          obs.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={cn("lp-revelar", className)}
      style={atraso ? { transitionDelay: `${atraso}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
