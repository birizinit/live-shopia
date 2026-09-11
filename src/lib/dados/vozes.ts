import "server-only";
import { bd } from "@/lib/db";
import { guardar, ler, remover } from "@/lib/armazenamento";
import { modoDemo, servicos } from "@/lib/env";
import { catalogoDeVozes, sintetizar } from "@/lib/integracoes/elevenlabs";
import { comDemo, comoJson } from "./comum";
import { ErroDominio, comTraducao, exigirAchado } from "./erros";
import { VOZES_EXEMPLO, ehVozExemplo } from "./exemplos/vozes";

/**
 * Vozes: o catálogo, as clonadas do usuário e a voz ativa da live.
 *
 * Duas decisões mandam neste arquivo:
 *
 * 1. A PRÉVIA NÃO GASTA CRÉDITO. Nenhuma função daqui chama
 *    `debitarEEnfileirar` — de propósito. O que a prévia custa é uma chamada à
 *    ElevenLabs, e essa chamada acontece UMA vez por voz: o áudio vai para
 *    `arquivos` e `vozes.previa_id` passa a apontar para ele. Prévia de voz de
 *    catálogo é gravada com `perfil_id` nulo, então o segundo usuário que
 *    clicar já ouve o arquivo do primeiro. Cobrar — em crédito ou em chamada
 *    paga — a cada clique num botão de "ouvir antes de decidir" seria cobrar
 *    pela vitrine.
 *
 * 2. SEM RLS, o dono entra em toda consulta. Voz de catálogo tem `perfil_id`
 *    nulo e é de todos; voz clonada é de um perfil só. Toda leitura filtra por
 *    `(perfil_id is null or perfil_id = $1)` e a gravação da voz ativa valida o
 *    mesmo par dentro do próprio INSERT — id vindo da URL não vira voz ativa
 *    sem passar por essa peneira.
 */

export type GeneroVoz = "feminina" | "masculina" | "neutra";
export type OrigemVoz = "catalogo" | "clonada";
export type EstadoVoz = "processando" | "pronta" | "falhou";

export type Voz = {
  id: string;
  origem: OrigemVoz;
  estado: EstadoVoz;
  nome: string;
  descricao: string | null;
  genero: GeneroVoz;
  idade: string | null;
  sotaque: string | null;
  categoria: string | null;
  uso: string | null;
  /** Código do idioma (`pt-BR`, `en`, …), como em `idiomas.codigo`. */
  idioma: string;
  idiomaNome: string;
  bandeira: string;
  premium: boolean;
  /** Já existe áudio de prévia guardado — o primeiro clique não espera síntese. */
  temPrevia: boolean;
  /** Voz de EXEMPLO: não existe no banco nem no provedor. A tela rotula. */
  exemplo?: boolean;
  criadoEm: string;
};

export type DadosVozes = {
  catalogo: Voz[];
  minhas: Voz[];
  vozAtiva: Voz | null;
  /** O catálogo em cena é o de exemplo. Some assim que houver chave e sincronização. */
  exemplo: boolean;
};

export type PreviaVoz = {
  conteudo: Buffer;
  mime: string;
  /** Tom rotulado, não a voz de verdade. A tela precisa dizer isso a quem ouviu. */
  exemplo: boolean;
};

/**
 * A frase da prévia é sempre a MESMA para todas as vozes.
 *
 * Prévia só serve para comparar timbre; texto diferente por voz tornaria a
 * comparação inútil e multiplicaria o custo de síntese sem motivo. É curta de
 * propósito: o que se guarda é um arquivo por voz, para sempre.
 */
export const FRASE_PREVIA =
  "Oi! Eu sou a apresentadora da sua live. Hoje eu vou te mostrar o produto que está bombando — e o cupom que só vale enquanto a gente estiver no ar.";

/** Teto de sínteses NOVAS por perfil por hora. Prévia já pronta é leitura e não conta. */
const TETO_PREVIAS_NOVAS = 30;
const JANELA_PREVIAS_S = 3600;

// -----------------------------------------------------------------------------
// Leitura
// -----------------------------------------------------------------------------

