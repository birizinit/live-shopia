import { NextResponse, type NextRequest } from "next/server";
import { bd } from "@/lib/db";
import { modoDemo } from "@/lib/env";
import { eventosDaLive, sessaoDoPerfil, type SessaoLive } from "@/lib/dados/live";
import { obterUsuario } from "@/lib/sessao";

/**
 * Fluxo do painel ao vivo.
 *
 * `?modo=json` devolve um lote e encerra — e o degrau de POLLING, para quando o
 * SSE nao sobe (proxy corporativo que bufferiza, rede que corta conexao longa).
 * Sem `modo`, devolve um fluxo SSE alimentado por LISTEN/NOTIFY do Postgres: o
 * gatilho `live_eventos_notificar` (migracao 0006) avisa no canal `shopia_live`
 * a cada evento, e sem esse aviso cada aba aberta viraria uma consulta por
 * segundo no banco.
 *
 * O NOTIFY carrega so os identificadores. A leitura continua passando por
 * `eventosDaLive`, com perfil e sessao no where — o payload de um canal e
 * visivel para qualquer conexao do mesmo banco, entao ele nunca e a fonte do
 * dado que vai para a tela.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Silencio do fluxo. Sem comentario periodico, proxy intermediario derruba. */
const PING_MS = 20_000;

/**
 * Teto de vida de um fluxo. Fechar de propria vontade e melhor do que esperar o
 * proxy cortar: o EventSource reconecta sozinho e manda `Last-Event-ID`, entao
 * a renovacao nao perde nem repete evento.
 */
const VIDA_MS = 25 * 60_000;

const CABECALHOS_SSE = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Nginx bufferiza text/event-stream por padrao e o fluxo chega em blocos
  // atrasados — que e o mesmo que nao chegar, num painel ao vivo.
  "X-Accel-Buffering": "no",
} as const;

function lerDesde(bruto: string | null): number | null {
  if (!bruto) return null;
  const valor = Number(bruto);
  return Number.isFinite(valor) && valor >= 0 ? Math.trunc(valor) : null;
}

function resumoDaSessao(sessao: SessaoLive) {
  return {
    id: sessao.id,
    estado: sessao.estado,
    inicio: sessao.inicio,
    vistoEm: sessao.vistoEm,
    espectadoresPico: sessao.espectadoresPico,
    fim: sessao.fim,
  };
}

