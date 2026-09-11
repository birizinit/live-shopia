import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** R$ 1.234,56 — sempre com tabular-nums na UI (ver .num no globals.css). */
export function brl(valor: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);
}

export function numero(valor: number) {
  return new Intl.NumberFormat("pt-BR").format(valor);
}