type LinhaVoz = {
  id: string;
  origem: OrigemVoz;
  estado: EstadoVoz;
  nome: string;
  descricao: string | null;
  genero: GeneroVoz;
  idade: string | null;
  sotaque: string | null;
  categoria: string | null;
  uso: string | null;
  idioma: string;
  idioma_nome: string;
  bandeira: string;
  premium: boolean;
  tem_previa: boolean;
  criado_em: Date;
};

function montarVoz(linha: LinhaVoz): Voz {
  return {
    id: linha.id,
    origem: linha.origem,
    estado: linha.estado,
    nome: linha.nome,
    descricao: linha.descricao,
    genero: linha.genero,
    idade: linha.idade,
    sotaque: linha.sotaque,
    categoria: linha.categoria,
    uso: linha.uso,
    idioma: linha.idioma,
    idiomaNome: linha.idioma_nome,
    bandeira: linha.bandeira,
    premium: linha.premium,
    temPrevia: linha.tem_previa,
    criadoEm: linha.criado_em.toISOString(),
  };
}

/**
 * Tudo que a tela de vozes precisa, numa ida só ao banco.
 *
 * Uma função em vez de três porque as três respostas são lidas juntas e o
 * `exemplo` só pode ser decidido depois de saber se o catálogo veio vazio.
 */
export async function paginaDeVozes(perfilId: string): Promise<DadosVozes> {
  return comDemo(
    () => ({
      catalogo: VOZES_EXEMPLO,
      minhas: [],
      vozAtiva: VOZES_EXEMPLO[0] ?? null,
      exemplo: true,
    }),
    async () => {
      const sql = bd();

      // Fragmento reaproveitado nas três consultas: a mesma lista de colunas
      // escrita três vezes sairia do lugar na primeira coluna nova.
      const colunas = sql`
        v.id, v.origem, v.estado, v.nome, v.descricao, v.genero, v.idade,
        v.sotaque, v.categoria, v.uso, v.idioma, i.nome as idioma_nome,
        i.bandeira, v.premium, (v.previa_id is not null) as tem_previa, v.criado_em
      `;

      const [catalogo, minhas, ativa] = await Promise.all([
        sql<LinhaVoz[]>`
          select ${colunas}
            from vozes v
            join idiomas i on i.codigo = v.idioma
           where v.perfil_id is null and v.ativa
           order by i.ordem, v.premium desc, v.ordem, v.nome
           limit 400
        `,
        sql<LinhaVoz[]>`
          select ${colunas}
            from vozes v
            join idiomas i on i.codigo = v.idioma
           where v.perfil_id = ${perfilId}
           order by v.criado_em desc
           limit 100
        `,
        sql<LinhaVoz[]>`
          select ${colunas}
            from live_config lc
            join vozes v on v.id = lc.voz_id
            join idiomas i on i.codigo = v.idioma
           where lc.perfil_id = ${perfilId}
             and (v.perfil_id is null or v.perfil_id = ${perfilId})
        `,
      ]);

      // Sem chave e sem catálogo sincronizado não há o que mostrar de verdade —
      // e tela vazia não ensina nada sobre o produto. Entra o catálogo de
      // exemplo, com selo. Havendo linhas no banco, elas vencem: são reais, e
      // trocá-las por exemplo seria esconder dado do usuário.
      const exemplo = catalogo.length === 0 && !servicos.voz;

      return {
        catalogo: exemplo ? VOZES_EXEMPLO : catalogo.map(montarVoz),
        minhas: minhas.map(montarVoz),
        vozAtiva: ativa[0] ? montarVoz(ativa[0]) : null,
        exemplo,
      };
    },
  );
}

// -----------------------------------------------------------------------------
// Voz ativa da live
// -----------------------------------------------------------------------------

export type VozAtivaDefinida = {
  nome: string;
  /** false no modo demo: a escolha foi aceita, mas não existe banco para gravá-la. */
  salvo: boolean;
};

/**
 * Grava `live_config.voz_id`. Devolve o nome da voz, para o aviso na tela.
 *
 * A peneira de dono está DENTRO do insert: o `select` que alimenta o `values`
 * não devolve linha nenhuma se a voz não for do perfil nem do catálogo, e aí
 * nada é gravado. Checar antes, em consulta separada, deixaria uma janela entre
 * a checagem e a escrita — pequena, mas real, e evitável de graça.
 */
