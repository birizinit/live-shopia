import type { Metadata } from "next";
import { EmConstrucao } from "@/components/em-construcao";
import { PAGINAS } from "@/lib/paginas";

const ROTA = "/creditos" as const;

export const metadata: Metadata = { title: PAGINAS[ROTA].titulo };

export default function Page() {
  return <EmConstrucao rota={ROTA} />;
}
