"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { entrar, type EstadoForm } from "../actions";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { CampoSenha } from "@/components/ui/campo-senha";
import { Campo, Input } from "@/components/ui/input";

const INICIAL: EstadoForm = {};

export function FormLogin({ proximo, expirou }: { proximo: string; expirou?: boolean }) {
  const [estado, acao, enviando] = useActionState(entrar, INICIAL);
  // Controlados: o formulário com Server Action é zerado depois do envio, e
  // ninguém quer digitar o e-mail de novo por ter errado a senha.
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");

  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="proximo" value={proximo} />

      {estado.erro ? (
        <Alerta tom="erro">{estado.erro}</Alerta>
      ) : expirou ? (
        <Alerta tom="info">Sua sessão expirou. Entre de novo para continuar.</Alerta>
      ) : null}

      <Campo rotulo="E-mail ou usuário" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="voce@email.com"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          aria-invalid={estado.erro ? true : undefined}
          required
          autoFocus
        />
      </Campo>

      <Campo rotulo="Senha" htmlFor="senha">
        <CampoSenha
          id="senha"
          name="senha"
          autoComplete="current-password"
          placeholder="••••••••"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          aria-invalid={estado.erro ? true : undefined}
          required
        />
      </Campo>

      <div className="flex justify-end">
        <Link href="/esqueci" className="text-sm text-fg-muted underline-offset-4 hover:text-primary hover:underline">
          Esqueci a senha
        </Link>
      </div>

      <Button type="submit" bloco tamanho="lg" disabled={enviando}>
        {enviando ? "Entrando…" : "Entrar"}
      </Button>

      <p className="text-center text-sm text-fg-muted">
        Ainda não tem conta?{" "}
        <Link href="/cadastro" className="font-medium text-primary underline-offset-4 hover:underline">
          Criar conta grátis
        </Link>
      </p>
    </form>
  );
}
