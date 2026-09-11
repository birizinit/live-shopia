"use client";

import Link from "next/link";
import { useActionState } from "react";
import { cadastrar, type EstadoForm } from "../actions";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/input";

const INICIAL: EstadoForm = {};

export function FormCadastro({ indicacao }: { indicacao?: string }) {
  const [estado, acao, enviando] = useActionState(cadastrar, INICIAL);

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
      {indicacao && <input type="hidden" name="ref" value={indicacao} />}

      {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}
      {indicacao && (
        <Alerta tom="info">
          Você foi indicado por{" "}
          <strong className="font-[family-name:var(--font-mono)]">{indicacao}</strong>.
        </Alerta>
      )}

      <Campo rotulo="Nome" htmlFor="nome">
        <Input
          id="nome"
          name="nome"
          autoComplete="name"
          placeholder="Como quer ser chamado"
          defaultValue={estado.campos?.nome}
          required
          autoFocus
        />
      </Campo>

      <Campo rotulo="Usuário" htmlFor="usuario" dica="Aparece no ranking. Letras, números, ponto e _">
        <Input
          id="usuario"
          name="usuario"
          autoComplete="nickname"
          placeholder="sualoja"
          defaultValue={estado.campos?.usuario}
          required
        />
      </Campo>

      <Campo rotulo="E-mail" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="voce@email.com"
          defaultValue={estado.campos?.email}
          required
        />
      </Campo>

      <Campo rotulo="Senha" htmlFor="senha" dica="Mínimo de 8 caracteres">
        <Input
          id="senha"
          name="senha"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={8}
          required
        />
      </Campo>

      <Campo rotulo="Confirmar senha" htmlFor="confirmacao">
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
        {enviando ? "Criando conta…" : "Criar conta"}
      </Button>

      <p className="text-center text-sm text-fg-muted">
        Já tem conta?{" "}
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Entrar
        </Link>
      </p>
    </form>
  );
}
