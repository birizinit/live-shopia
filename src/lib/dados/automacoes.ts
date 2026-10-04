import "server-only";
import { bd } from "@/lib/db";
import { comDemo, numeroDe } from "./comum";
import { ErroDominio } from "./erros";

/**
 * As automações da live: o que a Shopia faz sem ninguém pedir.
 *
 * Três famílias, e a diferença entre elas é o GATILHO:
 *
 *   por tempo    — avisos programados e refixar o produto. Roda de X em X
 *                  segundos enquanto a live está no ar.
 *   por evento   — carrinho e venda. Reage ao que o TikTok anuncia no chat.
 *   por pergunta — as respostas do manual, que moram em respostas.ts.
 *
 * -----------------------------------------------------------------------------
 * O TETO DE CADÊNCIA VALE PARA TODAS, E ISSO NÃO É DETALHE
 *
 * Cada automação, isolada, parece inofensiva: um aviso a cada 5 minutos, um
 * parabéns por venda, uma boas-vindas por pessoa. Somadas numa live movimentada
 * elas viram uma mensagem a cada três segundos — e chat que recebe mensagem a
 * cada três segundos do mesmo autor é a assinatura mais óbvia de automação que
 * existe.
 *
 * Por isso o intervalo de cada uma é um TETO DE FREQUÊNCIA, não uma promessa de
 * entrega: a conta de quantas mensagens já saíram no último minuto é uma só,
 * fica no servidor, e qualquer automação que estoure o teto cala. O aviso
 * programado é o primeiro a calar, porque é o único que ninguém está esperando:
 * perder um "aproveitem a oferta" não custa nada; perder a resposta de quem
 * perguntou o preço custa a venda.
 * -----------------------------------------------------------------------------
 */

export type TipoAviso = "aviso" | "relampago";

export type Aviso = {
  id: string;
  tipo: TipoAviso;
  texto: string;
  intervaloS: number;
  ativo: boolean;
  ordem: number;
};

export const LIMITES_AVISO = {
  /** O teto do campo do chat do TikTok (ver 0028). */
  texto: 150,
  intervaloMinS: 30,
  intervaloMaxS: 3600,
  /** Avisos por conta. Mais que isto não é automação, é mural. */
  quantidade: 10,
} as const;

export const LIMITES_GATILHO = { texto: 120 } as const;

type LinhaAviso = {
  id: string;
  tipo: TipoAviso;
  texto: string;
  intervalo_s: number;
  ativo: boolean;
  ordem: number;
};

const daLinha = (l: LinhaAviso): Aviso => ({
  id: l.id,
  tipo: l.tipo,
  texto: l.texto,
  intervaloS: numeroDe(l.intervalo_s),
  ativo: l.ativo,
  ordem: numeroDe(l.ordem),
});

/**
 * Exemplos do modo demo.
 *
 * Existem porque sem `DATABASE_URL` a aplicação inteira roda em modo demo
 * (src/lib/env.ts) e a tela precisa poder ser vista e revisada. Rotulados pela
 * própria interface como exemplo — nunca se apresentam como configuração real.
 */
const AVISOS_DEMO: Aviso[] = [
  {
    id: "00000000-0000-4000-8000-0000000b1001",
    tipo: "aviso",
    texto: "Aproveitem a oferta, é por tempo limitado!",
    intervaloS: 300,
    ativo: true,
    ordem: 10,
  },
  {
    id: "00000000-0000-4000-8000-0000000b1002",
    tipo: "relampago",
    texto: "OFERTA RELÂMPAGO ativa agora! Toca no produto fixado aqui embaixo ⚡",
    intervaloS: 600,
    ativo: false,
    ordem: 10,
  },
];

export async function listarAvisos(perfilId: string): Promise<Aviso[]> {
  return comDemo(
    () => AVISOS_DEMO,
    async () => {
      const linhas = await bd()<LinhaAviso[]>`
        select id, tipo, texto, intervalo_s, ativo, ordem
          from avisos_programados
         where perfil_id = ${perfilId}
         order by tipo, ordem, criado_em
      `;
      return linhas.map(daLinha);
    },
  );
}

