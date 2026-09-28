-- =============================================================================
-- Mapa de seletores v3: o chat da página da live no tiktok.com.
--
-- A v2 inteira era palpite (`data-e2e="chat-item"` e afins) e nunca foi vista
-- contra o DOM real — nenhuma live rodou até aqui, então a telemetria também
-- nunca acusou nada. Esta versão acrescenta, como fallback, o que código em
-- uso de verdade lê na página da live:
--
--   · lista do chat:  div[class*="DivChatMessageList"]
--   · mensagem:       div[class*="DivChatMessage"]
--   · apelido:        span[class*="SpanEllipsisName"]
--   · comentário:     div[class*="DivComment"]
--   · campo do chat:  div[contenteditable="plaintext-only"]  (envio por Enter)
--   · botão enviar:   [class*="DivPostButton"]
--
-- Casar por PEDAÇO do nome da classe não é o mesmo que casar a classe com
-- hash (que o CHECK recusa, e com razão): o TikTok gera classes como
-- `css-1x2y3z-DivChatMessageList`, em que o hash muda a cada build e o nome do
-- componente, não. É o nome que está sendo casado aqui.
--
-- Os candidatos da v2 continuam na frente: se um dia existirem, são mais
-- específicos. Quando só o último degrau casar, a telemetria avisa
-- (`ultimo_recurso`) — é o sinal para promover o que funcionou.
--
-- A entrada de espectador segue sem prova em DOM real; a cascata tenta o
-- nome de componente mais provável e o texto "entrou"/"joined".
-- =============================================================================

select public.publicar_mapa_seletores(
  jsonb_build_object(
    -- chat: o que a extensão usa hoje
    'chat.lista', jsonb_build_array(
      'css=[data-e2e="chat-list"]',
      'css=div[class*="DivChatMessageList"]',
      'css=div[class*="DivChatRoomContent"]',
      'aria=Comentários',
      'papel=log'),
    'chat.item', jsonb_build_array(
      'css=[data-e2e="chat-item"]',
      'css=[data-e2e="chat-message"]',
      'css=div[class*="DivChatMessageList"] > div',
      'css=div[class*="DivChatMessage"]:not([class*="DivChatMessageList"])'),
    'chat.item_autor', jsonb_build_array(
      'css=[data-e2e="chat-nickname"]',
      'css=[data-e2e="message-owner-name"]',
      'css=span[class*="SpanEllipsisName"]',
      'css=[class*="SpanNickName"]'),
    'chat.item_texto', jsonb_build_array(
      'css=[data-e2e="chat-text"]',
      'css=div[class*="DivComment"]',
      'css=[class*="SpanComment"]'),
    'chat.campo', jsonb_build_array(
      'css=[data-e2e="chat-input"]',
      'css=div[contenteditable="plaintext-only"]',
      'css=[class*="DivEditor"] [contenteditable]',
      'aria=Enviar um comentário',
      'papel=textbox'),
    'chat.enviar', jsonb_build_array(
      'css=[data-e2e="chat-send"]',
      'css=[class*="DivPostButton"]',
      'aria=Publicar',
      'aria=Post'),
    'chat.entrada', jsonb_build_array(
      'css=[data-e2e="chat-member-enter"]',
      'css=[class*="EnterMessage"]',
      'css=[class*="DivEnter"]',
      'texto=entrou',
      'texto=joined'),
    'chat.entrada_autor', jsonb_build_array(
      'css=[data-e2e="chat-nickname"]',
      'css=span[class*="SpanEllipsisName"]',
      'css=[class*="Nickname"]',
      'css=[class*="UserName"]'),

    -- estúdio: sem uso no código atual da extensão; mantidas da v2 para a
    -- telemetria continuar comparável quando voltarem a ser usadas.
    'estudio.raiz',              jsonb_build_array('css=[data-e2e="live-studio"]', 'papel=main', 'css=#root main'),
    'estudio.botao_iniciar',     jsonb_build_array('css=[data-e2e="live-start-button"]', 'texto=Iniciar'),
    'estudio.botao_parar',       jsonb_build_array('css=[data-e2e="live-stop-button"]', 'texto=Encerrar'),
    'estudio.indicador_ao_vivo', jsonb_build_array('css=[data-e2e="live-status"]', 'aria=Ao vivo'),
    'estudio.espectadores',      jsonb_build_array('css=[data-e2e="live-viewer-count"]', 'css=[class*="DivUserCount"]', 'aria=Espectadores'),
    'estudio.cupom',             jsonb_build_array('css=[data-e2e="live-coupon-button"]', 'aria=Cupom', 'texto=Cupom'),
    'estudio.produto_fixado',    jsonb_build_array('css=[data-e2e="live-pinned-product"]', 'css=[data-e2e="product-pin"]', 'aria=Produto fixado'),
    'estudio.produto_destacar',  jsonb_build_array('css=[data-e2e="product-highlight-button"]', 'aria=Destacar', 'texto=Destacar')
  ),
  'tiktok_live_studio',
  'v3: fallbacks por nome de componente (DivChatMessageList, SpanEllipsisName, DivComment, contenteditable plaintext-only), vistos em código que lê a página da live de verdade. Entrada de espectador ainda sem prova.'
);
