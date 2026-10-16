"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** No celular, o botão de cadastro acompanha a leitura depois do topo. */
export function CtaFixo({ href, rotulo }: { href: string; rotulo: string }) {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    const aoRolar = () => {
      const fim = document.getElementById("cta-final");
      const passouDoTopo = window.scrollY > window.innerHeight * 0.8;
      const chegouNoFim = fim ? fim.getBoundingClientRect().top < window.innerHeight : false;
      setVisivel(passouDoTopo && !chegouNoFim);
    };
    aoRolar();
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/90 p-3 backdrop-blur transition-transform duration-300 sm:hidden",
        visivel ? "translate-y-0" : "translate-y-full",
      )}
      aria-hidden={!visivel}
    >
      <Link
        href={href}
        tabIndex={visivel ? 0 : -1}
        className="lp-cta flex h-12 w-full items-center justify-center gap-2 rounded-lg text-base font-semibold text-white shadow-md"
        style={{ background: "var(--brand-gradient)" }}
      >
        {rotulo}
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}
