import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { COOKIE_DISPOSITIVO } from "@/lib/auth/sessoes";
import { registrarInscricao, removerInscricaoPorEndpoint } from "@/lib/dados/push";
import { servicos } from "@/lib/env";
import { obterUsuario } from "@/lib/sessao";

/**
 * A inscricao Web Push deste navegador.
 *
 * E rota de API, e nao Server Action, porque o mesmo endereco atende dois
 * clientes: a tela /notificacoes e o proprio service worker, que reinscreve
 * sozinho no `pushsubscriptionchange` — e worker nao chama Server Action.
 *
 * Gravar so o que o navegador mandou nao basta: o dono e sempre a sessao do
 * servidor. Quem posta o endpoint de outra pessoa acaba gravando no PROPRIO
 * perfil, que e inofensivo (e o `on conflict (endpoint)` documentado em
 * db/migrations/0006_live_dados.sql), e nunca no perfil alheio.
 */

const esquema = z.object({
  endpoint: z
    .string()
    .min(10, "Endpoint inválido")
    .max(2000, "Endpoint longo demais")
    // O servico de push sempre emite https. Recusar o resto evita gravar lixo
    // que o job de envio so descobriria na hora de mandar.
    .refine((valor) => valor.startsWith("https://"), "Endpoint inválido"),
  p256dh: z.string().min(1, "Chave ausente").max(300),
  auth: z.string().min(1, "Chave ausente").max(300),
});

const esquemaRemocao = esquema.pick({ endpoint: true });

type Recusa = { resposta: NextResponse };

/** As tres recusas valem para POST e DELETE, na mesma ordem. */
async function autorizar(): Promise<{ perfilId: string } | Recusa> {
  const usuario = await obterUsuario();

  if (!usuario) {
    return {
      resposta: NextResponse.json(
        { ok: false, erro: "Sessão expirada. Entre de novo." },
        { status: 401 },
      ),
    };
  }

  if (!servicos.push) {
    return {
      resposta: NextResponse.json(
        { ok: false, erro: "O push não está configurado neste servidor." },
        { status: 503 },
      ),
    };
  }

  if (usuario.demo) {
    // A sessao demo nao tem linha em `perfis`: gravar aqui estouraria a
    // chave estrangeira. A tela ja desabilita o botao antes de chegar aqui.
    return {
      resposta: NextResponse.json(
        { ok: false, erro: "Modo demonstração: não há onde guardar a inscrição." },
        { status: 503 },
      ),
    };
  }

  return { perfilId: usuario.id };
}

async function corpo(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const autorizacao = await autorizar();
  if ("resposta" in autorizacao) return autorizacao.resposta;

  const dados = esquema.safeParse(await corpo(request));
  if (!dados.success) {
    return NextResponse.json(
      { ok: false, erro: dados.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }

  const cabecalhos = await headers();
  const jar = await cookies();

  const { marca } = await registrarInscricao(autorizacao.perfilId, {
    endpoint: dados.data.endpoint,
    p256dh: dados.data.p256dh,
    auth: dados.data.auth,
    // O aparelho e o user agent vem do servidor, nao do corpo: sao dados de
    // reconhecimento da lista, e o navegador nao tem por que poder escolher
    // como aparece nela.
    deviceId: jar.get(COOKIE_DISPOSITIVO)?.value ?? null,
    userAgent: cabecalhos.get("user-agent")?.slice(0, 400) ?? null,
  });

  return NextResponse.json({ ok: true, marca }, { status: 201 });
}

export async function DELETE(request: Request) {
  const autorizacao = await autorizar();
  if ("resposta" in autorizacao) return autorizacao.resposta;

  const dados = esquemaRemocao.safeParse(await corpo(request));
  if (!dados.success) {
    return NextResponse.json({ ok: false, erro: "Endpoint inválido." }, { status: 400 });
  }

  const removida = await removerInscricaoPorEndpoint(
    autorizacao.perfilId,
    dados.data.endpoint,
  );

  // `removida: false` nao e erro: o navegador pode estar cancelando uma
  // inscricao que ja tinha saido do banco por outra aba ou por 410.
  return NextResponse.json({ ok: true, removida });
}
