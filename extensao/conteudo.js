// Content script: lê o chat do TikTok e reporta.
//
// Roda na aba do tiktok.com. NÃO toca áudio (isso é do painel lateral) e NÃO
// fala com o nosso servidor direto — passa tudo pelo service worker, que é
// quem tem o token. Content script vive numa página de terceiro; token de
// licença não entra aqui.
//
// Ele também não conhece nenhum seletor: pede o mapa ao service worker e
// resolve por nome de âncora. Quando o TikTok muda o DOM, o conserto é um
// mapa novo publicado no servidor, não uma versão nova da extensão.

(async () => {
  "use strict";

  // Só a página da live interessa. A conferência é a cada volta, e não uma vez
  // na carga: o TikTok é aplicação de página única, e quem sai do feed para a
  // própria live não recarrega a página — o script já estava aqui, dormindo.
  const ehPaginaDaLive = () => /\/(live|studio|live_studio)(\/|$)/i.test(location.pathname);

  const { Mapa, descrever, alvoClicavel } = await import(chrome.runtime.getURL("seletores.js"));
  const produtos = await import(chrome.runtime.getURL("produtos.js"));

  let mapa = new Mapa({}, null);
  /** Âncoras aprendidas nesta instalação. Vencem o mapa publicado. */
  let ancorasLocais = {};
  let observador = null;
  let listaObservada = null;
  let ligado = false;
  let suspenso = false;
  const vistos = new Set();
  let pendentes = [];

  // Estado do chat, contado ao painel: é o que responde "a extensão está
  // lendo a minha live?" sem ninguém precisar abrir o console.
  let tentativasSemChat = 0;
  let ultimoEstado = null;

  function contarEstado(estado) {
    if (estado === ultimoEstado) return;
    ultimoEstado = estado;
    void pedir({ tipo: "chat_status", estado, caminho: location.pathname.slice(0, 80) });
  }

  async function pedir(mensagem) {
    try {
      return await chrome.runtime.sendMessage(mensagem);
    } catch {
      // Service worker dormindo ou extensão recarregada. A próxima tentativa
      // acorda ele; perder uma mensagem de chat não justifica quebrar o laço.
      return null;
    }
  }

  async function carregarMapa() {
    const r = await pedir({ tipo: "mapa" });
    if (r?.locais) ancorasLocais = r.locais;
    if (r?.mapa) mapa = new Mapa(r.mapa, r.versao, ancorasLocais);
    return Boolean(r?.mapa);
  }

  /** Chave estável do comentário, para não reportar o mesmo duas vezes. */
  function identidade(no, apelido, texto) {
    const id = no.getAttribute?.("data-id") || no.id;
    return id ? `id:${id}` : `t:${apelido}|${texto}`;
  }

  function lerComentario(no) {
    const autor = mapa.um("chat.item_autor", no);
    const corpo = mapa.um("chat.item_texto", no);

    const apelido = (autor?.textContent || "").trim().slice(0, 80);
    const texto = (corpo?.textContent || "").trim().slice(0, 500);

    if (!texto) return null;
    return { apelido: apelido || null, texto };
  }

  /**
   * Escreve no chat do LIVE Studio.
   *
   * Digitar caractere a caractere seria teatro: o TikTok lê o valor do campo,
   * não a jornada até ele. O que importa de verdade é a CADÊNCIA entre
   * respostas, e essa quem decide é o servidor.
   *
   * Dispara os eventos que um framework de UI espera — sem eles, o React do
   * LIVE Studio não vê o texto e o botão continua desabilitado.
   */
  // --------------------------------------------------------- escrever no chat
  //
  // Esta é a função mais importante da extensão, e era a mais mal escrita: ela
  // devolvia `true` depois de clicar no botão E `true` depois de disparar um
  // Enter, sem NUNCA conferir se a mensagem saiu. Na primeira live real o texto
  // entrou no campo e ficou lá — e como a função dizia que tinha enviado, o
  // servidor registrou uma resposta que ninguém viu e a cadência contou uma
  // resposta fantasma, apertando o ritmo por nada.
  //
  // Agora o único sinal de sucesso aceito é OBSERVADO: o campo esvaziou. Todo
  // editor de chat limpa a entrada ao enviar, e nenhum limpa sem enviar. É a
  // única prova que não depende de eu adivinhar como o editor do TikTok está
  // implementado hoje.
  //
  // E como não sei qual caminho de envio funciona nesta versão da página, são
  // três, tentados em ordem e CADA UM verificado. O primeiro que esvaziar o
  // campo vence, e o painel reporta qual foi — o que transforma "não funcionou"
  // em informação.

  /** Quanto esperar o editor reagir antes de dizer que não enviou. */
  const ESPERA_ENVIO_MS = 1200;

  // -----------------------------------------------------------------------
  // O QUE A PÁGINA SALVA DE UMA LIVE REAL MOSTROU
  //
  //   <div contenteditable="plaintext-only" data-e2e="room-chat-input-field"
  //        maxlength="150" placeholder="Tipo...">texto</div>
  //   <div class="… invisible …" data-e2e="room-chat-send-btn">
  //
  // Dois fatos que mudam o código:
  //
  // O botão de enviar é um DIV, não um <button>. `.disabled` em div é
  // `undefined`, então qualquer checagem por `!botao.disabled` passa — e a
  // versão anterior clicava num elemento invisível achando que estava
  // habilitado. Para div, quem diz se está usável é a visibilidade computada.
  //
  // O botão fica invisível enquanto o editor acha que o campo está vazio.
  // Então ele é mais que um alvo de clique: é o ÚNICO sinal observável de que
  // o editor registrou o texto. Texto no DOM com botão invisível significa
  // exatamente o que aconteceu na primeira live — escrevemos na árvore e o
  // React não viu.
  // -----------------------------------------------------------------------

  function textoDoCampo(campo) {
    return (campo.isContentEditable ? campo.textContent : campo.value) ?? "";
  }

  /**
   * Põe o cursor DENTRO do campo.
   *
   * `selectAllChildren` num campo vazio não cria seleção editável válida, e aí
   * `execCommand("insertText")` devolve false e cai no fallback que escreve no
   * DOM sem avisar o editor. Um Range sobre o próprio nó funciona nos dois
   * casos, vazio ou com texto.
   */
  function porCursorNoCampo(campo) {
    campo.focus();
    try {
      const faixa = document.createRange();
      faixa.selectNodeContents(campo);
      const selecao = window.getSelection();
      selecao?.removeAllRanges();
      selecao?.addRange(faixa);
      return true;
    } catch {
      return false;
    }
  }

  /** O limite que a própria página declara, quando declara. */
  function tetoDoCampo(campo) {
    const bruto = Number(campo.getAttribute("maxlength"));
    return Number.isFinite(bruto) && bruto > 0 ? bruto : null;
  }

  function limparCampo(campo) {
    if (porCursorNoCampo(campo) && document.execCommand("insertText", false, "")) {
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (campo.isContentEditable) campo.textContent = "";
    else campo.value = "";
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // --- as técnicas de digitação, da mais fiel à menos ---------------------

  function porExecCommand(campo, texto) {
    if (!porCursorNoCampo(campo)) return false;
    return document.execCommand("insertText", false, texto);
  }

  /**
   * `beforeinput` + `input` como InputEvent de verdade.
   *
   * Editor moderno (Lexical, Draft, ProseMirror) escuta `beforeinput` e usa
   * `inputType`/`data` para montar o estado dele. É o caminho que mais se
   * parece com digitar sem ser digitar.
   */
  function porInputEvent(campo, texto) {
    if (!porCursorNoCampo(campo)) return false;
    const antes = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: texto,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    const seguiu = campo.dispatchEvent(antes);
    if (!seguiu) return true; // o editor preveniu o padrão: ele assumiu.

    if (campo.isContentEditable) campo.textContent = texto;
    else campo.value = texto;

    campo.dispatchEvent(
      new InputEvent("input", {
        inputType: "insertText",
        data: texto,
        bubbles: true,
        composed: true,
      }),
    );
    return true;
  }

  /**
   * Colar.
   *
   * Editor que ignora input sintético costuma tratar `paste`, porque colar é
   * caminho de usuário legítimo que ele é obrigado a suportar.
   */
  function porColagem(campo, texto) {
    if (!porCursorNoCampo(campo)) return false;
    try {
      const dados = new DataTransfer();
      dados.setData("text/plain", texto);
      return campo.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dados, bubbles: true, cancelable: true }),
      );
    } catch {
      return false;
    }
  }

  function porAtribuicaoDireta(campo, texto) {
    if (campo.isContentEditable) {
      campo.textContent = texto;
    } else {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype === Object.getPrototypeOf(campo)
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (setter) setter.call(campo, texto);
      else campo.value = texto;
    }
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    campo.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  const TECNICAS = [
    { nome: "digitacao", aplicar: porExecCommand },
    { nome: "input", aplicar: porInputEvent },
    { nome: "colagem", aplicar: porColagem },
    { nome: "atribuicao", aplicar: porAtribuicaoDireta },
  ];

  /**
   * O botão de enviar está usável?
   *
   * Para o div do TikTok, `.disabled` não existe e `invisible` é uma classe do
   * Tailwind deles. Então a pergunta é respondida pelo estilo COMPUTADO, que
   * cobre `visibility`, `display`, `opacity` e qualquer outro jeito de
   * esconder que eles inventem depois.
   */
  function botaoDeEnviar() {
    const botao = mapa.um("chat.enviar");
    if (!botao) return { botao: null, estado: "nao_achado" };

    if (botao.disabled === true || botao.getAttribute("aria-disabled") === "true") {
      return { botao, estado: "desabilitado" };
    }

    const estilo = window.getComputedStyle(botao);
    const escondido =
      estilo.visibility === "hidden" ||
      estilo.display === "none" ||
      Number(estilo.opacity) === 0 ||
      botao.getClientRects().length === 0;

    return { botao, estado: escondido ? "escondido" : "pronto" };
  }

  /**
   * Digita e devolve QUAL técnica o editor aceitou.
   *
   * Aceitar é o botão de enviar acender — não o texto estar na árvore. Era
   * essa a diferença que faltava: a primeira live teve texto na árvore e nada
   * enviado, e o código chamou isso de sucesso.
   *
   * Se nenhuma técnica acender o botão, vale a que ao menos deixou o texto
   * visível: pode ser que a página não tenha botão para acender, e aí o Enter
   * ainda tem chance.
   */
  async function digitarNoCampo(campo, texto) {
    const teto = tetoDoCampo(campo);
    const cortado = teto ? texto.slice(0, teto) : texto;
    let comTexto = null;

    for (const tecnica of TECNICAS) {
      limparCampo(campo);
      if (!tecnica.aplicar(campo, cortado)) continue;
      await dormir(60);

      if (textoDoCampo(campo).trim().length === 0) continue;
      if (!comTexto) comTexto = tecnica.nome;

      if (botaoDeEnviar().estado === "pronto") {
        return { tecnica: tecnica.nome, aceito: true, cortado: cortado !== texto };
      }
    }

    return comTexto
      ? { tecnica: comTexto, aceito: false, cortado: cortado !== texto }
      : { tecnica: null, aceito: false, cortado: false };
  }

  /** O campo esvaziou? É a prova de que a mensagem saiu. */
  async function esvaziou(campo) {
    const limite = Date.now() + ESPERA_ENVIO_MS;
    while (Date.now() < limite) {
      await dormir(100);
      if (!campo.isConnected) return true; // o editor foi recriado: enviou.
      if (textoDoCampo(campo).trim().length === 0) return true;
    }
    return false;
  }

  /**
   * Enter como o navegador de verdade entrega.
   *
   * O `keydown` solto que havia antes é ignorado por editor que escuta
   * `keypress` ou que confere `which`/`charCode`. Mandar a sequência inteira
   * se aproxima de uma tecla real — e mesmo assim pode não bastar, porque
   * `isTrusted` continua falso e nada feito por script muda isso. É por isso
   * que o resultado é VERIFICADO em vez de presumido.
   */
  function teclarEnter(campo) {
    const comum = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      charCode: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    campo.dispatchEvent(new KeyboardEvent("keydown", comum));
    campo.dispatchEvent(new KeyboardEvent("keypress", comum));
    campo.dispatchEvent(new KeyboardEvent("keyup", comum));
    return true;
  }

  function enviarPeloFormulario(campo) {
    const form = campo.closest("form");
    if (!form) return false;
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
    return true;
  }

  /**
   * Escreve e envia. Devolve o que ACONTECEU, não "deu certo".
   *
   * `{ ok: true, por }` — saiu, e por qual caminho.
   * `{ ok: false, motivo }` — não saiu, e o motivo serve para a tela explicar.
   */
  async function escreverNoChat(texto) {
    const campo = mapa.um("chat.campo");
    if (!campo) return { ok: false, motivo: "sem_campo" };

    const digitou = await digitarNoCampo(campo, texto);
    if (!digitou.tecnica) {
      limparCampo(campo);
      return { ok: false, motivo: "nao_digitou" };
    }

    const { botao, estado } = botaoDeEnviar();

    // O clique só entra na fila quando o botão está REALMENTE usável. Clicar
    // num div invisível é o que a versão anterior fazia, achando que tinha
    // enviado.
    const caminhos = [
      estado === "pronto" ? { nome: "botao", agir: () => (botao.click(), true) } : null,
      { nome: "enter", agir: () => teclarEnter(campo) },
      { nome: "formulario", agir: () => enviarPeloFormulario(campo) },
    ].filter(Boolean);

    for (const caminho of caminhos) {
      if (!caminho.agir()) continue;
      if (await esvaziou(campo)) {
        return { ok: true, por: caminho.nome, tecnica: digitou.tecnica, cortado: digitou.cortado };
      }
    }

    // Deixar o nosso texto parado no campo da pessoa é pior que não escrever:
    // ela digita em cima, manda sem ver, ou acha que a extensão travou a caixa.
    limparCampo(campo);
    return {
      ok: false,
      motivo: digitou.aceito ? "nao_enviou" : "editor_nao_registrou",
      botao: estado,
      tecnica: digitou.tecnica,
    };
  }

  /**
   * Diagnóstico do envio, sem publicar nada na live.
   *
   * Digita, confere o que achou, e APAGA sem enviar. Dá 90% da resposta com
   * zero exposição — porque a alternativa, mandar mensagem de teste numa live
   * de verdade, a audiência lê.
   */
  async function ensaiarEnvio() {
    const campo = mapa.um("chat.campo");
    if (!campo) return { campo: false };

    const digitou = await digitarNoCampo(campo, "teste");
    const { estado } = botaoDeEnviar();
    limparCampo(campo);

    return {
      campo: true,
      editavel: campo.isContentEditable ? "contenteditable" : campo.tagName.toLowerCase(),
      teto: tetoDoCampo(campo),
      tecnica: digitou.tecnica,
      aceito: digitou.aceito,
      botao: estado,
      dentroDeFormulario: Boolean(campo.closest("form")),
    };
  }

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------- aprender apontando
  //
  // A pessoa clica no botão que ela já usa e a extensão descreve aquele
  // elemento. É como o painel de produtos deixa de ser palpite nosso e vira
  // observação da tela dela. Ver produtos.js para o porquê.

  /** Âncora que estamos esperando a pessoa apontar, ou null. */
  let aprendendo = null;
  let aviso = null;

  function mostrarAviso(texto, tom = "info") {
    aviso?.remove();
    aviso = document.createElement("div");
    aviso.textContent = texto;
    // Estilo embutido de propósito: a folha de estilo do TikTok é território
    // deles e uma classe nossa pode colidir com uma classe deles.
    aviso.style.cssText = [
      "position:fixed", "z-index:2147483647", "left:50%", "top:16px",
      "transform:translateX(-50%)", "max-width:min(90vw,460px)",
      "padding:12px 16px", "border-radius:10px",
      "font:600 14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif",
      "color:#fff", "box-shadow:0 8px 24px rgba(0,0,0,.35)", "text-align:center",
      `background:${tom === "ok" ? "#15803d" : tom === "erro" ? "#b91c1c" : "#1d4ed8"}`,
    ].join(";");
    document.body.appendChild(aviso);
    return aviso;
  }

  function pararDeAprender() {
    aprendendo = null;
    document.removeEventListener("click", capturarClique, true);
    document.removeEventListener("keydown", cancelarComEsc, true);
    aviso?.remove();
    aviso = null;
  }

  function cancelarComEsc(evento) {
    if (evento.key !== "Escape") return;
    const qual = aprendendo;
    pararDeAprender();
    void pedir({ tipo: "aprendeu", ancora: qual, cancelado: true });
  }

  function capturarClique(evento) {
    // Captura na fase de captura e SEGURA o clique: durante o aprendizado, o
    // clique da pessoa é a resposta a uma pergunta nossa, não uma ordem para o
    // TikTok. Deixar passar fixaria um produto que ela não pediu para fixar.
    evento.preventDefault();
    evento.stopPropagation();

    const alvo = alvoClicavel(evento.target);
    const cascata = descrever(alvo);
    const qual = aprendendo;
    pararDeAprender();

    if (cascata.length === 0) {
      mostrarAviso("Não consegui descrever esse elemento. Tente clicar no botão em si.", "erro");
      setTimeout(() => { aviso?.remove(); aviso = null; }, 4000);
      void pedir({ tipo: "aprendeu", ancora: qual, cascata: [] });
      return;
    }

    ancorasLocais = { ...ancorasLocais, [qual]: cascata };
    mapa = new Mapa(mapa.mapa, mapa.versao, ancorasLocais);
    mostrarAviso("Anotado. Pode voltar ao painel da Shopia.", "ok");
    setTimeout(() => { aviso?.remove(); aviso = null; }, 3000);
    void pedir({ tipo: "aprendeu", ancora: qual, cascata });
  }

  function comecarAAprender(ancora, instrucao) {
    pararDeAprender();
    aprendendo = ancora;
    mostrarAviso(instrucao);
    document.addEventListener("click", capturarClique, true);
    document.addEventListener("keydown", cancelarComEsc, true);
  }

  /** Pergunta ao servidor e cumpre o que ele mandar. */
  async function consultarEResponder(evento) {
    const r = await pedir({ tipo: "decidir", evento });
    if (!r?.ok) return;

    // O evento da loja sobe antes de qualquer decisão sobre responder: o
    // contador e o sininho existem para o vendedor VER que vendeu, e isso vale
    // mesmo com a reação no chat desligada.
    if (r.loja) void pedir({ tipo: "loja", qual: r.loja, apelido: evento.apelido ?? null });

    if (r.acao === "ignorar") return;

    if (r.acao === "escrever" && r.texto) {
      // A espera vem do servidor, sorteada dentro da janela do cliente. É ela
      // que separa "responde como gente" de "responde como robô".
      await dormir(Math.min(Math.max(r.esperarMs ?? 0, 0), 120000));
      const envio = await escreverNoChat(r.texto);

      if (envio.ok) {
        void pedir({ tipo: "respondeu", texto: r.texto, tema: r.tema ?? null });
      } else {
        // Falha de envio precisa chegar ao painel. Antes ela não chegava a
        // lugar nenhum: a função mentia que tinha enviado, e a pessoa só
        // descobria olhando a live e não vendo resposta.
        void pedir({ tipo: "envio_falhou", motivo: envio.motivo, botao: envio.botao ?? null });
      }
    }
  }

  function processar(nos) {
    const novos = [];

    for (const no of nos) {
      // Entrada de espectador vem antes: o mesmo nó também casaria com o
      // leitor de comentário e viraria um comentário vazio.
      const entrada = mapa.um("chat.entrada", no) ?? (no.matches?.("[data-e2e='chat-member-enter']") ? no : null);
      if (entrada) {
        const autor = mapa.um("chat.entrada_autor", no);
        const apelido = (autor?.textContent || "").trim().slice(0, 80);
        const chave = `e:${apelido}`;
        if (apelido && !vistos.has(chave)) {
          vistos.add(chave);
          novos.push({ tipo: "entrada", apelido, texto: null });
          void consultarEResponder({ tipo: "entrada", apelido, texto: null });
        }
        continue;
      }

      const lido = lerComentario(no);
      if (!lido) continue;

      const chave = identidade(no, lido.apelido, lido.texto);
      if (vistos.has(chave)) continue;
      vistos.add(chave);

      novos.push({ tipo: "comentario", apelido: lido.apelido, texto: lido.texto });
      void consultarEResponder({
        tipo: "comentario",
        apelido: lido.apelido,
        texto: lido.texto,
      });
    }

    // O conjunto de vistos cresce para sempre numa live de 24 horas. Podar
    // pelos mais antigos é o que impede a aba inchar até travar.
    if (vistos.size > 5000) {
      const sobra = [...vistos].slice(-2500);
      vistos.clear();
      for (const v of sobra) vistos.add(v);
    }

    if (novos.length) {
      pendentes.push(...novos);
      // Só a contagem vai ao painel — o texto dos comentários segue pelo
      // caminho de sempre, em lote, para o servidor.
      void pedir({ tipo: "chat", quantidade: novos.length });
    }
  }

  function observarChat() {
    const lista = mapa.um("chat.lista");
    if (!lista) return false;

    listaObservada = lista;
    observador?.disconnect();
    observador = new MutationObserver((mutacoes) => {
      const candidatos = [];
      for (const m of mutacoes) {
        for (const no of m.addedNodes) {
          if (no.nodeType !== Node.ELEMENT_NODE) continue;
          candidatos.push(no);
        }
      }
      if (candidatos.length) processar(candidatos);
    });

    observador.observe(lista, { childList: true, subtree: true });

    // Os comentários que já estavam na tela quando a extensão subiu.
    processar(mapa.todos("chat.item"));
    return true;
  }

  async function despejar() {
    const falhas = mapa.drenarFalhas();
    if (falhas.length) void pedir({ tipo: "quebras", falhas });

    if (!pendentes.length) return;
    const lote = pendentes.splice(0, 200);
    await pedir({ tipo: "eventos", eventos: lote });
  }

  /** Três voltas de 5s sem achar o chat numa página de live é sinal real. */
  const VOLTAS_ATE_AVISAR = 3;

  async function ligar() {
    // Freio do servidor (kill switch) vale até ele mesmo soltar: sem isto, a
    // volta de 5s religava a leitura segundos depois de mandarem parar.
    if (suspenso) return;

    if (!ehPaginaDaLive()) {
      // Saiu da live dentro da mesma aba: para de ler o que não é chat.
      if (ligado) {
        observador?.disconnect();
        observador = null;
        ligado = false;
      }
      tentativasSemChat = 0;
      contarEstado("fora_da_live");
      return;
    }

    // A lista do chat é trocada quando a live recarrega o player: observador
    // preso num nó que saiu do DOM não recebe mais nada.
    if (ligado && !listaObservada?.isConnected) ligado = false;
    if (ligado) return;

    if (!(await carregarMapa())) return;
    if (!observarChat()) {
      tentativasSemChat += 1;
      if (tentativasSemChat >= VOLTAS_ATE_AVISAR) contarEstado("sem_chat");
      return;
    }
    tentativasSemChat = 0;
    ligado = true;
    contarEstado("lendo");
  }

  chrome.runtime.onMessage.addListener((mensagem) => {
    if (mensagem?.tipo === "mapa" && mensagem.mapa) {
      mapa = new Mapa(mensagem.mapa, mensagem.versao);
      // Mapa novo costuma chegar justamente porque o antigo quebrou: reatar o
      // observador é o que faz o conserto valer sem recarregar a página.
      ligado = ehPaginaDaLive() && observarChat();
      if (ligado) contarEstado("lendo");
    }
    if (mensagem?.tipo === "status_chat?") {
      // O painel acabou de abrir e quer saber: responde sem esperar a volta.
      ultimoEstado = null;
      contarEstado(ehPaginaDaLive() ? (ligado ? "lendo" : "procurando") : "fora_da_live");
    }
    if (mensagem?.tipo === "parar") {
      suspenso = true;
      observador?.disconnect();
      observador = null;
      ligado = false;
      contarEstado("suspenso");
    }
    if (mensagem?.tipo === "estado" && mensagem.estado && !mensagem.estado.pararAgora) {
      suspenso = false;
    }

    // --- produtos ---
    if (mensagem?.tipo === "aprender" && mensagem.ancora) {
      comecarAAprender(mensagem.ancora, mensagem.instrucao ?? "Clique no botão que você quer ensinar.");
    }
    if (mensagem?.tipo === "fixar") {
      const r = produtos.fixarProduto(mapa, mensagem.posicao ?? 1);
      void pedir({ tipo: "fixou", ...r });
      return;
    }
    if (mensagem?.tipo === "contar_produtos") {
      void pedir({ tipo: "produtos", total: produtos.quantosProdutos(mapa) });
    }

    // --- automações programadas ---
    //
    // O texto e o momento vêm do servidor. O content script não decide nada
    // aqui: ele só escreve e conta o que aconteceu.
    if (mensagem?.tipo === "programado_escrever" && mensagem.texto) {
      void escreverNoChat(String(mensagem.texto).slice(0, 150)).then((r) =>
        pedir({
          tipo: "programado_feito",
          ok: r.ok,
          motivo: r.motivo ?? null,
          texto: mensagem.texto,
          tema: mensagem.tema ?? "aviso",
          avisoId: mensagem.avisoId ?? null,
        }),
      );
      return;
    }

    if (mensagem?.tipo === "programado_fixar") {
      const r = produtos.fixarProduto(mapa, mensagem.posicao ?? 1);
      void pedir({ tipo: "programado_fixou", ...r });
      return;
    }

    // --- diagnóstico do chat ---
    if (mensagem?.tipo === "ensaiar_envio") {
      void ensaiarEnvio().then((r) => pedir({ tipo: "ensaio", ...r }));
    }
    if (mensagem?.tipo === "enviar_teste") {
      const texto = String(mensagem.texto ?? "teste").slice(0, 120);
      void escreverNoChat(texto).then((r) => pedir({ tipo: "teste_enviado", ...r }));
    }
  });

  // O LIVE Studio é uma aplicação de página única: a lista do chat aparece,
  // some e volta conforme o usuário navega. Tentar de novo periodicamente é
  // mais confiável do que apostar num único momento de carga.
  setInterval(() => void ligar(), 5000);
  setInterval(() => void despejar(), 10000);

  await ligar();
})();
