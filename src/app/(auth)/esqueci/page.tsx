import type { Metadata } from "next";
import { FormEsqueci } from "./form";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function EsqueciPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Recuperar senha</h1>
      <p className="mt-1 mb-8 text-sm text-fg-muted">
        Enviamos um link para você definir uma senha nova.
      </p>
      <FormEsqueci />
    </>
  );
}
