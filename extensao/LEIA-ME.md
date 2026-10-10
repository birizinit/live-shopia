# Extensão Shopia (3.0)

Painel lateral no formato da extensão de referência (LiveFox), com a paleta
verde da Shopia. Liga e cuida da live no TikTok Shop: timer de encerramento,
proteção contra violação, fixar produto (com modo cupom), comentários
automáticos, bloqueio por nome, aviso de venda no celular e respostas no chat
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

**Cabeçalho:** `✦ IA` (sua conta, créditos, "Ler a tela", contas TikTok e
planos), `↺` (reset), `⏻` (encerrar a live agora) e o selo ATIVO/INATIVO.

**Aba Início**

| Bloco | O que faz |
|---|---|
| Status | Aba do TikTok, live detectada, ação atual, conexão com o servidor |
| Scans · Timer · Alertas | Contadores do ciclo |
| Timer de Encerramento | 1h–8h ou minutos à mão; pausar/retomar; cancelar desliga |
| Ligar a extensão | Começa o ciclo: timer, varredura de violação a cada 8 s, checagem da live a cada 10 s, leitura de vendas |
| Fixar produto | Agora, ou automático (refixa a cada 18–30 s) |
| Tem cupom na lista | Pula o 1º item (o card do cupom) e fixa o de baixo |
| Proteção Contra Violação | Ao ver o aviso do TikTok: encerra na hora, ou continua por N minutos e encerra |
| Comentários Automáticos | Uma mensagem por linha, em rodízio, com intervalo aleatório entre mín. e máx. |
| Bloqueio por Nome | Bloqueia quem entra com palavra da lista no nome (palavra inteira) |
| Log de Eventos | Tudo que aconteceu, em tempo real |

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
`/api/ext/seletores`, `/api/ext/telemetria` e `/api/ext/venda` (só vira push
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
