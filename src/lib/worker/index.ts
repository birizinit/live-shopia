import "server-only";
import { bd } from "@/lib/db";
import { comoJson } from "@/lib/dados/comum";
import { env, modoDemo } from "@/lib/env";
import { ErroDominio, type CodigoErro } from "@/lib/dados/erros";
import { executarRoteiro } from "./trabalhos/roteiro";
import { executarTts } from "./trabalhos/tts";
import { executarFaxina } from "./trabalhos/faxina";
import { executarClonagem } from "./trabalhos/clonagem";
import { executarPush } from "./trabalhos/push";
import { executarComissao, executarLiberacaoDeComissoes } from "./trabalhos/comissoes";

/**
 * O worker da fila.
 *
 * Roda DENTRO do processo Next, ligado por instrumentation.ts. Isso e possivel
 * porque `next start` na Railway e um processo Node longo-vivo — nao e Vercel,
 * um laco de fundo sobrevive de verdade. E evita duplicar em JavaScript solto
 * tudo que ja existe em TypeScript aqui dentro.
 *
 * Varias replicas nao se atrapalham: a reserva usa FOR UPDATE SKIP LOCKED, que
 * e o mecanismo, nao uma convencao. Para mover o worker para um servico
 * separado depois, basta um processo que chame `iniciarWorker()` e nada mais.
 */

export type Contexto = {
  jobId: string;
  perfilId: string | null;
  entrada: Record<string, unknown>;
  /** Lança se a reserva foi perdida: parar ali evita gravar duas vezes. */
  progresso: (porcentagem: number) => Promise<void>;
  /**
   * Abortado quando a reserva do job se perdeu — outro worker pode já estar
   * nele. Trabalho em laço (TTS, bloco a bloco) confere antes de cada chamada
   * paga.
   */
  sinal: AbortSignal;
};

/** A reserva do job passou para outro worker; este não deve mais tocar nele. */
class ReservaPerdida extends Error {
  constructor(jobId: string) {
    super(`job ${jobId} perdeu a reserva`);
    this.name = "ReservaPerdida";
  }
}

type Handler = (ctx: Contexto) => Promise<Record<string, unknown> | void>;

const HANDLERS: Record<string, Handler> = {
  roteiro: executarRoteiro,
  tts: executarTts,
  clonagem: executarClonagem,
  push: executarPush,
  faxina: executarFaxina,
  comissao: executarComissao,
  comissao_liberar: executarLiberacaoDeComissoes,
};

const TIPOS = Object.keys(HANDLERS);

const IDENTIDADE = `worker-${process.pid}`;
const INTERVALO_OCIOSO_MS = 5_000;
/**
 * Renovação da reserva enquanto o trabalho roda. Abaixo do menor lease do
 * catálogo (30s): um áudio de 3h é UM job de TTS com ~45 chamadas pagas, e sem
 * renovar, o lease de 10 min vencia no meio e outro worker pegava o mesmo job.
 */
const INTERVALO_BATIMENTO_MS = 20_000;

/** Repetir não conserta: chave errada, recusa do modelo, dado que não existe. */
const CODIGOS_PERMANENTES: ReadonlySet<CodigoErro> = new Set([
  "sem_permissao",
  "dado_invalido",
  "nao_encontrado",
  "saldo_insuficiente",
]);
const INTERVALO_RECUPERACAO_MS = 60_000;
/** A faxina nao precisa ser pontual; precisa acontecer. */
const INTERVALO_FAXINA_MS = 60 * 60 * 1000;

let rodando = false;

type LinhaJob = {
  id: string;
  perfil_id: string | null;
  tipo: string;
  entrada: Record<string, unknown>;
};

async function marcarProgresso(jobId: string, porcentagem: number) {
  const valor = Math.max(0, Math.min(100, Math.round(porcentagem)));
  await bd()`update jobs set progresso = ${valor} where id = ${jobId}`;
}

async function registrarTentativa(job: LinhaJob, inicio: number, resultado: string, erro?: string) {
  const sql = bd();
  await sql`
    insert into jobs_tentativas (job_id, numero, worker, terminada_em, resultado, erro, duracao_ms)
    select ${job.id},
           (select coalesce(max(numero), 0) + 1 from jobs_tentativas where job_id = ${job.id}),
           ${IDENTIDADE}, now(), ${resultado}::estado_job, ${erro ?? null},
           ${Math.round(performance.now() - inicio)}
  `;
}

