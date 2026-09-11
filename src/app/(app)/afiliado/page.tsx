import type { Metadata } from "next";
import Link from "next/link";
import {
  Banknote,
  CalendarClock,
  FileText,
  HandCoins,
  Landmark,
  Lock,
  Percent,
  ReceiptText,
  ShieldCheck,
  TrendingUp,
  TriangleAlert,
  UserPlus,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { BotaoCopiar } from "@/components/ui/copiar";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Campo, Input } from "@/components/ui/input";
import { Propriedade, Propriedades } from "@/components/ui/propriedades";
import { Selecao } from "@/components/ui/selecao";
import { Cabecalho, Celula, Linha, Tabela } from "@/components/ui/tabela";
import {
  comissoesDe,
  convitesRecebidos,
  dataCurta,
  dataHora,
  dinheiro,
  estadoDeSaque,
  lancamentosDe,
  painelDoAfiliado,
  percentual,
  ROTULO_CHAVE_PIX,
  ROTULO_MOTIVO,
  ROTULO_ORIGEM_CURTO,
  ROTULO_STATUS_COMISSAO,
  ROTULO_STATUS_KYC,
  ROTULO_STATUS_SAQUE,
  saquesDe,
  type StatusComissao,
  type StatusSaque,
} from "@/lib/dados/afiliados";
import { chaveIdempotente } from "@/lib/dados/creditos";
import { PAGINAS } from "@/lib/paginas";
import { exigirPapel } from "@/lib/sessao";
import { cn, numero } from "@/lib/utils";
import { desistirDoSaque, enviarKyc, pedirSaque, salvarConta } from "./actions";

const ROTA = "/afiliado" as const;

export const metadata: Metadata = { title: PAGINAS[ROTA].titulo };

/** Catálogo fechado: a action manda o código, a tela escolhe a frase. */
const AVISOS: Record<string, { tom: "sucesso" | "erro" | "info"; texto: string }> = {
  kyc_enviado: {
    tom: "sucesso",
    texto:
      "Dados de identidade enviados. A verificação é feita por uma pessoa — o saque abre quando ela terminar.",
  },
  conta_salva: {
    tom: "sucesso",
    texto: "Conta de recebimento salva e definida como principal.",
  },
  saque_solicitado: {
    tom: "sucesso",
    texto:
      "Pedido de saque aberto. Ele entra na fila do financeiro: nada é transferido automaticamente.",
  },
  saque_cancelado: {
    tom: "info",
    texto: "Pedido cancelado. As comissões voltaram para o saldo disponível.",
  },
  demo: { tom: "info", texto: "Modo demo: a tela responde, mas nada foi gravado no banco." },

  kyc_nome: { tom: "erro", texto: "Informe o nome completo, como está no documento." },
  kyc_nascimento: { tom: "erro", texto: "Data de nascimento inválida." },
  kyc_cpf: { tom: "erro", texto: "CPF inválido. Confira os números." },
  kyc_idade: {
    tom: "erro",
    texto: "O titular precisa ter 18 anos ou mais para receber comissão.",
  },
  conta_incompleta: {
    tom: "erro",
    texto: "Faltou preencher um campo obrigatório da conta de recebimento.",
  },
  conta_cpf: {
    tom: "erro",
    texto:
      "CPF do titular inválido. Precisa ser exatamente o mesmo CPF da verificação de identidade.",
  },
  kyc_desligado: {
    tom: "erro",
    texto:
      "A verificação de identidade está desligada neste ambiente: falta a variável KYC_PEPPER.",
  },
  kyc_ausente: { tom: "erro", texto: "Envie seus dados de identidade antes de sacar." },
  kyc_analise: { tom: "erro", texto: "Sua identidade ainda está em análise." },
  kyc_recusado: {
    tom: "erro",
    texto: "A verificação de identidade foi recusada. Corrija os dados e envie de novo.",
  },
  sem_conta: { tom: "erro", texto: "Cadastre uma conta de recebimento antes de sacar." },
  abaixo_minimo: { tom: "erro", texto: "O saldo disponível está abaixo do mínimo de saque." },
  teto_periodo: { tom: "erro", texto: "O teto de saque do período já foi atingido." },

  conflito: { tom: "erro", texto: "O registro mudou enquanto você preenchia. Recarregue a página." },
  nao_encontrado: { tom: "erro", texto: "O registro não existe ou não é seu." },
  dado_invalido: { tom: "erro", texto: "Os dados enviados não passaram na validação." },
  sem_permissao: { tom: "erro", texto: "Esta ação não é permitida nesta conta." },
  servico_indisponivel: {
    tom: "erro",
    texto: "O serviço necessário não está configurado neste ambiente.",
  },
  saldo_insuficiente: { tom: "erro", texto: "Saldo insuficiente para esta operação." },
  desconhecido: { tom: "erro", texto: "Não foi possível concluir a operação." },
};

