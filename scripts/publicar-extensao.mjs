/**
 * Publica um pacote da extensão da Shopia.
 *
 * Uso:
 *   node scripts/publicar-extensao.mjs --pasta ./caminho --versao 1.0.0 --canal estavel --notas "texto"
 *   node scripts/publicar-extensao.mjs --zip ./pacote.zip --versao 1.0.0
 *
 * Depois que este comando roda com sucesso, /extensao para de dizer "Nenhuma
 * versão publicada" e passa a oferecer o download — sem mudança de código. É
 * `ext_versoes` + `arquivos` que a tela lê (src/lib/dados/extensao.ts).
 *
 * -----------------------------------------------------------------------------
 * POR QUE O ZIP É ESCRITO NA MÃO
 *
 * O package.json não é meu para editar, então adicionar `archiver`/`jszip` está
 * fora. O Node não traz escritor de ZIP — traz o `zlib`, que é a parte difícil
 * (deflate) já pronta. O que sobra é o envelope: cabeçalho local por arquivo,
 * diretório central e o registro de fim. São três structs de campo fixo, sem
 * ZIP64 (o teto da tabela `arquivos` é 8 MB, longe dos 4 GB que exigiriam), sem
 * criptografia e sem descritor de dados (o conteúdo inteiro está em memória
 * antes de escrever, então CRC e tamanhos já são conhecidos na hora do
 * cabeçalho). É o subconjunto que o Chrome lê ao "Carregar sem compactação" a
 * partir de uma pasta descompactada.
 *
 * O carimbo de data/hora é FIXO de propósito. ZIP determinístico significa que
 * a mesma árvore de arquivos gera sempre o mesmo sha256 — e é esse sha que
 * decide, mais abaixo, se republicar a mesma versão é um não-evento ou uma
 * troca de binário sob o mesmo número. Com mtime real, copiar a pasta já daria
 * um pacote "diferente".
 *
 * O leitor de ZIP existe pelo mesmo motivo: sem ele, `--zip` seria uma porta
 * dos fundos para pular a validação de manifest e a varredura de domínios que
 * `--pasta` sofre. Validação que se contorna trocando de flag não é validação.
 * -----------------------------------------------------------------------------
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import postgres from "postgres";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

// .env.local só existe no desenvolvimento; na Railway as variáveis já vêm
// injetadas no processo. Mesmo bloco de scripts/migrar.mjs.
for (const arquivo of [".env.local", ".env"]) {
  const caminho = join(raiz, arquivo);
  if (!existsSync(caminho)) continue;
  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const par = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!par) continue;
    const [, chave, bruto] = par;
    if (process.env[chave] !== undefined) continue;
    process.env[chave] = bruto.trim().replace(/^["']|["']$/g, "");
  }
}

// -----------------------------------------------------------------------------
// Constantes do domínio — todas espelham o que o banco já exige.
// -----------------------------------------------------------------------------

/** `ext_versoes.versao` tem CHECK com este mesmo formato. Recusar aqui dá mensagem; lá dá 23514. */
const VERSAO_VALIDA = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$/;

/** `arquivos_tamanho_por_linha`: bytes <= 8 MB. */
const TETO_BYTES = 8 * 1024 * 1024;

/** Chave de configuração com a fatia padrão do canário (semeada em 0007). */
const CHAVE_CANARIO = "ext.canario_percentual";

/**
 * Hosts que NÃO acendem o alerta de terceiro:
 *  · os nossos (derivados de NEXT_PUBLIC_SITE_URL) — é para cá que a licença vai;
 *  · o alvo da operação (tiktok), que a extensão precisa ler por definição e que
 *    já está em `host_permissions` de qualquer build nosso.
 * Um gate que dispara em toda publicação vira flag decorativa, e aí deixa de
 * proteger no dia em que o domínio estranho é de verdade.
 */
const HOSTS_ALVO = ["tiktok.com", "tiktokcdn.com", "tiktokv.com", "byteoversea.com"];
const HOSTS_LOCAIS = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];

/** Onde procurar URL. HTML e CSS entram junto com .js/.json: `fetch` mora em <script> inline também. */
const EXTENSOES_VARRIDAS = new Set([".js", ".mjs", ".cjs", ".json", ".html", ".htm", ".css"]);

/**
 * Nunca entram no pacote: chave de assinatura (publicada é chave perdida) e
 * pacote já montado (um .crx dentro do ZIP é sobra de build, e o Chrome ignora).
 */
