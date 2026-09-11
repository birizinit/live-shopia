"use client";

import Link from "next/link";
import { useActionState } from "react";
import { redefinirSenha, type EstadoForm } from "../actions";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/input";

const INICIAL: EstadoForm = {};

export function FormRedefinir({ token }: { token: string }) {
  const [estado, acao, enviando] = useActionState(redefinirSenha, INICIAL);

  if (estado.mensagem) {
    return (
      <div className="space-y-6">
        <Alerta tom="sucesso">{estado.mensagem}</Alerta>
        <Link
          href="/login"
          className="inline-flex h-12 w-full items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-primary-fg shadow-sm transition-colors duration-[--dur-fast] hover:bg-primary-hover"
        >
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}

      <Campo rotulo="Nova senha" htmlFor="senha" dica="Mínimo de 8 caracteres">
        <Input
          id="senha"
          name="senha"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={8}
          required
          autoFocus
        />
      </Campo>

      <Campo rotulo="Confirmar nova senha" htmlFor="confirmacao">
        <Input
          id="confirmacao"
          name="confirmacao"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={8}
          required
        />
      </Campo>

      <Button type="submit" bloco tamanho="lg" disabled={enviando}>
        {enviando ? "Salvando…" : "Salvar nova senha"}
      </Button>
    </form>
  );
}
