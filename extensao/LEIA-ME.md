# Extensão Shopia

Coloca o áudio da sua live no TikTok LIVE Studio, lê o chat e reporta o que
acontece — falando com o painel da Shopia por token de licença.

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

## O cabo de áudio

A voz não vai para o alto-falante: vai para um **cabo virtual**, e o LIVE
Studio escuta esse cabo como se fosse um microfone.

| Sistema | Instale | Depois |
|---|---|---|
| Windows | [VB-Cable](https://vb-audio.com/Cable/) | escolha **CABLE Input** no painel da Shopia e **CABLE Output** como microfone no LIVE Studio |
| macOS | [BlackHole 2ch](https://existential.audio/blackhole/) | escolha **BlackHole 2ch** nos dois lados |

Na primeira vez o navegador pede permissão de microfone. Ela existe só para o
Chrome revelar os **nomes** dos dispositivos — sem isso o cabo aparece como
"Dispositivo desconhecido" e não dá para reconhecê-lo. Nada é gravado: a
captura é encerrada no mesmo instante.

## Como é por dentro

| Arquivo | O que faz |
|---|---|
| `fundo.js` | Service worker. Bate na licença, guarda o mapa de seletores, obedece o kill switch, junta os eventos e manda em lote |
| `painel.html/js/css` | Painel lateral: onde o **áudio toca** |
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
- **Não responde o chat ainda.** A leitura está pronta e os eventos chegam ao
  painel ao vivo. A resposta depende do lado servidor (gerador com contexto do
  produto e cadência), que é o próximo bloco.
- **Não abre a live por você.** Você inicia a transmissão no LIVE Studio; a
  extensão assume o áudio.

## Aviso de risco

Automatizar o LIVE Studio tende a violar os Termos do TikTok, e um eventual
bloqueio recai sobre a conta do cliente. O aceite é registrado no painel antes
de a extensão poder operar, e o texto está em `/live`.

Dois freios independentes existem de propósito: o **mixer** (o áudio) e o
**chat** (a automação de conversa) são liberados separadamente, por conta e na
base inteira. Se a automação de chat precisar morrer, o áudio continua e o
produto sobrevive.