export async function GET(request: NextRequest) {
  const usuario = await obterUsuario();
  if (!usuario) {
    return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  }

  const parametros = request.nextUrl.searchParams;
  const sessaoId = parametros.get("sessao") ?? "";
  if (!sessaoId) {
    return NextResponse.json({ erro: "Informe a sessão da live." }, { status: 400 });
  }

  // O id da sessao vem da URL e por isso nao vale nada sozinho: quem decide e o
  // `where perfil_id` de sessaoDoPerfil.
  const sessao = await sessaoDoPerfil(usuario.id, sessaoId);
  if (!sessao) {
    return NextResponse.json({ erro: "Essa live não é sua." }, { status: 404 });
  }

  // Na reconexao o navegador manda o ultimo id entregue; ele vence o `desde` da
  // URL, que ficou congelado no valor da primeira montagem.
  const desde =
    lerDesde(request.headers.get("last-event-id")) ?? lerDesde(parametros.get("desde"));

  if (parametros.get("modo") === "json") {
    const eventos = await eventosDaLive(usuario.id, sessaoId, { desde });
    return NextResponse.json(
      {
        eventos,
        sessao: resumoDaSessao(sessao),
        encerrada: sessao.estado === "encerrada" || sessao.estado === "caiu",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const codificador = new TextEncoder();
  let fechado = false;
  let ultimoId = desde ?? 0;
  let relogio: ReturnType<typeof setInterval> | null = null;
  let expiracao: ReturnType<typeof setTimeout> | null = null;
  let parar: (() => Promise<void>) | null = null;
  let buscando = false;
  let pendente = false;

  const fluxo = new ReadableStream<Uint8Array>({
    async start(controle) {
      const escrever = (texto: string) => {
        if (fechado) return;
        try {
          controle.enqueue(codificador.encode(texto));
        } catch {
          // A outra ponta sumiu entre o teste e o enqueue. Nao ha o que fazer
          // alem de encerrar — e insistir aqui viraria excecao a cada evento.
          void encerrar();
        }
      };

      const enviar = (evento: string, dados: unknown, id?: number) => {
        escrever(
          `${id === undefined ? "" : `id: ${id}\n`}event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`,
        );
      };

      async function encerrar(motivo?: string) {
        if (fechado) return;
        fechado = true;

        if (relogio) clearInterval(relogio);
        if (expiracao) clearTimeout(expiracao);

        // UNLISTEN antes de fechar: listener orfao continuaria recebendo aviso
        // numa conexao compartilhada por todos os fluxos do processo.
        if (parar) {
          try {
            await parar();
          } catch {
            /* a conexao de aviso ja pode ter caido; nao ha o que salvar */
          }
        }

        try {
          if (motivo) {
            controle.enqueue(
              codificador.encode(`event: fim\ndata: ${JSON.stringify({ motivo })}\n\n`),
            );
          }
          controle.close();
        } catch {
          /* fluxo ja fechado pela outra ponta */
        }
      }

      // `retry` manda o navegador esperar 3s antes de reconectar. Sem isto ele
      // usa o proprio padrao e uma queda vira rajada de reconexoes.
      escrever("retry: 3000\n\n");
      enviar("estado", { ...resumoDaSessao(sessao), modo: modoDemo ? "demo" : "banco" });

      const atrasados = await eventosDaLive(usuario.id, sessaoId, { desde });
      if (atrasados.length > 0) {
        ultimoId = atrasados[atrasados.length - 1]!.id;
        enviar("eventos", atrasados, ultimoId);
      }

      if (modoDemo) {
        // Sem banco nao ha NOTIFY. Manter o fluxo aberto fingindo espera seria
        // mentir sobre o que o modo demo faz.
        await encerrar("demo");
        return;
      }

      const despejar = async () => {
        if (fechado) return;
        if (buscando) {
          // Aviso durante uma busca vira uma segunda rodada depois dela: o
          // evento novo entra na mesma consulta, sem concorrencia entre elas.
          pendente = true;
          return;
        }

        buscando = true;
        try {
          do {
            pendente = false;
            const novos = await eventosDaLive(usuario.id, sessaoId, { desde: ultimoId });
            if (novos.length === 0) break;
            ultimoId = novos[novos.length - 1]!.id;
            enviar("eventos", novos, ultimoId);
          } while (pendente && !fechado);
        } catch (erro) {
          console.error("[live/eventos] leitura falhou", erro);
        } finally {
          buscando = false;
        }
      };

      try {
        const assinatura = await bd().listen("shopia_live", (carga) => {
          try {
            const aviso = JSON.parse(carga) as { perfil?: string; sessao?: string };
            // O canal e do banco inteiro: o filtro por dono acontece aqui, e de
            // novo no `where` da consulta.
            if (aviso.perfil !== usuario.id || aviso.sessao !== sessaoId) return;
          } catch {
            return;
          }
          void despejar();
        });

        // O cliente pode ter desistido enquanto o LISTEN era estabelecido. Se
        // isso aconteceu, `cancel()` ja rodou e nao vai rodar de novo: instalar
        // intervalo e expiracao agora deixaria um timer e uma assinatura vivos
        // para sempre. Uma aba recarregada em laco vaza uma conexao por vez.
        if (fechado) {
          await assinatura.unlisten().catch(() => undefined);
          return;
        }

        parar = () => assinatura.unlisten();
      } catch (erro) {
        // Sem LISTEN o painel nao fica cego: o cliente cai para polling assim
        // que o fluxo fecha.
        console.error("[live/eventos] LISTEN indisponível", erro);
        await encerrar("sem_listen");
        return;
      }

      relogio = setInterval(() => {
        void (async () => {
          escrever(": ping\n\n");

          const atual = await sessaoDoPerfil(usuario.id, sessaoId).catch(() => null);
          if (!atual) return;

          enviar("estado", { ...resumoDaSessao(atual), modo: "banco" });
          // Live encerrada fecha o fluxo: deixar a conexao aberta depois do fim
          // e o vazamento mais facil de cometer nesta tela.
          if (atual.estado === "encerrada" || atual.estado === "caiu") {
            await encerrar("encerrada");
          }
        })();
      }, PING_MS);

      expiracao = setTimeout(() => void encerrar("renovar"), VIDA_MS);

      request.signal.addEventListener("abort", () => void encerrar());
    },

    cancel() {
      // Aba fechada ou navegacao: o navegador cancela o corpo da resposta.
      fechado = true;
      if (relogio) clearInterval(relogio);
      if (expiracao) clearTimeout(expiracao);
      void parar?.().catch(() => undefined);
    },
  });

  return new Response(fluxo, { headers: CABECALHOS_SSE });
}
