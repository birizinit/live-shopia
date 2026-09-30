import Link from "next/link";
import { ArrowRight, CircleCheck, Puzzle, Radio } from "lucide-react";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { jornadaDaLive } from "@/lib/dados/criacao";
import { garantirManualBasico, listarManual } from "@/lib/dados/manual";
import { LIMITES_PRODUTO, listarProdutos, obterProduto } from "@/lib/dados/produtos";
import { brl, cn, numero } from "@/lib/utils";
import { FormularioProduto } from "./formulario-produto";
import { Passos } from "./passos";

/**
 * As três etapas do assistente. Cada uma lê o próprio estado do banco — a URL
 * só diz QUAL produto; o que falta, o servidor decide.
 */

/**
 * Botão que na verdade é link.
 *
 * `Button` do projeto é um `<button>` de verdade e não aceita `href` — de
 * propósito: botão que navega tem de ser `<a>`, senão perde abrir em nova aba,
 * copiar endereço e o anúncio de "link" no leitor de tela.
 */
function BotaoLink({
  href,
  children,
  tom = "primario",
}: {
  href: string;
  children: React.ReactNode;
  tom?: "primario" | "secundario";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md px-4 text-sm font-medium",
        "transition-colors duration-[--dur-fast]",
        tom === "primario"
          ? "bg-primary text-primary-fg hover:bg-primary-hover"
          : "border border-border bg-surface text-fg hover:bg-surface-hover",
      )}
    >
      {children}
    </Link>
  );
}

// ------------------------------------------------------------------ passo 1

export async function EtapaProduto({
  perfilId,
  produtoId,
}: {
  perfilId: string;
  produtoId: string | null;
}) {
  const produto = produtoId ? await obterProduto(perfilId, produtoId) : null;
  const recentes = produto ? [] : (await listarProdutos(perfilId, { limite: 6 })).itens;

  const resumo = produto
    ? [
        produto.precoCentavos !== null ? brl(produto.precoCentavos / 100) : null,
        produto.cupom ? `cupom ${produto.cupom}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null
    : null;

  return (
    <>
      <Passos atual={1} />
      <Card>
        <FormularioProduto
          produto={produto ? { id: produto.id, nome: produto.nome, resumo } : null}
          limiteDescricao={LIMITES_PRODUTO.descricao}
        />
      </Card>

      {recentes.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-fg-muted">
            Ou use um produto que você já cadastrou
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {recentes.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/criar?produto=${p.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-fg-muted transition-colors duration-[--dur-fast] hover:border-primary-border hover:text-fg"
                >
                  {p.nome}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ------------------------------------------------------------------ passo 2

export async function EtapaManual({
  perfilId,
  produtoId,
}: {
  perfilId: string;
  produtoId: string;
}) {
  const produto = await obterProduto(perfilId, produtoId);
  const criados = await garantirManualBasico(perfilId);
  const itens = await listarManual(perfilId);

  const ativos = itens.filter((i) => i.ativo);
  const desteProduto = ativos.filter((i) => i.produtoId === produtoId);

  return (
    <>
      <Passos atual={2} />

      <Card>
        <CardTitulo>O manual de {produto?.nome ?? "seu produto"}</CardTitulo>
        <CardDescricao>
          É daqui que sai cada palavra que a Shopia escreve no chat. Ela não
          inventa resposta: escolhe uma que você escreveu. Quando a pergunta não
          está no manual, ela cala — e te avisa depois, para você ensinar.
        </CardDescricao>

        {criados > 0 && (
          <Alerta tom="sucesso" className="mt-4">
            Começamos com <span className="num">{numero(criados)}</span> perguntas que aparecem em
            toda live. Elas estão genéricas de propósito — leia e ajuste para o seu produto.
          </Alerta>
        )}

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <dt className="text-xs text-fg-subtle">Perguntas no manual</dt>
            <dd className="num mt-0.5 text-lg font-semibold">{numero(ativos.length)}</dd>
          </div>
          <div className="rounded-md border border-border p-3">
            <dt className="text-xs text-fg-subtle">Só para este produto</dt>
            <dd className="num mt-0.5 text-lg font-semibold">{numero(desteProduto.length)}</dd>
          </div>
        </dl>

        {ativos.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {ativos.slice(0, 6).map((i) => (
              <li key={i.id} className="flex items-start gap-2 text-sm">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <span className="min-w-0">
                  <span className="font-medium">{i.rotulo}</span>
                  <span className="text-fg-muted"> — {i.resposta}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <BotaoLink href="/manual">Revisar e completar o manual</BotaoLink>
          <BotaoLink href={`/criar?produto=${produtoId}&passo=live`} tom="secundario">
            Já está bom, seguir
            <ArrowRight className="size-4" aria-hidden />
          </BotaoLink>
        </div>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ passo 3

export async function EtapaLive({ perfilId }: { perfilId: string }) {
  const jornada = await jornadaDaLive(perfilId);

  return (
    <>
      <Passos atual={3} />

      <Card>
        <CardTitulo>Ligar a Shopia na sua live</CardTitulo>
        <CardDescricao>
          O manual está pronto. Agora é a extensão do Chrome que leva isso para
          dentro da sua transmissão.
        </CardDescricao>

        <ol className="mt-5 space-y-4">
          <Passo
            numero={1}
            icone={Puzzle}
            titulo="Instale a extensão no Chrome"
            feito={jornada.extensao.instalada}
            texto="Ela lê o chat da sua live e responde por lá. Não precisa instalar nada no computador além dela."
            acao={
              <BotaoLink href="/extensao" tom={jornada.extensao.instalada ? "secundario" : "primario"}>
                {jornada.extensao.instalada ? "Ver a extensão" : "Instalar agora"}
              </BotaoLink>
            }
          />
          <Passo
            numero={2}
            icone={Radio}
            titulo="Abra a live e clique em Entrar no ar"
            feito={jornada.live.lives > 0}
            texto="No painel da extensão, escreva o seu @ e clique. Ela abre a sua live, começa a ler o chat e responde pelo manual."
            acao={
              <BotaoLink href="/live" tom="secundario">
                Ver a sala de live
              </BotaoLink>
            }
          />
        </ol>

        {!jornada.riscoAceito && (
          <Alerta tom="info" className="mt-5">
            Antes de entrar no ar, leia e aceite o aviso sobre automação em{" "}
            <Link href="/bem-vindo" className="underline">
              boas-vindas
            </Link>
            . É exigido pelo servidor: sem o aceite, a sessão não abre.
          </Alerta>
        )}
      </Card>
    </>
  );
}

function Passo({
  numero: n,
  icone: Icone,
  titulo,
  texto,
  feito,
  acao,
}: {
  numero: number;
  icone: React.ComponentType<{ className?: string }>;
  titulo: string;
  texto: string;
  feito: boolean;
  acao: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        className="num mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-xs font-semibold text-fg-subtle"
        aria-hidden
      >
        {feito ? <CircleCheck className="size-4 text-success" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-fg">
          <Icone className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          {titulo}
          {feito && <Badge tom="sucesso">feito</Badge>}
        </p>
        <p className="mt-0.5 text-sm text-fg-muted">{texto}</p>
        <div className="mt-2">{acao}</div>
      </div>
    </li>
  );
}
