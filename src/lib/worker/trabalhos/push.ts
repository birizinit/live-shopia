import "server-only";
import webpush from "web-push";
import { bd } from "@/lib/db";
import { env, servicos } from "@/lib/env";
import { ErroDominio } from "@/lib/dados/erros";
import type { CargaPush } from "@/lib/dados/push";
import type { Contexto } from "../index";

/**
 * Entrega de notificação push.
 *
 * O envio é por aparelho, não por pessoa: um cliente com celular e desktop tem
 * duas inscrições, e uma falhar não pode impedir a outra de receber.
 *
 * Por que isto é um job e não uma chamada direta: o push sai no caminho de uma
 * venda. Se o servidor de push do navegador estiver lento, a venda não pode
 * esperar por ele — e se falhar, quem tem que sobreviver é a venda.
 */

let configurado = false;

function configurar() {
  if (configurado) return;
  webpush.setVapidDetails(
    env.vapidAssunto || "mailto:suporte@shopia.app",
    env.vapidPublica,
    env.vapidPrivada,
  );
  configurado = true;
}

type LinhaInscricao = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  falhas: number;
};

/**
 * Códigos em que o navegador diz "esta inscrição morreu".
 *
 * 404 e 410 são definitivos: o usuário desinstalou o app, limpou os dados ou
 * o navegador expirou a inscrição. Insistir nesses é gastar requisição para
 * sempre — e é assim que uma tabela de inscrições vira lixo que nunca limpa.
 */
const MORREU = new Set([404, 410]);

/** Depois disto, a inscrição é desativada mesmo sem código definitivo. */
const TETO_DE_FALHAS = 5;

export async function executarPush(ctx: Contexto) {
  const entrada = ctx.entrada;
  const perfilId = String(entrada.perfil_id ?? ctx.perfilId ?? "");

  if (!perfilId) {
    throw new ErroDominio("dado_invalido", "job de push sem perfil");
  }

  // Sem chave VAPID não há como assinar o envio. Falha permanente: o worker
  // não repete, e o job aparece como falhado em vez de sumir em silêncio.
  if (!servicos.push) {
    throw new ErroDominio(
      "sem_permissao",
      "O envio de push depende de VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY.",
    );
  }

  const carga = entrada.carga as CargaPush | undefined;
  if (!carga?.titulo) {
    throw new ErroDominio("dado_invalido", "job de push sem título");
  }

  configurar();
  const sql = bd();

  const inscricoes = await sql<LinhaInscricao[]>`
    select id, endpoint, p256dh, auth, falhas
      from push_inscricoes
     where perfil_id = ${perfilId} and desativada_em is null
  `;

  if (inscricoes.length === 0) {
    return { enviados: 0, motivo: "nenhum aparelho inscrito" };
  }

  const corpo = JSON.stringify({
    titulo: carga.titulo,
    texto: carga.texto ?? "",
    // Caminho interno sempre: URL absoluta vinda de fora levaria o clique do
    // cliente para onde quem enfileirou o job quisesse.
    url: carga.url?.startsWith("/") ? carga.url : "/inicio",
    tag: carga.tag ?? "shopia",
  });

  let enviados = 0;
  let desativadas = 0;

  for (const inscricao of inscricoes) {
    try {
      await webpush.sendNotification(
        {
          endpoint: inscricao.endpoint,
          keys: { p256dh: inscricao.p256dh, auth: inscricao.auth },
        },
        corpo,
        { TTL: 60 * 60 * 6 },
      );

      enviados += 1;
      await sql`
        update push_inscricoes
           set ultimo_envio_em = now(), falhas = 0
         where id = ${inscricao.id}
      `;
    } catch (erro) {
      const status = (erro as { statusCode?: number })?.statusCode ?? 0;
      const definitivo = MORREU.has(status);
      const falhas = inscricao.falhas + 1;

      await sql`
        update push_inscricoes
           set falhas = ${falhas},
               desativada_em = ${definitivo || falhas >= TETO_DE_FALHAS ? new Date() : null}
         where id = ${inscricao.id}
      `;

      if (definitivo || falhas >= TETO_DE_FALHAS) desativadas += 1;
    }
  }

  // Nenhum aparelho recebeu, mas o job não falhou: aparelho desinscrito é
  // estado normal do mundo, não erro que mereça retentativa.
  return { enviados, desativadas, aparelhos: inscricoes.length };
}
