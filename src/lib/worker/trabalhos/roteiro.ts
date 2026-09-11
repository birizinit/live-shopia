import "server-only";
import { bd } from "@/lib/db";
import { gerarRoteiro } from "@/lib/integracoes/claude";
import { ErroDominio } from "@/lib/dados/erros";
import type { Contexto } from "../index";

/**
 * Gera uma versao nova do roteiro. Nunca sobrescreve a anterior: o texto e o
 * unico ativo que o usuario produziu, e a IA reescreve com frequencia.
 */
export async function executarRoteiro({ perfilId, entrada, progresso }: Contexto) {
  const roteiroId = String(entrada.roteiro_id ?? "");
  if (!perfilId || !roteiroId) throw new ErroDominio("dado_invalido", "job de roteiro sem alvo");

  const sql = bd();
  await progresso(10);

  const alvo = (
    await sql<
      {
        produto_nome: string | null;
        descricao: string | null;
        preco_centavos: number | null;
        preco_de_centavos: number | null;
        cupom: string | null;
        beneficios: string[];
        objecoes: string[];
      }[]
    >`
      select p.nome as produto_nome, p.descricao, p.preco_centavos, p.preco_de_centavos,
             p.cupom, p.beneficios, p.objecoes
        from roteiros r
        left join produtos p on p.id = r.produto_id and p.perfil_id = r.perfil_id
       where r.id = ${roteiroId} and r.perfil_id = ${perfilId}
    `
  )[0];

  if (!alvo) throw new ErroDominio("nao_encontrado", "roteiro não encontrado");

  await progresso(25);

  const gerado = await gerarRoteiro({
    produto: alvo.produto_nome ?? String(entrada.produto ?? "produto"),
    descricao: alvo.descricao,
    precoCentavos: alvo.preco_centavos,
    precoDeCentavos: alvo.preco_de_centavos,
    cupom: alvo.cupom,
    beneficios: Array.isArray(alvo.beneficios) ? (alvo.beneficios as string[]) : [],
    objecoes: Array.isArray(alvo.objecoes) ? (alvo.objecoes as string[]) : [],
    minutosAlvo: Number(entrada.minutos_alvo ?? 3),
    tom: typeof entrada.tom === "string" ? entrada.tom : undefined,
  });

  await progresso(80);

  const texto = gerado.secoes.map((s) => s.texto.trim()).join("\n\n");

  const versao = (
    await sql<{ id: string; numero: number }[]>`
      insert into roteiro_versoes (roteiro_id, perfil_id, numero, secoes, texto, gerado_por_ia, modelo)
      select ${roteiroId}, ${perfilId},
             coalesce(max(numero), 0) + 1, ${sql.json(gerado.secoes)}, ${texto},
             true, ${gerado.demo ? "exemplo" : process.env.ANTHROPIC_MODELO || "claude-opus-5"}
        from roteiro_versoes where roteiro_id = ${roteiroId}
      returning id, numero
    `
  )[0]!;

  await sql`
    update roteiros
       set versao_atual = ${versao.numero},
           titulo = case when titulo = 'Roteiro sem título' then ${gerado.titulo} else titulo end
     where id = ${roteiroId} and perfil_id = ${perfilId}
  `;

  await progresso(100);
  return { versao_id: versao.id, numero: versao.numero, demo: gerado.demo };
}
