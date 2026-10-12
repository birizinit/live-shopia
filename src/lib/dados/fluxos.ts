import "server-only";
import { bd } from "@/lib/db";
import { ErroDominio } from "./erros";
import { comDemo, numeroDe } from "./comum";
import type { ModoFluxo } from "@/lib/fluxos";

/**
 * Fluxos de resposta: "quando comentarem X, responda Y".
 *
 * A pessoa monta aqui no app; quem executa é a extensão, lendo o chat da aba
 * da live (ver extensao/fluxos.js e db/migrations/0031_fluxos.sql). O
 * servidor guarda, valida e entrega a lista — não decide na hora.
 */

export type Fluxo = {
  id: string;
  nome: string;
  modo: ModoFluxo;
  gatilhos: string[];
  respostas: string[];
  atrasoS: number;
  marcar: boolean;
  umaVezPorPessoa: boolean;
  intervaloS: number;
  ativo: boolean;
  ordem: number;
  vezesUsado: number;
};

export type DadosFluxo = Omit<Fluxo, "id" | "ordem" | "vezesUsado">;

export const LIMITES_FLUXO = {
  quantidade: 50,
  nome: 60,
  gatilhos: 20,
  gatilho: 60,
  respostas: 5,
  /** O teto do campo do chat do TikTok. */
  resposta: 150,
  /** Com "@nome " na frente, sobra espaço para um apelido de até 30. */
  respostaMarcando: 120,
  atrasoMaxS: 300,
  intervaloMaxS: 3600,
} as const;

type Linha = {
  id: string;
  nome: string;
  modo: ModoFluxo;
  gatilhos: string[];
  respostas: string[];
  atraso_s: number;
  marcar: boolean;
  uma_vez_por_pessoa: boolean;
  intervalo_s: number;
  ativo: boolean;
  ordem: number;
  vezes_usado: number;
};

const daLinha = (l: Linha): Fluxo => ({
  id: l.id,
  nome: l.nome,
  modo: l.modo,
  gatilhos: l.gatilhos ?? [],
  respostas: l.respostas ?? [],
  atrasoS: numeroDe(l.atraso_s, 10),
  marcar: l.marcar,
  umaVezPorPessoa: l.uma_vez_por_pessoa,
  intervaloS: numeroDe(l.intervalo_s, 20),
  ativo: l.ativo,
  ordem: numeroDe(l.ordem),
  vezesUsado: numeroDe(l.vezes_usado),
});

/** Exemplo do modo demo, rotulado como exemplo pela própria tela. */
const FLUXOS_DEMO: Fluxo[] = [
  {
    id: "00000000-0000-4000-8000-0000000f1001",
    nome: "Frete",
    modo: "contem",
    gatilhos: ["frete", "entrega"],
    respostas: ["Frete grátis pra todo o Brasil acima de R$ 99!"],
    atrasoS: 10,
    marcar: true,
    umaVezPorPessoa: true,
    intervaloS: 20,
    ativo: true,
    ordem: 10,
    vezesUsado: 0,
  },
];

export async function listarFluxos(perfilId: string): Promise<Fluxo[]> {
  return comDemo(
    () => FLUXOS_DEMO,
    async () => {
      const linhas = await bd()<Linha[]>`
        select id, nome, modo, gatilhos, respostas, atraso_s, marcar, uma_vez_por_pessoa,
               intervalo_s, ativo, ordem, vezes_usado
          from fluxos
         where perfil_id = ${perfilId}
         order by ordem, criado_em
      `;
      return linhas.map(daLinha);
    },
  );
}

/** Só os ligados, na ordem — o que a extensão executa. */
export async function fluxosAtivos(perfilId: string): Promise<Fluxo[]> {
  return (await listarFluxos(perfilId)).filter((f) => f.ativo);
}

function limparLista(lista: string[], max: number, maxCada: number, rotulo: string): string[] {
  const vistos = new Set<string>();
  const limpa: string[] = [];
  for (const bruto of lista) {
    const item = bruto.replace(/\s+/g, " ").trim();
    if (!item) continue;
    if (item.length > maxCada) {
      throw new ErroDominio(
        "dado_invalido",
        `${rotulo} "${item.slice(0, 30)}…" tem ${item.length} caracteres; o máximo é ${maxCada}.`,
      );
    }
    const chave = item.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    limpa.push(item);
  }
  if (limpa.length > max) throw new ErroDominio("dado_invalido", `No máximo ${max} itens em ${rotulo.toLowerCase()}.`);
  return limpa;
}

