import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Compass, Radio, Sparkles, Zap } from "lucide-react";
import { dispensarCartaoTour } from "@/app/(app)/bem-vindo/actions";
import { PageHeader } from "@/components/layout/page-header";
import { Alerta } from "@/components/ui/alerta";
import { Card } from "@/components/ui/card";
import { Indicador } from "@/components/ui/indicador";
import { formatarDuracao } from "@/lib/caracteres";
import { jornadaDaLive, type JornadaDaLive } from "@/lib/dados/criacao";
import { resumoTour, type ResumoTour } from "@/lib/dados/onboarding";
import { exigirUsuario } from "@/lib/sessao";
import { cn, numero } from "@/lib/utils";

export const metadata: Metadata = { title: "Início" };

/**
 * O guia da live: três passos, lidos do estado real da conta.
 *
 * Antes era uma lista fixa de seis telas com "0 de 6" escrito à mão, e quem
 * chegava não sabia por onde começar — as primeiras clientes instalaram a
 * extensão sem nada cadastrado, e a Shopia ficou muda a live inteira. Agora o
 * passo da vez fica em destaque, com UM botão, e os feitos dizem o que já está
 * pronto.
 */

function desde(iso: string | null) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return ms < 60_000 ? "agora há pouco" : `há ${formatarDuracao(ms)}`;
}

type Passo = {
  titulo: string;
  feito: boolean;
  texto: React.ReactNode;
  acao: { href: string; rotulo: string } | null;
  extra?: React.ReactNode;
};

function montarPassos(j: JornadaDaLive): Passo[] {
  return [
    {
      titulo: "Cadastre o que você vende",
      feito: j.produto.pronto,
      texto: j.produto.pronto
        ? `${j.produto.quantos} ${j.produto.quantos === 1 ? "produto" : "produtos"} cadastrados${j.produto.nome ? ` — o último foi “${j.produto.nome}”` : ""}.`
        : "Nome, preço e cupom. É o que a Shopia usa para responder quem pergunta na live.",
      acao: {
        href: "/criar",
        rotulo: j.produto.pronto ? "Cadastrar outro" : "Cadastrar agora",
      },
    },
    {
      titulo: "Monte o manual",
      feito: j.manual.pronto,
      texto: j.manual.pronto
        ? `${j.manual.perguntas} ${j.manual.perguntas === 1 ? "pergunta" : "perguntas"} que ela sabe responder${j.manual.semResposta > 0 ? ` — e ${j.manual.semResposta} que a sua audiência fez e ficou sem resposta.` : "."}`
        : "As perguntas que a audiência faz e o que responder. A Shopia nunca inventa: se não está no manual, ela cala.",
      acao: {
        href: "/manual",
        rotulo: j.manual.pronto
          ? j.manual.semResposta > 0
            ? "Revisar o que faltou"
            : "Ver o manual"
          : "Montar o manual",
      },
    },
    {
      titulo: "Instale a extensão e entre com a sua conta",
      feito: j.extensao.conectada,
      texto: j.extensao.conectada
        ? `Conectada. Último contato ${desde(j.extensao.vistaEm) ?? "—"}.`
        : j.extensao.instalada
          ? "Instalada, mas desconectada agora. Abra o Chrome, clique no ícone da Shopia e entre com o seu e-mail e senha."
          : "É ela que cuida da sua live: timer, proteção contra violação, fixar produto, aviso de venda e respostas pelo manual.",
      acao: {
        href: "/extensao",
        rotulo: j.extensao.instalada ? "Ver instruções" : "Baixar e instalar",
      },
    },
    {
      titulo: "Ligue a extensão na sua live",
      feito: j.live.noAr,
      texto: j.live.noAr
        ? `A Shopia está cuidando do chat ${desde(j.live.desde) ?? ""}.`
        : "Com o manual pronto e a extensão conectada:",
      acao: j.live.noAr ? { href: "/live", rotulo: "Acompanhar" } : null,
      extra: j.live.noAr ? null : (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-fg-muted">
          <li>Comece a transmissão e deixe a página da sua live aberta no Chrome.</li>
          <li>
            Clique no ícone da Shopia e toque em{" "}
            <strong className="text-fg">Ligar a extensão</strong> — defina o timer de
            encerramento se quiser que ela encerre sozinha.
          </li>
          <li>
            Para responder o chat, abra <strong className="text-fg">✦ IA</strong> e ligue{" "}
            <strong className="text-fg">Ler a tela</strong>.
          </li>
          {!j.riscoAceito && (
            <li>
              Antes, na página{" "}
              <Link href="/live" className="font-medium text-primary underline-offset-4 hover:underline">
                Ao vivo
              </Link>
              , aceite o aviso de automação — sem ele a extensão não responde o chat.
            </li>
          )}
        </ol>
      ),
    },
  ];
}

