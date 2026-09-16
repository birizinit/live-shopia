-- =============================================================================
-- Mapa de seletores v2: as âncoras de entrada, cupom e produto fixado.
--
-- AVISO HONESTO, E ELE IMPORTA:
-- as âncoras NOVAS abaixo são PALPITE. Elas seguem o padrão `data-e2e` que o
-- TikTok usa nas âncoras já mapeadas, mas nunca foram vistas contra o DOM real
-- do LIVE Studio — ninguém aqui abriu o LIVE Studio com uma conta de vendedor.
--
-- É exatamente para isso que o mapa é remoto: quando a primeira live real
-- mostrar que erramos, a telemetria diz qual âncora falhou e a correção é
-- publicar a v3. O cliente não reinstala nada.
--
-- O que acontece enquanto elas estiverem erradas: o recurso correspondente
-- simplesmente NÃO acontece, e a falha vira linha em ext_telemetria. A live
-- continua no ar com o áudio, que é o que sustenta o produto.
-- =============================================================================

select public.publicar_mapa_seletores(
  jsonb_build_object(
    -- ---------------------------------------------------------------- verificadas
    -- (vieram da v1; continuam sem confirmação em DOM real, mas são as que o
    --  levantamento do concorrente indicou)
    'estudio.raiz',              jsonb_build_array('css=[data-e2e="live-studio"]', 'papel=main', 'css=#root main'),
    'estudio.botao_iniciar',     jsonb_build_array('css=[data-e2e="live-start-button"]', 'texto=Iniciar'),
    'estudio.botao_parar',       jsonb_build_array('css=[data-e2e="live-stop-button"]', 'texto=Encerrar'),
    'estudio.indicador_ao_vivo', jsonb_build_array('css=[data-e2e="live-status"]', 'aria=Ao vivo'),
    'chat.lista',                jsonb_build_array('css=[data-e2e="chat-list"]', 'papel=log', 'aria=Comentários'),
    'chat.item',                 jsonb_build_array('css=[data-e2e="chat-item"]', 'css=[data-e2e="chat-list"] > div > div'),
    'chat.item_autor',           jsonb_build_array('css=[data-e2e="chat-nickname"]', 'css=[data-e2e="chat-item"] a'),
    'chat.item_texto',           jsonb_build_array('css=[data-e2e="chat-text"]', 'css=[data-e2e="chat-item"] span:last-child'),
    'chat.campo',                jsonb_build_array('css=[data-e2e="chat-input"]', 'aria=Enviar um comentário', 'papel=textbox'),
    'chat.enviar',               jsonb_build_array('css=[data-e2e="chat-send"]', 'aria=Enviar', 'texto=Enviar'),

    -- ---------------------------------------------------------------- PALPITE
    -- Entrada de espectador: no chat do LIVE Studio a entrada costuma ser um
    -- item do mesmo container, com marcação própria.
    'chat.entrada',              jsonb_build_array('css=[data-e2e="chat-member-enter"]', 'css=[data-e2e="chat-item"][data-type="member"]', 'texto=entrou'),
    'chat.entrada_autor',        jsonb_build_array('css=[data-e2e="chat-member-enter"] [data-e2e="chat-nickname"]', 'css=[data-e2e="chat-member-enter"] a'),

    -- Contagem de espectadores: alimenta o pico da sessão no batimento.
    'estudio.espectadores',      jsonb_build_array('css=[data-e2e="live-viewer-count"]', 'aria=Espectadores'),

    -- Cupom e produto fixado: os dois controles que a apresentadora aciona.
    'estudio.cupom',             jsonb_build_array('css=[data-e2e="live-coupon-button"]', 'aria=Cupom', 'texto=Cupom'),
    'estudio.produto_fixado',    jsonb_build_array('css=[data-e2e="live-pinned-product"]', 'css=[data-e2e="product-pin"]', 'aria=Produto fixado'),
    'estudio.produto_destacar',  jsonb_build_array('css=[data-e2e="product-highlight-button"]', 'aria=Destacar', 'texto=Destacar')
  ),
  'tiktok_live_studio',
  'v2: entrada de espectador, contagem, cupom e produto fixado. As seis âncoras novas são PALPITE — nunca vistas contra o DOM real. Telemetria dirá o que corrigir.'
);
