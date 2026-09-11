import type { Metadata } from "next";
import { EmConstrucao } from "@/components/em-construcao";
import { PAGINAS } from "@/lib/paginas";
import { exigirPapel } from "@/lib/sessao";

const ROTA = "/gerente" as const;

export const metadata: Metadata = { title: PAGINAS[ROTA].titulo };

export default async function Page() {
  // Papel é checado no servidor, contra o banco — nunca contra um claim do token.
  await exigirPapel(["manager"]);
  return <EmConstrucao rota={ROTA} />;
}