function validarAviso(texto: string, intervaloS: number) {
  const limpo = texto.trim();
  if (limpo.length < 2) throw new ErroDominio("dado_invalido", "Escreva o texto do aviso.");

  // RECUSA, não corta. Aparar em silêncio é o mesmo defeito que a 0028
  // consertou no manual: o texto é aceito, vai ao ar pela metade, e quem
  // escreveu nunca fica sabendo. Aqui é a última hora em que dá para avisar.
  if (limpo.length > LIMITES_AVISO.texto) {
    throw new ErroDominio(
      "dado_invalido",
      `O aviso tem ${limpo.length} caracteres e o chat do TikTok aceita ${LIMITES_AVISO.texto}. Encurte ${limpo.length - LIMITES_AVISO.texto}.`,
    );
  }

  if (!Number.isSafeInteger(intervaloS)) {
    throw new ErroDominio("dado_invalido", "Intervalo inválido.");
  }
  if (intervaloS < LIMITES_AVISO.intervaloMinS) {
    throw new ErroDominio(
      "dado_invalido",
      `O intervalo mínimo é ${LIMITES_AVISO.intervaloMinS} segundos. Mais rápido que isso é o que faz o TikTok tratar a conta como robô.`,
    );
  }
  if (intervaloS > LIMITES_AVISO.intervaloMaxS) {
    throw new ErroDominio("dado_invalido", "O intervalo máximo é 1 hora.");
  }

  return { limpo, intervaloS };
}

export async function criarAviso(
  perfilId: string,
  dados: { tipo: TipoAviso; texto: string; intervaloS: number },
): Promise<string> {
  const { limpo, intervaloS } = validarAviso(dados.texto, dados.intervaloS);

  const [contagem] = await bd()<{ n: number }[]>`
    select count(*)::int n from avisos_programados where perfil_id = ${perfilId}
  `;
  if (numeroDe(contagem?.n) >= LIMITES_AVISO.quantidade) {
    throw new ErroDominio(
      "conflito",
      `São no máximo ${LIMITES_AVISO.quantidade} avisos. Apague um para criar outro.`,
    );
  }

  const [maior] = await bd()<{ ordem: number | null }[]>`
    select max(ordem) as ordem from avisos_programados
     where perfil_id = ${perfilId} and tipo = ${dados.tipo}
  `;

  const linhas = await bd()<{ id: string }[]>`
    insert into avisos_programados (perfil_id, tipo, texto, intervalo_s, ordem)
    values (${perfilId}, ${dados.tipo}, ${limpo}, ${intervaloS}, ${numeroDe(maior?.ordem) + 10})
    returning id
  `;
  return linhas[0]!.id;
}

export async function editarAviso(
  perfilId: string,
  id: string,
  dados: { texto: string; intervaloS: number; ativo: boolean },
): Promise<void> {
  const { limpo, intervaloS } = validarAviso(dados.texto, dados.intervaloS);

  const linhas = await bd()<{ id: string }[]>`
    update avisos_programados
       set texto = ${limpo}, intervalo_s = ${intervaloS}, ativo = ${dados.ativo}
     where id = ${id} and perfil_id = ${perfilId}
    returning id
  `;
  if (linhas.length === 0) throw new ErroDominio("nao_encontrado", "Aviso não encontrado.");
}

export async function removerAviso(perfilId: string, id: string): Promise<void> {
  await bd()`delete from avisos_programados where id = ${id} and perfil_id = ${perfilId}`;
}

// -----------------------------------------------------------------------------
// Gatilhos da loja e refixar produto
// -----------------------------------------------------------------------------

export type ConfigAutomacoes = {
  refixarAtivo: boolean;
  refixarIntervaloS: number;
  refixarPosicao: number;
  carrinhoAtivo: boolean;
  carrinhoTexto: string | null;
  vendaAtivo: boolean;
  vendaTexto: string | null;
  sinoAtivo: boolean;
};

/** O que a tela mostra quando a pessoa liga o gatilho sem ter escrito nada. */
export const SUGESTAO = {
  carrinho: "{nome} adicionou ao carrinho! Corre que tá acabando 🔥",
  venda: "{nome} acabou de garantir o seu! Quem é o próximo? 🎉",
  aviso: "Aproveitem a oferta, é por tempo limitado!",
  relampago: "OFERTA RELÂMPAGO ativa agora! Toca no produto fixado aqui embaixo ⚡",
} as const;

