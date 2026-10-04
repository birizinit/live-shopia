import "server-only";
import { bd } from "@/lib/db";
import { modoDemo } from "@/lib/env";
import { ErroDominio } from "./erros";
import { comDemo, numeroDe } from "./comum";

/**
 * O manual do produto: o que a Shopia sabe responder.
 *
 * É a mesa `temas_resposta`, que nasceu para as respostas do chat e virou a
 * peça central do produto. Cada linha é uma pergunta que a audiência faz
 * ("quanto custa?", "tem frete?") com a resposta que VOCÊ escreveu.
 *
 * -----------------------------------------------------------------------------
 * POR QUE O CASAMENTO É POR PALAVRA E NÃO POR IA
 *
 * A promessa do produto é "responde na hora e NUNCA INVENTA". Mandar cada
 * comentário para um modelo e pedir uma resposta quebra as duas metades:
 *
 *   inventa — o modelo preenche o que não sabe. Numa live de vendas isso vira
 *   promessa de frete que não existe, tamanho que não tem, prazo que ninguém
 *   vai cumprir. O prejuízo é do vendedor, na frente da audiência dele.
 *
 *   na hora — ida e volta ao modelo por comentário custa tempo e dinheiro POR
 *   EVENTO, numa live que recebe centenas deles.
 *
 * Casar palavra com resposta escrita pelo dono é instantâneo, de graça, e
 * previsível: quando a Shopia responde errado, dá para ver exatamente qual
 * linha do manual respondeu, e corrigir.
 *
 * A IA entra ANTES, não durante: sugerindo as perguntas que faltam no manual a
 * partir do que a audiência perguntou e ninguém soube responder.
 * -----------------------------------------------------------------------------
 */

export type ItemManual = {
  id: string;
  chave: string;
  rotulo: string;
  gatilhos: string[];
  resposta: string;
  produtoId: string | null;
  produtoNome: string | null;
  ativo: boolean;
  ordem: number;
  vezesUsado: number;
};

export const LIMITES_MANUAL = {
  rotulo: 60,
  /**
   * 150 porque é o que o TikTok aceita.
   *
   * O campo do chat da live declara `maxlength="150"` — visto na página salva
   * de uma live real. O limite daqui era 280, herdado de nada, e resposta
   * maior que isso chegaria cortada no meio da frase sem ninguém avisar.
   * Melhor recusar na hora de cadastrar.
   */
  resposta: 150,
  gatilhos: 20,
  gatilho: 40,
} as const;

type Linha = {
  id: string;
  chave: string;
  rotulo: string;
  gatilhos: string[] | null;
  resposta: string;
  produto_id: string | null;
  produto_nome: string | null;
  ativo: boolean;
  ordem: number;
  vezes_usado: number;
};

const daLinha = (l: Linha): ItemManual => ({
  id: l.id,
  chave: l.chave,
  rotulo: l.rotulo,
  gatilhos: l.gatilhos ?? [],
  resposta: l.resposta,
  produtoId: l.produto_id,
  produtoNome: l.produto_nome,
  ativo: l.ativo,
  ordem: numeroDe(l.ordem),
  vezesUsado: numeroDe(l.vezes_usado),
});

/**
 * Exemplos do modo demo. Sem `DATABASE_URL` a aplicação roda em demo
 * (src/lib/env.ts) e esta tela é a mais importante do produto: ela precisa
 * poder ser vista. A interface rotula como exemplo.
 */
const MANUAL_DEMO: ItemManual[] = [
  {
    id: "00000000-0000-4000-8000-0000000c1001",
    chave: "preco",
    rotulo: "Preço",
    gatilhos: ["quanto", "preco", "valor", "quanto custa"],
    resposta: "O valor está na tela e o cupom já está ativo — aproveita que é por tempo limitado!",
    produtoId: null,
    produtoNome: null,
    ativo: true,
    ordem: 10,
    vezesUsado: 23,
  },
  {
    id: "00000000-0000-4000-8000-0000000c1002",
    chave: "frete",
    rotulo: "Frete",
    gatilhos: ["frete", "entrega", "envio", "prazo"],
    resposta: "O frete aparece no carrinho conforme o seu CEP, e sai rapidinho!",
    produtoId: null,
    produtoNome: null,
    ativo: true,
    ordem: 20,
    vezesUsado: 11,
  },
];

