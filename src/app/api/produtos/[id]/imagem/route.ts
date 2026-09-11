import { NextResponse, type NextRequest } from "next/server";
import { guardar, ler, remover } from "@/lib/armazenamento";
import { ErroDominio } from "@/lib/dados/erros";
import {
  TETO_IMAGEM_BYTES,
  TIPOS_IMAGEM,
  definirImagem,
  imagemDoProduto,
} from "@/lib/dados/produtos";
import { modoDemo } from "@/lib/env";
import { obterUsuario } from "@/lib/sessao";

/**
 * Imagem do produto: serve, troca e remove.
 *
 * O binario NAO e publico. Cada requisicao resolve a sessao e so entao procura
 * `imagem_id` com `perfil_id` no where — o id do produto vem da URL e, sem
 * RLS, e exatamente o tipo de identificador que nao se pode acreditar. Um id
 * adivinhado devolve 404, nao a foto de outra pessoa.
 *
 * O upload entra por aqui e nao por Server Action de proposito: Server Action
 * tem teto de corpo de 1 MB, e foto de celular passa disso sem esforco. O
 * route handler nao tem esse teto.
 */

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

/** Cabecalho de um arquivo de imagem, em bytes. */
const ASSINATURAS: { mime: string; testar: (b: Uint8Array) => boolean }[] = [
  { mime: "image/jpeg", testar: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    testar: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: "image/gif",
    testar: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
  {
    mime: "image/webp",
    testar: (b) =>
      texto(b, 0, 4) === "RIFF" && texto(b, 8, 12) === "WEBP",
  },
  {
    mime: "image/avif",
    testar: (b) =>
      texto(b, 4, 8) === "ftyp" && ["avif", "avis"].includes(texto(b, 8, 12)),
  },
];

function texto(bytes: Uint8Array, de: number, ate: number) {
  return String.fromCharCode(...bytes.subarray(de, ate));
}

/**
 * O tipo REAL do arquivo, lido dos primeiros bytes.
 *
 * O `Content-Type` que o navegador manda vem do nome do arquivo e e trivial de
 * forjar: aceitar um `.exe` renomeado para `.png` e servi-lo de volta com
 * `image/png` e como a gente entregaria o payload de outra pessoa para o
 * proprio usuario.
 */
function tipoReal(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 12) return null;
  return ASSINATURAS.find((a) => a.testar(bytes))?.mime ?? null;
}

function recusar(mensagem: string, status: number) {
  return NextResponse.json({ erro: mensagem }, { status });
}

export async function GET(request: NextRequest, contexto: Contexto) {
  const usuario = await obterUsuario();
  if (!usuario) return new NextResponse(null, { status: 401 });

  // No modo demo nada foi gravado: os produtos de exemplo nao tem imagem, e a
  // tela cai no espaco reservado em vez de pedir um binario que nao existe.
  if (modoDemo) return new NextResponse(null, { status: 404 });

  const { id } = await contexto.params;
  const arquivoId = await imagemDoProduto(usuario.id, id);
  if (!arquivoId) return new NextResponse(null, { status: 404 });

  // A imagem so muda quando o arquivo muda, entao o proprio id e o ETag. Evita
  // reenviar megabytes a cada volta para a lista.
  const etag = `"${arquivoId}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { etag } });
  }

  const arquivo = await ler(usuario.id, arquivoId);
  if (!arquivo) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(arquivo.conteudo), {
    headers: {
      "content-type": arquivo.mime,
      "content-length": String(arquivo.bytes),
      // `private`: e conteudo de uma conta, nao pode parar em cache compartilhado.
      "cache-control": "private, max-age=300, must-revalidate",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      etag,
    },
  });
}

export async function POST(request: NextRequest, contexto: Contexto) {
  const usuario = await obterUsuario();
  if (!usuario) return recusar("Faça login para enviar a imagem.", 401);

  if (modoDemo) {
    return recusar(
      "Modo demo: nenhum arquivo é gravado. Configure o banco para enviar imagens de verdade.",
      422,
    );
  }

  const { id } = await contexto.params;

  const formulario = await request.formData();
  const enviado = formulario.get("imagem");

  if (!(enviado instanceof File) || enviado.size === 0) {
    return recusar("Escolha um arquivo de imagem.", 400);
  }

  // Tamanho antes de ler: `size` ja veio no cabecalho da parte, e carregar 40 MB
  // na memoria para so entao recusar e o jeito caro de dizer nao.
  if (enviado.size > TETO_IMAGEM_BYTES) {
    return recusar(
      `A imagem tem ${Math.ceil(enviado.size / 1024 / 1024)} MB e o limite é de ` +
        `${TETO_IMAGEM_BYTES / 1024 / 1024} MB. Reduza a resolução e tente de novo.`,
      413,
    );
  }

  const bytes = new Uint8Array(await enviado.arrayBuffer());
  const mime = tipoReal(bytes);

  if (!mime || !(TIPOS_IMAGEM as readonly string[]).includes(mime)) {
    return recusar("Esse arquivo não é uma imagem JPEG, PNG, WebP, AVIF ou GIF.", 415);
  }

  try {
    // Grava primeiro: se `definirImagem` falhar, sobra um arquivo orfao (que a
    // faxina recolhe) — o inverso deixaria o produto apontando para um binario
    // que nao existe, e ai a tela quebra.
    const arquivo = await guardar(usuario.id, Buffer.from(bytes), {
      mime,
      metadados: { uso: "produto", produto_id: id, nome: enviado.name.slice(0, 200) },
    });

    const { anterior } = await definirImagem(usuario.id, id, arquivo.id);
    if (anterior) await remover(anterior);

    return NextResponse.json({ ok: true, arquivoId: arquivo.id });
  } catch (erro) {
    if (erro instanceof ErroDominio) {
      return recusar(erro.message, erro.codigo === "nao_encontrado" ? 404 : 409);
    }
    return recusar("Não foi possível guardar a imagem. Tente de novo.", 500);
  }
}

export async function DELETE(_request: NextRequest, contexto: Contexto) {
  const usuario = await obterUsuario();
  if (!usuario) return recusar("Faça login para remover a imagem.", 401);
  if (modoDemo) return recusar("Modo demo: não há imagem gravada para remover.", 422);

  const { id } = await contexto.params;

  try {
    const { anterior } = await definirImagem(usuario.id, id, null);
    if (anterior) await remover(anterior);
    return NextResponse.json({ ok: true });
  } catch (erro) {
    if (erro instanceof ErroDominio) {
      return recusar(erro.message, erro.codigo === "nao_encontrado" ? 404 : 409);
    }
    return recusar("Não foi possível remover a imagem.", 500);
  }
}
