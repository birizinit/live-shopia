import { ler } from "@/lib/armazenamento";
import { obterUsuario } from "@/lib/sessao";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Serve um arquivo guardado — hoje o vídeo de reação da live.
 *
 * A checagem de dono está dentro de `ler()` (src/lib/armazenamento.ts), que
 * filtra por `perfil_id`. Sem RLS, é ela que impede um id adivinhado entregar
 * o arquivo de outra conta.
 *
 * Nasceu servindo bloco de áudio e sobreviveu à saída do áudio por causa do
 * suporte a `Range` abaixo, que vídeo exige ainda mais do que som.
 */
export async function GET(pedido: Request, contexto: { params: Promise<{ id: string }> }) {
  const usuario = await obterUsuario();
  if (!usuario) return new Response("sessão expirada", { status: 401 });

  const { id } = await contexto.params;
  if (!UUID.test(id)) return new Response("identificador inválido", { status: 400 });

  const arquivo = await ler(usuario.id, id);
  if (!arquivo) return new Response("arquivo não encontrado", { status: 404 });

  return servir(pedido, arquivo.conteudo, arquivo.mime);
}

/**
 * Responde com suporte a `Range`.
 *
 * Não é refinamento: Safari (e o WebView do iOS) só considera mídia tocável se
 * a origem aceitar faixa, e o player de vídeo pede o fim do arquivo antes do
 * começo para achar o índice. Sem faixa, o vídeo não abre.
 */
function servir(pedido: Request, conteudo: Buffer, mime: string) {
  const total = conteudo.byteLength;

  const cabecalhos = new Headers({
    "content-type": mime,
    "accept-ranges": "bytes",
    // O id É o conteúdo: um arquivo gravado nunca muda de bytes. `private`
    // porque o arquivo é de uma conta só e não pode ficar em cache compartilhado.
    "cache-control": "private, max-age=31536000, immutable",
  });

  const faixa = pedido.headers.get("range");
  const casa = faixa ? /^bytes=(\d*)-(\d*)$/.exec(faixa.trim()) : null;

  if (!casa) {
    cabecalhos.set("content-length", String(total));
    return new Response(corpo(conteudo), { status: 200, headers: cabecalhos });
  }

  const cruInicio = casa[1] ?? "";
  const cruFim = casa[2] ?? "";

  // "bytes=-500" pede os ÚLTIMOS 500 bytes, não do zero até 500.
  const inicio = cruInicio ? Number(cruInicio) : Math.max(0, total - Number(cruFim || total));
  let fim = cruFim && cruInicio ? Number(cruFim) : total - 1;

  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || inicio > fim || inicio >= total) {
    cabecalhos.set("content-range", `bytes */${total}`);
    return new Response(null, { status: 416, headers: cabecalhos });
  }

  fim = Math.min(fim, total - 1);
  const pedaco = conteudo.subarray(inicio, fim + 1);

  cabecalhos.set("content-length", String(pedaco.byteLength));
  cabecalhos.set("content-range", `bytes ${inicio}-${fim}/${total}`);
  return new Response(corpo(pedaco), { status: 206, headers: cabecalhos });
}

/**
 * `Buffer` do Node vive num pool compartilhado entre alocações; o corpo de uma
 * `Response` pede um buffer próprio. A cópia é o que fecha os dois mundos — e
 * ela cabe porque a linha tem no máximo 8 MB (arquivos_tamanho_por_linha).
 */
function corpo(bytes: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}
