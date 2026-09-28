-- =============================================================================
-- Mapa v5: o texto do comentário.
--
-- Na página salva com um comentário de verdade ("Olá", de Best Nails BR), o
-- apelido do comentário fica UM nível mais fundo que o da entrada — junto do
-- selo de nível do espectador:
--
--   [chat-message] > … > div.w-full.flex > div.inline-flex > [selo] [message-owner-name]
--                        div.w-full.break-words   ← o texto
--
-- A v4 procurava o texto logo depois do pai do apelido; no comentário ele vem
-- depois do avô. O candidato novo vem primeiro; o da v4 continua de reserva.
-- Validado rodando o seletores.js da extensão contra a página salva.
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
      'css=div:has(> div > [data-e2e="message-owner-name"]) + div',
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
  'v5: texto do comentario (um nivel mais fundo que na entrada, por causa do selo de nivel). Visto na pagina salva com comentario de 27/09.'
);
