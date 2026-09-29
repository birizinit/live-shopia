# Extensão Shopia

Responde os comentários da sua live no TikTok, dá boas-vindas pelo nome e fixa
produtos — falando com o painel da Shopia por token de licença. Opcionalmente,
também coloca a voz da apresentadora no LIVE Studio.

## Os dois modos

| | Só chat (padrão) | Chat + áudio |
|---|---|---|
| Responder comentários | sim | sim |
| Boas-vindas pelo nome | sim | sim |
| Fixar produto | sim | sim |
| Apresentadora falando | não | sim |
| Precisa instalar algo no computador | **não** | sim, o cabo virtual |
| Precisa do painel aberto | não | **sim** |

O padrão é **só chat** porque é o modo que funciona com o que a pessoa já tem:
o navegador. Exigir cabo virtual instalado no sistema operacional para
responder comentário barrava na porta a maioria das lives, que são
apresentadas por gente de verdade e só querem a parte automática do chat.

No modo só chat, fechar o painel **não** derruba a live: quem lê o chat é o
content script e quem mantém a sessão viva é o service worker. No modo com
áudio derruba, porque o motor de som mora no painel — em MV3 o service worker
morre ocioso, e áudio que para no meio da live é o produto quebrado.

## Como instalar (modo desenvolvedor)

1. Baixe o ZIP em **Extensão** no painel e **extraia numa pasta fixa**. Não
   apague a pasta: o Chrome lê a extensão de lá.
2. Abra `chrome://extensions`.
3. Ligue o **Modo do desenvolvedor**, no canto superior direito.
4. **Carregar sem compactação** e escolha a pasta extraída.
5. Fixe a Shopia na barra, clique no ícone e cole o código da licença.

> Instalação em modo desenvolvedor **não se atualiza sozinha**. Quando sair
> versão nova, o painel avisa e você repete os passos 1 e 4. É o maior custo
> de suporte desse caminho, e é por isso que a Web Store entra depois.

## Fixar produtos

A Shopia **não traz seletor pronto** para o painel de produtos do LIVE Studio.
O chat nós mapeamos: tem `data-e2e` estável e o mapa publicado foi validado
contra uma página real. O painel de produtos não — ele muda por país, por tipo
de conta de vendedor e por teste A/B do TikTok.

Publicar um palpite seria pior do que não ter o recurso. Um seletor errado não
falha em silêncio numa lista de produtos: ele acha **algum** botão e clica. Numa
live de vendas, o botão ao lado pode ser arquivar o produto, tirar do ar ou
aplicar desconto.

Então você aponta uma vez, na seção **Produtos** do painel: a lista, um produto
e o botão de fixar. Fica guardado neste navegador e vence o mapa publicado.

## O cabo de áudio — só no modo com áudio

A voz não vai para o alto-falante: vai para um **cabo virtual**, e o LIVE
Studio escuta esse cabo como se fosse um microfone.