export async function definirVozAtiva(
  perfilId: string,
  vozId: string,
): Promise<VozAtivaDefinida> {
  // O tipo explícito impede que `salvo: false` do exemplo estreite o retorno:
  // o ramo do banco devolve `true`, e sem isto os dois não conversam.
  return comDemo<VozAtivaDefinida>(
    () => {
      // Demo não tem linha em `live_config` para atualizar. A tela responde
      // "escolhida, mas não salva" — mentir que salvou seria pior que recusar.
      const voz = VOZES_EXEMPLO.find((exemplo) => exemplo.id === vozId);
      if (!voz) throw new ErroDominio("nao_encontrado", "Voz não encontrada.");
      return { nome: voz.nome, salvo: false };
    },
    () =>
      comTraducao(async () => {
        const sql = bd();

        const gravadas = await sql<{ voz_id: string }[]>`
          insert into live_config (perfil_id, voz_id)
          select ${perfilId}, v.id
            from vozes v
           where v.id = ${vozId}
             and v.ativa
             and v.estado = 'pronta'
             and (v.perfil_id is null or v.perfil_id = ${perfilId})
          on conflict (perfil_id) do update set voz_id = excluded.voz_id
          returning voz_id
        `;

        const gravada = exigirAchado(gravadas[0]?.voz_id, "Voz");

        const nomes = await sql<{ nome: string }[]>`
          select nome from vozes where id = ${gravada}
        `;
        return { nome: nomes[0]?.nome ?? "Voz", salvo: true };
      }),
  );
}

// -----------------------------------------------------------------------------
// Prévia
// -----------------------------------------------------------------------------

/**
 * Tom curto em WAV, para quando não existe voz de verdade para tocar.
 *
 * A integração tem um gerador parecido, mas privado e só acionado quando falta
 * a chave. Aqui o tom também precisa sair COM a chave configurada: voz de
 * exemplo não existe no provedor, e mandar o id falso para a API renderia um
 * 400 pago em vez de um som. Duas notas em vez de uma para não soar como erro.
 */
let tomGuardado: Buffer | null = null;

