import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bell, HandCoins, Star, UserCog } from "lucide-react";
import { sair } from "@/app/(auth)/actions";
import { PageHeader } from "@/components/layout/page-header";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { visivelPara, type ItemNav } from "@/lib/nav";
import { exigirUsuario } from "@/lib/sessao";
import type { Papel } from "@/lib/roles";
import { numero } from "@/lib/utils";

export const metadata: Metadata = { title: "Minha conta" };

const ROTULO_PAPEL: Record<Papel, string> = {
  user: "Usuário",
  affiliate: "Afiliado PRO",
  manager: "Gerente",
  admin: "Admin",
};

/**
 * O resultado do link de confirmação (src/app/confirmar/route.ts). Chegava na
 * URL e ninguém lia: quem clicava no e-mail caía aqui sem saber se deu certo.
 */
const CONFIRMACAO: Record<string, { tom: "sucesso" | "erro" | "info"; texto: string }> = {
  confirmado: { tom: "sucesso", texto: "E-mail confirmado. Obrigado!" },
  expirado: { tom: "erro", texto: "O link de confirmação expirou ou já foi usado." },
  invalido: { tom: "erro", texto: "O link de confirmação não é válido." },
  demo: { tom: "info", texto: "Modo demonstração: nada foi confirmado de verdade." },
};

const ATALHOS: ItemNav[] = [
  { href: "/notificacoes", rotulo: "Notificações", icone: Bell, descricao: "Aviso de venda no celular" },
  { href: "/indique", rotulo: "Indique e ganhe", icone: HandCoins, descricao: "Seu link de indicação e ganhos" },
  { href: "/afiliado", rotulo: "Afiliado PRO", icone: Star, papeis: ["affiliate", "manager"], descricao: "Saldo e saques" },
  { href: "/gerente", rotulo: "Gerente", icone: UserCog, papeis: ["manager"], descricao: "Sua equipe" },
];

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <dt className="text-sm text-fg-muted">{rotulo}</dt>
      <dd className="min-w-0 truncate text-sm font-medium">{valor}</dd>
    </div>
  );
}

export default async function PerfilPage(props: PageProps<"/perfil">) {
  const usuario = await exigirUsuario("/perfil");
  const { email } = await props.searchParams;
  const confirmacao = typeof email === "string" ? CONFIRMACAO[email] : undefined;
  const atalhos = ATALHOS.filter((item) => visivelPara(item, usuario.papel));

  return (
    <>
      <PageHeader titulo="Minha conta" descricao="Dados da conta, plano, créditos e preferências." />

      {confirmacao && (
        <Alerta tom={confirmacao.tom} className="mb-4">
          {confirmacao.texto}
        </Alerta>
      )}

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
            <Linha
              rotulo="E-mail confirmado"
              valor={
                usuario.emailVerificado ? (
                  <Badge tom="sucesso">Confirmado</Badge>
                ) : (
                  <Badge tom="alerta">Pendente</Badge>
                )
              }
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
          <CardTitulo>Mais da sua conta</CardTitulo>
          <ul className="mt-3 divide-y divide-border">
            {atalhos.map(({ href, rotulo, icone: Icone, descricao }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="group flex items-center gap-3 py-2.5 text-sm hover:text-primary"
                >
                  <Icone className="size-4 shrink-0 text-fg-subtle group-hover:text-primary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{rotulo}</span>
                    {descricao && <span className="block text-fg-muted">{descricao}</span>}
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
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
          <form action={sair} className="mt-6 border-t border-border pt-4">
            <Button type="submit" variante="secondary">
              Sair da conta
            </Button>
            {usuario.demo && (
              <p className="mt-2 text-xs text-fg-subtle">Esta sessão é do modo demonstração.</p>
            )}
          </form>
        </Card>
      </div>
    </>
  );
}