const NUNCA_EMPACOTAR = [".pem", ".key", ".p12", ".pfx", ".crx"];
const PASTAS_IGNORADAS = new Set([".git", "node_modules", ".next", ".vscode", "__MACOSX"]);
const ARQUIVOS_IGNORADOS = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

// Bomba de descompressão: o ZIP cabe em 8 MB, o conteúdo dele não precisa caber
// em 8 GB de RAM nossa só porque alguém mandou um arquivo com 10.000 zeros.
const TETO_DESCOMPRIMIDO = 64 * 1024 * 1024;
const TETO_ENTRADAS = 5000;

// -----------------------------------------------------------------------------
// Argumentos
// -----------------------------------------------------------------------------

function lerArgumentos(argv) {
  const opcoes = {};
  const soltos = [];

  for (let i = 0; i < argv.length; i += 1) {
    const bruto = argv[i];
    if (!bruto.startsWith("--")) {
      soltos.push(bruto);
      continue;
    }
    const igual = bruto.indexOf("=");
    const nome = (igual === -1 ? bruto.slice(2) : bruto.slice(2, igual)).replace(/-/g, "_");
    if (igual !== -1) {
      opcoes[nome] = bruto.slice(igual + 1);
      continue;
    }
    const proximo = argv[i + 1];
    if (proximo === undefined || proximo.startsWith("--")) {
      opcoes[nome] = true;
      continue;
    }
    opcoes[nome] = proximo;
    i += 1;
  }

  return { opcoes, soltos };
}

const AJUDA = `
Publica um pacote da extensão da Shopia em ext_versoes.

  node scripts/publicar-extensao.mjs --pasta ./extensao --versao 1.0.0
  node scripts/publicar-extensao.mjs --zip ./pacote.zip --versao 1.0.0 --canal canario

Origem (uma das duas, obrigatória)
  --pasta <caminho>        Pasta com o manifest.json na raiz. Vira ZIP aqui mesmo.
  --zip <arquivo.zip>      ZIP já montado. Sofre as mesmas validações.

Obrigatório
  --versao <x.y.z>         Precisa bater com "version" do manifest.

Opcional
  --canal estavel|canario  Padrão: estavel.
  --percentual <0-100>     Fatia do canário. Só com --canal canario.
                           Sem isto, usa ${CHAVE_CANARIO} da tabela configuracoes.
  --notas "<texto>"        Aparece no cartão "Pacote" da /extensao.
  --obrigatoria            Versões anteriores param de operar até atualizar.
  --rascunho               Grava o pacote SEM publicar (publicada_em nulo).
  --substituir             Troca o binário de uma versão já publicada. Ver aviso.
  --confirmar-dominios     Segue mesmo com domínio de terceiro no pacote.
  --salvar <arquivo.zip>   Grava em disco o ZIP montado, para conferência.
  --seco                   Valida e relata, sem tocar no banco.
  --ajuda                  Isto aqui.
`;

// -----------------------------------------------------------------------------
// ZIP — escrita
// -----------------------------------------------------------------------------

// 1º de janeiro de 2020 em formato MS-DOS. Fixo para o ZIP ser determinístico.
const DOS_DATA = ((2020 - 1980) << 9) | (1 << 5) | 1;
const DOS_HORA = 0;

/** `zlib.crc32` chegou no Node 22.2. O engines diz >=22, então a tabela é o seguro. */
const crc32 =
  zlib.crc32 ??
  (() => {
    const tabela = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabela[n] = c;
    }
    return (buf) => {
      let c = -1;
      for (let i = 0; i < buf.length; i += 1) c = tabela[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
      return (c ^ -1) >>> 0;
    };
  })();

