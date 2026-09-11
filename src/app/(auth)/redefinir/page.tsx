import type { Metadata } from "next";
import { FormRedefinir } from "./form";

export const metadata: Metadata = { title: "Nova senha" };

export default function RedefinirPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Nova senha</h1>
      <p className="mt-1 mb-8 text-sm text-fg-muted">
        Escolha uma senha que você não use em outro lugar.
      </p>
      <FormRedefinir />
    </>
  );
}
