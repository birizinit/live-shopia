import type { Metadata } from "next";
import { destinoSeguro } from "@/lib/destino-seguro";
import { ROTA_POS_LOGIN } from "@/lib/rotas";
import { FormLogin } from "./form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { proximo } = await props.searchParams;
  const destino = destinoSeguro(proximo, ROTA_POS_LOGIN);

  return (
    <>
      <h1 className="text-2xl font-bold">Entrar</h1>
      <p className="mt-1 mb-8 text-sm text-fg-muted">
        Continue de onde a sua live parou.
      </p>
      <FormLogin proximo={destino} />
    </>
  );
}
