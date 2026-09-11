import type { Metadata } from "next";
import Link from "next/link";
import { sair } from "@/app/(auth)/actions";
import { PageHeader } from "@/components/layout/page-header";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { exigirUsuario } from "@/lib/sessao";
import type { Papel } from "@/lib/roles";
import { numero } from "@/lib/utils";

export const metadata: Metadata = { title: "Perfil" };

const ROTULO_PAPEL: Record<Papel, string> = {
  user: "Usuário",
  affiliate: "Afiliado PRO",
  manager: "Gerente",
  admin: "Admin",
};

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <dt className="text-sm text-fg-muted">{rotulo}</dt>
      <dd className="min-w-0 truncate text-sm font-medium">{valor}</dd>
    </div>
  );
}

export default async function PerfilPage() {
  const usuario = await exigirUsuario("/perfil");

  return (
    <>
      <PageHeader titulo="Perfil" descricao="Dados da conta, plano e preferências." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitulo>Conta</CardTitulo>
          <dl className="mt-3">
            <Linha rotulo="Nome" valor={usuario.nome || "—"} />
            <Linha
              rotulo="Usuário"
              valor={
                <span className="font-[family-name:var(--font-mono)]">
                  @{usuario.usuario}
                </span>
              }
            />
            <Linha rotulo="E-mail" valor={usuario.email} />
            <Linha
              rotulo="Papel"
              valor={<Badge tom="marca">{ROTULO_PAPEL[usuario.papel]}</Badge>}
            />
          </dl>
        </Card>

        <Card>
          <CardTitulo>Plano e créditos</CardTitulo>
          <dl className="mt-3">
            <Linha rotulo="Plano" valor={usuario.plano ?? "Sem plano"} />
            <Linha
              rotulo="Créditos"
              valor={<span className="num">{numero(usuario.creditos)}</span>}
            />
          </dl>
          <div className="mt-4 flex gap-2">
            <Link
              href="/planos"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
            >
              Ver planos
            </Link>
            <Link
              href="/creditos"
              className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
            >
              Comprar créditos
            </Link>
          </div>
        </Card>

        <Card>
          <CardTitulo>Aparência</CardTitulo>
          <CardDescricao>
            O padrão acompanha o sistema. A escolha explícita vale nos dois
            sentidos e fica guardada neste navegador.
          </CardDescricao>
          <div className="mt-4">
            <ThemeToggle />
          </div>
        </Card>

        <Card>
          <CardTitulo>Sessão</CardTitulo>
          <CardDescricao>
            O token fica num cookie <code className="font-[family-name:var(--font-mono)] text-xs">HttpOnly</code>,
            fora do alcance do JavaScript da página.
            {usuario.demo && " Esta sessão é do modo demo, não do Supabase."}
          </CardDescricao>
          <form action={sair} className="mt-4">
            <Button type="submit" variante="secondary">
              Sair da conta
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
