// Service worker: coordena, não toca áudio.
//
// Em MV3 este processo MORRE depois de ~30 segundos ocioso e volta quando algo
// o acorda. Então tudo que precisa durar horas — o áudio — mora no painel
// lateral, e tudo que precisa sobreviver à morte dele mora no storage.
//
// O que este arquivo faz:
//   - bate na licença de tempos em tempos (chrome.alarms sobrevive à morte)
//   - guarda o mapa de seletores e entrega a quem pedir
//   - obedece o kill switch e manda todo mundo parar
//   - junta os eventos do chat e manda em lote para o servidor

import * as api from "./api.js";

const ALARME_LICENCA = "shopia:licenca";
const ALARME_EVENTOS = "shopia:eventos";
const ALARME_SESSAO = "shopia:sessao";
const CHAVE_CHAT = "shopia_chat";

/** Estado vivo. Reconstruído do storage quando o worker renasce. */
let estado = {
  licenciada: false,
  motivo: null,
  recursos: { mixer: false, chat: false },
  versaoPublicada: null,
  atualizacaoObrigatoria: false,
  pararAgora: false,
  pararMotivo: null,
  heartbeatSegundos: 120,
  ultimoContato: null,
};

let fila = [];

/**
 * O worker morre ocioso e renasce com `estado` no valor padrão — inclusive
 * `pararAgora: false`. Sem reler o que foi guardado, um renascimento seguido de
 * rede caída desfazia o kill switch sozinho: o ramo "offline" espalhava o
 * padrão por cima da ordem de parar. Service worker não aceita await no topo do
 * módulo, então quem precisa do estado espera esta promessa.
 */
const restaurado = (chrome.storage.session?.get("shopia_estado") ?? Promise.resolve({}))
  .then((r) => {
    if (r?.shopia_estado) estado = { ...estado, ...r.shopia_estado };
  })
  .catch(() => {});

const versaoDaExtensao = () => chrome.runtime.getManifest().version;

async function avisarTodos(mensagem) {
  // O painel pode estar fechado e a aba pode não existir: falar com ninguém
  // não é erro, e não pode derrubar o batimento.
  chrome.runtime.sendMessage(mensagem).catch(() => {});
  try {
    const abas = await chrome.tabs.query({ url: "*://*.tiktok.com/*" });
    for (const aba of abas) chrome.tabs.sendMessage(aba.id, mensagem).catch(() => {});
  } catch {
    /* sem abas do TikTok */
  }
}

async function guardarEstado() {
  await chrome.storage.session?.set({ shopia_estado: estado }).catch(() => {});
}

async function baterLicenca() {
  await restaurado;
  const token = await api.token();
  if (!token) {
    estado = { ...estado, licenciada: false, motivo: "sem_token" };
    await avisarTodos({ tipo: "estado", estado });
    return estado;
  }

  const mapaVersao = await api.lerLocal(api.CHAVES.mapaVersao);

  try {
    const r = await api.licenca({ versao: versaoDaExtensao(), mapaVersao });

    estado = {
      licenciada: true,
      motivo: null,
      recursos: {
        mixer: Boolean(r.recursos?.mixer),
        chat: Boolean(r.recursos?.chat),
        chatDesligadoNaBase: Boolean(r.recursos?.chatDesligadoNaBase),
      },
      versaoPublicada: r.versao?.publicada ?? null,
      atualizacaoObrigatoria: Boolean(r.versao?.obrigatoria),
      notas: r.versao?.notas ?? null,
      expiraEm: r.licenca?.expiraEm ?? null,
      pararAgora: Boolean(r.pararAgora),
      pararMotivo: r.pararMotivo ?? null,
      heartbeatSegundos: Number(r.heartbeatSegundos) || 120,
      ultimoContato: new Date().toISOString(),
    };

    await sincronizarMapa(mapaVersao);

    if (estado.pararAgora) {
      // Kill switch. A ordem é imediata e vale para a versão que está rodando
      // agora: no dia em que a extensão estiver derrubando a conta do cliente,
      // não dá para esperar ele atualizar.
      await avisarTodos({ tipo: "parar", motivo: estado.pararMotivo });
    }
  } catch (erro) {
    if (erro.codigo === "rede") {
      // Offline não é perda de licença. Manter o estado anterior é o que
      // impede a live cair porque o Wi-Fi oscilou.
      estado = { ...estado, motivo: "offline" };
    } else {
      estado = {
        ...estado,
        licenciada: false,
        motivo: erro.codigo,
        pararAgora: erro.codigo === "expirada" || erro.codigo === "revogada",
        pararMotivo: erro.message,
      };
      if (estado.pararAgora) await avisarTodos({ tipo: "parar", motivo: erro.message });
    }
  }

  await guardarEstado();
  await avisarTodos({ tipo: "estado", estado });
  return estado;
}