type LinhaConfig = {
  refixar_ativo: boolean;
  refixar_intervalo_s: number;
  refixar_posicao: number;
  carrinho_ativo: boolean;
  carrinho_texto: string | null;
  venda_ativo: boolean;
  venda_texto: string | null;
  sino_ativo: boolean;
};

const PADRAO: ConfigAutomacoes = {
  refixarAtivo: false,
  refixarIntervaloS: 180,
  refixarPosicao: 1,
  carrinhoAtivo: false,
  carrinhoTexto: null,
  vendaAtivo: false,
  vendaTexto: null,
  sinoAtivo: true,
};

export async function configAutomacoes(perfilId: string): Promise<ConfigAutomacoes> {
  return comDemo(() => PADRAO, () => lerConfig(perfilId));
}

async function lerConfig(perfilId: string): Promise<ConfigAutomacoes> {
  const linhas = await bd()<LinhaConfig[]>`
    select refixar_ativo, refixar_intervalo_s, refixar_posicao,
           carrinho_ativo, carrinho_texto, venda_ativo, venda_texto, sino_ativo
      from live_config
     where perfil_id = ${perfilId}
  `;
  const l = linhas[0];
  if (!l) return PADRAO;

  return {
    refixarAtivo: l.refixar_ativo,
    refixarIntervaloS: numeroDe(l.refixar_intervalo_s, 180),
    refixarPosicao: numeroDe(l.refixar_posicao, 1),
    carrinhoAtivo: l.carrinho_ativo,
    carrinhoTexto: l.carrinho_texto,
    vendaAtivo: l.venda_ativo,
    vendaTexto: l.venda_texto,
    sinoAtivo: l.sino_ativo,
  };
}

function textoDeGatilho(bruto: string | null, rotulo: string): string | null {
  const limpo = bruto?.trim() ?? "";
  if (limpo.length === 0) return null;
  if (limpo.length < 2) throw new ErroDominio("dado_invalido", `Escreva o texto de ${rotulo}.`);

  // O teto é menor que o do chat (150) de propósito: `{nome}` é trocado pelo
  // apelido na hora do envio, e apelido longo empurra a frase para fora do
  // limite. A folga evita que a mensagem chegue cortada por causa do nome de
  // quem comprou.
  if (limpo.length > LIMITES_GATILHO.texto) {
    throw new ErroDominio(
      "dado_invalido",
      `O texto de ${rotulo} tem ${limpo.length} caracteres e o limite é ${LIMITES_GATILHO.texto}, para sobrar espaço ao nome da pessoa. Encurte ${limpo.length - LIMITES_GATILHO.texto}.`,
    );
  }
  return limpo;
}

export async function salvarAutomacoes(
  perfilId: string,
  dados: Partial<ConfigAutomacoes>,
): Promise<void> {
  const atual = await configAutomacoes(perfilId);
  const novo = { ...atual, ...dados };

  const intervalo = Math.min(
    Math.max(numeroDe(novo.refixarIntervaloS, 180), LIMITES_AVISO.intervaloMinS),
    LIMITES_AVISO.intervaloMaxS,
  );
  const posicao = Math.min(Math.max(numeroDe(novo.refixarPosicao, 1), 1), 99);

  const carrinho = textoDeGatilho(novo.carrinhoTexto, "carrinho");
  const venda = textoDeGatilho(novo.vendaTexto, "venda");

  // Ligar o gatilho sem texto deixaria a Shopia detectando a venda e calada.
  // Recusar aqui é melhor do que descobrir ao vivo que nada é dito.
  if (novo.carrinhoAtivo && !carrinho) {
    throw new ErroDominio("dado_invalido", "Escreva o que dizer quando alguém adiciona ao carrinho.");
  }
  if (novo.vendaAtivo && !venda) {
    throw new ErroDominio("dado_invalido", "Escreva o que dizer quando alguém compra.");
  }

  await bd()`
    insert into live_config (
      perfil_id, refixar_ativo, refixar_intervalo_s, refixar_posicao,
      carrinho_ativo, carrinho_texto, venda_ativo, venda_texto, sino_ativo
    )
    values (
      ${perfilId}, ${novo.refixarAtivo}, ${intervalo}, ${posicao},
      ${novo.carrinhoAtivo}, ${carrinho}, ${novo.vendaAtivo}, ${venda}, ${novo.sinoAtivo}
    )
    on conflict (perfil_id) do update
       set refixar_ativo       = excluded.refixar_ativo,
           refixar_intervalo_s = excluded.refixar_intervalo_s,
           refixar_posicao     = excluded.refixar_posicao,
           carrinho_ativo      = excluded.carrinho_ativo,
           carrinho_texto      = excluded.carrinho_texto,
           venda_ativo         = excluded.venda_ativo,
           venda_texto         = excluded.venda_texto,
           sino_ativo          = excluded.sino_ativo
  `;
}

