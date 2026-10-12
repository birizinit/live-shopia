# Extensão Shopia (3.3.0)

Painel lateral no formato da extensão de referência (LiveFox), com a paleta
verde da Shopia. Liga e cuida da live no TikTok Shop: timer de encerramento,
proteção contra violação, fixar produto (com modo cupom), comentários
automáticos, fluxos de resposta, moderação do chat, bloqueio por nome, aviso de venda no celular e respostas no chat
pelo manual.

Só precisa do navegador. Nada é instalado no sistema operacional.

## Como instalar (modo desenvolvedor)

1. Baixe o ZIP em **Extensão** no painel e **extraia numa pasta fixa**.
2. Abra `chrome://extensions` e ligue o **Modo do desenvolvedor**.
3. **Carregar sem compactação** e escolha a pasta extraída.
4. Fixe a Shopia na barra, clique no ícone e **entre com o e-mail e a senha**
   da sua conta. Entrar numa máquina desconecta a anterior (1 conta = 1
   dispositivo).

Quando sair versão nova, o painel mostra o aviso com o link para baixar.

## O painel

**Cabeçalho:** **IA** (sua conta, créditos, "Ler a tela", contas TikTok e
planos), reset, encerrar a live agora (botão vermelho) e o selo ATIVO/INATIVO.

Os ícones são SVG de traço (sprite no `painel.html`, o mesmo desenho na
barra e nos avisos da página) — nenhum emoji na interface.

**Aba Início**

| Bloco | O que faz |
|---|---|
| Status | Aba do TikTok, live detectada, ação atual, conexão com o servidor |
| Scans · Timer · Alertas | Contadores do ciclo |
| Testar antes da live | Confere conta, plano, aba, página da live, campo do chat (escreve e apaga, **sem enviar**), botão de fixar, leitura do chat e fluxos carregados. Mostra o que resolver antes de ligar |
| Timer de Encerramento | 1h–8h ou minutos à mão; pausar/retomar; cancelar desliga |
| Ligar a extensão | Começa o ciclo: timer, varredura de violação a cada 8 s, checagem da live a cada 10 s, leitura de vendas |
| Fixar produto | Agora, ou automático (refixa a cada 18–30 s) |
| Tem cupom na lista | Pula o 1º item (o card do cupom) e fixa o de baixo |
| Proteção Contra Violação | Ao ver o aviso do TikTok: encerra na hora, ou continua por N minutos e encerra |
| Comentários Automáticos | Uma mensagem por linha, em rodízio, com intervalo aleatório entre mín. e máx. Também é a chave dos avisos cadastrados no app (Automações): com isto desligado, eles não saem; ligado, o primeiro de cada um espera o intervalo dele a partir do início da live |
| Fluxos de Resposta | Executa os fluxos montados no app (**Fluxos**): quando um comentário é exatamente ou contém a palavra/frase, responde depois da espera escolhida, marcando (`@nome`) ou não, uma vez por pessoa e com intervalo por fluxo. Respeita o teto de mensagens por minuto da conta. Quando um fluxo casa, o manual não responde o mesmo comentário. **Perguntas sem resposta**: o que parece pergunta e nenhum fluxo respondeu aparece no painel (com "Criar fluxo") e na lista do Manual no app |
| Moderação do Chat | Modo seguro: ninguém é silenciado nem bloqueado pelo texto. **Alertar reclamações** ("não chegou", "golpe"…): som, aviso na página e na lista do painel, para você responder. **Avisar no chat**: link, telefone ou palavra proibida recebe um aviso educado (`{nome}`), uma vez por pessoa na live e no máximo um a cada 20 s. Lista "Nunca moderar"; mensagens com tag Host/moderador e o que a própria Shopia escreveu são ignoradas |
| Bloqueio por Nome | Bloqueia quem entra com palavra da lista no nome (palavra inteira) |
| Carrinho e Cliques | No painel de produtos da live: avisa quem adicionou ao carrinho (pela Atividade, com o nome) e quando os cliques/carrinhos de um produto sobem (pelos contadores do cartão). Opcional: comentar no chat com `{nome}` e `{produto}`, com intervalo mínimo |
| Log de Eventos | Tudo que aconteceu, em tempo real |

