import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  ClipboardCheck,
  MessageSquareWarning,
  Pin,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Timer,
  Workflow,
} from "lucide-react";
import "./landing.css";
import { CtaFixo } from "@/components/landing/cta-fixo";
import { DemoLive } from "@/components/landing/demo-live";
import { Revelar } from "@/components/landing/revelar";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { listarPlanos, type Plano } from "@/lib/dados/planos";
import { obterUsuario } from "@/lib/sessao";
import { brl } from "@/lib/utils";

/**
 * Landing de conversão.
 *
 * A ordem é a do raciocínio de quem chega: o que é (hero com o produto
 * funcionando), por que eu preciso (a dor da live solo), quão difícil é
 * (3 passos), o que mais faz, quanto custa, e as dúvidas que travam o
 * cadastro. Um único botão principal — "Criar conta grátis" — repetido onde
 * a decisão acontece. Nenhum número ou depoimento inventado.
 */

const LETREIRO = [
  "Responde o chat em segundos",
  "Marca quem perguntou",
  "Fixa o produto sozinho",
  "Avisa quem pôs no carrinho",
  "Venda no seu celular",
  "Encerra no horário",
  "Protege contra violação",
  "Relatório no fim da live",
];

const DORES = [
  {
    titulo: "Pergunta sem resposta é venda perdida",
    texto: "“Qual o frete?”, “tem cupom?”, “serve em mim?”. Enquanto você apresenta, o chat corre — e quem não é respondido sai da live.",
  },
  {
    titulo: "Você não tem quatro mãos",
    texto: "Mostrar o produto, ler o chat, fixar o item, olhar o tempo e conferir as vendas. Tudo ao mesmo tempo, sozinha.",
  },
  {
    titulo: "Um aviso do TikTok pode custar a conta",
    texto: "Violação na live, horário estourado, link no chat. Quem percebe tarde paga caro.",
  },
];

const PASSOS = [
  {
    titulo: "Cadastre o produto e as respostas",
    texto: "Preço, cupom, frete — e o que responder quando perguntarem. Ou monte fluxos: “quando comentarem frete, responda isto em 10 segundos”.",
  },
  {
    titulo: "Instale a extensão no Chrome",
    texto: "Baixe, carregue no Chrome e entre com o seu e-mail. Nada para instalar no computador.",
  },
  {
    titulo: "Teste e ligue na sua live",
    texto: "Um botão confere tudo antes de entrar ao vivo. Depois, “Ligar a extensão” — e o chat é com ela.",
  },
];

const RECURSOS = [
  {
    Icone: Workflow,
    titulo: "Fluxos de resposta",
    texto: "Quando o comentário for ou contiver uma palavra, responde o que você escreveu, no tempo que você escolher, marcando a pessoa ou não.",
    grande: true,
  },
  { Icone: ShoppingCart, titulo: "Carrinho e cliques", texto: "Avisa quem pôs no carrinho e pode comentar na hora para fechar a venda." },
  { Icone: Bell, titulo: "Venda no celular", texto: "Cada venda chega como notificação, mesmo com o celular no bolso." },
  { Icone: Timer, titulo: "Timer de encerramento", texto: "Escolha 1h, 2h, 4h… e a live encerra sozinha no horário." },
  { Icone: ShieldCheck, titulo: "Proteção contra violação", texto: "Viu aviso do TikTok? Encerra na hora — ou depois do tempo que você definir." },
  { Icone: Pin, titulo: "Fixar produto", texto: "Fixa e refixa o produto automaticamente, inclusive pulando o cupom da lista." },
  { Icone: MessageSquareWarning, titulo: "Moderação segura", texto: "Alerta reclamações e avisa quem manda link ou contato — sem bloquear cliente." },
  { Icone: ClipboardCheck, titulo: "Teste antes da live", texto: "Confere chat, botão de fixar e conexão sem publicar nada." },
  {
    Icone: BarChart3,
    titulo: "Relatório da live",
    texto: "Carrinhos, cliques, vendas, perguntas que ficaram sem resposta e o que ajustar na próxima.",
    grande: true,
  },
];

