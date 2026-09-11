import { NextResponse } from "next/server";
import { ErroDominio, traduzirErro, type CodigoErro } from "@/lib/dados/erros";
import { previaDaVoz } from "@/lib/dados/vozes";
import { obterUsuario } from "@/lib/sessao";

/**
 * Áudio de prévia de uma voz.
 *
 * É rota e não Server Action porque o destino do byte é o elemento `<audio>` do
 * navegador: uma URL que o player pede, cacheia e toca. Server Action
 * devolveria o áudio em base64 dentro da resposta do React — dez vezes maior e
 * sem o cache HTTP que faz o segundo clique não sair da máquina.
 *
 * A rota NÃO gasta crédito e não tem como gastar: `previaDaVoz` não chama a
 * razão de créditos. O que ela pode fazer é sintetizar uma vez, guardar, e
 * servir o arquivo guardado daí em diante (ver src/lib/dados/vozes.ts).
 *
 * Sessão é obrigatória mesmo com o catálogo sendo público dentro do app: sem
 * ela, esta URL vira um gerador de áudio pago aberto na internet.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O código do domínio manda no status; a mensagem já vem pronta para ser lida. */
const STATUS: Record<CodigoErro, number> = {
  nao_encontrado: 404,
  sem_permissao: 403,
  dado_invalido: 400,
  saldo_insuficiente: 402,
  conflito: 409,
  servico_indisponivel: 503,
  desconhecido: 500,
};

export async function GET(
  _requisicao: Request,
  contexto: { params: Promise<{ id: string }> },
) {
  const usuario = await obterUsuario();
  if (!usuario) {
    return NextResponse.json({ erro: "Entre na sua conta para ouvir a prévia." }, { status: 401 });
  }

  const { id } = await contexto.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ erro: "Identificador de voz inválido." }, { status: 400 });
  }

  try {
    const previa = await previaDaVoz(usuario.id, id);
    if (!previa) {
      return NextResponse.json({ erro: "Voz não encontrada." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(previa.conteudo), {
      headers: {
        "Content-Type": previa.mime,
        "Content-Length": String(previa.conteudo.byteLength),
        // Prévia de verdade não muda mais depois de gerada — o navegador pode
        // guardar à vontade. O tom de exemplo vira voz real assim que a chave
        // aparecer, então esse fica com prazo curto para não colar na máquina
        // de quem já ouviu. `private` nos dois casos: a URL exige sessão.
        "Cache-Control": previa.exemplo
          ? "private, max-age=60"
          : "private, max-age=86400, immutable",
        // Quem tocou precisa saber que ouviu um tom, não a voz.
        "X-Previa-Exemplo": previa.exemplo ? "1" : "0",
      },
    });
  } catch (erro) {
    const dominio = erro instanceof ErroDominio ? erro : traduzirErro(erro);
    const status = STATUS[dominio.codigo];

    return NextResponse.json(
      { erro: dominio.message },
      {
        status,
        // 503 aqui é quase sempre o teto de sínteses novas na janela. Dizer
        // quando voltar a valer a pena tentar evita a rajada de recliques.
        headers: status === 503 ? { "Retry-After": "60" } : undefined,
      },
    );
  }
}