async function sincronizarMapa(versaoConhecida) {
  try {
    const r = await api.seletores(versaoConhecida);
    if (r.mudou && r.mapa) {
      await api.gravarLocal({
        [api.CHAVES.mapa]: r.mapa,
        [api.CHAVES.mapaVersao]: r.versao,
      });
      await avisarTodos({ tipo: "mapa", mapa: r.mapa, versao: r.versao });
    }
  } catch {
    // Sem mapa novo a extensão segue com o que tem em cache. Falhar aqui não
    // pode parar a live.
  }
}

async function despejarFila() {
  if (fila.length === 0) return;

  const sessaoId = await api.lerLocal(api.CHAVES.sessao);
  if (!sessaoId) {
    // Sem sessão aberta os eventos não têm onde morar. Descartar é melhor do
    // que acumular para sempre na memória de um worker que vai morrer.
    fila = [];
    return;
  }

  const lote = fila.splice(0, 200);
  try {
    await api.enviarEventos(sessaoId, lote);
  } catch (erro) {
    // Sessão encerrada do outro lado: não adianta insistir.
    if (erro.codigo === "nao_encontrado" || erro.status === 404) {
      await chrome.storage.local.remove(api.CHAVES.sessao);
      fila = [];
      return;
    }
    // Rede: devolve para a frente da fila e tenta no próximo ciclo, com teto
    // para a fila não crescer sem limite se o servidor ficar fora por horas.
    fila = [...lote, ...fila].slice(0, 1000);
  }
}

/**
 * Mantém viva a sessão aberta, mesmo com o painel lateral fechado.
 *
 * No modo só chat nada precisa do painel: quem lê o chat é o content script e
 * quem guarda o token é este worker. Mas o batimento da sessão morava no
 * painel, junto do motor de áudio — então fechar o painel derrubava a sessão
 * pela faxina do servidor, e o chat parava de responder sem ninguém entender
 * por quê. Aqui ele sobrevive: `chrome.alarms` acorda o worker morto.
 */
async function baterSessaoAberta() {
  const sessaoId = await api.lerLocal(api.CHAVES.sessao);
  if (!sessaoId) return;

  try {
    await api.baterSessao(sessaoId, null);
  } catch (erro) {
    // 409 = o servidor já fechou esta sessão. Insistir seria bater numa porta
    // que não existe mais a cada minuto, para sempre.
    if (erro?.codigo === "sessao_encerrada") {
      await chrome.storage.local.remove(api.CHAVES.sessao);
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARME_LICENCA, { periodInMinutes: 2 });
  chrome.alarms.create(ALARME_EVENTOS, { periodInMinutes: 0.5 });
  chrome.alarms.create(ALARME_SESSAO, { periodInMinutes: 1 });
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARME_LICENCA, { periodInMinutes: 2 });
  chrome.alarms.create(ALARME_EVENTOS, { periodInMinutes: 0.5 });
  chrome.alarms.create(ALARME_SESSAO, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarme) => {
  if (alarme.name === ALARME_LICENCA) void baterLicenca();
  if (alarme.name === ALARME_EVENTOS) void despejarFila();
  if (alarme.name === ALARME_SESSAO) void baterSessaoAberta();
});

chrome.action.onClicked.addListener((aba) => {
  chrome.sidePanel.open({ tabId: aba.id }).catch(() => {});
});