const TOM_COMISSAO: Record<StatusComissao, "neutro" | "marca" | "sucesso" | "alerta" | "perigo"> = {
  pendente: "alerta",
  disponivel: "marca",
  paga: "sucesso",
  estornada: "perigo",
};

const TOM_SAQUE: Record<StatusSaque, "neutro" | "marca" | "sucesso" | "alerta" | "perigo"> = {
  solicitado: "alerta",
  aprovado: "marca",
  pago: "sucesso",
  recusado: "perigo",
  cancelado: "neutro",
};

function Tile({
  icone: Icone,
  rotulo,
  valor,
  detalhe,
  tom = "neutro",
}: {
  icone: React.ComponentType<{ className?: string }>;
  rotulo: string;
  valor: string;
  detalhe?: string;
  tom?: "neutro" | "marca" | "alerta" | "perigo";
}) {
  const fundo =
    tom === "marca"
      ? "bg-primary-soft text-primary-soft-fg"
      : tom === "alerta"
        ? "bg-warning-soft text-warning"
        : tom === "perigo"
          ? "bg-danger-soft text-danger"
          : "bg-bg-subtle text-fg-subtle";

  return (
    <Card className="flex items-start gap-3">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-md", fundo)}>
        <Icone className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-fg-subtle">{rotulo}</p>
        <p className="num truncate text-lg font-semibold">{valor}</p>
        {detalhe && <p className="mt-0.5 text-xs text-fg-muted">{detalhe}</p>}
      </div>
    </Card>
  );
}

