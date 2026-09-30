# Extensão Shopia

Modera a sua live no TikTok: responde os comentários, dá boas-vindas pelo nome
e fixa produtos — falando com o painel da Shopia por token de licença.

Só precisa do navegador. Nada é instalado no sistema operacional.

## Como ela responde

Tudo o que a Shopia escreve no chat sai do **manual do produto**, que você
cadastra no painel (`/manual`). Cada linha do manual é uma pergunta com as
palavras que a audiência usa e a resposta que **você** escreveu.

Ela não gera resposta: escolhe uma que já existe. Quando o comentário não casa
com nenhuma linha, ela **cala** — e o comentário fica registrado para você
cadastrar a resposta antes da próxima live.

É por isso que "nunca inventa" não é promessa de marketing: não existe caminho
pelo qual uma frase que você não aprovou chegue à sua audiência.

Fechar o painel lateral **não** derruba a live: quem lê o chat é o content
script e quem mantém a sessão viva é um `chrome.alarms` do service worker.

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

## Entrar no ar

1. Comece a sua transmissão como você já faz.
2. No Chrome, clique no ícone da Shopia e escreva o seu @ do TikTok.
3. **Entrar no ar.** Ela abre a página da sua live sozinha, se ainda não estiver
   aberta, e começa a ler o chat. O cronômetro corre; em **Encerrar sozinho
   depois de** dá para programar o fim (30 min a 8 h).

A extensão lê o chat pela **página da live no tiktok.com**, e não pelo LIVE
Studio: o LIVE Studio é um programa do sistema, e extensão de navegador não
enxerga dentro dele.

O bloco **Proteção anti-restrição** mostra se o seu manual tem o que costuma
fazer o TikTok restringir uma live (mandar para WhatsApp, pedir Pix por fora,
prometer resultado) e aponta qual resposta corrigir. É revisão de conteúdo com
a mesma lista do painel (`src/lib/termos-restritos.ts`) — não disfarça
automação.

## Como é por dentro

| Arquivo | O que faz |
|---|---|
| `fundo.js` | Service worker. Bate na licença, guarda o mapa de seletores, obedece o kill switch, junta os eventos e manda em lote |
| `painel.html/js/css` | Painel lateral: a lista do que falta, cronômetro, produtos e proteção |
| `api.js` | Cliente da API, autenticado por token de licença |
| `seletores.js` | Resolve âncoras do DOM pelo mapa remoto, com cascata; e aprende âncora apontada na tela |
| `produtos.js` | Acha o produto pela posição na lista e clica em fixar |
| `conteudo.js` | Lê o chat na aba do TikTok, escreve a resposta e reporta |

### Três decisões que explicam o resto

**Fechar o painel não derruba a live.** Quem lê o chat é o content script, na
aba da live, e quem mantém a sessão viva é um `chrome.alarms` do service worker
— que ressuscita o worker depois de ele morrer por ociosidade, coisa que em MV3
acontece em ~30 segundos. O painel só manda e mostra. Reabri-lo reassume a
sessão em vez de abrir outra.

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
- **Não inicia a sua transmissão.** Quem sobe a live é você, no LIVE Studio ou
  no app. A extensão só ABRE A PÁGINA da live no navegador, para poder ler o
  chat.
- **Não lê o chat de dentro do LIVE Studio.** Lê pela página da live no
  tiktok.com, aberta no Chrome. Os seletores dessa página vêm do mapa remoto
  (v3, migração 0022) e ainda não foram confirmados numa live real — a
  telemetria da primeira live diz o que ajustar.

## Aviso de risco

Automatizar o chat do TikTok tende a violar os Termos, e um eventual bloqueio
recai sobre a conta do cliente. O aceite é registrado no painel, e desde a
1.2.0 o servidor confere: sem aceite na versão vigente do texto,
`/api/ext/sessao` recusa abrir a sessão (`risco_pendente`) e o painel leva ao
aceite.

O freio tem dois níveis, de propósito: por CONTA (`ext_licencas.chat`) e na
BASE INTEIRA (`configuracoes` → `ext.chat_desligado`). O segundo existe para o
caso de a automação de chat precisar parar em todo mundo de uma vez, sem
depender de a gente alcançar cada cliente.