// -----------------------------------------------------------------------------
// O contador da live (item 3)
// -----------------------------------------------------------------------------

export type ContagemDaLive = {
  carrinhos: number;
  vendas: number;
  /**
   * Faturamento ESTIMADO: vendas detectadas × preço do produto fixado.
   *
   * Não é medição, e a tela precisa dizer isso. A mensagem do chat anuncia que
   * alguém comprou, não quanto pagou nem quantas unidades — então o único valor
   * disponível é o preço que o próprio vendedor cadastrou. Cupom, frete, taxa
   * do TikTok e compra de mais de uma unidade fazem o número real divergir.
   *
   * `null` quando não há produto fixado com preço: melhor não mostrar número do
   * que mostrar zero e deixar parecer que não vendeu nada.
   */
  faturamentoEstimadoCentavos: number | null;
  comentarios: number;
  respostas: number;
};

export async function contagemDaLive(
  perfilId: string,
  sessaoId: string | null,
): Promise<ContagemDaLive> {
  const vazio: ContagemDaLive = {
    carrinhos: 0,
    vendas: 0,
    faturamentoEstimadoCentavos: null,
    comentarios: 0,
    respostas: 0,
  };
  if (!sessaoId) return vazio;

  return comDemo(
    () => ({
      carrinhos: 7,
      vendas: 3,
      faturamentoEstimadoCentavos: 26_970,
      comentarios: 42,
      respostas: 11,
    }),
    () => lerContagem(perfilId, sessaoId),
  );
}

async function lerContagem(perfilId: string, sessaoId: string): Promise<ContagemDaLive> {
  const [l] = await bd()<
    {
      carrinhos: number;
      vendas: number;
      comentarios: number;
      respostas: number;
      preco: number | null;
    }[]
  >`
    select
      count(*) filter (where e.tipo = 'carrinho')::int   as carrinhos,
      count(*) filter (where e.tipo = 'venda')::int      as vendas,
      count(*) filter (where e.tipo = 'comentario')::int as comentarios,
      count(*) filter (where e.tipo = 'resposta_ia')::int as respostas,
      (select p.preco_centavos from produtos p
        where p.perfil_id = ${perfilId} and p.fixado and p.arquivado_em is null) as preco
      from live_eventos e
     where e.perfil_id = ${perfilId} and e.live_sessao_id = ${sessaoId}
  `;

  const vendas = numeroDe(l?.vendas);
  const preco = l?.preco === null || l?.preco === undefined ? null : numeroDe(l.preco);

  return {
    carrinhos: numeroDe(l?.carrinhos),
    vendas,
    faturamentoEstimadoCentavos: preco === null ? null : vendas * preco,
    comentarios: numeroDe(l?.comentarios),
    respostas: numeroDe(l?.respostas),
  };
}

// -----------------------------------------------------------------------------
// O agendador: o que a extensão deve fazer AGORA
// -----------------------------------------------------------------------------

export type TarefaProgramada =
  | { acao: "nada"; motivo: string }
  | { acao: "escrever"; avisoId: string; texto: string; tema: string }
  | { acao: "fixar"; posicao: number };

/**
 * A extensão pergunta de tempo em tempo "tem algo para fazer?", e QUEM DECIDE É
 * AQUI.
 *
 * Não é a extensão que conta os segundos. Ela roda na máquina do cliente, onde
 * duas abas abertas na mesma conta contariam em dobro e postariam em dobro — e
 * mensagem duplicada é o sinal de automação mais visível que existe. O relógio
 * de cada automação sai de `live_eventos`, que é um lugar só.
 *
 * Uma tarefa por vez, de propósito. Devolver uma lista faria a extensão
 * executar três coisas em sequência sem a cadência ser recontada entre elas.
 */