| Sistema | Instale | Depois |
|---|---|---|
| Windows | [VB-Cable](https://vb-audio.com/Cable/) | escolha **CABLE Input** no painel da Shopia e **CABLE Output** como microfone no LIVE Studio |
| macOS | [BlackHole 2ch](https://existential.audio/blackhole/) | escolha **BlackHole 2ch** nos dois lados |

Na primeira vez é preciso **liberar o acesso ao áudio**. Sem essa permissão o
Chrome esconde o nome das saídas e o cabo aparece como "sem nome" — e aí a voz
iria para o alto-falante, não para a live. O painel lateral **não consegue**
mostrar o balão de permissão (o Chrome não exibe ali), então o painel mostra o
botão **Liberar acesso**, que abre `permissao.html` numa aba normal: você clica
em Permitir e volta. A permissão é da extensão, então passa a valer no painel.
Nada é gravado: a captura é encerrada no mesmo instante.

No modo com áudio, enquanto o cabo não for identificado o botão **Entrar no
ar** fica bloqueado e diz por quê. Antes (até a 1.1.1) ele deixava entrar no ar
tocando no alto-falante, e a live ia ao ar muda. No modo só chat o cabo não é
cobrado: não há áudio para levar a lugar nenhum.

## Entrar no ar

1. No LIVE Studio, escolha o cabo como microfone e comece a transmitir.
2. No Chrome, clique no ícone da Shopia. O painel lista **o que falta**: áudio
   da live, cabo e chat — cada item com o botão que resolve.
3. Abra a página da sua live no tiktok.com (botão **Abrir minha live no
   TikTok**). É por ela que a extensão lê o chat; o LIVE Studio é um programa, e
   extensão de navegador não enxerga dentro dele.
4. **Entrar no ar.** O cronômetro corre; em **Encerrar sozinho depois de** dá
   para programar o fim (30 min a 8 h).

O bloco **Proteção anti-restrição** mostra se o texto do áudio tem o que costuma
fazer o TikTok restringir uma live (mandar para WhatsApp, pedir Pix, prometer
resultado) e aponta onde corrigir. É revisão de conteúdo com a mesma lista do
painel (`src/lib/termos-restritos.ts`) — não disfarça automação.

## Como é por dentro

| Arquivo | O que faz |
|---|---|
| `fundo.js` | Service worker. Bate na licença, guarda o mapa de seletores, obedece o kill switch, junta os eventos e manda em lote |
| `painel.html/js/css` | Painel lateral: onde o **áudio toca**, com a lista do que falta, cronômetro e proteção |
| `permissao.html/js` | Aba que pede a permissão de áudio que o painel lateral não consegue pedir |
| `audio.js` | Acha o cabo, toca a montagem em laço, trilha de ambiente |
| `api.js` | Cliente da API, autenticado por token de licença |
| `seletores.js` | Resolve âncoras do DOM pelo mapa remoto, com cascata de alternativas |
| `conteudo.js` | Lê o chat na aba do TikTok e reporta |

### Três decisões que explicam o resto

**O áudio mora no painel lateral, não no service worker.** Em MV3 o worker
morre depois de ~30 segundos ocioso. Áudio que para no meio da live é o
produto quebrado, então o motor vive numa página de verdade — enquanto o
painel está aberto, a apresentadora fala. Fechar o painel é sair do ar, e a
extensão encerra a sessão em vez de deixar uma live fantasma no dashboard.

**Nenhum seletor é compilado no pacote.** O `conteudo.js` pede o mapa ao
servidor e resolve por nome de âncora (`chat.item`, `chat.campo`). Quando o
TikTok muda o layout, o conserto é publicar um mapa novo: a base inteira volta
a funcionar no batimento seguinte, sem republicar extensão e sem pedir
reinstalação. É a diferença entre dez minutos e três dias com todo mundo
parado.

**O content script não tem o token.** Ele roda dentro de uma página de
terceiro. Tudo que precisa de credencial passa pelo service worker, que é
quem guarda o token e fala com a nossa API.

## O que ela NÃO faz

- **Não registra venda.** Ingestão de venda precisa de origem verificável;
  aceitar valor vindo de uma extensão que o próprio cliente controla seria
  deixar o ranking e o faturamento serem escritos por quem os disputa.
- **Não decide sozinha quando responder.** Cada comentário vai ao servidor
  (`/api/ext/responder`), que decide se responde, o quê e depois de quanto
  tempo — com teto por minuto. Regra que protege a conta não mora na máquina
  de quem ela protege.
- **Não abre a live por você.** Você inicia a transmissão no LIVE Studio; a
  extensão assume o áudio.
- **Não lê o chat de dentro do LIVE Studio.** Lê pela página da live no
  tiktok.com, aberta no Chrome. Os seletores dessa página vêm do mapa remoto
  (v3, migração 0022) e ainda não foram confirmados numa live real — a
  telemetria da primeira live diz o que ajustar.

## Aviso de risco

Automatizar o LIVE Studio tende a violar os Termos do TikTok, e um eventual
bloqueio recai sobre a conta do cliente. O aceite é registrado no painel, e
desde a 1.2.0 o servidor confere: sem aceite na versão vigente do texto,
`/api/ext/sessao` recusa abrir a sessão (`risco_pendente`) e o painel leva ao
aceite.

Dois freios independentes existem de propósito: o **mixer** (o áudio) e o
**chat** (a automação de conversa) são liberados separadamente, por conta e na
base inteira. Se a automação de chat precisar morrer, o áudio continua e o
produto sobrevive.
