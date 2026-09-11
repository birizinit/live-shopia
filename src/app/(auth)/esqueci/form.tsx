"use client";

import Link from "next/link";
import { useActionState } from "react";
import { solicitarRecuperacao, type EstadoForm } from "../actions";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/input";

const INICIAL: EstadoForm = {};

export function FormEsqueci() {
  const [estado, acao, enviando] = useActionState(solicitarRecuperacao, INICIAL);

  return (
    <form action={acao} className="space-y-4">
      {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}
      {estado.mensagem && <Alerta tom="sucesso">{estado.mensagem}</Alerta>}

      <Campo rotulo="E-mail" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="voce@email.com"
          required
          autoFocus
        />
      </Campo>

      <Button type="submit" bloco tamanho="lg" disabled={enviando}>
        {enviando ? "Enviando…" : "Enviar link de redefinição"}
      </Button>

      <p className="text-center text-sm text-fg-muted">
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Voltar para o login
        </Link>
      </p>
    </form>
  );
}
