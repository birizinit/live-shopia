# Extensão — manual de operação

Este é o documento de plantão: o que fazer no dia em que o TikTok muda o DOM, no
dia em que a extensão derruba a conta de um cliente, e no dia normal em que só
se publica uma versão nova.

## O estado de hoje, sem maquiagem

**O pacote da extensão ainda não existe.** A tabela `ext_versoes` está vazia, e
por isso `/extensao` mostra o selo "Ainda não publicada", o título "O pacote
ainda não foi publicado" e a lista de recursos inteira em "em breve" — sem
nenhum botão de download. Isso não é um bug nem uma tela inacabada: é a tela
contando a verdade.

O que **já existe e funciona** é todo o contrato em volta — licença por token,
mapa de seletores servido pelo servidor, telemetria de quebra, resolução de
versão com canal, canário e kill switch (`db/migrations/0007_extensao.sql`,
`src/lib/dados/extensao.ts`, `src/app/api/ext/*`).

No minuto em que o primeiro pacote entrar em `ext_versoes` pelo comando abaixo,
a MESMA página passa a mostrar o download. Nenhuma linha de código muda.

---

## 1. Publicar uma versão

```bash
node scripts/publicar-extensao.mjs \
  --pasta ./extensao \
  --versao 1.0.0 \
  --canal estavel \
  --notas "Primeira versão pública: mixer de áudio e leitura do chat."
```

Com o ZIP já montado por outra ferramenta, é a mesma coisa trocando a origem —
e ele sofre exatamente as mesmas validações:

```bash
node scripts/publicar-extensao.mjs --zip ./pacote.zip --versao 1.0.0
```

`node scripts/publicar-extensao.mjs --ajuda` lista todas as opções.

### O que o comando recusa, e por quê

| Recusa | Motivo |
|---|---|
| `manifest.json` fora da raiz do pacote | Quase sempre é `--pasta` apontando para a pasta-mãe. O erro diz onde o manifest foi achado. |
| `manifest_version` diferente de 3 | O Chrome não instala MV2. Publicar MV2 é publicar algo que não instala. |
| `version` do manifest ≠ `--versao` | As duas aparecem lado a lado no erro. É sempre "esqueci de subir uma das duas". |
| ZIP acima de 8 MB | `arquivos_tamanho_por_linha`. O erro lista os cinco maiores arquivos do pacote. |
| Domínio de terceiro no código | Ver a seção 1.1. Exige `--confirmar-dominios`. |
| Mesmo número de versão com binário diferente | Ver a seção 1.3. Exige `--substituir`. |
| `.pem`, `.key`, `.p12`, `.pfx` dentro do pacote | Chave de assinatura publicada é chave perdida. Com `--pasta` ela fica de fora e o comando avisa; com `--zip` ele para. |

Antes de publicar de verdade, `--seco` roda tudo isso e não toca no banco.
`--salvar saida.zip` grava o ZIP montado para você abrir e conferir.

### 1.1 O aviso de domínio de terceiro

O comando varre os `.js`, `.json`, `.html` e `.css` do pacote atrás de URL e
agrupa os domínios encontrados em quatro listas: **nossos** (derivados de
`NEXT_PUBLIC_SITE_URL`), **locais**, **do alvo** (`tiktok.com` e companhia, que
a extensão precisa ler por definição) e **de terceiro**.

Achando qualquer coisa na quarta lista, ele **para** e só segue com
`--confirmar-dominios`. O motivo é direto: uma extensão que fala com o servidor
de outra empresa manda para lá a credencial do **nosso** cliente — o token da
licença, o e-mail, o que estiver no caminho. É um erro que não dá para descobrir
depois de publicado.

O gate não dispara com TikTok de propósito. Gate que acende em toda publicação
vira flag decorativa, e aí não protege mais no dia em que o domínio estranho é
de verdade.

### 1.2 Canal, canário e promoção

```bash
# Sai para 5% da base (o padrão vem de ext.canario_percentual):
node scripts/publicar-extensao.mjs --pasta ./extensao --versao 1.1.0 --canal canario

# Fatia explícita:
node scripts/publicar-extensao.mjs --pasta ./extensao --versao 1.1.0 --canal canario --percentual 20
```

Quem cai na fatia é decidido por `ext_bucket(licenca_id)`, um hash estável da
licença. Duas consequências práticas: a mesma instalação **não troca de versão a
cada heartbeat**, e subir de 5% para 20% **acrescenta** gente ao canário em vez
de sortear um grupo novo.

A equipe e os testadores não dependem do sorteio — basta fixar a conta no canal:

```sql
update ext_licencas set canal = 'canario' where perfil_id = '<uuid do perfil>';
```