function tomDePrevia(): { conteudo: Buffer; mime: string } {
  if (tomGuardado) return { conteudo: tomGuardado, mime: "audio/wav" };

  const taxa = 8_000;
  const duracaoMs = 2_400;
  const amostras = Math.round((taxa * duracaoMs) / 1000);
  const dados = Buffer.alloc(amostras * 2);
  const metade = Math.floor(amostras / 2);

  for (let i = 0; i < amostras; i += 1) {
    const primeiraNota = i < metade;
    const frequencia = primeiraNota ? 220 : 330;
    const local = primeiraNota ? i : i - metade;
    const tamanho = primeiraNota ? metade : amostras - metade;
    // Envelope nas duas pontas de cada nota: corte seco vira estalo no alto-falante.
    const envelope = Math.min(1, local / 300) * Math.min(1, (tamanho - local) / 300);
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

  tomGuardado = Buffer.concat([cabecalho, dados]);
  return { conteudo: tomGuardado, mime: "audio/wav" };
}

type LinhaPrevia = {
  origem: OrigemVoz;
  provedor_voz_id: string | null;
  previa_id: string | null;
};

/**
 * O áudio de prévia da voz. `null` quando a voz não existe ou não é desta pessoa.
 *
 * Gera no máximo uma vez por voz: o arquivo fica em `vozes.previa_id` e todo
 * clique seguinte é leitura de banco. Nada aqui toca a razão de créditos.
 */
export async function previaDaVoz(
  perfilId: string,
  vozId: string,
): Promise<PreviaVoz | null> {
  // Voz de exemplo — e a tela inteira em modo demo, que não tem linha no banco.
  // Tom local, sem banco e sem provedor.
  if (modoDemo || ehVozExemplo(vozId)) {
    return { ...tomDePrevia(), exemplo: true };
  }

  const sql = bd();

  const linhas = await sql<LinhaPrevia[]>`
    select v.origem, v.provedor_voz_id, v.previa_id
      from vozes v
     where v.id = ${vozId}
       and v.ativa
       and (v.perfil_id is null or v.perfil_id = ${perfilId})
  `;

  const voz = linhas[0];
  if (!voz) return null;

  if (voz.previa_id) {
    const arquivo = await ler(perfilId, voz.previa_id);
    if (arquivo) {
      return { conteudo: arquivo.conteudo, mime: arquivo.mime, exemplo: false };
    }

    // Ponteiro órfão: a faxina marcou o arquivo como removido, mas a coluna
    // continua apontando para ele. Limpar aqui é o que permite a síntese abaixo
    // gravar no lugar — sem isso a prévia desta voz seria refeita (e repaga) a
    // cada clique, para sempre.
    await sql`
      update vozes
         set previa_id = null
       where id = ${vozId} and previa_id = ${voz.previa_id}
    `;
  }

  // Sem chave, ou voz sem id no provedor: tom rotulado — e NÃO se guarda. Prévia
  // falsa gravada em `previa_id` ficaria colada na voz depois que a chave
  // chegasse, e ninguém mais ouviria o timbre de verdade.
  if (!servicos.voz || !voz.provedor_voz_id) {
    return { ...tomDePrevia(), exemplo: true };
  }

  const [limite] = await sql<{ pode: boolean }[]>`
    select consumir_limite(
      ${`previa:${perfilId}`}, ${TETO_PREVIAS_NOVAS}, ${JANELA_PREVIAS_S}
    ) as pode
  `;
  if (!limite?.pode) {
    throw new ErroDominio(
      "servico_indisponivel",
      "Muitas prévias novas em pouco tempo. Espere alguns minutos e tente de novo.",
    );
  }

  const fala = await sintetizar(FRASE_PREVIA, voz.provedor_voz_id);

  // Prévia de catálogo nasce sem dono (`perfil_id` nulo): é a mesma para todo
  // mundo, e `ler()` deixa qualquer perfil ler arquivo global. A da voz clonada
  // é do dono, porque o timbre é dele.
  const arquivo = await guardar(voz.origem === "clonada" ? perfilId : null, fala.conteudo, {
    mime: fala.mime,
    duracaoMs: fala.duracaoMs,
    metadados: { previa_de: vozId, frase: FRASE_PREVIA },
  });

  const gravadas = await sql<{ previa_id: string }[]>`
    update vozes
       set previa_id = ${arquivo.id}
     where id = ${vozId} and previa_id is null
    returning previa_id
  `;

  // Dois cliques ao mesmo tempo sintetizam duas vezes; só uma ganha a coluna.
  // A perdedora vira lixo e é removida na hora — o áudio dela já está em mãos e
  // vai para a resposta do mesmo jeito.
  if (gravadas.length === 0) await remover(arquivo.id);

  return { conteudo: fala.conteudo, mime: fala.mime, exemplo: fala.demo };
}

// -----------------------------------------------------------------------------
// Sincronização do catálogo (admin)
// -----------------------------------------------------------------------------

/**
 * Idioma a partir do rótulo de sotaque da ElevenLabs.
 *
 * A API não devolve idioma: devolve `accent` ("brazilian", "british"). O modelo
 * multilíngue fala qualquer idioma com qualquer voz, mas o SOTAQUE fica — uma
 * voz americana narrando em português soa estrangeira na live. Por isso o
 * catálogo é classificado pelo sotaque de origem, e não por "fala português".
 */
const IDIOMA_POR_SOTAQUE: Record<string, string> = {
  brazilian: "pt-BR",
  portuguese: "pt-BR",
  american: "en",
  british: "en",
  australian: "en",
  irish: "en",
  english: "en",
  transatlantic: "en",
  spanish: "es",
  mexican: "es",
  latin: "es",
  french: "fr",
  german: "de",
  italian: "it",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
  arabic: "ar",
};

function idiomaDoSotaque(sotaque: string | null): string {
  const chave = sotaque?.trim().toLowerCase() ?? "";
  for (const [marca, codigo] of Object.entries(IDIOMA_POR_SOTAQUE)) {
    if (chave.includes(marca)) return codigo;
  }
  // O acervo padrão da ElevenLabs é majoritariamente inglês. `idiomas.codigo` é
  // chave estrangeira: um palpite fora da lista derrubaria a sincronização toda.
  return "en";
}

export type ResumoSincronizacao = {
  importadas: number;
  atualizadas: number;
  total: number;
};

/**
 * Traz o catálogo real da ElevenLabs para a tabela `vozes`. Só admin chama.
 *
 * Não recebe filtro de dono porque catálogo não tem dono: `perfil_id` é nulo em
 * toda linha escrita aqui. `perfilId` entra como ATOR na auditoria — quem mexe
 * no catálogo de todo mundo tem nome.
 *
 * O `where vozes.origem = 'catalogo'` no `do update` é a trava que importa: o
 * índice único é (provedor, provedor_voz_id) e não separa catálogo de clonada,
 * então sem ele uma sincronização poderia sobrescrever a voz clonada de um
 * usuário com os dados do acervo público.
 */
export async function sincronizarCatalogo(
  perfilId: string,
): Promise<ResumoSincronizacao> {
  if (!servicos.voz) {
    throw new ErroDominio(
      "servico_indisponivel",
      "Sem ELEVENLABS_API_KEY não há catálogo real para sincronizar.",
    );
  }

  const vozes = await catalogoDeVozes();
  if (vozes.length === 0) {
    return { importadas: 0, atualizadas: 0, total: 0 };
  }

  return comTraducao(async () => {
    const sql = bd();

    const conhecidas = await sql<{ provedor_voz_id: string }[]>`
      select provedor_voz_id
        from vozes
       where provedor = 'elevenlabs' and provedor_voz_id is not null
    `;
    const jaExistiam = new Set(conhecidas.map((l) => l.provedor_voz_id));

    const linhas = vozes.map((voz, indice) => ({
      origem: "catalogo",
      nome: voz.nome,
      descricao: voz.descricao,
      genero: voz.genero,
      idade: voz.idade,
      sotaque: voz.sotaque,
      categoria: voz.categoria,
      uso: voz.uso,
      idioma: idiomaDoSotaque(voz.sotaque),
      provedor: "elevenlabs",
      provedor_voz_id: voz.provedorVozId,
      premium: voz.premium,
      // `ordem` é smallint; um acervo grande não pode estourar o tipo.
      ordem: Math.min(indice, 30_000),
      ativa: true,
    }));

    // Em lotes: uma instrução única com centenas de linhas é um statement enorme
    // para o servidor montar, e o ganho sobre 100 por vez é nenhum.
    for (let inicio = 0; inicio < linhas.length; inicio += 100) {
      const lote = linhas.slice(inicio, inicio + 100);

      await sql`
        insert into vozes ${sql(
          lote,
          "origem",
          "nome",
          "descricao",
          "genero",
          "idade",
          "sotaque",
          "categoria",
          "uso",
          "idioma",
          "provedor",
          "provedor_voz_id",
          "premium",
          "ordem",
          "ativa",
        )}
        on conflict (provedor, provedor_voz_id) where provedor_voz_id is not null
        do update set
          nome      = excluded.nome,
          descricao = excluded.descricao,
          genero    = excluded.genero,
          idade     = excluded.idade,
          sotaque   = excluded.sotaque,
          categoria = excluded.categoria,
          uso       = excluded.uso,
          idioma    = excluded.idioma,
          premium   = excluded.premium,
          ordem     = excluded.ordem,
          ativa     = true
        where vozes.origem = 'catalogo'
      `;
    }

    const importadas = vozes.filter((v) => !jaExistiam.has(v.provedorVozId)).length;
    const resumo: ResumoSincronizacao = {
      importadas,
      atualizadas: vozes.length - importadas,
      total: vozes.length,
    };

    await sql`
      insert into auditoria (ator_id, acao, entidade, depois)
      values (${perfilId}, 'sincronizar_catalogo_vozes', 'vozes', ${comoJson(resumo)})
    `;

    return resumo;
  });
}
