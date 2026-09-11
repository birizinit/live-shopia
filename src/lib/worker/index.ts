import "server-only";
import { bd } from "@/lib/db";
import { comoJson } from "@/lib/dados/comum";
import { env, modoDemo } from "@/lib/env";
import { ErroDominio } from "@/lib/dados/erros";
import { executarRoteiro } from "./trabalhos/roteiro";
import { executarTts } from "./trabalhos/tts";
import { executarFaxina } from "./trabalhos/faxina";
import { executarClonagem } from "./trabalhos/clonagem";

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
  progresso: (porcentagem: number) => Promise<void>;
};

type Handler = (ctx: Contexto) => Promise<Record<string, unknown> | void>;

const HANDLERS: Record<string, Handler> = {
  roteiro: executarRoteiro,
  tts: executarTts,
  clonagem: executarClonagem,
  faxina: executarFaxina,
};

const TIPOS = Object.keys(HANDLERS);

const IDENTIDADE = `worker-${process.pid}`;
const INTERVALO_OCIOSO_MS = 5_000;
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

async function executarUm(job: LinhaJob) {
  const inicio = performance.now();
  const handler = HANDLERS[job.tipo];

  if (!handler) {
    await falharDeVez(job.id, `sem handler para o tipo ${job.tipo}`);
    return;
  }

  try {
    const resultado = await handler({
      jobId: job.id,
      perfilId: job.perfil_id,
      entrada: job.entrada ?? {},
      progresso: (p) => marcarProgresso(job.id, p),
    });

    const sql = bd();
    await sql`select concluir_job(${job.id}, ${comoJson(resultado ?? {})})`;
    await registrarTentativa(job, inicio, "concluido");
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    const permanente = erro instanceof ErroDominio && erro.codigo === "sem_permissao";

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
 * tipo de defeito — o silencioso. Hoje isso vale para 'comissao', 'montagem' e
 * 'push', que a migracao 0003 declara e o codigo ainda nao implementa.
 */
async function avisarTiposOrfaos() {
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
    console.warn(
      `[worker] tipos sem handler: ${orfaos.map((o) => o.tipo).join(", ")}` +
        (presos.length
          ? ` — ATENCAO: ${presos.map((o) => `${o.pendentes} job(s) de ${o.tipo}`).join(", ")} ` +
            "parado(s) na fila e ninguem vai processar."
          : " (nenhum job preso por enquanto)"),
    );
  } catch (erro) {
    console.error("[worker] não foi possível checar tipos órfãos:", erro);
  }
}

export async function iniciarWorker() {
  if (rodando || modoDemo || !env.workerLigado) return;
  rodando = true;

  console.log(`[worker] ligado (${IDENTIDADE}), tipos: ${TIPOS.join(", ")}`);
  void avisarTiposOrfaos();

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
          void avisarTiposOrfaos();
          const hora = new Date(agoraMs).toISOString().slice(0, 13);
          await bd()`
            insert into jobs (tipo, chave_idempotencia, entrada)
            values ('faxina', ${`faxina:${hora}`}, '{}'::jsonb)
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