/** Falha que nao adianta repetir: chave invalida, sem saldo no provedor. */
async function falharDeVez(jobId: string, mensagem: string) {
  await bd()`
    update jobs
       set estado = 'falhou', erro = ${mensagem}, tentativas = max_tentativas,
           reservado_por = null, reservado_ate = null, concluido_em = now()
     where id = ${jobId}
  `;
}

/** Devolve o credito quando o trabalho morreu de vez. */
async function estornarSePreciso(job: LinhaJob, motivo: string) {
  const lancamento = job.entrada?.lancamento_id;
  if (typeof lancamento === "string") {
    await bd()`select estornar_creditos(${lancamento}, ${motivo})`;
  }
}

/** Estende o lease; `false` quando o job não é mais deste worker. */
async function renovarReserva(jobId: string): Promise<boolean> {
  const linhas = await bd()<{ ok: boolean }[]>`
    select renovar_lease(${jobId}, ${IDENTIDADE}) as ok
  `;
  return linhas[0]?.ok === true;
}

async function executarUm(job: LinhaJob) {
  const inicio = performance.now();
  const handler = HANDLERS[job.tipo];

  if (!handler) {
    await falharDeVez(job.id, `sem handler para o tipo ${job.tipo}`);
    return;
  }

  const controle = new AbortController();
  const batimento = setInterval(() => {
    renovarReserva(job.id)
      .then((ok) => {
        if (!ok) controle.abort(new ReservaPerdida(job.id));
      })
      // Banco oscilando não é reserva perdida: o lease ainda vale, e o
      // próximo batimento tenta de novo.
      .catch((erro) => console.error(`[worker] não renovou a reserva de ${job.id}:`, erro));
  }, INTERVALO_BATIMENTO_MS);

  try {
    const resultado = await handler({
      jobId: job.id,
      perfilId: job.perfil_id,
      entrada: job.entrada ?? {},
      sinal: controle.signal,
      progresso: async (p) => {
        controle.signal.throwIfAborted();
        await marcarProgresso(job.id, p);
      },
    });

    controle.signal.throwIfAborted();
    const sql = bd();
    await sql`select concluir_job(${job.id}, ${comoJson(resultado ?? {})})`;
    await registrarTentativa(job, inicio, "concluido");
  } catch (erro) {
    // Outro worker é o dono agora. Concluir ou falhar daqui sobrescreveria o
    // trabalho dele — o certo é sair sem tocar no job.
    if (controle.signal.aborted) {
      console.warn(`[worker] ${String(controle.signal.reason?.message ?? erro)}; abandonando.`);
      return;
    }

    const mensagem = erro instanceof Error ? erro.message : String(erro);
    const permanente = erro instanceof ErroDominio && CODIGOS_PERMANENTES.has(erro.codigo);

    if (permanente) {
      await falharDeVez(job.id, mensagem);
      await estornarSePreciso(job, mensagem);
    } else {
      const estado = await bd()<{ estado: string | null }[]>`
        select falhar_job(${job.id}, ${mensagem}) as estado
      `;
      if (estado[0]?.estado === "falhou") await estornarSePreciso(job, mensagem);
    }

    await registrarTentativa(job, inicio, permanente ? "falhou" : "pendente", mensagem);
    console.error(`[worker] job ${job.id} (${job.tipo}) falhou:`, mensagem);
  } finally {
    clearInterval(batimento);
  }
}

async function processarLote(): Promise<number> {
  const jobs = await bd()<LinhaJob[]>`
    select id, perfil_id, tipo, entrada from reservar_jobs(${IDENTIDADE}, ${TIPOS}, 3)
  `;

  // Em serie de proposito: as chamadas externas sao pagas e o container e
  // pequeno. Paralelismo aqui compra latencia e vende estabilidade.
  for (const job of jobs) await executarUm(job);
  return jobs.length;
}

