import { ler } from "@/lib/armazenamento";
import { ehIdValido } from "@/lib/dados/audios";
import { modoDemo } from "@/lib/env";
import { obterUsuario } from "@/lib/sessao";

export const dynamic = "force-dynamic";

/**
 * Serve UM bloco de áudio.
 *
 * Um bloco, nunca o áudio inteiro: o arquivo contínuo de 3h não existe neste
 * produto (db/migrations/0003_infra.sql). O player recebe a lista de blocos e
 * toca em ordem, e é esta rota que entrega cada um.
 *
 * A checagem de dono está dentro de `ler()` (src/lib/armazenamento.ts), que
 * filtra por `perfil_id`. Sem RLS, é ela que impede um id adivinhado entregar
 * o áudio de outra conta; arquivo global (prévia de voz) tem perfil nulo e é
 * legível por qualquer sessão.
 */
export async function GET(pedido: Request, contexto: { params: Promise<{ id: string }> }) {
  const usuario = await obterUsuario();
  if (!usuario) return new Response("sessão expirada", { status: 401 });

  const { id } = await contexto.params;
  if (!ehIdValido(id)) return new Response("identificador inválido", { status: 400 });

  if (modoDemo) return servir(pedido, tomDeExemplo(id), "audio/wav");

  const arquivo = await ler(usuario.id, id);
  if (!arquivo) return new Response("arquivo não encontrado", { status: 404 });

  return servir(pedido, arquivo.conteudo, arquivo.mime);
}

/**
 * Responde com suporte a `Range`.
 *
 * Não é refinamento: o Safari (e o WebView do iOS) só considera um áudio
 * tocável se a origem aceitar faixa, e sem isso o player fica mudo justamente
 * no celular, que é onde a live é assistida.
 */
function servir(pedido: Request, conteudo: Buffer, mime: string) {
  const total = conteudo.byteLength;

  const cabecalhos = new Headers({
    "content-type": mime,
    "accept-ranges": "bytes",
    // O id É o conteúdo: um arquivo gravado nunca muda de bytes. `private`
    // porque o áudio é de uma conta só e não pode ficar num cache compartilhado.
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
 * ela cabe porque um bloco tem no máximo 8 MB (arquivos_tamanho_por_linha).
 */
function corpo(bytes: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

/**
 * Tom curto em WAV para o modo demo.
 *
 * A sessão demo não tem linha no banco, então não há bloco nenhum para ler — e
 * uma tela de estúdio sem nada para tocar não demonstra nada. Isto é um bipe, e
 * a interface diz que é exemplo: nunca se apresenta como voz gerada.
 */
function tomDeExemplo(id: string): Buffer {
  const taxa = 8_000;
  const duracaoMs = 8_000;
  const amostras = Math.round((taxa * duracaoMs) / 1000);

  // Frequência derivada do id: blocos diferentes soam diferentes, e dá para
  // ouvir a virada de um bloco para o outro no player.
  const semente = [...id].reduce((soma, letra) => soma + letra.charCodeAt(0), 0);
  const frequencia = 180 + (semente % 7) * 40;

  const dados = Buffer.alloc(amostras * 2);
  for (let i = 0; i < amostras; i += 1) {
    const envelope = Math.min(1, i / 800) * Math.min(1, (amostras - i) / 800);
    const valor = Math.sin((2 * Math.PI * frequencia * i) / taxa) * 0.16 * envelope;
    dados.writeInt16LE(Math.round(valor * 32767), i * 2);
  }

  const cabecalho = Buffer.alloc(44);
  cabecalho.write("RIFF", 0);
  cabecalho.writeUInt32LE(36 + dados.length, 4);
  cabecalho.write("WAVEfmt ", 8);
  cabecalho.writeUInt32LE(16, 16);
  cabecalho.writeUInt16LE(1, 20);
  cabecalho.writeUInt16LE(1, 22);
  cabecalho.writeUInt32LE(taxa, 24);
  cabecalho.writeUInt32LE(taxa * 2, 28);
  cabecalho.writeUInt16LE(2, 32);
  cabecalho.writeUInt16LE(16, 34);
  cabecalho.write("data", 36);
  cabecalho.writeUInt32LE(dados.length, 40);

  return Buffer.concat([cabecalho, dados]);
}