/** Recusa, não corta: ao vivo não dá para pedir para reescrever. */
export function validarFluxo(dados: DadosFluxo): DadosFluxo {
  const nome = dados.nome.trim();
  if (!nome) throw new ErroDominio("dado_invalido", "Dê um nome ao fluxo.");
  if (nome.length > LIMITES_FLUXO.nome) {
    throw new ErroDominio("dado_invalido", `O nome tem no máximo ${LIMITES_FLUXO.nome} caracteres.`);
  }
  if (dados.modo !== "contem" && dados.modo !== "exato") {
    throw new ErroDominio("dado_invalido", "Escolha como o comentário deve casar.");
  }

  const gatilhos = limparLista(dados.gatilhos, LIMITES_FLUXO.gatilhos, LIMITES_FLUXO.gatilho, "Gatilho");
  if (!gatilhos.length) throw new ErroDominio("dado_invalido", "Escreva ao menos uma palavra ou frase de gatilho.");

  const tetoResposta = dados.marcar ? LIMITES_FLUXO.respostaMarcando : LIMITES_FLUXO.resposta;
  const respostas = limparLista(dados.respostas, LIMITES_FLUXO.respostas, tetoResposta, "Resposta");
  if (!respostas.length) throw new ErroDominio("dado_invalido", "Escreva a resposta.");

  const atrasoS = Math.trunc(dados.atrasoS);
  if (!Number.isFinite(atrasoS) || atrasoS < 0 || atrasoS > LIMITES_FLUXO.atrasoMaxS) {
    throw new ErroDominio("dado_invalido", `A espera vai de 0 a ${LIMITES_FLUXO.atrasoMaxS} segundos.`);
  }
  const intervaloS = Math.trunc(dados.intervaloS);
  if (!Number.isFinite(intervaloS) || intervaloS < 0 || intervaloS > LIMITES_FLUXO.intervaloMaxS) {
    throw new ErroDominio("dado_invalido", "O intervalo vai de 0 a 1 hora.");
  }

  return { ...dados, nome, gatilhos, respostas, atrasoS, intervaloS };
}

export async function criarFluxo(perfilId: string, dados: DadosFluxo): Promise<string> {
  const f = validarFluxo(dados);
  const [contagem] = await bd()<{ n: number }[]>`
    select count(*)::int n from fluxos where perfil_id = ${perfilId}
  `;
  if (numeroDe(contagem?.n) >= LIMITES_FLUXO.quantidade) {
    throw new ErroDominio("conflito", `São no máximo ${LIMITES_FLUXO.quantidade} fluxos. Apague um para criar outro.`);
  }
  const [maior] = await bd()<{ ordem: number | null }[]>`
    select max(ordem) as ordem from fluxos where perfil_id = ${perfilId}
  `;
  const [linha] = await bd()<{ id: string }[]>`
    insert into fluxos (perfil_id, nome, modo, gatilhos, respostas, atraso_s, marcar,
                        uma_vez_por_pessoa, intervalo_s, ativo, ordem)
    values (${perfilId}, ${f.nome}, ${f.modo}, ${f.gatilhos}, ${f.respostas}, ${f.atrasoS},
            ${f.marcar}, ${f.umaVezPorPessoa}, ${f.intervaloS}, ${f.ativo},
            ${numeroDe(maior?.ordem) + 10})
    returning id
  `;
  return linha!.id;
}

export async function editarFluxo(perfilId: string, id: string, dados: DadosFluxo): Promise<void> {
  const f = validarFluxo(dados);
  const linhas = await bd()<{ id: string }[]>`
    update fluxos
       set nome = ${f.nome}, modo = ${f.modo}, gatilhos = ${f.gatilhos}, respostas = ${f.respostas},
           atraso_s = ${f.atrasoS}, marcar = ${f.marcar}, uma_vez_por_pessoa = ${f.umaVezPorPessoa},
           intervalo_s = ${f.intervaloS}, ativo = ${f.ativo}
     where id = ${id} and perfil_id = ${perfilId}
    returning id
  `;
  if (!linhas.length) throw new ErroDominio("nao_encontrado", "Fluxo não encontrado.");
}

export async function alternarFluxo(perfilId: string, id: string, ativo: boolean): Promise<void> {
  const linhas = await bd()<{ id: string }[]>`
    update fluxos set ativo = ${ativo} where id = ${id} and perfil_id = ${perfilId} returning id
  `;
  if (!linhas.length) throw new ErroDominio("nao_encontrado", "Fluxo não encontrado.");
}

export async function removerFluxo(perfilId: string, id: string): Promise<void> {
  await bd()`delete from fluxos where id = ${id} and perfil_id = ${perfilId}`;
}

/** A extensão conta quantas vezes cada fluxo respondeu. */
export async function contarUsoDoFluxo(perfilId: string, id: string): Promise<void> {
  await bd()`
    update fluxos set vezes_usado = vezes_usado + 1 where id = ${id} and perfil_id = ${perfilId}
  `;
}
