"use client";

import { useActionState } from "react";
import { redefinirSenha, type EstadoForm } from "../actions";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/input";

const INICIAL: EstadoForm = {};

export function FormRedefinir() {
  const [estado, acao, enviando] = useActionState(redefinirSenha, INICIAL);

  return (
    <form action={acao} className="space-y-4">
      {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}
      {estado.mensagem && <Alerta tom="sucesso">{estado.mensagem}</Alerta>}

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