function CartaoPasso({ passo, numeroPasso, daVez }: { passo: Passo; numeroPasso: number; daVez: boolean }) {
  return (
    <li
      className={cn(
        "rounded-lg border bg-surface p-4 sm:p-5",
        daVez ? "border-primary-border shadow-sm ring-1 ring-primary-border" : "border-border",
      )}
      aria-current={daVez ? "step" : undefined}
    >
      {/* No celular o botão desce para baixo do texto: ao lado, espremia a
          descrição numa coluna de uma palavra por linha. */}
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        <span
          className={cn(
            "num grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold",
            passo.feito && "bg-success-soft text-success",
            !passo.feito && daVez && "bg-primary text-primary-fg",
            !passo.feito && !daVez && "border border-border text-fg-subtle",
          )}
          aria-hidden
        >
          {passo.feito ? <Check className="size-4" /> : numeroPasso}
        </span>

        <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-auto">
          <p className={cn("font-semibold", passo.feito && !daVez && "text-fg-muted")}>
            {passo.titulo}
            {passo.feito && <span className="sr-only"> (feito)</span>}
          </p>
          <p className="mt-0.5 text-sm text-fg-muted">{passo.texto}</p>
          {passo.extra}
        </div>

        {passo.acao && (
          <Link
            href={passo.acao.href}
            className={cn(
              "ml-11 inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md px-4 text-sm font-medium transition-colors duration-[--dur-fast] sm:ml-0",
              daVez
                ? "bg-primary text-primary-fg hover:bg-primary-hover"
                : "border border-border bg-surface text-fg hover:bg-surface-hover",
            )}
          >
            {passo.acao.rotulo}
            {daVez && <ArrowRight className="size-4" aria-hidden />}
          </Link>
        )}
      </div>
    </li>
  );
}

/**
 * Retomada do tour.
 *
 * Discreto de proposito: quem ja entendeu a ferramenta nao precisa de um
 * banner na cara todo dia — por isso "Agora nao" existe e fica guardado em
 * `dicas_vistas`, na conta.
 */
function CartaoTour({ resumo }: { resumo: ResumoTour }) {
  // Tour todo lido e aceite desatualizado: o aviso de risco foi reescrito e
  // precisa ser aceito de novo. A cobranca muda de texto.
  const soAceite = resumo.pendentes === 0 && !resumo.riscoEmDia;

  return (
    <Card className="mt-6 flex flex-wrap items-center gap-4 bg-bg-subtle shadow-none">
      <span
        className="grid size-10 shrink-0 place-items-center rounded-md bg-surface text-primary"
        aria-hidden
      >
        <Compass className="size-5" />
      </span>

      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-semibold">
          {soAceite
            ? "Falta registrar o aceite do aviso de automação"
            : "Continue o tour de boas-vindas"}
        </p>
        <p className="mt-0.5 text-sm text-fg-muted">
          {soAceite ? (
            "O texto do aviso mudou. Ele explica o risco de automatizar ações na sua live do TikTok, e o seu aceite fica registrado com data e versão."
          ) : (
            <>
              {resumo.pendentes === 1 ? "Falta" : "Faltam"}{" "}
              <span className="num">{resumo.pendentes}</span> de{" "}
              <span className="num">{resumo.total}</span> passos
              {resumo.proximoTitulo ? `, a começar por “${resumo.proximoTitulo}”` : ""}.
            </>
          )}
        </p>
      </div>

      <div className="flex shrink-0 gap-2">
        <Link
          href="/bem-vindo"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
        >
          {soAceite ? "Ler o aviso" : "Continuar"}
        </Link>
        <form action={dispensarCartaoTour}>
          <button
            type="submit"
            className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-fg-muted transition-colors duration-[--dur-fast] hover:bg-surface hover:text-fg"
          >
            Agora não
          </button>
        </form>
      </div>
    </Card>
  );
}

export default async function InicioPage() {
  const usuario = await exigirUsuario("/inicio");
  const primeiroNome = (usuario.nome || usuario.usuario).split(" ")[0];
  const [tour, jornada] = await Promise.all([resumoTour(usuario.id), jornadaDaLive(usuario.id)]);

  const passos = montarPassos(jornada);
  const daVez = passos.findIndex((p) => !p.feito);
  const faltam = passos.filter((p) => !p.feito).length;

  const descricao = jornada.live.noAr
    ? "A sua live está no ar."
    : faltam === 1
      ? "Falta só um passo para a sua live."
      : faltam === 0
        ? "Tudo pronto."
        : `Faltam ${faltam} passos para a sua live. Comece pelo que está em destaque.`;

  return (
    <>
      <PageHeader titulo={`Olá, ${primeiroNome}`} descricao={descricao} />

      {!jornada.planoAtivo && (
        <Alerta tom="erro" className="mb-4">
          <strong>A extensão só funciona com plano ativo.</strong> Sem ele, ela fica
          trancada na tela de assinatura.{" "}
          <Link href="/planos" className="font-medium underline underline-offset-2">
            Ver planos
          </Link>
        </Alerta>
      )}

      <section aria-labelledby="titulo-passos">
        <h2 id="titulo-passos" className="sr-only">
          Sua live, passo a passo
        </h2>
        <ol className="space-y-3">
          {passos.map((passo, indice) => (
            <CartaoPasso key={passo.titulo} passo={passo} numeroPasso={indice + 1} daVez={indice === daVez} />
          ))}
        </ol>
      </section>

      {tour.pendente && !tour.cartaoDispensado && <CartaoTour resumo={tour} />}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-fg">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-fg-subtle">Plano</p>
            <p className="truncate font-semibold">{usuario.plano ?? "Sem plano"}</p>
          </div>
        </Card>

        <Link href="/creditos" className="block">
          <Card className="flex items-center gap-3 transition-colors duration-[--dur-fast] hover:bg-surface-hover">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-fg">
              <Zap className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-fg-subtle">Créditos</p>
              <p className="num truncate font-semibold">{numero(usuario.creditos)}</p>
            </div>
          </Card>
        </Link>

        <Link href="/live" className="block">
          <Card className="flex items-center gap-3 transition-colors duration-[--dur-fast] hover:bg-surface-hover">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-bg-subtle text-fg-subtle">
              <Radio className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-fg-subtle">Live</p>
              <Indicador estado={jornada.live.noAr ? "no_ar" : "fora_do_ar"} />
            </div>
          </Card>
        </Link>
      </div>
    </>
  );
}