export async function listarManual(perfilId: string): Promise<ItemManual[]> {
  return comDemo(() => MANUAL_DEMO, () => lerManual(perfilId));
}

async function lerManual(perfilId: string): Promise<ItemManual[]> {
  const linhas = await bd()<Linha[]>`
    select t.id, t.chave, t.rotulo, t.gatilhos, t.resposta, t.produto_id,
           p.nome as produto_nome, t.ativo, t.ordem, t.vezes_usado
      from temas_resposta t
      left join produtos p on p.id = t.produto_id
     where t.perfil_id = ${perfilId}
     order by t.ordem, t.criado_em
  `;
  return linhas.map(daLinha);
}

/**
 * Garante que a conta tem o manual básico.
 *
 * Chamado quando a tela abre, e não no cadastro: `criar_temas_padrao` existe
 * desde a 0015 e nunca foi chamado por ninguém — as contas de teste todas
 * estavam com manual vazio, o que fazia a Shopia calar em toda pergunta. Aqui
 * é idempotente (`on conflict do nothing`), então abrir a tela duas vezes não
 * duplica nada, e quem apagou um tema de propósito não o vê voltar... exceto se
 * apagar TODOS, caso em que a semeadura recomeça. Preferimos isso a uma conta
 * que não responde nada e não diz por quê.
 */
export async function garantirManualBasico(perfilId: string): Promise<number> {
  // Em demo não há banco onde semear, e devolver 0 faz a tela não mostrar o
  // aviso de "começamos o seu manual" — que seria mentira sobre dados falsos.
  if (modoDemo) return 0;

  const [linha] = await bd()<{ n: number }[]>`
    select count(*)::int n from temas_resposta where perfil_id = ${perfilId}
  `;
  if (numeroDe(linha?.n) > 0) return 0;

  const [r] = await bd()<{ criados: number }[]>`
    select criar_temas_padrao(${perfilId}) as criados
  `;
  return numeroDe(r?.criados);
}

/** Um `chave` estável a partir do rótulo: é o que o índice único protege. */
function chaveDe(rotulo: string): string {
  const base = rotulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  // O CHECK do banco exige 2 a 30 caracteres de [a-z0-9_]. Rótulo só de emoji
  // ou de pontuação não sobra nada — melhor uma chave feia que um erro 500.
  return base.length >= 2 ? base : `tema_${Date.now().toString(36).slice(-6)}`;
}

function limparGatilhos(bruto: string): string[] {
  const vistos = new Set<string>();
  for (const parte of bruto.split(/[,\n;]/)) {
    const g = parte.trim().slice(0, LIMITES_MANUAL.gatilho);
    if (g.length >= 2) vistos.add(g);
    if (vistos.size >= LIMITES_MANUAL.gatilhos) break;
  }
  return [...vistos];
}

export type EntradaManual = {
  rotulo: string;
  resposta: string;
  gatilhos: string;
  produtoId: string | null;
};

function validar(entrada: EntradaManual) {
  const rotulo = entrada.rotulo.trim().slice(0, LIMITES_MANUAL.rotulo);
  const resposta = entrada.resposta.trim().slice(0, LIMITES_MANUAL.resposta);
  const gatilhos = limparGatilhos(entrada.gatilhos);

  if (rotulo.length < 2) throw new ErroDominio("dado_invalido", "Dê um nome à pergunta.");
  if (resposta.length < 2) throw new ErroDominio("dado_invalido", "Escreva a resposta.");
  if (gatilhos.length === 0) {
    throw new ErroDominio(
      "dado_invalido",
      "Escreva ao menos uma palavra que a audiência usa para perguntar isso.",
    );
  }
  return { rotulo, resposta, gatilhos };
}