function ziparEntradas(entradas) {
  const ordenadas = [...entradas].sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
  const corpo = [];
  const diretorio = [];
  let deslocamento = 0;

  for (const { nome, dados } of ordenadas) {
    const nomeBuf = Buffer.from(nome, "utf8");
    const crc = crc32(dados);

    // Deflate que cresce o arquivo (PNG, MP3, qualquer coisa já comprimida) vira
    // método 0 (guardar). O ZIP fica menor e o teto de 8 MB agradece.
    let metodo = 8;
    let comprimido = dados.length ? zlib.deflateRawSync(dados, { level: 9 }) : Buffer.alloc(0);
    if (comprimido.length >= dados.length) {
      metodo = 0;
      comprimido = dados;
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // assinatura do cabeçalho local
    local.writeUInt16LE(20, 4); // versão necessária: 2.0 (deflate)
    local.writeUInt16LE(0x0800, 6); // bit 11: nome em UTF-8
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(DOS_HORA, 10);
    local.writeUInt16LE(DOS_DATA, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    local.writeUInt16LE(0, 28); // sem campo extra

    corpo.push(local, nomeBuf, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // assinatura do diretório central
    central.writeUInt16LE(20, 4); // versão de quem criou
    central.writeUInt16LE(20, 6); // versão necessária
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt16LE(DOS_HORA, 12);
    central.writeUInt16LE(DOS_DATA, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nomeBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comentário
    central.writeUInt16LE(0, 34); // disco
    central.writeUInt16LE(0, 36); // atributos internos
    // Atributos externos: arquivo comum 0644. O `>>> 0` não é enfeite — em JS o
    // `<<` trabalha em int32 com sinal, e 0o100644 << 16 estoura para negativo.
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(deslocamento, 42);

    diretorio.push(central, nomeBuf);
    deslocamento += local.length + nomeBuf.length + comprimido.length;
  }

  const dir = Buffer.concat(diretorio);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(0, 4); // disco atual
  fim.writeUInt16LE(0, 6); // disco do diretório
  fim.writeUInt16LE(ordenadas.length, 8);
  fim.writeUInt16LE(ordenadas.length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  fim.writeUInt16LE(0, 20); // sem comentário

  return Buffer.concat([...corpo, dir, fim]);
}

// -----------------------------------------------------------------------------
// ZIP — leitura (só o que a validação precisa)
// -----------------------------------------------------------------------------

function lerZip(buf) {
  // O registro de fim tem tamanho variável por causa do comentário, então é
  // procurado de trás para frente. 65535 + 22 é o máximo que ele pode estar
  // longe do fim do arquivo.
  let fim = -1;
  const limite = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= limite; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim === -1) throw new Error("Não parece um ZIP: registro de fim não encontrado.");

  const total = buf.readUInt16LE(fim + 10);
  const inicioDir = buf.readUInt32LE(fim + 16);
  if (total > TETO_ENTRADAS) throw new Error(`ZIP com ${total} entradas; o teto aqui é ${TETO_ENTRADAS}.`);

  const entradas = [];
  let cursor = inicioDir;
  let descomprimido = 0;

  for (let n = 0; n < total; n += 1) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Diretório central corrompido.");
    }
    const metodo = buf.readUInt16LE(cursor + 10);
    const tamanhoComprimido = buf.readUInt32LE(cursor + 20);
    const tamanhoCru = buf.readUInt32LE(cursor + 24);
    const nomeLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const comentarioLen = buf.readUInt16LE(cursor + 32);
    const deslocamento = buf.readUInt32LE(cursor + 42);
    const nome = buf.toString("utf8", cursor + 46, cursor + 46 + nomeLen);

    cursor += 46 + nomeLen + extraLen + comentarioLen;

    // Diretório-entrada não tem conteúdo e não interessa a nada aqui.
    if (nome.endsWith("/")) continue;

    descomprimido += tamanhoCru;
    if (descomprimido > TETO_DESCOMPRIMIDO) {
      throw new Error("ZIP descomprime para mais de 64 MB. Recusado antes de virar problema de memória.");
    }

    // O campo extra do cabeçalho LOCAL costuma diferir do central — por isso o
    // salto é recalculado aqui, e não reaproveitado de cima.
    if (buf.readUInt32LE(deslocamento) !== 0x04034b50) {
      throw new Error(`Cabeçalho local inválido em "${nome}".`);
    }
    const nomeLocal = buf.readUInt16LE(deslocamento + 26);
    const extraLocal = buf.readUInt16LE(deslocamento + 28);
    const inicio = deslocamento + 30 + nomeLocal + extraLocal;
    const bruto = buf.subarray(inicio, inicio + tamanhoComprimido);

    let dados;
    if (metodo === 0) dados = Buffer.from(bruto);
    else if (metodo === 8) dados = zlib.inflateRawSync(bruto);
    else throw new Error(`"${nome}" usa o método de compressão ${metodo}, que não sabemos ler.`);

    entradas.push({ nome, dados });
  }

  return entradas;
}

// -----------------------------------------------------------------------------
// Pasta -> entradas
// -----------------------------------------------------------------------------

async function lerPasta(caminho) {
  const entradas = [];
  const recusados = [];

  async function percorrer(atual) {
    for (const item of await readdir(atual, { withFileTypes: true })) {
      const cheio = join(atual, item.name);

      if (item.isDirectory()) {
        if (PASTAS_IGNORADAS.has(item.name)) continue;
        await percorrer(cheio);
        continue;
      }
      if (!item.isFile()) continue;
      if (ARQUIVOS_IGNORADOS.has(item.name)) continue;

      const minusculo = item.name.toLowerCase();
      if (NUNCA_EMPACOTAR.some((ext) => minusculo.endsWith(ext))) {
        recusados.push(relative(caminho, cheio));
        continue;
      }

      // Nome dentro do ZIP é sempre com barra normal, mesmo vindo do Windows:
      // o formato manda, e o Chrome não abre caminho com contrabarra.
      const nome = relative(caminho, cheio).split(sep).join("/");
      entradas.push({ nome, dados: await readFile(cheio) });
    }
  }

  await percorrer(caminho);
  return { entradas, recusados };
}

// -----------------------------------------------------------------------------
// Validações
// -----------------------------------------------------------------------------

/** Chrome aceita de 1 a 4 componentes; a nossa tabela exige 3. Compara em terreno comum. */
function normalizarVersao(valor) {
  const partes = String(valor).trim().split(".");
  if (partes.length > 4 || partes.some((p) => !/^\d+$/.test(p))) return null;
  while (partes.length < 4) partes.push("0");
  return partes.map((p) => String(Number(p))).join(".");
}

function validarManifest(entradas, versaoPedida) {
  const manifest = entradas.find((e) => e.nome === "manifest.json");
  if (!manifest) {
    // Quase sempre é a pasta errada: apontaram para o pai da pasta da extensão.
    const candidato = entradas.find((e) => e.nome.endsWith("/manifest.json"));
    throw new Error(
      candidato
        ? `Não há manifest.json na RAIZ do pacote — achei em "${candidato.nome}". ` +
          `Aponte --pasta para ${dirname(candidato.nome)}, não para o pai dela.`
        : "Não há manifest.json no pacote. Sem manifest não é extensão, é uma pasta de arquivos.",
    );
  }

  let json;
  try {
    json = JSON.parse(manifest.dados.toString("utf8"));
  } catch (erro) {
    throw new Error(`manifest.json não é JSON válido: ${erro.message}`);
  }

  if (json.manifest_version !== 3) {
    throw new Error(
      `manifest_version é ${JSON.stringify(json.manifest_version)}; exigimos 3. ` +
        "O Chrome parou de aceitar MV2, e publicar MV2 é publicar algo que não instala.",
    );
  }

  const noManifest = normalizarVersao(json.version);
  const pedida = normalizarVersao(versaoPedida);
  if (!noManifest) {
    throw new Error(`"version" do manifest (${JSON.stringify(json.version)}) não é uma versão válida.`);
  }
  if (noManifest !== pedida) {
    // As duas aparecem juntas porque o erro é sempre "esqueci de subir uma das
    // duas", e ver qual ficou para trás resolve em um segundo.
    throw new Error(
      `A versão do manifest e a passada em --versao não batem:\n` +
        `      manifest.json  version = ${json.version}\n` +
        `      --versao                 ${versaoPedida}\n` +
        "    Suba a que ficou para trás e rode de novo.",
    );
  }

  if (!json.name || typeof json.name !== "string") {
    throw new Error('manifest.json sem "name". O Chrome recusa a instalação.');
  }

  return json;
}

function hostDe(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function classificar(host, nossos) {
  if (HOSTS_LOCAIS.includes(host)) return "local";
  if (nossos.includes(host)) return "nosso";
  // Sufixo por rótulo, nunca `includes`: "tiktok.com.exemplo.net" é de outra
  // pessoa e precisa cair em "terceiro".
  if (HOSTS_ALVO.some((a) => host === a || host.endsWith(`.${a}`))) return "alvo";
  return "terceiro";
}

function varrerDominios(entradas) {
  const nossos = [];
  const site = hostDe(process.env.NEXT_PUBLIC_SITE_URL ?? "");
  if (site) nossos.push(site);
  if (process.env.RAILWAY_PUBLIC_DOMAIN) nossos.push(process.env.RAILWAY_PUBLIC_DOMAIN.toLowerCase());

  const achados = new Map(); // host -> Set(arquivos)

  for (const { nome, dados } of entradas) {
    const ponto = nome.lastIndexOf(".");
    const ext = ponto === -1 ? "" : nome.slice(ponto).toLowerCase();
    if (!EXTENSOES_VARRIDAS.has(ext)) continue;

    const texto = dados.toString("utf8");
    // Também pega "*://*.tiktok.com/*" de host_permissions: o `*://` casa com
    // o esquema opcional e o host vem logo depois.
    for (const achado of texto.matchAll(/(?:https?|\*):\/\/([^\s"'`<>\\)\]}(,;]+)/gi)) {
      const host = hostDe(`https://${achado[1].replace(/^\*\./, "")}`);
      // Sem ponto quase sempre é ruído do regex ("https://" solto, caminho
      // relativo). `localhost` é a exceção legítima, e some da lista se cair no
      // filtro genérico.
      if (!host || (!host.includes(".") && !HOSTS_LOCAIS.includes(host))) continue;
      if (!achados.has(host)) achados.set(host, new Set());
      achados.get(host).add(nome);
    }
  }

  const grupos = { nosso: [], local: [], alvo: [], terceiro: [] };
  for (const [host, arquivos] of [...achados].sort()) {
    grupos[classificar(host, nossos)].push({ host, arquivos: [...arquivos].sort() });
  }
  return grupos;
}

// -----------------------------------------------------------------------------
// Formatação
// -----------------------------------------------------------------------------

function tamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function falhar(mensagem) {
  console.error(`\n✗ ${mensagem}\n`);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Programa
// -----------------------------------------------------------------------------

const { opcoes } = lerArgumentos(process.argv.slice(2));

if (opcoes.ajuda || opcoes.h || process.argv.length <= 2) {
  console.log(AJUDA);
  process.exit(0);
}

// --- origem ------------------------------------------------------------------

if (Boolean(opcoes.pasta) === Boolean(opcoes.zip)) {
  falhar("Escolha uma origem: --pasta <caminho> OU --zip <arquivo.zip>.");
}

const versao = typeof opcoes.versao === "string" ? opcoes.versao.trim() : "";
if (!VERSAO_VALIDA.test(versao)) {
  falhar(
    `--versao "${versao || "(vazio)"}" fora do formato. A coluna ext_versoes.versao exige x.y.z ` +
      "(até 3, 3 e 4 dígitos). Exemplo: 1.0.0.",
  );
}

const canal = typeof opcoes.canal === "string" ? opcoes.canal.trim() : "estavel";
if (canal !== "estavel" && canal !== "canario") {
  falhar(`--canal "${canal}" não existe. Os valores do enum canal_extensao são: estavel, canario.`);
}

if (opcoes.percentual !== undefined && canal !== "canario") {
  falhar(
    "--percentual só faz sentido com --canal canario. O CHECK ext_versoes_canario_tem_fatia " +
      "recusa fatia em versão estável: estável é para todos, por definição.",
  );
}

let percentual = null;
if (opcoes.percentual !== undefined) {
  percentual = Number(opcoes.percentual);
  if (!Number.isInteger(percentual) || percentual < 0 || percentual > 100) {
    falhar("--percentual precisa ser um inteiro de 0 a 100.");
  }
}

const notas = typeof opcoes.notas === "string" ? opcoes.notas.trim() || null : null;
const obrigatoria = opcoes.obrigatoria === true || opcoes.obrigatoria === "true";
const rascunho = opcoes.rascunho === true || opcoes.rascunho === "true";
const substituir = opcoes.substituir === true || opcoes.substituir === "true";
const confirmarDominios = opcoes.confirmar_dominios === true || opcoes.confirmar_dominios === "true";
const seco = opcoes.seco === true || opcoes.seco === "true";

// --- montar o pacote ---------------------------------------------------------

let zip;
let entradas;
let recusados = [];

try {
  if (opcoes.pasta) {
    const pasta = resolve(String(opcoes.pasta));
    const info = await stat(pasta).catch(() => null);
    if (!info?.isDirectory()) falhar(`--pasta "${pasta}" não é uma pasta.`);

    console.log(`\nLendo ${pasta}`);
    ({ entradas, recusados } = await lerPasta(pasta));
    if (entradas.length === 0) falhar("A pasta está vazia.");
    if (entradas.length > TETO_ENTRADAS) falhar(`${entradas.length} arquivos; o teto aqui é ${TETO_ENTRADAS}.`);

    zip = ziparEntradas(entradas);
  } else {
    const caminho = resolve(String(opcoes.zip));
    const info = await stat(caminho).catch(() => null);
    if (!info?.isFile()) falhar(`--zip "${caminho}" não é um arquivo.`);

    console.log(`\nLendo ${caminho}`);
    zip = await readFile(caminho);
    // Mesmo com o ZIP pronto, o conteúdo é lido: manifest e domínios passam
    // pelas mesmas checagens que --pasta sofre.
    entradas = lerZip(zip);
    if (entradas.length === 0) falhar("O ZIP não tem nenhum arquivo dentro.");

    const proibidos = entradas.filter((e) =>
      NUNCA_EMPACOTAR.some((ext) => e.nome.toLowerCase().endsWith(ext)),
    );
    if (proibidos.length > 0) {
      falhar(
        `O ZIP carrega arquivo que nunca deve ser publicado: ${proibidos.map((e) => e.nome).join(", ")}. ` +
          "Chave de assinatura publicada é chave perdida — remonte o pacote sem ela.",
      );
    }
  }
} catch (erro) {
  falhar(erro.message);
}

if (recusados.length > 0) {
  console.log(`\n⚠  Ficaram DE FORA do pacote (chave de assinatura e sobra de build):`);
  for (const r of recusados) console.log(`     ${r}`);
}

// --- validar -----------------------------------------------------------------

let manifest;
try {
  manifest = validarManifest(entradas, versao);
} catch (erro) {
  falhar(erro.message);
}

console.log(`\n  manifest     ${manifest.name} v${manifest.version} (MV${manifest.manifest_version})`);
console.log(`  arquivos     ${entradas.length}`);
console.log(`  pacote       ${tamanho(zip.length)} (${zip.length} bytes)`);

if (zip.length > TETO_BYTES) {
  const maiores = [...entradas]
    .sort((a, b) => b.dados.length - a.dados.length)
    .slice(0, 5)
    .map((e) => `       ${tamanho(e.dados.length).padStart(9)}  ${e.nome}`)
    .join("\n");

  falhar(
    `O ZIP tem ${tamanho(zip.length)} e o teto por linha da tabela arquivos é 8 MB ` +
      "(constraint arquivos_tamanho_por_linha).\n" +
      "    Os cinco arquivos maiores do pacote:\n" +
      `${maiores}\n\n` +
      "    Caminhos: tirar mídia pesada de dentro da extensão (áudio e vídeo podem ser\n" +
      "    baixados sob demanda pela própria extensão), ou mudar `arquivos.provedor` para\n" +
      "    R2 e guardar o binário lá — o schema já prevê os dois.",
  );
}

// --- domínios ----------------------------------------------------------------

const grupos = varrerDominios(entradas);
const mostrar = (rotulo, lista) => {
  if (lista.length === 0) return;
  console.log(`\n  ${rotulo}`);
  for (const { host, arquivos } of lista) {
    const onde = arquivos.slice(0, 3).join(", ") + (arquivos.length > 3 ? `, +${arquivos.length - 3}` : "");
    console.log(`     ${host}  —  ${onde}`);
  }
};

mostrar("Domínios nossos", grupos.nosso);
mostrar("Domínios locais", grupos.local);
mostrar("Domínios do alvo (TikTok)", grupos.alvo);

if (grupos.terceiro.length > 0) {
  mostrar("⚠  DOMÍNIOS DE TERCEIRO", grupos.terceiro);
  console.log(
    "\n  Um pacote que fala com servidor de outra empresa manda a credencial do NOSSO\n" +
      "  cliente para lá — token, e-mail, o que estiver no caminho. Se algum destes\n" +
      "  domínios não deveria estar aqui, o pacote está errado, não a checagem.",
  );
  if (!confirmarDominios) {
    falhar(
      "Publicação interrompida por domínio de terceiro. Se os domínios acima são mesmo " +
        "esperados, repita o comando com --confirmar-dominios.",
    );
  }
  console.log("\n  --confirmar-dominios passado: seguindo mesmo assim.");
}

// --- ZIP em disco, quando pedido ---------------------------------------------

const sha = createHash("sha256").update(zip).digest();
const shaHex = sha.toString("hex");
console.log(`  sha256       ${shaHex}`);

if (typeof opcoes.salvar === "string") {
  await writeFile(resolve(opcoes.salvar), zip);
  console.log(`  salvo em     ${resolve(opcoes.salvar)}`);
}

if (seco) {
  console.log("\n--seco: nada foi gravado. O pacote passou em todas as validações.\n");
  process.exit(0);
}

// --- banco -------------------------------------------------------------------

const url = process.env.DATABASE_URL;
if (!url) falhar("DATABASE_URL não definida. Sem banco não há onde publicar.");

const sql = postgres(url, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 30,
  ssl: process.env.DATABASE_SSL === "require" ? "require" : false,
  onnotice: () => {},
});

let resultado;

try {
  if (canal === "canario" && percentual === null) {
    const linhas = await sql`
      select (valor #>> '{}')::int as valor from configuracoes where chave = ${CHAVE_CANARIO}
    `;
    percentual = linhas[0]?.valor ?? 5;
    console.log(`\n  fatia        ${percentual}% (padrão de ${CHAVE_CANARIO})`);
  }

  resultado = await sql.begin(async (tx) => {
    const [existente] = await tx`
      select v.id, v.arquivo_id, v.publicada_em, v.kill_switch,
             a.sha256, a.estado, a.bytes
        from ext_versoes v
        left join arquivos a on a.id = v.arquivo_id
       where v.versao = ${versao}
    `;

    const mesmoPacote =
      existente?.sha256 != null &&
      existente.estado === "pronto" &&
      Buffer.compare(Buffer.from(existente.sha256), sha) === 0;

    // Idempotência: o mesmo binário sob o mesmo número não gera linha nova em
    // `arquivos` nem em `ext_versoes`. Só os metadados alcançam a linha.
    if (existente && mesmoPacote) {
      // `--rascunho` numa versão que já está no ar NÃO a tira do ar: despublicar
      // é operação de incidente (é para isso que existe o kill switch, que
      // manda quem já baixou parar), não efeito colateral de um flag de upload.
      const quandoPublicar = rascunho ? tx`publicada_em` : tx`coalesce(publicada_em, now())`;

      const [linha] = await tx`
        update ext_versoes
           set canal              = ${canal},
               percentual_canario = ${canal === "canario" ? percentual : null},
               notas              = coalesce(${notas}, notas),
               obrigatoria        = ${obrigatoria},
               publicada_em       = ${quandoPublicar}
         where id = ${existente.id}
        returning versao, publicada_em
      `;
      return {
        acao: "inalterada",
        arquivoId: existente.arquivo_id,
        publicadaEm: linha.publicada_em,
        killSwitch: existente.kill_switch === true,
      };
    }

    // Binário diferente sob um número já publicado é o pior estado possível:
    // duas máquinas dizem rodar a v1.0.0 e rodam bytes diferentes, e a
    // telemetria (que agrupa por `versao`) passa a misturar as duas. Só com
    // --substituir, e de olho aberto.
    if (existente && existente.sha256 != null && existente.estado === "pronto" && !substituir) {
      // Sugestão de número, só quando o incremento ainda cabe no CHECK da coluna.
      const candidata = versao.replace(/(\d+)$/, (n) => String(Number(n) + 1));
      const proxima = VERSAO_VALIDA.test(candidata) ? candidata : null;

      throw new Error(
        `A v${versao} já está publicada com OUTRO pacote.\n` +
          `      no banco  sha256 ${Buffer.from(existente.sha256).toString("hex")}\n` +
          `      aqui      sha256 ${shaHex}\n` +
          `    Publique com número novo${proxima ? ` (v${proxima}, por exemplo)` : ""}: é o que mantém a telemetria\n` +
          "    honesta — ela agrupa por `versao`, e duas máquinas dizendo rodar a mesma\n" +
          "    versão com binários diferentes misturam as duas séries. Se for mesmo para\n" +
          "    trocar o binário no lugar, repita com --substituir.",
      );
    }

    const [arquivo] = await tx`
      insert into arquivos (perfil_id, provedor, conteudo, mime, bytes, sha256, estado, metadados)
      values (
        null, 'postgres', ${zip}, 'application/zip', ${zip.length}, ${sha}, 'pronto',
        ${tx.json({
          tipo: "extensao",
          versao,
          canal,
          manifest_nome: manifest.name,
          arquivos: entradas.length,
          sha256: shaHex,
        })}
      )
      returning id
    `;

    if (!existente) {
      const [linha] = await tx`
        insert into ext_versoes (versao, canal, arquivo_id, notas, obrigatoria, percentual_canario, publicada_em)
        values (
          ${versao}, ${canal}, ${arquivo.id}, ${notas}, ${obrigatoria},
          ${canal === "canario" ? percentual : null},
          ${rascunho ? null : tx`now()`}
        )
        returning publicada_em
      `;
      return {
        acao: "publicada",
        arquivoId: arquivo.id,
        publicadaEm: linha.publicada_em,
        killSwitch: false,
      };
    }

    const [linha] = await tx`
      update ext_versoes
         set arquivo_id         = ${arquivo.id},
             canal              = ${canal},
             percentual_canario = ${canal === "canario" ? percentual : null},
             notas              = coalesce(${notas}, notas),
             obrigatoria        = ${obrigatoria},
             publicada_em       = ${rascunho ? tx`publicada_em` : tx`coalesce(publicada_em, now())`}
       where id = ${existente.id}
      returning publicada_em
    `;

    // O binário antigo sai de cena, mas a LINHA fica: `arquivo_id` é
    // `on delete restrict`, e o histórico de quem baixou o quê não some porque
    // republicamos. `remover()` (src/lib/armazenamento.ts) faz o mesmo.
    if (existente.arquivo_id) {
      await tx`
        update arquivos
           set estado = 'removido', removido_em = now(), conteudo = null
         where id = ${existente.arquivo_id} and removido_em is null
      `;
    }

    return {
      acao:
        existente.sha256 == null || existente.estado !== "pronto"
          ? "pacote_anexado"
          : "substituida",
      arquivoId: arquivo.id,
      publicadaEm: linha.publicada_em,
      anterior: existente.arquivo_id,
      killSwitch: existente.kill_switch === true,
    };
  });
} catch (erro) {
  await sql.end();
  falhar(erro.message);
}

await sql.end();

// --- relatório ---------------------------------------------------------------

const ACOES = {
  publicada: "Publicada",
  substituida: "Binário substituído",
  pacote_anexado: "Pacote anexado a uma versão que já existia",
  inalterada: "Já estava publicada com este mesmo pacote — nada duplicado",
};

console.log(`\n✓ ${ACOES[resultado.acao]}: v${versao}\n`);
console.log(`  versão       ${versao}`);
console.log(
  `  canal        ${canal === "canario" ? `canário · ${percentual}% da base (por hash da licença)` : "estável · toda a base"}`,
);
console.log(`  tamanho      ${tamanho(zip.length)} (${zip.length} bytes, ${entradas.length} arquivos)`);
console.log(`  arquivo_id   ${resultado.arquivoId}`);
console.log(`  estado       ${resultado.publicadaEm ? `no ar desde ${new Date(resultado.publicadaEm).toISOString()}` : "RASCUNHO — gravada, mas fora do ar"}`);
if (resultado.anterior) console.log(`  substituiu   arquivo ${resultado.anterior} (marcado como removido)`);

console.log("\nO que a /extensao passa a mostrar:");

if (resultado.killSwitch) {
  // Republicar não desarma o kill switch de propósito: quem apertou o freio
  // apertou por um motivo, e o motivo não some porque um pacote novo subiu.
  console.log(
    `  · NADA. A v${versao} está com kill_switch ligado, e a tela só lê versão no ar.\n` +
      `    Quando o motivo do freio estiver resolvido:\n` +
      `      update ext_versoes set kill_switch = false, kill_motivo = null where versao = '${versao}';`,
  );
} else if (!resultado.publicadaEm) {
  console.log(
    "  · nada ainda. `publicada_em` está nulo, e a tela só lê versão publicada.\n" +
      `    Para pôr no ar:  update ext_versoes set publicada_em = now() where versao = '${versao}';`,
  );
} else {
  const badge = canal === "canario" ? `v${versao} · canário` : `v${versao}`;
  console.log(`  · o selo do topo vira "${badge}", no lugar de "Ainda não publicada";`);
  console.log(
    `  · a abertura troca "O pacote ainda não foi publicado" pela área de download${notas ? `\n    e mostra as notas em "O que mudou"` : ""};`,
  );
  console.log(
    '  · o roteiro de instalação perde o aviso de que "estes passos valem a partir\n' +
      '    do momento em que o pacote existir";',
  );
  console.log('  · a lista de recursos sai de "em breve" e passa a refletir o plano de cada conta;');

  if (process.env.EXTENSAO_SEGREDO) {
    console.log(`  · o botão "Baixar a extensão (v${versao})" fica ativo (ticket HMAC de 15 min).`);
  } else {
    console.log(
      '  · o botão "Baixar a extensão" fica DESLIGADO: falta EXTENSAO_SEGREDO no ambiente,\n' +
        "    que é o que assina o link temporário. A tela explica isso ao usuário.",
    );
  }

  if (canal === "canario") {
    console.log(
      `  · só quem cai na fatia de ${percentual}% (ou tem ext_licencas.canal = 'canario') recebe;\n` +
        "    para os outros, a última estável continua sendo a versão do dia.",
    );
  }
  if (obrigatoria) {
    console.log("  · alerta de atualização obrigatória: versões anteriores param de operar.");
  }

  console.log(
    "  · a extensão já instalada recebe a nova versão no próximo heartbeat\n" +
      "    (ext.heartbeat_segundos, semeado em 120s).",
  );
}

console.log("");
