import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  ALVO_PADRAO,
  autenticarLicenca,
  contextoSemPessoal,
  dentroDoLimite,
  juntarFalhas,
  MAX_FALHAS_POR_ENVIO,
  origemDaRequisicao,
  registrarContato,
  registrarTelemetria,
  tokenDoCabecalho,
  type FalhaTelemetria,
} from "@/lib/dados/extensao";
import { ErroDominio } from "@/lib/dados/erros";
import { modoDemo } from "@/lib/env";

/**
 * POST /api/ext/telemetria — qual seletor falhou.
 *
 * É o que faz o painel avisar antes do WhatsApp: o agregado diário diz quando
 * N% das instalações vivas numa versão falham no MESMO ponto, e aí a quebra é
 * do TikTok, não da máquina de um cliente.
 *
 * O QUE ESTA ROTA RECUSA, e recusa no formato e não na boa-fé de quem chama:
 * comentário do chat, @usuário, apelido, id de sala, URL com identificador e
 * qualquer texto longo demais para ser "motivo". O espectador do cliente não é
 * usuário nosso, nunca consentiu com nada e não tem a quem pedir exclusão —
 * dado dele que não coletamos é dado que não vaza. O banco também barra isso
 * (CHECK `telemetria_sem_pessoal`); aqui a checagem existe para a extensão
 * receber o motivo em vez de um erro de constraint opaco.
 */

export const dynamic = "force-dynamic";

/**
 * Generoso de propósito: no dia da quebra TODA a base reporta ao mesmo tempo, e
 * o teto que protege o banco não pode ser o que apaga a evidência. A extensão
 * já agrupa (40 falhas do mesmo seletor viram uma linha com ocorrencias=40).
 */
const TETO_POR_LICENCA = 30;
const TETO_POR_ORIGEM = 120;
const JANELA_S = 60;

const CORPO_MAXIMO_BYTES = 16 * 1024;

const esquemaFalha = z.object({
  alvo: z
    .string()
    .regex(/^[a-z_]{3,40}$/, "alvo fora do formato")
    .default(ALVO_PADRAO),
  modulo: z.enum(["nucleo", "mixer", "chat", "painel"]).default("nucleo"),
  // A âncora do mapa, pelo nome da chave. Mesmo formato do CHECK do banco.
  seletor: z.string().regex(/^[a-z0-9_.]{3,60}$/, "seletor fora do formato"),
  // null = a cascata inteira falhou, que é o alarme de verdade.
  candidato: z.number().int().min(0).max(32).nullable().default(null),
  versao: z.string().min(1).max(32),
  mapaVersao: z.number().int().positive().nullable().default(null),
  ocorrencias: z.number().int().positive().max(100_000).default(1),
  contexto: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

const esquemaCorpo = z.object({
  instalacao: z.string().regex(/^[A-Za-z0-9._-]{8,128}$/, "chave de instalação fora do formato"),
  versao: z.string().regex(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$/, "versão fora do formato"),
  mapaVersao: z.number().int().positive().nullable().default(null),
  sistema: z.string().max(60).nullable().default(null),
  navegador: z.string().max(60).nullable().default(null),
  falhas: z.array(esquemaFalha).min(1).max(MAX_FALHAS_POR_ENVIO),
});

export async function POST(request: NextRequest) {
  if (modoDemo) {
    return NextResponse.json(
      { ok: false, erro: "modo_demo", detalhe: "Servidor em modo demonstração, sem banco." },
      { status: 503 },
    );
  }

  const origem = origemDaRequisicao(request.headers);

  try {
    if (!(await dentroDoLimite(`ext:telemetria:origem:${origem}`, TETO_POR_ORIGEM, JANELA_S))) {
      return excedeu();
    }

    const licenca = await autenticarLicenca(tokenDoCabecalho(request.headers));
    if (!licenca) {
      return NextResponse.json(
        { ok: false, erro: "token_invalido" },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      );
    }

    if (licenca.estado === "revogada") {
      return NextResponse.json({ ok: false, erro: "revogada" }, { status: 403 });
    }

    if (!(await dentroDoLimite(`ext:telemetria:${licenca.licencaId}`, TETO_POR_LICENCA, JANELA_S))) {
      return excedeu();
    }

    const bruto = await request.text();
    if (bruto.length > CORPO_MAXIMO_BYTES) {
      return NextResponse.json({ ok: false, erro: "corpo_grande" }, { status: 413 });
    }

    let json: unknown;
    try {
      json = JSON.parse(bruto);
    } catch {
      return NextResponse.json({ ok: false, erro: "json_invalido" }, { status: 400 });
    }

    const lido = esquemaCorpo.safeParse(json);
    if (!lido.success) {
      return NextResponse.json(
        {
          ok: false,
          erro: "formato_invalido",
          detalhe: lido.error.issues[0]?.message ?? "Confira o corpo enviado.",
          campo: lido.error.issues[0]?.path.join("."),
        },
        { status: 422 },
      );
    }

    const corpo = lido.data;

    // Segunda barreira, separada do formato: aqui o que se recusa não é campo
    // torto, é dado de pessoa. As duas razões de recusa são diferentes e a
    // extensão precisa poder distinguir uma da outra no log dela.
    for (const falha of corpo.falhas) {
      const limpo = contextoSemPessoal(falha.contexto);
      if (!limpo.ok) {
        return NextResponse.json(
          { ok: false, erro: "dado_pessoal_recusado", detalhe: limpo.erro, seletor: falha.seletor },
          { status: 422 },
        );
      }
    }

    // O heartbeat resolve a instalação: a extensão manda a CHAVE dela, nunca um
    // id. Assim o `instalacao_id` gravado sempre pertence a esta licença — a
    // chave estrangeira composta de `ext_telemetria` não teria como ser furada,
    // mas nem chega a ser testada.
    const instalacao = await registrarContato(licenca.licencaId, {
      instalacaoChave: corpo.instalacao,
      versao: corpo.versao,
      userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      sistema: corpo.sistema,
      navegador: corpo.navegador,
      mapaVersao: corpo.mapaVersao,
    });

    const falhas: FalhaTelemetria[] = juntarFalhas(
      corpo.falhas.map((f) => ({
        alvo: f.alvo,
        modulo: f.modulo,
        seletor: f.seletor,
        candidato: f.candidato,
        versao: f.versao,
        mapaVersao: f.mapaVersao ?? corpo.mapaVersao,
        ocorrencias: f.ocorrencias,
        contexto: f.contexto,
      })),
    );

    const gravadas = await registrarTelemetria(licenca.perfilId, instalacao.id, falhas);

    return NextResponse.json(
      { ok: true, gravadas, instalacao: instalacao.id },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (erro) {
    // Licença revogada entre a autenticação e o heartbeat, ou contexto que
    // passou por aqui e bateu no CHECK do banco: os dois são culpa de quem
    // chamou, e 503 mandaria a extensão tentar de novo para sempre.
    if (erro instanceof ErroDominio) {
      if (erro.codigo === "sem_permissao") {
        return NextResponse.json({ ok: false, erro: "revogada" }, { status: 403 });
      }
      if (erro.codigo === "dado_invalido") {
        return NextResponse.json(
          { ok: false, erro: "dado_recusado", detalhe: erro.message },
          { status: 422 },
        );
      }
    }
    console.error("[api/ext/telemetria]", erro);
    return NextResponse.json({ ok: false, erro: "indisponivel" }, { status: 503 });
  }
}

function excedeu() {
  return NextResponse.json(
    { ok: false, erro: "limite_excedido" },
    { status: 429, headers: { "retry-after": String(JANELA_S) } },
  );
}