Deu certo o canário, promova. Não republique o pacote: é a mesma linha:

```sql
update ext_versoes
   set canal = 'estavel', percentual_canario = null
 where versao = '1.1.0';
```

Deu errado, o caminho é a seção 3, não o `delete`.

### 1.3 Idempotência, e o número que não se reaproveita

Rodar o comando duas vezes com o mesmo pacote **não duplica nada**: o script
compara o `sha256` do ZIP com o que está no banco e, se for igual, só atualiza os
metadados (notas, canal, fatia). O ZIP é determinístico — mesma árvore de
arquivos, mesmo byte, mesmo hash —, então copiar a pasta para outra máquina não
inventa um pacote "diferente".

Binário **diferente** sob um número **já publicado** é recusado. Isso protege a
telemetria: ela agrupa por `versao`, e duas máquinas dizendo rodar a v1.0.0 com
bytes diferentes misturam as duas séries justamente no dia em que você precisa
ler o gráfico. O caminho normal é publicar `1.0.1`. `--substituir` existe para a
exceção consciente (o pacote subiu quebrado e ninguém baixou ainda) e marca o
arquivo antigo como removido.

### 1.4 Rascunho

`--rascunho` grava o pacote com `publicada_em` nulo: a linha existe, o binário
está no banco e **a tela não mostra nada**, porque ela só lê versão publicada.
Serve para subir o arquivo agora e abrir depois, na hora combinada:

```sql
update ext_versoes set publicada_em = now() where versao = '1.0.0';
```

### 1.5 Depois de publicar

A saída do comando termina dizendo, com todas as letras, o que `/extensao` passa
a mostrar. Em resumo: o selo do topo vira `v1.0.0`, a abertura troca "O pacote
ainda não foi publicado" pela área de download, o roteiro de instalação perde o
aviso de que os passos ainda não valem, e a lista de recursos sai de "em breve"
para refletir o plano de cada conta.

Duas coisas que o comando avisa e vale repetir:

- **sem `EXTENSAO_SEGREDO` no ambiente o botão fica desligado.** É essa variável
  que assina o ticket HMAC de 15 minutos usado por `/api/ext/baixar` — um
  `<a href>` não manda cabeçalho, e pôr o token da licença na URL o deixaria no
  histórico, no log do proxy e no `Referer`. Sem a variável a tela explica isso
  ao usuário em vez de servir arquivo sem prova de quem pediu;
- **a base instalada só vê a versão nova no próximo heartbeat** (padrão de 120s,
  em `ext.heartbeat_segundos`).

---

## 2. O TikTok mudou o DOM — publicar um mapa de seletores

Esta é a operação mais importante do documento, e a que precisa sair em minutos.

A extensão **não traz seletor nenhum compilado**: ela pede o mapa em
`/api/ext/seletores` e resolve cada âncora pela cascata. Consertar uma quebra é
um `INSERT`, não uma republicação na Web Store com dias de análise e a base
inteira parada.

```sql
select * from publicar_mapa_seletores(
  '{
    "estudio.raiz":              ["css=[data-e2e=\"live-studio\"]", "papel=main", "css=#root main"],
    "estudio.botao_iniciar":     ["css=[data-e2e=\"live-start-button\"]", "texto=Iniciar transmissão", "texto=Go LIVE"],
    "estudio.botao_parar":       ["css=[data-e2e=\"live-stop-button\"]", "texto=Encerrar transmissão", "texto=End LIVE"],
    "estudio.indicador_ao_vivo": ["css=[data-e2e=\"live-status\"]", "aria=Ao vivo", "aria=LIVE"],
    "audio.seletor_entrada":     ["css=[data-e2e=\"audio-source-select\"]", "aria=Fonte de áudio", "texto=Microfone"],
    "chat.lista":                ["css=[data-e2e=\"chat-list\"]", "papel=log", "aria=Comentários"],
    "chat.item":                 ["css=[data-e2e=\"chat-item\"]", "css=[data-e2e=\"chat-list\"] > div > div"],
    "chat.item_autor":           ["css=[data-e2e=\"chat-nickname\"]", "css=[data-e2e=\"chat-item\"] a"],
    "chat.item_texto":           ["css=[data-e2e=\"chat-text\"]", "css=[data-e2e=\"chat-item\"] span:last-child"],
    "chat.campo":                ["css=[data-e2e=\"chat-input\"]", "aria=Enviar um comentário", "papel=textbox"],
    "chat.enviar":               ["css=[data-e2e=\"chat-send\"]", "aria=Enviar", "texto=Enviar"],
    "espectadores.contador":     ["css=[data-e2e=\"live-viewer-count\"]", "aria=Espectadores"]
  }'::jsonb,
  'tiktok_live_studio',
  'Conserto de 11/09: o chat trocou data-e2e="chat-item" por lista virtualizada.'
);
```