const INCLUSO = [
  "Fluxos de resposta e manual do produto",
  "Carrinho, cliques e venda no celular",
  "Timer e proteção contra violação",
  "Fixar produto automático (com modo cupom)",
  "Comentários automáticos e moderação",
  "Relatório de cada live",
];

const DUVIDAS = [
  {
    p: "Preciso instalar alguma coisa no computador?",
    r: "Não. A Shopia é uma extensão do Google Chrome: você baixa o arquivo no app, carrega no Chrome e entra com o seu e-mail e senha. Nada é instalado no sistema.",
  },
  {
    p: "Funciona com o painel do TikTok Shop e com a live pelo navegador?",
    r: "Sim. A extensão trabalha na página da sua live aberta no Chrome — o painel de produtos da live do TikTok Shop ou a live no tiktok.com.",
  },
  {
    p: "Ela inventa respostas?",
    r: "Não. A Shopia só escreve o que você cadastrou — nos fluxos ou no manual. O que ninguém respondeu fica anotado para você cadastrar antes da próxima live.",
  },
  {
    p: "Posso acompanhar pelo celular?",
    r: "A extensão roda no Chrome do computador, onde a live está aberta. No celular você recebe a notificação de cada venda e o resumo quando a live acaba.",
  },
  {
    p: "Automatizar a live tem risco?",
    r: "Tem, e a gente prefere dizer antes: automatizar ações na live pode contrariar os termos do TikTok, e o risco recai sobre a conta. Por isso a Shopia responde com ritmo de gente, respeita um teto de mensagens por minuto e você aceita o aviso antes de ligar.",
  },
  {
    p: "Quanto tempo leva para começar?",
    r: "Criar a conta leva 30 segundos. Cadastrar um produto, escrever as primeiras respostas e instalar a extensão, uns 10 minutos.",
  },
];

/** Planos vigentes do banco; se o banco não responder, a seção mostra só o botão. */
async function planosParaVitrine(): Promise<Plano[]> {
  try {
    return (await listarPlanos()).filter((p) => p.precoCentavos > 0).slice(0, 3);
  } catch {
    return [];
  }
}