export async function criarItemManual(perfilId: string, entrada: EntradaManual): Promise<string> {
  const { rotulo, resposta, gatilhos } = validar(entrada);

  const [maior] = await bd()<{ ordem: number | null }[]>`
    select max(ordem) as ordem from temas_resposta where perfil_id = ${perfilId}
  `;

  try {
    const linhas = await bd()<{ id: string }[]>`
      insert into temas_resposta (perfil_id, produto_id, chave, rotulo, gatilhos, resposta, ordem)
      values (
        ${perfilId},
        (select p.id from produtos p
          where p.id = ${entrada.produtoId} and p.perfil_id = ${perfilId}),
        ${chaveDe(rotulo)}, ${rotulo}, ${gatilhos}, ${resposta},
        ${numeroDe(maior?.ordem) + 10}
      )
      returning id
    `;
    return linhas[0]!.id;
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    if (detalhe.includes("temas_resposta_perfil_id_chave_key")) {
      throw new ErroDominio("conflito", "Já existe uma pergunta com esse nome no seu manual.");
    }
    throw erro;
  }
}

export async function editarItemManual(
  perfilId: string,
  id: string,
  entrada: EntradaManual,
): Promise<void> {
  const { rotulo, resposta, gatilhos } = validar(entrada);

  // A `chave` NÃO é reescrita ao editar o rótulo: ela é o que a telemetria de
  // resposta grava em `live_eventos.dados->>'tema'`, e trocá-la quebraria a
  // ligação com todo o histórico da conta.
  const linhas = await bd()<{ id: string }[]>`
    update temas_resposta
       set rotulo = ${rotulo},
           resposta = ${resposta},
           gatilhos = ${gatilhos},
           produto_id = (select p.id from produtos p
                          where p.id = ${entrada.produtoId} and p.perfil_id = ${perfilId})
     where id = ${id} and perfil_id = ${perfilId}
    returning id
  `;
  if (linhas.length === 0) throw new ErroDominio("nao_encontrado", "Pergunta não encontrada.");
}

export async function alternarItemManual(perfilId: string, id: string, ativo: boolean) {
  await bd()`
    update temas_resposta set ativo = ${ativo}
     where id = ${id} and perfil_id = ${perfilId}
  `;
}

export async function removerItemManual(perfilId: string, id: string) {
  await bd()`delete from temas_resposta where id = ${id} and perfil_id = ${perfilId}`;
}

/**
 * O que a audiência perguntou e o manual não soube responder.
 *
 * É o "Revisar manual" da vitrine, e a razão de a Shopia calar em vez de
 * inventar: o silêncio fica REGISTRADO e volta como sugestão. O comentário sai
 * de `live_eventos`, onde a extensão já grava tudo o que leu; o filtro é a
 * ausência de resposta nossa com aquele tema.
 */
export async function perguntasSemResposta(
  perfilId: string,
  limite = 30,
): Promise<{ texto: string; vezes: number; ultimaEm: string }[]> {
  if (modoDemo) {
    return [
      { texto: "serve pra pele oleosa?", vezes: 3, ultimaEm: new Date().toISOString() },
      { texto: "tem em azul?", vezes: 2, ultimaEm: new Date().toISOString() },
    ];
  }

  const linhas = await bd()<{ texto: string; vezes: number; ultima: Date }[]>`
    select lower(btrim(e.texto)) as texto,
           count(*)::int as vezes,
           max(e.criado_em) as ultima
      from live_eventos e
     where e.perfil_id = ${perfilId}
       and e.tipo = 'comentario'
       and e.texto is not null
       and length(btrim(e.texto)) between 4 and 200
       -- Mensagem de sistema do TikTok não é pergunta de ninguém. Sem este
       -- filtro, "compartilhou a LIVE" aparecia aqui como se alguém tivesse
       -- perguntado algo — e a lista existe para a pessoa cadastrar resposta,
       -- não para ela ficar procurando o que responder a um aviso de sistema.
       and classificar_mensagem(e.texto) is null
       -- Não soube responder: não existe tema que case com este comentário.
       and (select id from casar_tema(${perfilId}, e.texto)) is null
     group by lower(btrim(e.texto))
     order by count(*) desc, max(e.criado_em) desc
     limit ${limite}
  `;
  return linhas.map((l) => ({
    texto: l.texto,
    vezes: numeroDe(l.vezes),
    ultimaEm: l.ultima.toISOString(),
  }));
}
