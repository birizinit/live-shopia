import type { Metadata } from "next";
import { FormRedefinir } from "./form";

export const metadata: Metadata = { title: "Nova senha" };

export default async function RedefinirPage(props: PageProps<"/redefinir">) {
  const { token } = await props.searchParams;

  return (
    <>
      <h1 className="text-2xl font-bold">Nova senha</h1>
      <p className="mt-1 mb-8 text-sm text-fg-muted">
        Escolha uma senha que você não use em outro lugar.
      </p>
      <FormRedefinir token={typeof token === "string" ? token : ""} />
    </>
  );
}
