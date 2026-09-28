-- =============================================================================
-- Mapa de seletores v4: o chat da página da live, visto de verdade.
--
-- A v3 continuava errada. Na primeira live real (27/09) a extensão achou a
-- página mas não o chat: o TikTok de hoje não usa nome de componente na classe
-- (só classes utilitárias), e nenhum dos `data-e2e` da v1–v3 existe. Esta
-- versão sai da página salva daquela live:
--
--   · lista        [data-e2e=live-chat-container]
--   · entrada      [data-e2e=enter-message]            ("fulano entrou")
--   · apelido      [data-e2e=message-owner-name]
--   · texto        o bloco logo depois do apelido      (div:has(> apelido) + div)
--   · campo        [data-e2e=room-chat-input-field]    (contenteditable plaintext-only)
--   · enviar       [data-e2e=room-chat-send-btn]
--
-- Cada linha nova do chat entra como um `div` dentro da lista; o content script
-- olha a entrada primeiro e, se não for, lê apelido e texto da linha. Linha de
-- sistema ("Boas-vindas ao TikTok LIVE!") não tem apelido nem texto depois
-- dele, e por isso é ignorada.
--
-- Validado rodando o seletores.js da extensão contra a página salva: as três
-- entradas daquela live saíram com o apelido certo, e um comentário no mesmo
-- formato saiu com apelido e texto separados.
-- =============================================================================

select public.publicar_mapa_seletores(
  jsonb_build_object(
    'chat.lista', jsonb_build_array(
      'css=[data-e2e="live-chat-container"]'),
    'chat.item', jsonb_build_array(
      'css=[data-e2e="live-chat-container"] div:has(> [data-e2e="enter-message"]), [data-e2e="live-chat-container"] div:has(> [data-e2e="chat-message"])',
      'css=[data-e2e="live-chat-container"] div:has(> div [data-e2e="message-owner-name"])'),
    'chat.item_autor', jsonb_build_array(
      'css=[data-e2e="message-owner-name"]'),
    'chat.item_texto', jsonb_build_array(
      'css=div:has(> [data-e2e="message-owner-name"]) + div',
      'css=div:has(> [data-e2e="message-owner-name"]) ~ span'),
    'chat.entrada', jsonb_build_array(
      'css=[data-e2e="enter-message"]'),
    'chat.entrada_autor', jsonb_build_array(
      'css=[data-e2e="message-owner-name"]'),
    'chat.campo', jsonb_build_array(
      'css=[data-e2e="room-chat-input-field"]',
      'css=div[contenteditable="plaintext-only"]'),
    'chat.enviar', jsonb_build_array(
      'css=[data-e2e="room-chat-send-btn"]'),

    -- Sem uso no código atual da extensão; mantidas para a telemetria.
    'estudio.espectadores', jsonb_build_array('css=[data-e2e="person-count"]'),
    'estudio.raiz',         jsonb_build_array('css=[data-e2e="live-room-content"]', 'papel=main')
  ),
  'tiktok_live_studio',
  'v4: etiquetas reais da página da live (live-chat-container, enter-message, message-owner-name, room-chat-input-field, room-chat-send-btn), tiradas da página salva da primeira live de 27/09.'
);