export default async function LandingPage() {
  const [usuario, planos] = await Promise.all([obterUsuario(), planosParaVitrine()]);
  const destino = usuario ? "/inicio" : "/cadastro";
  const rotuloCta = usuario ? "Abrir o app" : "Criar conta grátis";
  const mensal = planos.find((p) => p.meses === 1);

  return (
    <div className="min-h-dvh overflow-x-clip">
      {/* ------------------------------------------------------------ topo */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-bg/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link href="/" aria-label="Shopia, início">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-fg-muted md:flex" aria-label="Seções">
            <a href="#como-funciona" className="hover:text-fg">Como funciona</a>
            <a href="#recursos" className="hover:text-fg">Recursos</a>
            <a href="#planos" className="hover:text-fg">Planos</a>
            <a href="#duvidas" className="hover:text-fg">Dúvidas</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle className="hidden sm:inline-flex" />
            {!usuario && (
              <Link href="/login" className="hidden h-9 items-center rounded-md px-3 text-sm font-medium text-fg-muted hover:text-fg sm:inline-flex">
                Entrar
              </Link>
            )}
            <Link
              href={destino}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary-hover"
            >
              {usuario ? "Abrir o app" : "Começar grátis"}
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ---------------------------------------------------------- hero */}
        <section className="relative isolate">
          <div className="lp-grade absolute inset-0 -z-10" aria-hidden />
          <div
            className="lp-deriva absolute -top-24 left-1/2 -z-10 size-[520px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
            style={{ background: "radial-gradient(circle, var(--accent) 0%, transparent 65%)" }}
            aria-hidden
          />

          <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pt-14 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-20 lg:pb-28">
            <div>
              <p className="lp-sobe inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary-soft px-3 py-1 text-xs font-semibold text-primary-soft-fg">
                <span className="lp-pulso size-1.5 rounded-full bg-primary" aria-hidden />
                Para quem vende ao vivo no TikTok Shop
              </p>

              <h1
                className="lp-sobe mt-5 text-[2.6rem] leading-[1.05] font-extrabold tracking-tight sm:text-6xl"
                style={{ animationDelay: "80ms" }}
              >
                Você apresenta.{" "}
                <span
                  className="bg-clip-text text-transparent"
                  style={{ backgroundImage: "var(--brand-gradient)" }}
                >
                  A Shopia cuida do resto.
                </span>
              </h1>

              <p className="lp-sobe mt-5 max-w-xl text-lg text-fg-muted" style={{ animationDelay: "160ms" }}>
                Responde o chat com as suas respostas, fixa o produto, avisa quem pôs no carrinho, manda cada
                venda pro seu celular e encerra a live no horário — sem você tirar o olho da câmera.
              </p>

              <div className="lp-sobe mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "240ms" }}>
                <Link
                  href={destino}
                  className="lp-cta inline-flex h-12 items-center gap-2 rounded-lg px-6 text-base font-semibold text-white shadow-lg transition-transform"
                  style={{ background: "var(--brand-gradient)" }}
                >
                  {rotuloCta}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <a
                  href="#como-funciona"
                  className="inline-flex h-12 items-center rounded-lg border border-border bg-surface px-6 text-base font-medium transition-colors hover:bg-surface-hover"
                >
                  Ver como funciona
                </a>
              </div>

              <ul className="lp-sobe mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-fg-muted" style={{ animationDelay: "320ms" }}>
                {["Criar conta é grátis", "Só o Chrome, nada para instalar", "Nunca inventa resposta"].map((t) => (
                  <li key={t} className="inline-flex items-center gap-1.5">
                    <Check className="size-4 text-primary" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="lp-sobe lg:pl-4" style={{ animationDelay: "200ms" }}>
              <div className="lp-flutua">
                <DemoLive />
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ letreiro */}
        <section className="border-y border-border bg-surface py-4" aria-label="O que a Shopia faz">
          <div className="lp-letreiro overflow-hidden">
            <div className="flex w-max gap-10">
              {[...LETREIRO, ...LETREIRO].map((t, i) => (
                <span key={i} className="inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap text-fg-muted" aria-hidden={i >= LETREIRO.length}>
                  <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                  {t}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- dor */}
        <section className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
          <Revelar>
            <p className="text-sm font-semibold text-primary">O problema</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
              Live solo é apresentar, vender e vigiar tudo ao mesmo tempo.
            </h2>
          </Revelar>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {DORES.map((d, i) => (
              <Revelar key={d.titulo} atraso={i * 100}>
                <div className="h-full rounded-xl border border-border bg-surface p-6">
                  <p className="num text-sm font-semibold text-fg-subtle">0{i + 1}</p>
                  <h3 className="mt-3 text-lg font-semibold">{d.titulo}</h3>
                  <p className="mt-2 text-sm text-fg-muted">{d.texto}</p>
                </div>
              </Revelar>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------- como funciona */}
        <section id="como-funciona" className="scroll-mt-20 border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
            <Revelar className="max-w-2xl">
              <p className="text-sm font-semibold text-primary">Como funciona</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Pronta para a próxima live em 3 passos.</h2>
            </Revelar>
            <ol className="relative mt-12 grid gap-8 md:grid-cols-3">
              <div className="absolute top-5 right-[16%] left-[16%] hidden h-px bg-border md:block" aria-hidden />
              {PASSOS.map((p, i) => (
                <Revelar key={p.titulo} como="li" atraso={i * 140} className="relative">
                  <span
                    className="num relative grid size-10 place-items-center rounded-full text-sm font-bold text-white shadow-md"
                    style={{ background: "var(--brand-gradient)" }}
                  >
                    {i + 1}
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{p.titulo}</h3>
                  <p className="mt-2 text-sm text-fg-muted">{p.texto}</p>
                </Revelar>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------------ recursos */}
        <section id="recursos" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:py-24">
          <Revelar className="max-w-2xl">
            <p className="text-sm font-semibold text-primary">Recursos</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Tudo que uma live precisa, num painel só.</h2>
          </Revelar>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {RECURSOS.map(({ Icone, titulo, texto, grande }, i) => (
              <Revelar key={titulo} atraso={(i % 4) * 80} className={grande ? "sm:col-span-2" : undefined}>
                <div className="group h-full rounded-xl border border-border bg-surface p-6 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-primary-border hover:shadow-lg">
                  <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary-soft-fg transition-transform duration-300 group-hover:scale-110">
                    <Icone className="size-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 font-semibold">{titulo}</h3>
                  <p className="mt-1.5 text-sm text-fg-muted">{texto}</p>
                  {titulo === "Fluxos de resposta" && <MiniFluxo />}
                  {titulo === "Relatório da live" && <MiniRelatorio />}
                </div>
              </Revelar>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------------- planos */}
        <section id="planos" className="scroll-mt-20 border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
            <Revelar className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold text-primary">Planos</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Tudo incluso. Muda só o período.</h2>
              <p className="mt-3 text-fg-muted">Criar a conta é grátis. Para ligar a extensão na live, escolha um plano.</p>
            </Revelar>

            {planos.length > 0 && (
              <div className="mx-auto mt-12 grid max-w-5xl gap-4 md:grid-cols-3">
                {planos.map((p, i) => {
                  const economia =
                    mensal && p.meses > 1
                      ? Math.round((1 - p.precoMensalCentavos / mensal.precoMensalCentavos) * 100)
                      : 0;
                  const destaque = p.meses === Math.max(...planos.map((x) => x.meses));
                  return (
                    <Revelar key={p.id} atraso={i * 100}>
                      <div
                        className={
                          destaque
                            ? "relative h-full rounded-2xl border-2 border-primary bg-bg p-6 shadow-lg"
                            : "relative h-full rounded-2xl border border-border bg-bg p-6"
                        }
                      >
                        {destaque && (
                          <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-fg">
                            Melhor custo
                          </span>
                        )}
                        <p className="font-semibold">{p.nome}</p>
                        <p className="mt-4 flex items-baseline gap-1">
                          <span className="num text-4xl font-extrabold tracking-tight">{brl(p.precoMensalCentavos / 100)}</span>
                          <span className="text-sm text-fg-muted">/mês</span>
                        </p>
                        <p className="mt-1 text-sm text-fg-muted">
                          {p.meses === 1 ? "Cobrado todo mês" : `${brl(p.precoCentavos / 100)} a cada ${p.meses} meses`}
                          {economia > 0 && <span className="ml-1 font-semibold text-primary">· economize {economia}%</span>}
                        </p>
                        <Link
                          href={usuario ? `/planos?plano=${p.slug}` : `/cadastro`}
                          className={
                            destaque
                              ? "lp-cta mt-6 flex h-11 items-center justify-center rounded-lg text-sm font-semibold text-white"
                              : "mt-6 flex h-11 items-center justify-center rounded-lg border border-border bg-surface text-sm font-semibold transition-colors hover:bg-surface-hover"
                          }
                          style={destaque ? { background: "var(--brand-gradient)" } : undefined}
                        >
                          {usuario ? "Assinar" : "Começar"}
                        </Link>
                      </div>
                    </Revelar>
                  );
                })}
              </div>
            )}

            <Revelar className="mx-auto mt-10 max-w-3xl">
              <ul className="grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
                {INCLUSO.map((t) => (
                  <li key={t} className="flex items-center gap-2 text-fg-muted">
                    <Check className="size-4 shrink-0 text-primary" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </Revelar>
          </div>
        </section>

        {/* -------------------------------------------------------- dúvidas */}
        <section id="duvidas" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-20 sm:py-24">
          <Revelar>
            <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl">Dúvidas</h2>
          </Revelar>
          <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-surface">
            {DUVIDAS.map((d) => (
              <details key={d.p} className="lp-faq group px-6">
                <summary className="flex cursor-pointer list-none items-center gap-4 py-5 font-medium">
                  <span className="flex-1">{d.p}</span>
                  <Plus className="lp-faq-sinal size-5 shrink-0 text-fg-subtle transition-transform duration-300" aria-hidden />
                </summary>
                <p className="-mt-1 pb-5 text-sm text-fg-muted">{d.r}</p>
              </details>
            ))}
          </div>
        </section>

        {/* --------------------------------------------------------- final */}
        <section id="cta-final" className="mx-auto max-w-6xl px-5 pb-24">
          <Revelar>
            <div className="relative isolate overflow-hidden rounded-3xl p-10 text-white sm:p-16" style={{ background: "var(--brand-gradient)" }}>
              <div className="lp-deriva absolute -right-20 -bottom-24 -z-10 size-80 rounded-full bg-white/10 blur-2xl" aria-hidden />
              <h2 className="max-w-xl text-3xl font-extrabold tracking-tight sm:text-5xl">A sua próxima live já pode vender mais.</h2>
              <p className="mt-4 max-w-lg text-white/80">Crie a conta, cadastre as respostas e ligue a extensão. Em 10 minutos o chat é com a Shopia.</p>
              <Link
                href={destino}
                className="mt-8 inline-flex h-12 items-center gap-2 rounded-lg bg-white px-6 text-base font-semibold text-[color:var(--green-800)] shadow-lg transition-transform hover:-translate-y-0.5"
              >
                {rotuloCta}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </Revelar>
        </section>
      </main>

      <footer className="border-t border-border pb-20 sm:pb-0">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <nav className="flex gap-5" aria-label="Rodapé">
            <Link href="/planos" className="hover:text-fg">Planos</Link>
            <Link href="/login" className="hover:text-fg">Entrar</Link>
            <Link href="/cadastro" className="hover:text-fg">Criar conta</Link>
          </nav>
          <p>Shopia © {new Date().getFullYear()}</p>
        </div>
      </footer>

      <CtaFixo href={destino} rotulo={rotuloCta} />
    </div>
  );
}

/** Fluxo em miniatura: gatilho → espera → resposta. */
function MiniFluxo() {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full border border-border bg-bg-subtle px-2.5 py-1">
        comentou <strong className="text-fg">“frete”</strong>
      </span>
      <ArrowRight className="lp-seta size-3.5 text-primary" aria-hidden />
      <span className="rounded-full border border-border bg-bg-subtle px-2.5 py-1">espera 10 s</span>
      <ArrowRight className="lp-seta size-3.5 text-primary" aria-hidden />
      <span className="rounded-full border border-primary-border bg-primary-soft px-2.5 py-1 text-primary-soft-fg">
        @Ana Frete grátis acima de R$ 99!
      </span>
    </div>
  );
}

/** Barras que crescem: o relatório da live. */
function MiniRelatorio() {
  const barras = [38, 62, 45, 80, 58, 92, 70];
  return (
    <div className="mt-5 flex h-16 items-end gap-1.5" aria-hidden>
      {barras.map((h, i) => (
        <span
          key={i}
          className="lp-barra flex-1 rounded-t-sm"
          style={{ height: `${h}%`, background: "var(--brand-gradient)", animationDelay: `${i * 90}ms`, opacity: 0.35 + i * 0.09 }}
        />
      ))}
    </div>
  );
}
