import type { Metadata } from "next";
import { Users, Ticket, Gift, KeyRound } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alerta } from "@/components/ui/alerta";
import { exigirPapel } from "@/lib/sessao";
import { listarContas, listarConvites, planosAtivos, resumoAdmin } from "@/lib/dados/admin";
import { numero } from "@/lib/utils";
import { PainelConvites } from "./convites";
import { PainelContas } from "./contas";

export const metadata: Metadata = { title: "Operação" };

/**
 * A área de operação.
 *
 * Existe porque a alternativa é dar UPDATE na produção pelo terminal, que é
 * como se concede acesso errado para a pessoa errada e ninguém descobre.
 * Toda ação daqui grava em `auditoria`.
 */
export default async function AdminPage(props: PageProps<"/admin">) {
  const admin = await exigirPapel(["admin"]);
  const { busca } = await props.searchParams;
  const termo = typeof busca === "string" ? busca : null;

  const [resumo, contas, convites, planos] = await Promise.all([
    resumoAdmin(),
    listarContas(termo),
    listarConvites(),
    planosAtivos(),
  ]);

  return (
    <>
      <PageHeader
        titulo="Operação"
        descricao="Convites de acesso, cortesias e contas. Tudo aqui fica registrado na auditoria."
        acoes={<Badge tom="marca">{admin.usuario}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <Indicador icone={<Users className="size-5" aria-hidden />} rotulo="Contas" valor={resumo.contas} />
        <Indicador icone={<KeyRound className="size-5" aria-hidden />} rotulo="Com acesso" valor={resumo.comAcesso} />
        <Indicador icone={<Gift className="size-5" aria-hidden />} rotulo="Cortesias" valor={resumo.cortesias} />
        <Indicador icone={<Ticket className="size-5" aria-hidden />} rotulo="Convites no ar" valor={resumo.convitesAtivos} />
      </div>

      {planos.length === 0 && (
        <Alerta tom="info" className="mt-4">
          Não há plano ativo no catálogo. Sem plano não dá para conceder acesso.
        </Alerta>
      )}

      <section className="mt-6">
        <Card>
          <CardTitulo>Convites de acesso</CardTitulo>
          <CardDescricao>
            Um código dá acesso de cortesia pelo prazo que você definir, sem
            pagamento. Serve para teste fechado e para quem você quiser liberar.
            O acesso fica marcado como cortesia — não vira assinatura paga
            disfarçada na hora de fechar o mês.
          </CardDescricao>
          <PainelConvites convites={convites} planos={planos} />
        </Card>
      </section>

      <section className="mt-4">
        <Card>
          <CardTitulo>Contas</CardTitulo>
          <CardDescricao>
            Conceder ou encerrar cortesia, mudar papel e ajustar crédito.
            O ajuste de crédito entra na razão como lançamento, nunca por cima
            do saldo.
          </CardDescricao>
          <PainelContas contas={contas} planos={planos} busca={termo} meuId={admin.id} />
        </Card>
      </section>
    </>
  );
}

function Indicador({
  icone,
  rotulo,
  valor,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor: number;
}) {
  return (
    <Card className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-fg">
        {icone}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-fg-subtle">{rotulo}</p>
        <p className="num truncate text-lg font-semibold">{numero(valor)}</p>
      </div>
    </Card>
  );
}