chrome.runtime.onMessage.addListener((mensagem, remetente, responder) => {
  (async () => {
    await restaurado;
    switch (mensagem?.tipo) {
      case "estado":
        responder({ ok: true, estado });
        break;

      case "bater":
        responder({ ok: true, estado: await baterLicenca() });
        break;

      case "mapa": {
        const mapa = await api.lerLocal(api.CHAVES.mapa);
        const versao = await api.lerLocal(api.CHAVES.mapaVersao);
        const locais = await api.lerLocal(api.CHAVES.ancorasLocais);
        responder({ ok: true, mapa, versao, locais: locais ?? {} });
        break;
      }

      case "aprendeu": {
        // A âncora aprendida é gravada AQUI e não no content script: storage da
        // extensão é do service worker, e uma aba que recarrega perderia o que
        // a pessoa acabou de ensinar.
        if (mensagem.ancora && Array.isArray(mensagem.cascata) && mensagem.cascata.length > 0) {
          const atuais = (await api.lerLocal(api.CHAVES.ancorasLocais)) ?? {};
          await api.gravarLocal({
            [api.CHAVES.ancorasLocais]: { ...atuais, [mensagem.ancora]: mensagem.cascata },
          });
        }
        // O painel escuta esta mesma mensagem para repintar; aqui só confirma.
        responder({ ok: true });
        break;
      }

      case "eventos":
        // Guarda e responde na hora: o content script não pode ficar esperando
        // a rede para continuar lendo o chat.
        fila.push(...(mensagem.eventos ?? []));
        if (fila.length > 1000) fila = fila.slice(-1000);
        responder({ ok: true });
        break;

      case "quebras":
        void api.relatarQuebra(mensagem.falhas ?? []);
        responder({ ok: true });
        break;

      case "decidir": {
        // O content script pergunta, o servidor decide. Aqui é só o carteiro:
        // quem tem o token é este worker, e o content script roda numa página
        // de terceiro onde credencial não pode entrar.
        const sessaoId = await api.lerLocal(api.CHAVES.sessao);
        if (!sessaoId) {
          responder({ ok: false, acao: "ignorar", motivo: "sem_sessao" });
          break;
        }

        try {
          const decisao = await api.decidirResposta({ sessaoId, ...mensagem.evento });

          // Falar é com o painel: é lá que o motor de áudio vive. O content
          // script não tem como tocar nada.
          if (decisao.acao === "falar") {
            chrome.runtime
              .sendMessage({ tipo: "falar", decisao, sessaoId })
              .catch(() => {});
            responder({ ok: true, acao: "falando" });
            break;
          }

          responder({ ok: true, ...decisao });
        } catch (erro) {
          responder({ ok: false, acao: "ignorar", motivo: erro.codigo ?? "falhou" });
        }
        break;
      }

      case "respondeu": {
        const sessaoId = await api.lerLocal(api.CHAVES.sessao);
        if (sessaoId) {
          await api
            .confirmarResposta(sessaoId, mensagem.texto ?? "", mensagem.tema ?? null)
            .catch(() => {});
        }
        responder({ ok: true });
        break;
      }

      case "sessao":
        await api.gravarLocal({ [api.CHAVES.sessao]: mensagem.sessaoId ?? null });
        responder({ ok: true });
        break;

      case "chat_status":
        // Guardado na sessão do navegador: o painel que abrir depois lê daqui
        // em vez de esperar a próxima volta do content script.
        await chrome.storage.session
          ?.set({ [CHAVE_CHAT]: { estado: mensagem.estado, aba: remetente?.tab?.id ?? null, em: Date.now() } })
          .catch(() => {});
        responder({ ok: true });
        break;

      case "rotulos_liberados":
      case "chat":
        // Quem reage é o painel (recarrega as saídas, soma o contador); aqui
        // só se confirma o recebimento.
        responder({ ok: true });
        break;

      case "despejar":
        await despejarFila();
        responder({ ok: true });
        break;

      default:
        responder({ ok: false, erro: "mensagem_desconhecida" });
    }
  })();

  // true = a resposta vem depois, de forma assíncrona.
  return true;
});
