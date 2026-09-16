import type { Metadata } from "next";
import { FormCadastro } from "./form";

export const metadata: Metadata = { title: "Criar conta" };

export default async function CadastroPage(props: PageProps<"/cadastro">) {
  const { ref, convite } = await props.searchParams;
  const indicacao = typeof ref === "string" ? ref.slice(0, 32) : undefined;
  const codigoConvite = typeof convite === "string" ? convite.slice(0, 12).toUpperCase() : undefined;

  return (
    <>
      <h1 className="text-2xl font-bold">Criar conta</h1>
      <p className="mt-1 mb-8 text-sm text-fg-muted">
        Leva menos de um minuto.
      </p>
      <FormCadastro indicacao={indicacao} convite={codigoConvite} />
    </>
  );
}