export async function proximaTarefa(
  perfilId: string,
  sessaoId: string,
  config: { tetoPorMinuto: number },
): Promise<TarefaProgramada> {
  // Refixar vem primeiro porque não escreve no chat: não gasta cadência, e o
  // produto fora da tela custa mais caro que um aviso atrasado.
  const auto = await configAutomacoes(perfilId);
  if (auto.refixarAtivo) {
    const [r] = await bd()<{ segundos: number | null }[]>`
      select extract(epoch from (now() - max(criado_em)))::int as segundos
        from live_eventos
       where perfil_id = ${perfilId} and live_sessao_id = ${sessaoId}
         and tipo = 'aviso' and dados->>'tema' = 'refixar'
    `;
    const desde = r?.segundos;
    if (desde === null || desde === undefined || desde >= auto.refixarIntervaloS) {
      return { acao: "fixar", posicao: auto.refixarPosicao };
    }
  }

  const avisos = await bd()<
    (LinhaAviso & { segundos_desde: number | null })[]
  >`
    select a.id, a.tipo, a.texto, a.intervalo_s, a.ativo, a.ordem,
           (select extract(epoch from (now() - max(e.criado_em)))::int
              from live_eventos e
             where e.perfil_id = ${perfilId}
               and e.live_sessao_id = ${sessaoId}
               and e.tipo = 'aviso'
               and e.dados->>'aviso_id' = a.id::text) as segundos_desde
      from avisos_programados a
     where a.perfil_id = ${perfilId} and a.ativo
     order by a.tipo, a.ordem, a.criado_em
  `;

  const vencidos = avisos.filter((a) => {
    const desde = a.segundos_desde;
    return desde === null || desde === undefined || desde >= numeroDe(a.intervalo_s);
  });
  if (vencidos.length === 0) return { acao: "nada", motivo: "nenhum_vencido" };

  // O teto da cadência é conferido DEPOIS de saber que há aviso vencido, e o
  // aviso é o primeiro a calar quando o chat está cheio: ninguém está esperando
  // um "aproveitem a oferta". Perder a resposta de quem perguntou o preço custa
  // a venda; perder um aviso não custa nada.
  const [ritmo] = await bd()<{ no_minuto: number }[]>`
    select count(*) filter (where criado_em > now() - interval '1 minute')::int as no_minuto
      from live_eventos
     where perfil_id = ${perfilId} and live_sessao_id = ${sessaoId}
       and tipo in ('resposta_ia', 'aviso')
  `;
  if (numeroDe(ritmo?.no_minuto) >= config.tetoPorMinuto) {
    return { acao: "nada", motivo: "teto_por_minuto" };
  }

  // O mais atrasado primeiro: sem isso, o aviso de intervalo curto abafaria
  // para sempre o de intervalo longo.
  const escolhido = vencidos.sort((a, b) => {
    const da = a.segundos_desde ?? Number.MAX_SAFE_INTEGER;
    const db = b.segundos_desde ?? Number.MAX_SAFE_INTEGER;
    return db - da;
  })[0]!;

  return {
    acao: "escrever",
    avisoId: escolhido.id,
    // Sem `slice` aqui: o texto já foi recusado no cadastro se não cabia, e
    // cortar neste ponto esconderia um bug de validação em vez de expô-lo.
    texto: escolhido.texto,
    tema: escolhido.tipo === "relampago" ? "relampago" : "aviso",
  };
}

/** Registra que o refixar aconteceu, para o intervalo contar a partir de agora. */
export async function registrarRefixada(perfilId: string, sessaoId: string): Promise<void> {
  await bd()`
    insert into live_eventos (live_sessao_id, perfil_id, tipo, dados)
    select ${sessaoId}, ${perfilId}, 'aviso', '{"tema":"refixar"}'::jsonb
     where exists (
       select 1 from live_sessoes
        where id = ${sessaoId} and perfil_id = ${perfilId} and fim is null
     )
  `;
}

/**
 * O teto por minuto da conta.
 *
 * Fica aqui e não em `respostas.ts` porque o agendador precisa dele antes de
 * decidir se publica um aviso, e importar a decisão inteira só para ler um
 * número amarraria os dois módulos sem motivo.
 */
export async function tetoDaConta(perfilId: string): Promise<number> {
  const [l] = await bd()<{ teto: number }[]>`
    select chat_teto_por_minuto as teto from live_config where perfil_id = ${perfilId}
  `;
  return numeroDe(l?.teto, 3);
}