/**
 * Tipo de job declarado no banco que ninguem sabe executar.
 *
 * `TIPOS` sai das chaves de HANDLERS e vai direto para `reservar_jobs`, entao
 * um job de tipo sem handler nunca e reservado: fica `pendente` para sempre,
 * sem falhar, sem estourar tentativa e sem aparecer em lugar nenhum. E o pior
 * tipo de defeito — o silencioso. Hoje isso vale para 'credito': o gatilho de
 * pagamento confirmado (0005) o enfileira, mas a ativacao de assinatura por
 * pagamento ainda nao existe nem no banco, e so nasce junto com o gateway.
 *
 * Na subida o catalogo e listado uma vez; dali em diante so ha aviso quando um
 * job desses realmente parou na fila. Repetir a lista toda hora sem nada preso
 * e ruido — e ruido ensina a ignorar justamente a linha que importa.
 */
async function avisarTiposOrfaos(naSubida: boolean) {
  try {
    const orfaos = await bd()<{ tipo: string; pendentes: number }[]>`
      select t.tipo,
             (select count(*)::int from jobs j
               where j.tipo = t.tipo and j.estado = 'pendente') as pendentes
        from job_tipos t
       where t.ativo and not (t.tipo = any (${TIPOS}))
    `;

    if (orfaos.length === 0) return;

    const presos = orfaos.filter((o) => o.pendentes > 0);
    if (presos.length) {
      console.warn(
        `[worker] ATENCAO: ${presos.map((o) => `${o.pendentes} job(s) de ${o.tipo}`).join(", ")} ` +
          "parado(s) na fila e nenhum handler vai processar.",
      );
    } else if (naSubida) {
      console.log(`[worker] tipos declarados ainda sem handler: ${orfaos.map((o) => o.tipo).join(", ")}`);
    }
  } catch (erro) {
    console.error("[worker] não foi possível checar tipos órfãos:", erro);
  }
}

export async function iniciarWorker() {
  if (rodando || modoDemo || !env.workerLigado) return;
  rodando = true;

  console.log(`[worker] ligado (${IDENTIDADE}), tipos: ${TIPOS.join(", ")}`);
  void avisarTiposOrfaos(true);

  let acordar: (() => void) | null = null;

  // Acorda por evento; o intervalo ocioso e so a rede de seguranca.
  try {
    await bd().listen("shopia_jobs", () => acordar?.());
  } catch (erro) {
    console.warn("[worker] LISTEN indisponível, seguindo por intervalo:", erro);
  }

  const esperar = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        acordar = null;
        resolve();
      }, ms);
      acordar = () => {
        clearTimeout(t);
        acordar = null;
        resolve();
      };
    });

  let ultimaRecuperacao = 0;
  let ultimaFaxina = 0;

  // Laço perpétuo: nenhum erro aqui pode derrubar o processo do app.
  void (async () => {
    for (;;) {
      try {
        const agora = performance.now();
        if (agora - ultimaRecuperacao > INTERVALO_RECUPERACAO_MS) {
          ultimaRecuperacao = agora;
          await bd()`select recuperar_jobs_travados()`;
        }

        // Enfileirar a faxina em vez de executar direto mantem a rotina no
        // mesmo trilho dos outros trabalhos: tem tentativa, lease e registro.
        // A chave por hora impede duas replicas agendarem a mesma faxina.
        const agoraMs = Date.now();
        if (agoraMs - ultimaFaxina > INTERVALO_FAXINA_MS) {
          ultimaFaxina = agoraMs;
          void avisarTiposOrfaos(false);
          const hora = new Date(agoraMs).toISOString().slice(0, 13);
          // Liberação do D+30: uma por dia basta, e a chave diária impede que
          // réplicas ou reinícios agendem de novo.
          const dia = hora.slice(0, 10);
          await bd()`
            insert into jobs (tipo, chave_idempotencia, entrada)
            values ('faxina', ${`faxina:${hora}`}, '{}'::jsonb),
                   ('comissao_liberar', ${`comissao_liberar:${dia}`}, '{}'::jsonb)
            on conflict (tipo, chave_idempotencia) where chave_idempotencia is not null
              do nothing
          `;
        }

        const feitos = await processarLote();
        if (feitos === 0) await esperar(INTERVALO_OCIOSO_MS);
      } catch (erro) {
        console.error("[worker] laço falhou, seguindo:", erro);
        await esperar(INTERVALO_OCIOSO_MS);
      }
    }
  })();
}
