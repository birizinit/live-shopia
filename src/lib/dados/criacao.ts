import "server-only";
import { bd } from "@/lib/db";
import { comDemo, numeroDe } from "./comum";
import { ErroDominio } from "./erros";
import { criarProduto, type EntradaProduto } from "./produtos";

/**
 * O caminho curto até a live: produto → manual → extensão → no ar.
 *
 * Antes, cada passo era uma tela e a pessoa precisava saber a ordem — as
 * primeiras clientes instalaram a extensão sem nada cadastrado, e a Shopia
 * ficava muda na live inteira sem dizer por quê. Este módulo junta os passos
 * que não pedem decisão e deixa para a tela só o que pede.
 *
 * Era aqui que morava a criação de roteiro, voz e montagem de áudio. Saiu tudo
 * na 0026: a Shopia não fala mais, ela modera.
 */

export type PedidoDeLive = {
  /** Produto já cadastrado… */
  produtoId: string | null;
  /** …ou o que acabou de ser digitado no assistente. */
  produto: EntradaProduto | null;
};

/**
 * Garante que existe o produto e devolve o id, para o assistente seguir para o
 * manual. Cadastrar o mesmo produto duas vezes por duplo clique é problema do
 * formulário (que manda `produtoId` na segunda vez), não daqui.
 */
export async function comecarCriacao(perfilId: string, pedido: PedidoDeLive): Promise<string> {
  const produtoId =
    pedido.produtoId ?? (pedido.produto ? await criarProduto(perfilId, pedido.produto) : null);
  if (!produtoId) throw new ErroDominio("dado_invalido", "Diga o que você vai vender.");
  return produtoId;
}

// -----------------------------------------------------------------------------
// Onde a pessoa está no caminho — o que o Início mostra.
// -----------------------------------------------------------------------------

export type JornadaDaLive = {
  produto: {
    /** Tem ao menos um produto cadastrado e não arquivado. */
    pronto: boolean;
    nome: string | null;
    quantos: number;
  };
  manual: {
    /**
     * Tem manual utilizável. O corte é em respostas ATIVAS: manual com tudo
     * desligado é manual vazio na hora da live, e dizer "pronto" aqui faria a
     * pessoa descobrir isso ao vivo.
     */
    pronto: boolean;
    perguntas: number;
    semResposta: number;
  };
  extensao: {
    instalada: boolean;
    /**
     * Conectada AGORA: licença valendo (não revogada, não substituída por
     * login em outra máquina, dentro da janela) e contato nos últimos 15 min.
     * "Instalada um dia" não basta — a extensão desloga.
     */
    conectada: boolean;
    /** Último contato de qualquer máquina desta conta. */
    vistaEm: string | null;
  };
  /** Assinatura ativa e dentro do prazo: sem ela a extensão tranca. */
  planoAtivo: boolean;
  live: {
    noAr: boolean;
    desde: string | null;
    lives: number;
  };
  riscoAceito: boolean;
};

const JORNADA_DEMO: JornadaDaLive = {
  produto: { pronto: true, nome: "Kit 3 camisetas", quantos: 3 },
  manual: { pronto: true, perguntas: 6, semResposta: 2 },
  extensao: { instalada: false, conectada: false, vistaEm: null },
  planoAtivo: true,
  live: { noAr: false, desde: null, lives: 0 },
  riscoAceito: true,
};

export async function jornadaDaLive(perfilId: string): Promise<JornadaDaLive> {
  return comDemo(
    () => JORNADA_DEMO,
    async () => {
      const linha = (
        await bd()<
          {
            produto_nome: string | null;
            produtos: number;
            perguntas: number;
            sem_resposta: number;
            extensao_vista_em: Date | null;
            instalacoes: number;
            ao_vivo_desde: Date | null;
            lives: number;
            risco_ok: boolean | null;
            licenca_ok: boolean;
            plano_ok: boolean;
          }[]
        >`
          select
            (select p.nome from produtos p
              where p.perfil_id = ${perfilId} and p.arquivado_em is null
              order by p.fixado desc, p.criado_em desc limit 1) as produto_nome,
            (select count(*)::int from produtos p
              where p.perfil_id = ${perfilId} and p.arquivado_em is null) as produtos,
            (select count(*)::int from temas_resposta t
              where t.perfil_id = ${perfilId} and t.ativo) as perguntas,
            (select count(distinct lower(btrim(e.texto)))::int
               from live_eventos e
              where e.perfil_id = ${perfilId}
                and e.tipo = 'comentario'
                and e.texto is not null
                and length(btrim(e.texto)) between 4 and 200
                and classificar_mensagem(e.texto) is null
                and (select id from casar_tema(${perfilId}, e.texto)) is null) as sem_resposta,
            (select max(e.ultimo_contato) from ext_instalacoes e
              where e.perfil_id = ${perfilId}) as extensao_vista_em,
            (select count(*)::int from ext_instalacoes e
              where e.perfil_id = ${perfilId}) as instalacoes,
            (select min(s.inicio) from live_sessoes s
              where s.perfil_id = ${perfilId} and s.estado = 'ativa' and s.fim is null) as ao_vivo_desde,
            (select count(*)::int from live_sessoes s where s.perfil_id = ${perfilId}) as lives,
            -- O aceite vale só na versão vigente do aviso — a mesma regra que
            -- /api/ext/sessao aplica antes de abrir a sessão.
            (select lc.risco_aceito_em is not null
                    and coalesce(lc.risco_aceito_versao, 0) >= coalesce(
                      (select (c.valor #>> '{}')::int from configuracoes c
                        where c.chave = 'live.risco_aceito_versao'), 1)
               from live_config lc
              where lc.perfil_id = ${perfilId}) as risco_ok,
            exists (select 1 from ext_licencas l
                     where l.perfil_id = ${perfilId}
                       and l.revogada_em is null and l.expira_em > now()) as licenca_ok,
            exists (select 1 from assinaturas a
                     where a.perfil_id = ${perfilId} and a.status = 'ativa'
                       and (a.fim is null or a.fim > now())) as plano_ok
        `
      )[0]!;

      const produtos = numeroDe(linha.produtos);
      const perguntas = numeroDe(linha.perguntas);

      return {
        produto: {
          pronto: produtos > 0,
          nome: linha.produto_nome,
          quantos: produtos,
        },
        manual: {
          pronto: perguntas > 0,
          perguntas,
          semResposta: numeroDe(linha.sem_resposta),
        },
        extensao: {
          instalada: numeroDe(linha.instalacoes) > 0,
          conectada:
            linha.licenca_ok === true &&
            linha.extensao_vista_em !== null &&
            Date.now() - linha.extensao_vista_em.getTime() < 15 * 60_000,
          vistaEm: linha.extensao_vista_em?.toISOString() ?? null,
        },
        planoAtivo: linha.plano_ok === true,
        live: {
          noAr: linha.ao_vivo_desde !== null,
          desde: linha.ao_vivo_desde?.toISOString() ?? null,
          lives: numeroDe(linha.lives),
        },
        riscoAceito: linha.risco_ok === true,
      };
    },
  );
}
