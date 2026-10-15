"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { cadastrar, type EstadoForm } from "../actions";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { CampoSenha } from "@/components/ui/campo-senha";
import { Campo, Input } from "@/components/ui/input";

const INICIAL: EstadoForm = {};

/**
 * Três campos: nome, e-mail e senha. O @usuário sai do e-mail (o banco
 * resolve colisão) e o "confirmar senha" virou o botão de mostrar a senha —
 * cada campo a mais no cadastro é gente que desiste no meio.
 */
export function FormCadastro({ indicacao, convite }: { indicacao?: string; convite?: string }) {
  const [estado, acao, enviando] = useActionState(cadastrar, INICIAL);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const senhaOk = senha.length >= 8;

  return (
    <form action={acao} className="space-y-4">
      {indicacao && <input type="hidden" name="ref" value={indicacao} />}
      {convite && <input type="hidden" name="convite" value={convite} />}

      {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}
      {convite && (
        <Alerta tom="sucesso">
          Convite <strong className="font-[family-name:var(--font-mono)]">{convite}</strong> aplicado. O
          acesso é liberado assim que a conta for criada.
        </Alerta>
      )}
      {indicacao && (
        <Alerta tom="info">
          Você foi indicado por <strong className="font-[family-name:var(--font-mono)]">{indicacao}</strong>.
        </Alerta>
      )}

      <Campo rotulo="Nome" htmlFor="nome">
        <Input
          id="nome"
          name="nome"
          autoComplete="name"
          placeholder="Como quer ser chamado"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          minLength={2}
          autoFocus
        />
      </Campo>

      <Campo rotulo="E-mail" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="voce@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Campo>

      <div className="space-y-1.5">
        <label htmlFor="senha" className="block text-sm font-medium text-fg">
          Senha
        </label>
        <CampoSenha
          id="senha"
          name="senha"
          autoComplete="new-password"
          placeholder="Mínimo de 8 caracteres"
          minLength={8}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          required
        />
        <p className={senhaOk ? "flex items-center gap-1 text-xs text-success" : "text-xs text-fg-subtle"}>
          {senhaOk && <Check className="size-3.5" aria-hidden />}
          {senhaOk ? "Senha boa." : `Mínimo de 8 caracteres${senha ? ` — faltam ${8 - senha.length}` : ""}.`}
        </p>
      </div>

      <Button type="submit" bloco tamanho="lg" disabled={enviando}>
        {enviando ? "Criando conta…" : "Criar conta grátis"}
      </Button>

      <p className="text-center text-sm text-fg-muted">
        Já tem conta?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </form>
  );
}