export default async function AfiliadoPage(props: PageProps<typeof ROTA>) {
  // Papel é checado no servidor, contra o banco — nunca contra um claim do token.
  const usuario = await exigirPapel(["affiliate"]);
  const { aviso: avisoBruto } = await props.searchParams;

  const codigoAviso = typeof avisoBruto === "string" ? avisoBruto : null;
  const aviso = codigoAviso ? AVISOS[codigoAviso] : undefined;

  const [painel, saque, comissoes, lancamentos, saques, convites] = await Promise.all([
    painelDoAfiliado(usuario.id),
    estadoDeSaque(usuario.id),
    comissoesDe(usuario.id),
    lancamentosDe(usuario.id),
    saquesDe(usuario.id),
    convitesRecebidos(usuario.id),
  ]);

  /**
   * A chave de idempotência do pedido nasce AQUI, no render, e viaja num campo
   * oculto. Gerada dentro da action, cada clique criaria uma chave nova — e o
   * duplo clique abriria dois saques sobre o mesmo saldo.
   */
  const referenciaDoSaque = chaveIdempotente("saque");

  const kycVerificado = saque.kyc?.status === "verificado";
  const emDivida = painel.saldo.disponivel < 0;
  const saqueAberto = saques.find(
    (s) => s.status === "solicitado" || s.status === "aprovado",
  );

  return (
    <>
      <PageHeader
        titulo={PAGINAS[ROTA].titulo}
        descricao="Seus indicados diretos, o volume que eles geraram, a taxa vigente e o caminho do dinheiro até a sua conta."
        acoes={
          <Link
            href="/indique"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-hover"
          >
            Rede em 3 níveis
          </Link>
        }
      />

      {aviso && (
        <Alerta tom={aviso.tom} className="mb-6">
          {aviso.texto}
        </Alerta>
      )}

      {usuario.demo && (
        <Alerta tom="info" className="mb-6">
          Esta sessão é do modo demo. Os números abaixo são um exemplo para a
          tela poder ser vista — nenhum deles veio do banco, e nenhum formulário
          grava nada.
        </Alerta>
      )}

      {convites.length > 0 && (
        <Alerta tom="info" className="mb-6">
          Você tem <span className="num">{numero(convites.length)}</span> convite(s)
          de gerente esperando resposta em{" "}
          <Link href="/indique" className="font-medium underline underline-offset-4">
            Indique e ganhe
          </Link>
          .
        </Alerta>
      )}

      <section>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            icone={Percent}
            tom="marca"
            rotulo="Taxa vigente (nível 1)"
            valor={painel.taxa ? percentual(painel.taxa.percentual) : "—"}
            detalhe={
              painel.taxa?.provisorio
                ? "Provisória: ainda não fechada com o dono do negócio"
                : "Sobre cada assinatura paga"
            }
          />
          <Tile
            icone={UserPlus}
            rotulo="Indicados diretos"
            valor={numero(painel.diretos.length)}
            detalhe="Pessoas que entraram pelo seu link"
          />
          <Tile
            icone={TrendingUp}
            rotulo="Volume gerado"
            valor={dinheiro(painel.volume.brutoCentavos)}
            detalhe={`${numero(painel.volume.vendas)} venda(s) confirmada(s)`}
          />
          <Tile
            icone={HandCoins}
            rotulo="Comissão de nível 1"
            valor={dinheiro(painel.volume.comissaoCentavos)}
            detalhe="Total gerado pelos seus diretos"
          />
        </div>

        {painel.taxa?.provisorio && (
          <Alerta tom="info" className="mt-4 bg-warning-soft text-warning">
            A taxa de{" "}
            <span className="num">{percentual(painel.taxa.percentual)}</span> está
            marcada como <strong>provisória</strong> no banco: é um número de
            trabalho, não um percentual fechado. Ele pode mudar antes do
            lançamento, e a comissão já gerada guarda a taxa que valia no dia.
          </Alerta>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Saldo</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            icone={CalendarClock}
            tom="alerta"
            rotulo="Pendente"
            valor={dinheiro(painel.saldo.pendente)}
            detalhe={
              painel.saldo.proximaLiberacao
                ? `Libera em ${dataCurta(painel.saldo.proximaLiberacao)} (D+${painel.diasLiberacao})`
                : `Nada na janela de D+${painel.diasLiberacao}`
            }
          />
          <Tile
            icone={Wallet}
            tom={emDivida ? "perigo" : "marca"}
            rotulo="Disponível"
            valor={dinheiro(painel.saldo.disponivel)}
            detalhe={emDivida ? "Negativo por clawback de venda sacada" : "Pode entrar num saque"}
          />
          <Tile
            icone={Lock}
            rotulo="Reservado em saque"
            valor={dinheiro(painel.saldo.bloqueado)}
            detalhe="Comprometido num pedido em análise"
          />
          <Tile
            icone={Banknote}
            rotulo="Já recebido"
            valor={dinheiro(painel.saldo.sacado)}
            detalhe="Total pago em saques"
          />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Saque</h2>

        <Alerta tom="info" className="mb-4">
          Pedir saque <strong>não transfere nada</strong>. O pedido reserva as
          comissões disponíveis e entra na fila de aprovação do financeiro; a
          transferência acontece fora do sistema e só depois o pedido vira{" "}
          <em>pago</em>, com comprovante anexado. Não existe gateway de
          pagamento aqui, e simular uma transferência seria mentir sobre
          dinheiro.
        </Alerta>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <CardTitulo>1. Identidade</CardTitulo>
              {saque.kyc && (
                <Badge
                  tom={
                    saque.kyc.status === "verificado"
                      ? "sucesso"
                      : saque.kyc.status === "recusado"
                        ? "perigo"
                        : "alerta"
                  }
                >
                  {ROTULO_STATUS_KYC[saque.kyc.status]}
                </Badge>
              )}
            </div>

            {!saque.kycConfigurado ? (
              <Alerta tom="erro" className="mt-3">
                A verificação de identidade está desligada neste ambiente: falta a
                variável <code className="font-[family-name:var(--font-mono)] text-xs">KYC_PEPPER</code>.
                Sem ela o CPF seria guardado sem segredo nenhum — 11 dígitos com
                dois verificadores caem numa tabela arco-íris em minutos. O
                formulário fica desligado em vez de fingir que protege.
              </Alerta>
            ) : kycVerificado ? (
              <>
                <CardDescricao>
                  Identidade conferida. Para trocar o titular, fale com o suporte —
                  esta troca não é feita por formulário.
                </CardDescricao>
                <Propriedades className="mt-3">
                  <Propriedade rotulo="Titular" valor={saque.kyc?.nome ?? "—"} />
                  <Propriedade
                    rotulo="CPF"
                    numerica
                    valor={saque.kyc?.cpfFinal ? `•••.•••.•••-${saque.kyc.cpfFinal}` : "—"}
                  />
                  <Propriedade
                    rotulo="Verificado em"
                    valor={dataCurta(saque.kyc?.verificadoEm ?? null)}
                  />
                </Propriedades>
              </>
            ) : (
              <>
                <CardDescricao>
                  O CPF nunca é guardado: gravamos um HMAC-SHA256 com um segredo
                  que vive fora do banco. Um dump vazado não vira lista de CPFs.
                </CardDescricao>

                {saque.kyc?.status === "recusado" && saque.kyc.motivoRecusa && (
                  <Alerta tom="erro" className="mt-3">
                    {saque.kyc.motivoRecusa}
                  </Alerta>
                )}

                <form action={enviarKyc} className="mt-4 space-y-3">
                  <Campo rotulo="Nome completo" htmlFor="kyc-nome">
                    <Input
                      id="kyc-nome"
                      name="nome"
                      autoComplete="name"
                      defaultValue={saque.kyc?.nome ?? usuario.nome}
                      required
                    />
                  </Campo>
                  <Campo rotulo="Data de nascimento" htmlFor="kyc-nascimento">
                    <Input id="kyc-nascimento" name="nascimento" type="date" required />
                  </Campo>
                  <Campo
                    rotulo="CPF"
                    htmlFor="kyc-cpf"
                    dica="Só números. Um CPF por conta de afiliado."
                  >
                    <Input
                      id="kyc-cpf"
                      name="cpf"
                      inputMode="numeric"
                      placeholder="00000000000"
                      required
                    />
                  </Campo>
                  <Button type="submit" bloco>
                    Enviar para verificação
                  </Button>
                </form>
              </>
            )}
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-3">
              <CardTitulo>2. Conta de recebimento</CardTitulo>
              {saque.contas.some((c) => c.principal) && (
                <Badge tom="sucesso">Principal definida</Badge>
              )}
            </div>

            {!kycVerificado ? (
              <CardDescricao>
                A conta só pode ser cadastrada depois que a identidade for
                verificada — e o titular precisa ser o mesmo. É o banco que
                recusa uma conta de terceiro, não a tela.
              </CardDescricao>
            ) : (
              <>
                {saque.contas.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {saque.contas.map((conta) => (
                      <li
                        key={conta.id}
                        className="flex items-start gap-2.5 rounded-md border border-border px-3 py-2.5 text-sm"
                      >
                        <Landmark className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
                        <span className="min-w-0">
                          <span className="block font-medium">
                            {conta.tipo === "pix"
                              ? `PIX ${conta.chaveTipo ? ROTULO_CHAVE_PIX[conta.chaveTipo] : ""}`
                              : (conta.bancoNome ?? "Conta bancária")}
                          </span>
                          <span className="num block text-xs text-fg-muted">
                            {conta.tipo === "pix"
                              ? (conta.chaveMascarada ?? "—")
                              : `Ag. ${conta.agencia ?? "—"} · ${conta.contaMascarada ?? "—"}`}
                          </span>
                          <span className="block text-xs text-fg-subtle">
                            {conta.titularNome}
                          </span>
                        </span>
                        {conta.principal && (
                          <Badge tom="marca" className="ml-auto shrink-0">
                            Principal
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <form action={salvarConta} className="mt-4 space-y-3">
                  <input type="hidden" name="tipo" value="pix" />

                  <Campo rotulo="Tipo da chave PIX" htmlFor="pix-tipo">
                    <Selecao
                      id="pix-tipo"
                      name="chaveTipo"
                      defaultValue="cpf"
                      opcoes={Object.entries(ROTULO_CHAVE_PIX).map(([valor, rotulo]) => ({
                        valor,
                        rotulo,
                      }))}
                    />
                  </Campo>

                  <Campo rotulo="Chave PIX" htmlFor="pix-chave">
                    <Input id="pix-chave" name="chave" required />
                  </Campo>

                  <Campo rotulo="Nome do titular" htmlFor="pix-titular">
                    <Input
                      id="pix-titular"
                      name="titularNome"
                      defaultValue={saque.kyc?.nome ?? ""}
                      required
                    />
                  </Campo>

                  <Campo
                    rotulo="CPF do titular"
                    htmlFor="pix-cpf"
                    dica="Precisa ser o mesmo da verificação. Se a chave for um CPF, ele é usado automaticamente."
                  >
                    <Input id="pix-cpf" name="titularCpf" inputMode="numeric" />
                  </Campo>

                  <Button type="submit" variante="secondary" bloco>
                    Salvar chave PIX
                  </Button>
                </form>

                <details className="mt-4 rounded-md border border-border">
                  <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">
                    Receber em conta bancária (TED)
                  </summary>
                  <form action={salvarConta} className="space-y-3 border-t border-border p-3">
                    <input type="hidden" name="tipo" value="conta" />
                    <Campo rotulo="ISPB do banco" htmlFor="ted-ispb" dica="8 dígitos.">
                      <Input id="ted-ispb" name="bancoIspb" inputMode="numeric" required />
                    </Campo>
                    <Campo rotulo="Nome do banco" htmlFor="ted-banco">
                      <Input id="ted-banco" name="bancoNome" />
                    </Campo>
                    <Campo rotulo="Agência" htmlFor="ted-agencia">
                      <Input id="ted-agencia" name="agencia" inputMode="numeric" required />
                    </Campo>
                    <Campo rotulo="Conta" htmlFor="ted-conta">
                      <Input id="ted-conta" name="conta" inputMode="numeric" required />
                    </Campo>
                    <Campo rotulo="Dígito" htmlFor="ted-digito">
                      <Input id="ted-digito" name="contaDigito" inputMode="numeric" />
                    </Campo>
                    <Campo rotulo="Nome do titular" htmlFor="ted-titular">
                      <Input
                        id="ted-titular"
                        name="titularNome"
                        defaultValue={saque.kyc?.nome ?? ""}
                        required
                      />
                    </Campo>
                    <Campo rotulo="CPF do titular" htmlFor="ted-cpf">
                      <Input id="ted-cpf" name="titularCpf" inputMode="numeric" required />
                    </Campo>
                    <Button type="submit" variante="secondary" bloco>
                      Salvar conta bancária
                    </Button>
                  </form>
                </details>
              </>
            )}
          </Card>

          <Card>
            <CardTitulo>3. Pedir saque</CardTitulo>
            <CardDescricao>
              O pedido leva as comissões disponíveis mais antigas que couberem no
              teto do período.
            </CardDescricao>

            <Propriedades className="mt-3">
              <Propriedade
                rotulo="Disponível"
                numerica
                valor={dinheiro(saque.disponivelCentavos)}
              />
              <Propriedade rotulo="Mínimo" numerica valor={dinheiro(saque.minimoCentavos)} />
              <Propriedade
                rotulo={`Teto a cada ${saque.periodoDias} dias`}
                numerica
                valor={dinheiro(saque.tetoCentavos)}
              />
              <Propriedade
                rotulo="Ainda cabe no período"
                numerica
                valor={dinheiro(saque.restanteCentavos)}
              />
            </Propriedades>

            {saque.impedimento && (
              <Alerta tom="info" className="mt-4 bg-warning-soft text-warning">
                {saque.impedimento.texto}
              </Alerta>
            )}

            {saqueAberto && (
              <Alerta tom="info" className="mt-4">
                Você já tem um pedido de{" "}
                <span className="num">{dinheiro(saqueAberto.valorCentavos)}</span> em
                análise, aberto em {dataCurta(saqueAberto.solicitadoEm)}.
              </Alerta>
            )}

            <form action={pedirSaque} className="mt-4 space-y-3">
              {/* Chave gerada no render: é ela que faz o duplo clique devolver o
                  MESMO pedido em vez de abrir dois sobre o mesmo saldo. */}
              <input type="hidden" name="referencia" value={referenciaDoSaque} />

              {saque.contas.length > 1 ? (
                <Campo rotulo="Receber em" htmlFor="saque-conta">
                  <Selecao
                    id="saque-conta"
                    name="contaId"
                    defaultValue={saque.contas.find((c) => c.principal)?.id ?? saque.contas[0]?.id}
                    opcoes={saque.contas.map((conta) => ({
                      valor: conta.id,
                      rotulo:
                        conta.tipo === "pix"
                          ? `PIX ${conta.chaveTipo ? ROTULO_CHAVE_PIX[conta.chaveTipo] : ""} ${conta.chaveMascarada ?? ""}`
                          : `${conta.bancoNome ?? "Conta"} ${conta.contaMascarada ?? ""}`,
                    }))}
                  />
                </Campo>
              ) : (
                <input
                  type="hidden"
                  name="contaId"
                  value={saque.contas[0]?.id ?? ""}
                />
              )}

              <Button type="submit" bloco disabled={!saque.podeSolicitar}>
                Solicitar saque
              </Button>
            </form>
          </Card>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Pedidos de saque</h2>
          {saques.length > 0 && (
            <Badge>
              <span className="num">{numero(saques.length)}</span>
              <span className="ml-1">pedido(s)</span>
            </Badge>
          )}
        </div>

        {saques.length === 0 ? (
          <EstadoVazio
            icone={Banknote}
            titulo="Nenhum saque pedido ainda"
            texto="Assim que o saldo disponível passar do mínimo e a identidade estiver verificada, o botão acima abre o primeiro pedido."
          />
        ) : (
          <Card>
            <Tabela
              rotulo="Seus pedidos de saque"
              cabecalho={
                <Cabecalho
                  colunas={[
                    "Pedido",
                    "Destino",
                    { rotulo: "Valor", numerica: true },
                    { rotulo: "Líquido", numerica: true },
                    "Estado",
                    "",
                  ]}
                />
              }
            >
              {saques.map((s) => (
                <Linha key={s.id}>
                  <Celula linha>
                    {dataCurta(s.solicitadoEm)}
                    {s.pagoEm && (
                      <span className="block text-xs font-normal text-fg-subtle">
                        pago em {dataCurta(s.pagoEm)}
                      </span>
                    )}
                    {s.motivoRecusa && (
                      <span className="block text-xs font-normal text-danger">
                        {s.motivoRecusa}
                      </span>
                    )}
                  </Celula>
                  <Celula className="text-fg-muted">{s.destino}</Celula>
                  <Celula numerica>{dinheiro(s.valorCentavos)}</Celula>
                  <Celula numerica>{dinheiro(s.liquidoCentavos)}</Celula>
                  <Celula>
                    <Badge tom={TOM_SAQUE[s.status]}>{ROTULO_STATUS_SAQUE[s.status]}</Badge>
                  </Celula>
                  <Celula>
                    {s.status === "solicitado" ? (
                      <form action={desistirDoSaque}>
                        <input type="hidden" name="saqueId" value={s.id} />
                        <Button type="submit" variante="ghost" tamanho="sm">
                          Cancelar
                        </Button>
                      </form>
                    ) : s.comprovanteRef ? (
                      <span className="font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
                        {s.comprovanteRef}
                      </span>
                    ) : null}
                  </Celula>
                </Linha>
              ))}
            </Tabela>
          </Card>
        )}
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Indicados diretos</h2>
          {painel.gerente && (
            <Badge tom="marca">
              <ShieldCheck className="mr-1 size-3" aria-hidden />
              Equipe de {painel.gerente}
            </Badge>
          )}
        </div>

        {painel.diretos.length === 0 ? (
          <EstadoVazio
            icone={UserPlus}
            titulo="Nenhum indicado direto"
            texto="Compartilhe o seu link de indicação. A comissão nasce quando a assinatura é paga, nunca no cadastro."
            acao={<BotaoCopiar texto={painel.link} rotulo="Copiar link de indicação" />}
          />
        ) : (
          <Card>
            <Tabela
              rotulo="Indicados diretos"
              cabecalho={
                <Cabecalho
                  colunas={[
                    "Pessoa",
                    "Desde",
                    { rotulo: "Vendas", numerica: true },
                    { rotulo: "Sua comissão", numerica: true },
                  ]}
                />
              }
            >
              {painel.diretos.map((indicado) => (
                <Linha key={indicado.id}>
                  <Celula linha quebrar>
                    {indicado.nome}
                  </Celula>
                  <Celula className="text-fg-muted">{dataCurta(indicado.desde)}</Celula>
                  <Celula numerica>{numero(indicado.vendas)}</Celula>
                  <Celula numerica>{dinheiro(indicado.comissaoCentavos)}</Celula>
                </Linha>
              ))}
            </Tabela>
          </Card>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-1 text-lg font-semibold">Extrato de comissões</h2>
        <p className="mb-3 text-sm text-fg-muted">
          Cada linha guarda a venda que a gerou, o nível, a taxa aplicada e o
          estado. É esta trilha que responde a uma disputa seis meses depois — o
          valor nunca é reescrito, correção vira estorno.
        </p>

        {comissoes.length === 0 ? (
          <EstadoVazio
            icone={ReceiptText}
            titulo="Nenhuma comissão ainda"
            texto="A primeira linha aparece quando alguém da sua rede tiver uma assinatura confirmada pelo gateway."
          />
        ) : (
          <Card>
            <Tabela
              rotulo="Extrato de comissões"
              cabecalho={
                <Cabecalho
                  colunas={[
                    "Origem",
                    "Nível",
                    { rotulo: "Venda", numerica: true },
                    { rotulo: "Taxa", numerica: true },
                    { rotulo: "Comissão", numerica: true },
                    "Estado",
                    "Libera em",
                    "Pagamento",
                  ]}
                />
              }
            >
              {comissoes.map((c) => (
                <Linha key={c.id}>
                  <Celula linha quebrar>
                    {c.origemNome ?? "—"}
                  </Celula>
                  <Celula>{ROTULO_ORIGEM_CURTO[c.origem]}</Celula>
                  <Celula numerica>{dinheiro(c.baseCentavos)}</Celula>
                  <Celula numerica>{percentual(c.percentual)}</Celula>
                  <Celula numerica>{dinheiro(c.valorCentavos)}</Celula>
                  <Celula>
                    <Badge tom={TOM_COMISSAO[c.status]}>
                      {ROTULO_STATUS_COMISSAO[c.status]}
                    </Badge>
                  </Celula>
                  <Celula className="text-fg-muted">
                    {c.status === "estornada" ? "—" : dataCurta(c.liberadaEm)}
                  </Celula>
                  <Celula className="font-[family-name:var(--font-mono)] text-xs text-fg-subtle">
                    {c.pagamentoRef}
                  </Celula>
                </Linha>
              ))}
            </Tabela>
          </Card>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-1 text-lg font-semibold">Razão do saldo</h2>
        <p className="mb-3 text-sm text-fg-muted">
          O saldo lá em cima não é um campo que alguém edita: é a soma desta
          razão, que só recebe linha nova. Cada movimento diz de qual balde o
          dinheiro saiu e em qual entrou.
        </p>

        {lancamentos.length === 0 ? (
          <EstadoVazio
            icone={FileText}
            titulo="Razão vazia"
            texto="O primeiro lançamento entra junto com a primeira comissão."
          />
        ) : (
          <Card>
            <Tabela
              rotulo="Razão de comissões"
              cabecalho={
                <Cabecalho
                  colunas={[
                    "Quando",
                    "Movimento",
                    { rotulo: "Pendente", numerica: true },
                    { rotulo: "Disponível", numerica: true },
                    { rotulo: "Reservado", numerica: true },
                    { rotulo: "Sacado", numerica: true },
                  ]}
                />
              }
            >
              {lancamentos.map((l) => (
                <Linha key={l.id}>
                  <Celula linha className="font-normal text-fg-muted">
                    {dataHora(l.criadoEm)}
                  </Celula>
                  <Celula>
                    <span className="inline-flex items-center gap-1.5">
                      {l.motivo === "clawback" && (
                        <TriangleAlert className="size-3.5 text-danger" aria-hidden />
                      )}
                      {ROTULO_MOTIVO[l.motivo]}
                    </span>
                  </Celula>
                  <Celula numerica className={l.pendente < 0 ? "text-danger" : undefined}>
                    {l.pendente === 0 ? "—" : dinheiro(l.pendente)}
                  </Celula>
                  <Celula numerica className={l.disponivel < 0 ? "text-danger" : undefined}>
                    {l.disponivel === 0 ? "—" : dinheiro(l.disponivel)}
                  </Celula>
                  <Celula numerica className={l.bloqueado < 0 ? "text-danger" : undefined}>
                    {l.bloqueado === 0 ? "—" : dinheiro(l.bloqueado)}
                  </Celula>
                  <Celula numerica className={l.sacado < 0 ? "text-danger" : undefined}>
                    {l.sacado === 0 ? "—" : dinheiro(l.sacado)}
                  </Celula>
                </Linha>
              ))}
            </Tabela>
          </Card>
        )}
      </section>
    </>
  );
}