**Fim da live:** abre o **relatório** — vendas, carrinhos, cliques, pico de
espectadores, respostas dos fluxos, comentários, perguntas sem resposta,
reclamações e links barrados — com dicas do que ajustar e "Criar fluxo" para
cada pergunta. Fica no histórico ("Ver relatório") e, em live de 5 min ou
mais, chega como notificação no celular (`/api/ext/relatorio`).

**Aba Central:** threshold e intervalo de scan, som de venda, "ensinar" o
botão de fixar (quando a conta tem um layout diferente), passo a passo das
notificações no celular e o histórico das últimas 30 sessões.

## Como é por dentro

| Arquivo | O que faz |
|---|---|
| `fundo.js` | Service worker. Licença, login, o ciclo (timer por instante — sobrevive ao worker morrer), violação, sessão no servidor, histórico, aviso de venda |
| `painel.html/css/js` | O painel lateral. É só tela: fechar não desliga nada |
| `conteudo.js` | Na aba do TikTok: detecta live e violação, encerra a live, fixa, comenta, bloqueia, lê vendas e o chat, barra de status na página |
| `api.js` | Cliente da API, autenticado por token de licença |
| `seletores.js` / `produtos.js` | Mapa remoto de seletores e âncoras aprendidas apontando na tela |
| `fluxos.js` | A regra dos fluxos (casar exato/contém, montar a resposta). O app usa a mesma regra na prévia — `src/lib/fluxos.test.ts` roda as duas contra os mesmos casos |

**Na página da live**, com a extensão ligada: uma barra fina no topo
(estado, aba, live, timer, scans, proteção) e um aviso arrastável com
espectadores e vendas, o escudo da proteção e o botão de atualizar os números.

**Desligar é desligar.** "Desligar a extensão" (ou o timer, a violação, o app)
desliga também comentários automáticos, bloqueio, carrinho, moderação, fixar
automático e "Ler a tela". E comentar, bloquear e fixar sozinho só rodam com a extensão ligada. Se
a extensão for desativada, removida ou recarregada no Chrome, o script que
ficou na aba percebe em até 2 s e para tudo — antes ele seguia comentando.

**Uma escrita por vez.** Comentário automático, fluxo, aviso da moderação e
resposta do manual passam por uma fila: duas no mesmo instante misturariam
as letras no campo do chat.

**Uma aba só age.** O service worker escolhe a aba do TikTok
(`shopia_aba_alvo`); as outras ficam quietas. Duas abas comentando seria a
mesma mensagem em dobro.

**Os interruptores moram no `chrome.storage`.** O content script escuta
`storage.onChanged`, então recarregar a aba não desliga nada.

**Quem responde o chat é o servidor.** Com "Ler a tela" ligado, cada
comentário vai a `/api/ext/responder`, que escolhe a resposta no manual e
segura o ritmo. A extensão não inventa texto.

## Rotas do servidor que ela usa

`/api/ext/entrar` (login → token), `/api/ext/licenca`, `/api/ext/conta`,
`/api/ext/sessao`, `/api/ext/responder`, `/api/ext/eventos`,
`/api/ext/seletores`, `/api/ext/telemetria`, `/api/ext/fluxos`, `/api/ext/relatorio` e `/api/ext/venda` (só vira push
no celular do próprio vendedor; **não** entra no ranking nem no faturamento).

## O que ficou de fora de propósito

A extensão de referência tem uma **câmera virtual** (troca a webcam por vídeo
gravado em loop) e uma **"camada ao vivo"** (respiração, cliques e ruído
sintéticos para parecer gente). As duas existem para fazer conteúdo gravado
passar por transmissão ao vivo — o que viola as regras do TikTok LIVE e é o
caminho mais rápido para banir a conta do cliente. Não foram reproduzidas.

## Aviso de risco

Automatizar ações na live tende a violar os Termos do TikTok, e um eventual
bloqueio recai sobre a conta do cliente. O aceite é registrado no app (página
**Ao vivo**); sem ele, o servidor recusa abrir a sessão de respostas
(`risco_pendente`). O freio existe em dois níveis: por conta e na base inteira
(`ext.chat_desligado`), e o kill switch do batimento desliga tudo.