A função aposenta o mapa anterior e publica o novo **no mesmo commit** — nunca
existe um instante com dois mapas ativos nem com nenhum. No dia da quebra
ninguém vai lembrar de desativar o antigo à mão, e é por isso que isso não é
responsabilidade de quem digita.

**Mande o mapa inteiro, sempre.** Não existe publicação parcial: o mapa novo
substitui o anterior por completo. Comece pelo mapa ativo e edite só as âncoras
que quebraram:

```sql
select versao, mapa from seletores_mapas
 where alvo = 'tiktok_live_studio' and ativo;
```

### O formato, e o que o banco recusa

```
{ "<ancora>": ["<estrategia>=<valor>", ...] }
```

A chave é o ponto de ancoragem que o código pede pelo nome. O valor é a
**cascata de fallback, em ordem**: o primeiro candidato que resolver ganha.
Estratégias: `css=`, `aria=`, `texto=`, `papel=`.

O `CHECK seletores_mapas_formato` recusa classe hasheada (`.css-1x2y3z`,
`.e1a2b3c4`) porque ela muda a cada build do TikTok — mapa ancorado nela já
nasce quebrado, e o lugar de descobrir isso é no `INSERT`, não no cliente.
Prefira `data-e2e`, `aria-label`, papel ARIA e texto visível: são os atributos
que o TikTok mantém entre builds, porque o teste automatizado deles também
depende disso.

### Como saber que o conserto chegou

A extensão manda a versão do mapa que tem; `seletores_ativos` só devolve JSON
quando mudou. O atraso máximo entre publicar e a base voltar é um heartbeat —
120s por padrão, ajustável em `ext.heartbeat_segundos` sem deploy.

```sql
-- Quem já está com o mapa novo (mapa_versao por instalação viva):
select mapa_versao, count(*)
  from ext_instalacoes
 where ultimo_contato >= now() - interval '1 hour'
 group by mapa_versao
 order by mapa_versao desc;
```

---

## 3. Kill switch e canário

### Apertar o freio

`kill_switch` desliga a versão em toda a base sem passar pela Web Store, e —
esta é a parte que importa — **vale para quem JÁ está rodando ela**, não só para
quem ia baixar. No dia em que a extensão derruba a conta de um cliente não dá
para esperar o Chrome atualizar.

```sql
update ext_versoes
   set kill_switch = true,
       kill_motivo = 'A automação de chat da 1.2.0 dispara em rajada e o TikTok está limitando a conta.'
 where versao = '1.2.0';
```

O motivo é obrigatório (`ext_versoes_kill_explicado`): ele aparece para o cliente
no alerta vermelho de `/extensao` — "Desligamos a versão que você está rodando" —
e é o que evita o WhatsApp perguntando o que houve.

Soltar o freio é o inverso, e não acontece por acaso: **republicar a versão não
desarma o kill switch**, porque quem apertou apertou por um motivo, e o motivo
não some porque um pacote novo subiu.

```sql
update ext_versoes set kill_switch = false, kill_motivo = null where versao = '1.2.0';
```

### O freio menor: só o chat

Matar a automação de chat na base inteira **sem derrubar o mixer** é outra
chave, e é ela que se usa quando o problema é a política de automação e não o
código:

```sql
update configuracoes set valor = 'true'::jsonb, atualizado_em = now()
 where chave = 'ext.chat_desligado';
```

Chat e mixer são recursos separados desde o schema justamente para isto: se o
chat precisar morrer, o produto continua de pé. Por conta, em vez da base
inteira: `update ext_licencas set chat = false where perfil_id = '…';`.

### Usar o canário como freio

Voltar o canário atrás não precisa de kill switch — basta encolher a fatia. Quem
está fora dela cai de volta na última estável no próximo heartbeat:

```sql
update ext_versoes set percentual_canario = 0 where versao = '1.1.0';
```

Esta é a ordem certa de escalonamento: **fatia → chat desligado → kill switch**.
Cada degrau derruba menos coisa que o seguinte.

---

## 4. Onde ler a telemetria de quebra

A extensão reporta **qual âncora falhou**, agrupada (40 falhas do mesmo seletor
viram uma linha com `ocorrencias = 40`). Um gatilho agrega em
`ext_telemetria_resumo` no momento do `INSERT`, e não num job noturno, porque o
momento em que este número importa é o da quebra acontecendo.

