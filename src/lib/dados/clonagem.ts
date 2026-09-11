import "server-only";
import { bd } from "@/lib/db";
import { guardar, remover } from "@/lib/armazenamento";
import { comDemo, numeroDe } from "./comum";
import { ErroDominio, comTraducao } from "./erros";
import { enfileirar } from "./fila";
import type { EstadoJob } from "./tipos";

/**
 * Clonagem de voz — dados.
 *
 * Duas coisas mandam no desenho deste módulo:
 *
 * 1. O CONSENTIMENTO é o produto jurídico, não a voz. A linha de
 *    `vozes_amostras` guarda o texto EXATO que estava na tela, a hora e o IP,
 *    e o banco recusa a amostra que sai de 'enviada' sem esses campos
 *    (constraint `vozes_amostras_consentimento_registrado`, 0009). Por isso o
 *    texto vem daqui — do servidor — e nunca do formulário: se viesse do
 *    cliente, a prova seria escrita por quem ela deveria responsabilizar.
 * 2. Uma clonagem custa dinheiro no provedor. O envio é idempotente pela chave
 *    gerada no render do formulário: duplo clique e F5 no POST devolvem o
 *    MESMO envio em vez de mandar a amostra duas vezes para a ElevenLabs.
 */

export type ModoClonagem = "rapido" | "treino";
export type EstadoAmostra = "enviada" | "processando" | "clonada" | "recusada";
export type GeneroVoz = "feminina" | "masculina" | "neutra";
export type EstadoVoz = "processando" | "pronta" | "falhou";

export type ModoInfo = {
  id: ModoClonagem;
  rotulo: string;
  resumo: string;
  segundosMinimos: number;
  segundosIdeais: number;
};

/**
 * Os dois modos de `vozes_amostras.modo`.
 *
 * O mínimo do modo treino é maior de propósito: amostra curta com promessa de
 * alta fidelidade só entrega decepção depois da espera.
 */
export const MODOS: readonly ModoInfo[] = [
  {
    id: "rapido",
    rotulo: "Rápido",
    resumo:
      "Uma amostra curta e a voz fica pronta em minutos. Fidelidade boa para narrar oferta.",
    segundosMinimos: 15,
    segundosIdeais: 90,
  },
  {
    id: "treino",
    rotulo: "Treino",
    resumo:
      "Manda mais áudio e demora mais, com entonação e sotaque bem mais próximos do original.",
    segundosMinimos: 120,
    segundosIdeais: 600,
  },
] as const;

export function modoInfo(modo: ModoClonagem): ModoInfo {
  return MODOS.find((m) => m.id === modo) ?? MODOS[0]!;
}

/**
 * O texto do aceite.
 *
 * Fica no servidor porque é ele que é gravado em
 * `vozes_amostras.consentimento_texto`. Reescrever este texto NÃO invalida os
 * aceites antigos nem exige migração: cada linha guarda a versão que a pessoa
 * de fato leu.
 */
export const TEXTO_CONSENTIMENTO =
  "Declaro que a voz desta amostra é a minha ou que tenho autorização expressa " +
  "de quem fala nela, e autorizo a Shopia a processar esse áudio para criar uma " +
  "voz sintética e usá-la nas transmissões da minha conta. Entendo que este " +
  "aceite fica registrado com data, hora e endereço de IP, que posso pedir a " +
  "exclusão da voz clonada a qualquer momento, e que clonar a voz de outra " +
  "pessoa sem autorização viola direitos de personalidade e responsabiliza " +
  "esta conta.";

/** Teto de `arquivos_tamanho_por_linha` (0003) e de guardar() — 8 MB. */
export const TETO_BYTES_AMOSTRA = 8 * 1024 * 1024;

/**
 * Piso de bytes. Existe porque a duração nem sempre é medível no servidor (ver
 * `duracaoDeAudio`): mesmo sem saber os segundos, um arquivo de 3 KB não tem
 * fala nenhuma dentro e não pode virar job pago.
 */
export const PISO_BYTES_AMOSTRA = 16 * 1024;

