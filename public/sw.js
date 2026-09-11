/**
 * Service worker da Shopia — push, e SO push.
 *
 * Nao ha listener de `fetch` aqui, e isso e deliberado. Um listener de fetch
 * passa a intermediar TODA navegacao do app; qualquer bug nele vira tela
 * branca que nem o F5 resolve (o worker antigo continua no comando ate ser
 * substituido). O PWA do manifest.ts nao precisa disso para instalar: display
 * standalone, icone e start_url ja vem do manifesto. Entao este arquivo
 * escuta tres eventos e mais nada.
 *
 * Registrado so na tela /notificacoes, e so quando a pessoa clica em ativar.
 *
 * O corpo da mensagem e o tipo `CargaPush` de src/lib/dados/push.ts:
 *   { titulo, texto?, url?, tag? }
 */

const ICONE = "/icons/shopia.svg";
const URL_PADRAO = "/inicio";
const API_INSCREVER = "/api/push/inscrever";

/**
 * Assume o comando sem esperar as abas antigas fecharem.
 *
 * Sem isto, a primeira notificacao depois de uma correcao no worker ainda
 * seria mostrada pela versao velha — que e exatamente a que tinha o defeito.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(self.clients.claim());
});

/** Le a carga sem confiar nela: push com corpo vazio ou texto solto acontece. */
function lerCarga(evento) {
  const padrao = {
    titulo: "Shopia",
    texto: "Você tem uma novidade no painel.",
    url: URL_PADRAO,
    tag: "shopia",
  };

  if (!evento.data) return padrao;

  try {
    const dados = evento.data.json();
    if (!dados || typeof dados !== "object") return padrao;
    return {
      titulo: typeof dados.titulo === "string" && dados.titulo ? dados.titulo : padrao.titulo,
      texto: typeof dados.texto === "string" ? dados.texto : "",
      // So caminho interno: uma URL externa vinda do corpo da mensagem
      // transformaria a notificacao em porta de saida para outro site.
      url:
        typeof dados.url === "string" &&
        dados.url.startsWith("/") &&
        !dados.url.startsWith("//")
          ? dados.url
          : padrao.url,
      tag: typeof dados.tag === "string" && dados.tag ? dados.tag : padrao.tag,
    };
  } catch {
    const texto = evento.data.text();
    return { ...padrao, texto: texto || padrao.texto };
  }
}

/**
 * A inscricao e `userVisibleOnly: true`: todo push PRECISA virar notificacao
 * visivel. Engolir uma mensagem faz o navegador mostrar no lugar o aviso
 * generico de "este site rodou em segundo plano" — e, repetido, ele revoga a
 * permissao sozinho.
 */
self.addEventListener("push", (evento) => {
  const carga = lerCarga(evento);

  evento.waitUntil(
    self.registration.showNotification(carga.titulo, {
      body: carga.texto,
      icon: ICONE,
      badge: ICONE,
      // Mesma tag substitui a notificacao anterior: dez vendas na mesma live
      // nao podem virar dez linhas empilhadas na tela de bloqueio.
      tag: carga.tag,
      renotify: true,
      lang: "pt-BR",
      data: { url: carga.url },
    }),
  );
});

/** Clique leva para a aba que ja existe; abrir uma segunda e perder o contexto. */
self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();

  const destino = new URL(
    (evento.notification.data && evento.notification.data.url) || URL_PADRAO,
    self.location.origin,
  );

  evento.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((abas) => {
        for (const aba of abas) {
          if (new URL(aba.url).origin !== destino.origin) continue;
          if ("focus" in aba) {
            aba.focus();
            if ("navigate" in aba) return aba.navigate(destino.href);
            return undefined;
          }
        }
        return self.clients.openWindow(destino.href);
      }),
  );
});

/**
 * O navegador troca a inscricao sozinho (rotacao de chave, limpeza do
 * servico). Sem reinscrever aqui, o aparelho fica mudo e ninguem descobre:
 * do lado do servidor a linha continua parecendo viva ate o primeiro 410.
 *
 * O POST reaproveita a rota de inscricao, que faz `on conflict (endpoint)` —
 * o endpoint novo entra, e o velho morre no proximo envio.
 */
self.addEventListener("pushsubscriptionchange", (evento) => {
  evento.waitUntil(
    (async () => {
      let inscricao = evento.newSubscription || null;

      if (!inscricao) {
        const anterior = evento.oldSubscription;
        const chave = anterior && anterior.options && anterior.options.applicationServerKey;
        if (!chave) return;
        inscricao = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: chave,
        });
      }

      const dados = inscricao.toJSON();
      if (!dados.endpoint || !dados.keys) return;

      await fetch(API_INSCREVER, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // O cookie de sessao e HttpOnly e same-origin: ele viaja neste fetch,
        // que e o unico motivo desta rota poder exigir sessao.
        credentials: "same-origin",
        body: JSON.stringify({
          endpoint: dados.endpoint,
          p256dh: dados.keys.p256dh,
          auth: dados.keys.auth,
        }),
      });
    })(),
  );
});