**Ainda não há tela para isso.** Nenhum componente do painel consome
`ext_quebras` hoje — quem está de plantão lê por SQL. Dizer que existe um alerta
automático seria mentira; o que existe é o dado, pronto e barato de consultar.

```sql
-- O alerta do dia: pontos em que ≥5% das instalações VIVAS na versão falharam.
select * from ext_quebras();

-- Outro dia, outro limiar:
select * from ext_quebras('2026-09-10', 2);
```

Leia **percentual**, não contagem: 30 falhas é rotina com 3.000 instalações e é
incêndio com 40. `instalacoes` (o numerador) é o que separa "uma máquina falhando
400 vezes" de "400 máquinas falhando uma vez" — a segunda é o TikTok tendo mudado
o DOM.

```sql
-- A série de um ponto específico, para ver quando começou:
select dia, instalacoes, ocorrencias
  from ext_telemetria_resumo
 where seletor = 'chat.item' and versao = '1.0.0'
 order by dia desc limit 14;

-- Quantas instalações estão vivas em cada versão (o denominador):
select versao, count(*)
  from ext_instalacoes
 where ultimo_contato >= now() - interval '24 hours'
 group by versao order by 2 desc;
```

Duas coisas a saber antes de interpretar:

- **`dia` é horário de Brasília, não UTC.** O banco roda em UTC; um dia que
  virasse às 21h partiria o pico de uma quebra em duas linhas, bem no horário de
  maior live do país. Por isso `ext_quebras()` também não usa `current_date` como
  padrão;
- **a telemetria crua tem prazo.** A faxina apaga o que passou de
  `ext.telemetria_retencao_dias` (30). O agregado fica — ele não identifica
  ninguém, e a série histórica de quebras não pode depender de manter dado
  pessoal por perto.

### O que nunca vai estar aqui

`ext_telemetria` não tem coluna para comentário do chat, `@usuário`, apelido, id
de sala, URL com identificador ou IP — e um `CHECK` recusa texto que pareça
qualquer uma dessas coisas. O espectador do cliente não é usuário nosso, nunca
consentiu com nada e não tem a quem pedir exclusão. Se um dia faltar um campo
para depurar, o caminho é uma migração revisada, não um `metadados` solto.

---

## 5. Por que não reaproveitar o pacote de um concorrente

É uma ideia que aparece sozinha quando se olha para o tamanho da fase 5, e ela
não se sustenta por um motivo técnico simples: aquele pacote autentica contra o
servidor **dele**. Rodando na máquina do nosso cliente, é para lá que vão as
credenciais, o e-mail e o comportamento de uso — dado do nosso cliente, num
servidor que não controlamos e não auditamos.

Não é só má ideia jurídica; é uma vulnerabilidade que a gente instalaria com as
próprias mãos, e que nenhum `ctrl+F` de domínio conserta depois. É por isso que
o `publicar-extensao.mjs` para diante de domínio de terceiro em vez de apenas
avisar.

---

## Referência rápida

| Tabela / função | Para quê |
|---|---|
| `ext_versoes` | Catálogo de builds. Canal, canário, kill switch. |
| `ext_licencas` | Uma por perfil. Só o SHA-256 do token mora aqui. |
| `ext_instalacoes` | Uma por máquina. Denominador de todo alerta. |
| `seletores_mapas` | O mapa remoto. A defesa contra a quebra de DOM. |
| `ext_telemetria` / `ext_telemetria_resumo` | Qual âncora falhou; o agregado por dia. |
| `publicar_mapa_seletores(mapa, alvo, notas, por)` | Publica mapa e aposenta o anterior no mesmo commit. |
| `ext_versao_para(licenca_id, versao_atual)` | O que a instalação deve rodar, e se precisa parar agora. |
| `ext_quebras(dia, minimo)` | O alerta de quebra, em percentual das vivas. |

| Configuração | Padrão | Efeito |
|---|---|---|
| `ext.chat_desligado` | `false` | Mata a automação de chat na base inteira, sem tocar no mixer. |
| `ext.canario_percentual` | `5` | Fatia padrão do canário ao publicar versão nova. |
| `ext.heartbeat_segundos` | `120` | Atraso máximo entre publicar um mapa e a base voltar. |
| `ext.quebra_percentual_alerta` | `5` | A partir de quanto uma falha de seletor vira alerta. |
| `ext.telemetria_retencao_dias` | `30` | Prazo da telemetria crua. O agregado fica. |
| `ext.licenca_graca_dias` | `7` | Janela offline: indisponibilidade nossa não derruba a live do cliente. |

Todas se ajustam sem deploy:

```sql
update configuracoes set valor = '60'::jsonb, atualizado_em = now()
 where chave = 'ext.heartbeat_segundos';
```
