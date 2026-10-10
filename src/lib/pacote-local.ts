import "server-only";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import zlib from "node:zlib";

/**
 * A extensão que vem JUNTO com o deploy.
 *
 * A pasta `extensao/` mora no mesmo repositório que o app, então todo deploy
 * na Railway já carrega a versão mais nova dela. Este módulo lê essa pasta e
 * monta o ZIP na hora — é o que deixa a tela /extensao oferecer o download
 * sem ninguém precisar rodar `scripts/publicar-extensao.mjs` a cada versão.
 *
 * O catálogo do banco (`ext_versoes`) continua valendo: se lá houver versão
 * MAIS NOVA que a da pasta, ela vence; e se a versão da pasta estiver com
 * kill switch lá, ela não é servida.
 */

const PASTA = join(process.cwd(), "extensao");

/** Fora do pacote: teste e documentação de quem desenvolve. */
const FORA = [/\.test\.js$/, /^\./, /(^|\/)node_modules\//];

const VERSAO = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$/;

export type PacoteLocal = {
  versao: string;
  conteudo: Buffer;
  mime: string;
  bytes: number;
};

let cacheVersao: { versao: string | null } | null = null;
let cachePacote: PacoteLocal | null = null;

/** Versão do manifest da pasta, ou null se a pasta não veio no deploy. */
export async function versaoLocal(): Promise<string | null> {
  if (cacheVersao) return cacheVersao.versao;
  try {
    const manifest = JSON.parse(await readFile(join(PASTA, "manifest.json"), "utf8")) as {
      version?: unknown;
    };
    const v = typeof manifest.version === "string" && VERSAO.test(manifest.version) ? manifest.version : null;
    cacheVersao = { versao: v };
  } catch {
    cacheVersao = { versao: null };
  }
  return cacheVersao.versao;
}

/** -1, 0 ou 1, comparando "1.2.3" número a número. */
export function compararVersoes(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** A pasta é mais nova que a versão do catálogo (ou o catálogo está vazio)? */
export async function localVence(versaoDoCatalogo: string | null): Promise<boolean> {
  const local = await versaoLocal();
  if (!local) return false;
  return !versaoDoCatalogo || compararVersoes(local, versaoDoCatalogo) > 0;
}

async function listar(pasta: string): Promise<string[]> {
  const entradas = await readdir(pasta, { withFileTypes: true });
  const arquivos: string[] = [];
  for (const e of entradas) {
    const caminho = join(pasta, e.name);
    if (e.isDirectory()) arquivos.push(...(await listar(caminho)));
    else if (e.isFile()) arquivos.push(caminho);
  }
  return arquivos;
}

// --- ZIP mínimo (deflate do zlib + envelope), determinístico -----------------

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(dados: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 2020-01-01 00:00 em formato DOS: data fixa = mesmo conteúdo, mesmo ZIP. */
const DOS_HORA = 0;
const DOS_DATA = ((2020 - 1980) << 9) | (1 << 5) | 1;

function montarZip(arquivos: { nome: string; dados: Buffer }[]): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;

  for (const { nome, dados } of arquivos) {
    const nomeBuf = Buffer.from(nome, "utf8");
    const comprimido = zlib.deflateRawSync(dados, { level: 9 });
    const crc = crc32(dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nome em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_HORA, 10);
    local.writeUInt16LE(DOS_DATA, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nomeBuf, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_HORA, 12);
    central.writeUInt16LE(DOS_DATA, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nomeBuf.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, nomeBuf);

    deslocamento += 30 + nomeBuf.length + comprimido.length;
  }

  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);

  return Buffer.concat([...locais, diretorio, fim]);
}

/**
 * O ZIP da pasta, com tudo dentro de uma pasta `shopia-extensao/` — quem
 * extrai ganha uma pasta pronta para "Carregar sem compactação".
 */
export async function pacoteLocal(): Promise<PacoteLocal | null> {
  const versao = await versaoLocal();
  if (!versao) return null;
  if (cachePacote?.versao === versao) return cachePacote;

  const caminhos = (await listar(PASTA)).sort();
  const arquivos: { nome: string; dados: Buffer }[] = [];
  for (const caminho of caminhos) {
    const rel = relative(PASTA, caminho).split(sep).join("/");
    if (FORA.some((r) => r.test(rel))) continue;
    arquivos.push({ nome: `shopia-extensao/${rel}`, dados: await readFile(caminho) });
  }

  const conteudo = montarZip(arquivos);
  cachePacote = { versao, conteudo, mime: "application/zip", bytes: conteudo.length };
  return cachePacote;
}
