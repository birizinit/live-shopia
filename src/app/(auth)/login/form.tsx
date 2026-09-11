"use client";

import Link from "next/link";
import { useActionState } from "react";
import { entrar, type EstadoForm } from "../actions";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/input";

const INICIAL: EstadoForm = {};

export function FormLogin({ proximo }: { proximo: string }) {
  const [estado, acao, enviando] = useActionState(entrar, INICIAL);

  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="proximo" value={proximo} />

      {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}

      <Campo rotulo="E-mail" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          placeholder="voce@email.com"
          defaultValue={estado.campos?.email}
          required
          autoFocus
        />
      </Campo>

      <Campo rotulo="Senha" htmlFor="senha">
        <Input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </Campo>

      <div className="flex justify-end">
        <Link
          href="/esqueci"
          className="text-sm text-fg-muted underline-offset-4 hover:text-primary hover:underline"
        >
          Esqueci a senha
        </Link>
      </div>

      <Button type="submit" bloco tamanho="lg" disabled={enviando}>
        {enviando ? "Entrando…" : "Entrar"}
      </Button>

      <p className="text-center text-sm text-fg-muted">
        Ainda não tem conta?{" "}
        <Link
          href="/cadastro"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Criar conta
        </Link>
      </p>
    </form>
  );
}