export const FORMATOS_ACEITOS = "MP3, WAV, M4A, OGG, WEBM ou FLAC";

/** Alias do navegador -> o mime que fica gravado em `arquivos.mime`. */
const MIMES_ACEITOS: Record<string, string> = {
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/mp4": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/aac": "audio/aac",
  "audio/ogg": "audio/ogg",
  "audio/opus": "audio/ogg",
  "audio/webm": "audio/webm",
  "audio/flac": "audio/flac",
  "audio/x-flac": "audio/flac",
};

/** Windows manda `application/octet-stream` com frequência; a extensão salva. */
const MIMES_POR_EXTENSAO: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
  flac: "audio/flac",
};

function mimeCanonico(mime: string, nomeArquivo: string): string | null {
  const bruto = mime.split(";")[0]!.trim().toLowerCase();
  const porMime = MIMES_ACEITOS[bruto];
  if (porMime) return porMime;

  const extensao = nomeArquivo.split(".").pop()?.toLowerCase() ?? "";
  return MIMES_POR_EXTENSAO[extensao] ?? null;
}

// -----------------------------------------------------------------------------
// Duração
//
// Sem ffmpeg (a imagem do Nixpacks não traz, ver armazenamento.ts) a duração sai
// do cabeçalho do próprio arquivo. WAV e MP3 dão para ler a custo zero e cobrem
// quase todo envio real; nos outros contêineres a conta cai para o valor que o
// navegador mediu — que é guarda de qualidade, não de segurança, e por isso
// anda junto com o piso de bytes acima.
// -----------------------------------------------------------------------------

function duracaoWav(b: Buffer): number | null {
  if (b.length < 44) return null;
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }

  let posicao = 12;
  let bytesPorSegundo = 0;
  let bytesDeAudio = 0;

  while (posicao + 8 <= b.length) {
    const tipo = b.toString("ascii", posicao, posicao + 4);
    const tamanho = b.readUInt32LE(posicao + 4);

    if (tipo === "fmt " && posicao + 20 <= b.length) {
      bytesPorSegundo = b.readUInt32LE(posicao + 16);
    }
    if (tipo === "data") {
      // Arquivo truncado declara mais do que tem: vale o que chegou.
      bytesDeAudio = Math.min(tamanho, b.length - posicao - 8);
    }

    // Chunk de tamanho ímpar carrega um byte de alinhamento.
    posicao += 8 + tamanho + (tamanho % 2);
  }

  if (bytesPorSegundo <= 0 || bytesDeAudio <= 0) return null;
  return Math.round((bytesDeAudio / bytesPorSegundo) * 1000);
}

const MP3_TAXAS_BITS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_TAXAS_BITS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MP3_TAXAS_AMOSTRA: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

function duracaoMp3(b: Buffer): number | null {
  let inicio = 0;

  // ID3v2: "ID3", versão (2), flags (1) e tamanho em 4 bytes sincrosseguros.
  if (b.length > 10 && b.toString("ascii", 0, 3) === "ID3") {
    inicio =
      10 +
      (((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f));
  }

  let quadro = -1;
  const fim = Math.min(b.length - 4, inicio + 200_000);
  for (let i = Math.max(0, inicio); i < fim; i += 1) {
    if (b[i] === 0xff && (b[i + 1]! & 0xe0) === 0xe0) {
      quadro = i;
      break;
    }
  }
  if (quadro < 0) return null;

  const versao = (b[quadro + 1]! >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const camada = (b[quadro + 1]! >> 1) & 3; // 1 = Layer III
  if (camada !== 1 || versao === 1) return null;

  const taxaAmostra = MP3_TAXAS_AMOSTRA[versao]?.[(b[quadro + 2]! >> 2) & 3];
  const kbps = (versao === 3 ? MP3_TAXAS_BITS_V1 : MP3_TAXAS_BITS_V2)[(b[quadro + 2]! >> 4) & 0xf];
  if (!taxaAmostra || !kbps) return null;

  const amostrasPorQuadro = versao === 3 ? 1152 : 576;

  // Taxa variável: o primeiro quadro traz a contagem total em Xing/Info. Sem
  // isso, VBR daria uma duração errada por um fator grande.
  const cabecalho = b.subarray(quadro, Math.min(quadro + 200, b.length));
  const xing = cabecalho.indexOf("Xing");
  const info = cabecalho.indexOf("Info");
  const marca = xing >= 0 ? xing : info;

  if (marca >= 0 && quadro + marca + 12 <= b.length) {
    const bandeiras = b.readUInt32BE(quadro + marca + 4);
    if (bandeiras & 1) {
      const quadros = b.readUInt32BE(quadro + marca + 8);
      if (quadros > 0) {
        return Math.round(((quadros * amostrasPorQuadro) / taxaAmostra) * 1000);
      }
    }
  }

  // Taxa constante: bits restantes / kbps já dá milissegundos.
  return Math.round(((b.length - quadro) * 8) / kbps);
}

export function duracaoDeAudio(conteudo: Buffer, mime: string): number | null {
  const medida = mime === "audio/wav" ? duracaoWav(conteudo) : duracaoMp3(conteudo);
  return medida && medida > 0 ? medida : null;
}

// -----------------------------------------------------------------------------
// Validação do arquivo enviado
// -----------------------------------------------------------------------------

export type AmostraAnalisada = {
  mime: string;
  duracaoMs: number | null;
  /** true quando a duração saiu do arquivo; false quando veio do navegador. */
  medidaNoServidor: boolean;
};

function mb(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1).replace(".", ",");
}

/**
 * Tipo, tamanho e duração mínima — tudo no servidor.
 *
 * A mesma checagem roda no navegador antes do upload, mas só para o usuário
 * descobrir o problema sem esperar 8 MB subirem. Quem decide é esta função.
 */
export function analisarAmostra(opcoes: {
  conteudo: Buffer;
  nomeArquivo: string;
  mime: string;
  modo: ModoClonagem;
  duracaoInformadaMs: number | null;
}): AmostraAnalisada {
  const bytes = opcoes.conteudo.byteLength;

  if (bytes === 0) {
    throw new ErroDominio("dado_invalido", "O arquivo chegou vazio. Escolha a amostra de novo.");
  }

  if (bytes > TETO_BYTES_AMOSTRA) {
    throw new ErroDominio(
      "dado_invalido",
      `A amostra tem ${mb(bytes)} MB e o teto é 8 MB por arquivo. ` +
        "Corte um trecho ou exporte em MP3 de 128 kbps.",
    );
  }

  if (bytes < PISO_BYTES_AMOSTRA) {
    throw new ErroDominio(
      "dado_invalido",
      "O arquivo é pequeno demais para conter fala suficiente. Grave uma amostra maior.",
    );
  }

  const mime = mimeCanonico(opcoes.mime, opcoes.nomeArquivo);
  if (!mime) {
    throw new ErroDominio(
      "dado_invalido",
      `Formato não aceito. Envie ${FORMATOS_ACEITOS}.`,
    );
  }

  const medida = duracaoDeAudio(opcoes.conteudo, mime);
  const duracaoMs = medida ?? opcoes.duracaoInformadaMs;
  const modo = modoInfo(opcoes.modo);
  const minimoMs = modo.segundosMinimos * 1000;

  if (duracaoMs !== null && duracaoMs < minimoMs) {
    throw new ErroDominio(
      "dado_invalido",
      `O modo ${modo.rotulo.toLowerCase()} precisa de pelo menos ` +
        `${modo.segundosMinimos} segundos de áudio. Esta amostra tem ` +
        `${Math.round(duracaoMs / 1000)}.`,
    );
  }

  return { mime, duracaoMs, medidaNoServidor: medida !== null };
}

// -----------------------------------------------------------------------------
// Leitura
// -----------------------------------------------------------------------------

export type AmostraVoz = {
  id: string;
  nome: string;
  modo: ModoClonagem;
  estado: EstadoAmostra;
  erro: string | null;
  duracaoMs: number | null;
  bytes: number;
  audioApagado: boolean;
  vozId: string | null;
  vozNome: string | null;
  estadoJob: EstadoJob | null;
  progresso: number;
  consentimentoEm: string | null;
  criadoEm: string;
};

type LinhaAmostra = {
  id: string;
  nome: string;
  modo: ModoClonagem;
  estado: EstadoAmostra;
  erro: string | null;
  duracao_ms: number | null;
  bytes: string | null;
  audio_apagado: boolean;
  voz_id: string | null;
  voz_nome: string | null;
  job_estado: EstadoJob | null;
  job_progresso: number | null;
  consentimento_em: Date | null;
  criado_em: Date;
};

function paraAmostra(l: LinhaAmostra): AmostraVoz {
  return {
    id: l.id,
    nome: l.nome,
    modo: l.modo,
    estado: l.estado,
    erro: l.erro,
    duracaoMs: l.duracao_ms,
    bytes: numeroDe(l.bytes),
    audioApagado: l.audio_apagado,
    vozId: l.voz_id,
    vozNome: l.voz_nome,
    estadoJob: l.job_estado,
    progresso: l.job_progresso ?? 0,
    consentimentoEm: l.consentimento_em?.toISOString() ?? null,
    criadoEm: l.criado_em.toISOString(),
  };
}

const AGORA = new Date();
const antes = (minutos: number) => new Date(AGORA.getTime() - minutos * 60_000).toISOString();

const AMOSTRAS_EXEMPLO: AmostraVoz[] = [
  {
    id: "00000000-0000-4000-8000-00000000c101",
    nome: "Minha voz — estúdio",
    modo: "treino",
    estado: "clonada",
    erro: null,
    duracaoMs: 214_000,
    bytes: 3_412_992,
    audioApagado: false,
    vozId: "00000000-0000-4000-8000-00000000c901",
    vozNome: "Minha voz — estúdio",
    estadoJob: "concluido",
    progresso: 100,
    consentimentoEm: antes(2880),
    criadoEm: antes(2882),
  },
  {
    id: "00000000-0000-4000-8000-00000000c102",
    nome: "Voz do celular",
    modo: "rapido",
    estado: "processando",
    erro: null,
    duracaoMs: 47_000,
    bytes: 754_176,
    audioApagado: false,
    vozId: null,
    vozNome: null,
    estadoJob: "processando",
    progresso: 45,
    consentimentoEm: antes(3),
    criadoEm: antes(3),
  },
];

export async function listarAmostras(perfilId: string, limite = 12): Promise<AmostraVoz[]> {
  return comDemo(
    () => AMOSTRAS_EXEMPLO,
    async () => {
      const linhas = await bd()<LinhaAmostra[]>`
        select a.id,
               a.nome,
               a.modo,
               a.estado,
               a.erro,
               a.duracao_ms,
               arq.bytes,
               (arq.id is null or arq.removido_em is not null) as audio_apagado,
               a.voz_id,
               v.nome as voz_nome,
               j.estado as job_estado,
               j.progresso as job_progresso,
               a.consentimento_em,
               a.criado_em
          from vozes_amostras a
          left join arquivos arq on arq.id = a.arquivo_id
          left join vozes v on v.id = a.voz_id and v.perfil_id = a.perfil_id
          left join jobs j on j.id = a.job_id and j.perfil_id = a.perfil_id
         where a.perfil_id = ${perfilId}
         order by a.criado_em desc
         limit ${limite}
      `;
      return linhas.map(paraAmostra);
    },
  );
}

export type VozClonada = {
  id: string;
  nome: string;
  descricao: string | null;
  estado: EstadoVoz;
  idioma: string;
  genero: GeneroVoz;
  ativa: boolean;
  criadoEm: string;
};

const VOZES_EXEMPLO: VozClonada[] = [
  {
    id: "00000000-0000-4000-8000-00000000c901",
    nome: "Minha voz — estúdio",
    descricao: "Clonada a partir de 3min41 de gravação limpa.",
    estado: "pronta",
    idioma: "pt-BR",
    genero: "feminina",
    ativa: true,
    criadoEm: antes(2875),
  },
];

export async function listarVozesClonadas(perfilId: string, limite = 12): Promise<VozClonada[]> {
  return comDemo(
    () => VOZES_EXEMPLO,
    async () => {
      const linhas = await bd()<
        {
          id: string;
          nome: string;
          descricao: string | null;
          estado: EstadoVoz;
          idioma: string;
          genero: GeneroVoz;
          ativa: boolean;
          criado_em: Date;
        }[]
      >`
        select id, nome, descricao, estado, idioma, genero, ativa, criado_em
          from vozes
         where perfil_id = ${perfilId} and origem = 'clonada'
         order by criado_em desc
         limit ${limite}
      `;

      return linhas.map((l) => ({
        id: l.id,
        nome: l.nome,
        descricao: l.descricao,
        estado: l.estado,
        idioma: l.idioma,
        genero: l.genero,
        ativa: l.ativa,
        criadoEm: l.criado_em.toISOString(),
      }));
    },
  );
}

export type Idioma = { codigo: string; nome: string; bandeira: string };

/** Os mesmos 10 que 0004 semeia — repetidos aqui só para o modo demo. */
const IDIOMAS_EXEMPLO: Idioma[] = [
  { codigo: "pt-BR", nome: "Português (Brasil)", bandeira: "🇧🇷" },
  { codigo: "en", nome: "Inglês", bandeira: "🇺🇸" },
  { codigo: "es", nome: "Espanhol", bandeira: "🇪🇸" },
  { codigo: "fr", nome: "Francês", bandeira: "🇫🇷" },
  { codigo: "de", nome: "Alemão", bandeira: "🇩🇪" },
  { codigo: "it", nome: "Italiano", bandeira: "🇮🇹" },
  { codigo: "ja", nome: "Japonês", bandeira: "🇯🇵" },
  { codigo: "ko", nome: "Coreano", bandeira: "🇰🇷" },
  { codigo: "zh", nome: "Chinês", bandeira: "🇨🇳" },
  { codigo: "ar", nome: "Árabe", bandeira: "🇸🇦" },
];

export async function listarIdiomas(): Promise<Idioma[]> {
  return comDemo(
    () => IDIOMAS_EXEMPLO,
    async () => {
      const linhas = await bd()<Idioma[]>`
        select codigo, nome, bandeira from idiomas order by ordem
      `;
      return linhas.length > 0 ? linhas : IDIOMAS_EXEMPLO;
    },
  );
}

// -----------------------------------------------------------------------------
// Escrita
// -----------------------------------------------------------------------------

/**
 * Teto de envios por hora.
 *
 * Cada envio vira uma chamada paga no provedor; sem teto, um script deixa a
 * conta negativa antes de alguém acordar.
 */
const ENVIOS_POR_HORA = 5;

export async function podeEnviarAmostra(perfilId: string): Promise<boolean> {
  const linhas = await bd()<{ ok: boolean }[]>`
    select consumir_limite(${`clonagem:${perfilId}`}, ${ENVIOS_POR_HORA}, 3600) as ok
  `;
  return linhas[0]?.ok ?? false;
}

async function envioDaChave(perfilId: string, chave: string) {
  const linhas = await bd()<{ amostra_id: string; job_id: string }[]>`
    select a.id as amostra_id, j.id as job_id
      from jobs j
      join vozes_amostras a on a.job_id = j.id and a.perfil_id = ${perfilId}
     where j.tipo = 'clonagem' and j.chave_idempotencia = ${chave}
  `;
  const l = linhas[0];
  return l ? { amostraId: l.amostra_id, jobId: l.job_id } : null;
}

export type NovaAmostra = {
  nome: string;
  modo: ModoClonagem;
  idioma: string;
  genero: GeneroVoz;
  descricao: string | null;
  conteudo: Buffer;
  mime: string;
  duracaoMs: number | null;
  /** O texto que a pessoa leu. Vem de TEXTO_CONSENTIMENTO, nunca do formulário. */
  consentimentoTexto: string;
  ip: string | null;
  /** chaveIdempotente() gerada no render do formulário. */
  chave: string;
};

export type EnvioAceito = {
  amostraId: string;
  jobId: string;
  /** true quando a chave já tinha envio — nada foi criado de novo. */
  repetido: boolean;
};

export async function criarAmostra(
  perfilId: string,
  dados: NovaAmostra,
): Promise<EnvioAceito> {
  if (!dados.chave.trim()) {
    throw new ErroDominio("dado_invalido", "Envio sem chave de idempotência.");
  }
  if (!dados.consentimentoTexto.trim()) {
    // O banco também recusaria, mas errar aqui dá uma mensagem legível.
    throw new ErroDominio("dado_invalido", "Falta registrar o consentimento de uso da voz.");
  }

  return comTraducao(async () => {
    const sql = bd();

    const jaEnviado = await envioDaChave(perfilId, dados.chave);
    if (jaEnviado) return { ...jaEnviado, repetido: true };

    const arquivo = await guardar(perfilId, dados.conteudo, {
      mime: dados.mime,
      duracaoMs: dados.duracaoMs ?? undefined,
      metadados: { uso: "clonagem_voz", modo: dados.modo },
    });

    const amostra = (
      await sql<{ id: string }[]>`
        insert into vozes_amostras
          (perfil_id, arquivo_id, nome, modo, duracao_ms, estado,
           consentimento_texto, consentimento_em, ip_consentimento)
        values
          (${perfilId}, ${arquivo.id}, ${dados.nome}, ${dados.modo},
           ${dados.duracaoMs}, 'enviada',
           ${dados.consentimentoTexto}, now(), ${dados.ip})
        returning id
      `
    )[0]!;

    const jobId = await enfileirar(perfilId, "clonagem", {
      referencia: dados.chave,
      entrada: {
        amostra_id: amostra.id,
        arquivo_id: arquivo.id,
        nome: dados.nome,
        modo: dados.modo,
        idioma: dados.idioma,
        genero: dados.genero,
        descricao: dados.descricao,
      },
    });

    // `not exists` fecha a corrida de dois envios simultâneos com a mesma
    // chave: `enfileirar` devolve o MESMO job para os dois, e só o primeiro
    // consegue reivindicá-lo.
    const vinculada = await sql<{ id: string }[]>`
      update vozes_amostras
         set job_id = ${jobId}, estado = 'processando'
       where id = ${amostra.id}
         and perfil_id = ${perfilId}
         and not exists (select 1 from vozes_amostras where job_id = ${jobId})
      returning id
    `;

    if (!vinculada[0]) {
      // Perdeu a corrida: desfaz o que ESTA requisição criou, senão sobra uma
      // amostra órfã ocupando 8 MB da conta e um job com dois donos.
      await sql`delete from vozes_amostras where id = ${amostra.id} and perfil_id = ${perfilId}`;
      await remover(arquivo.id);

      const vencedor = await envioDaChave(perfilId, dados.chave);
      if (vencedor) return { ...vencedor, repetido: true };
      throw new ErroDominio("conflito", "Outro envio chegou primeiro. Tente de novo.");
    }

    return { amostraId: amostra.id, jobId, repetido: false };
  });
}

/**
 * Apaga o áudio de uma amostra recusada.
 *
 * A LINHA fica: é ela que responde quem autorizou, quando e de onde — e essa
 * prova precisa sobreviver ao fim da voz (0009). O que sai é só o binário, que
 * ocupa espaço e já não serve para nada. Amostra clonada não entra aqui: o
 * arquivo dela ainda é a prévia da voz em /vozes.
 */
export async function apagarAudioDaAmostra(perfilId: string, amostraId: string): Promise<void> {
  const sql = bd();

  const linhas = await sql<{ arquivo_id: string | null }[]>`
    select arquivo_id
      from vozes_amostras
     where id = ${amostraId} and perfil_id = ${perfilId} and estado = 'recusada'
  `;

  const alvo = linhas[0];
  if (!alvo) {
    throw new ErroDominio(
      "nao_encontrado",
      "Só dá para apagar o áudio de uma amostra recusada.",
    );
  }

  if (alvo.arquivo_id) await remover(alvo.arquivo_id);
}
