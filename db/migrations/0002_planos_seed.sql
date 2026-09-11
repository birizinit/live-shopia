-- =============================================================================
-- Planos — semente.
--
-- Só os dois preços que o levantamento do concorrente confirmou
-- (docs/referencia-livefox.md §8). O tier intermediário e os tetos de crédito
-- ficam nulos de propósito: são a pendência §9.4 do PLANO.md, e chutar número
-- aqui vira número errado no checkout depois.
--
-- `creditos_mes` é em CARACTERES. Referência: ~600 chars/min de fala,
-- 108.000 chars ≈ 3h ≈ US$16 de ElevenLabs por geração.
-- =============================================================================

insert into public.planos
  (slug, nome, descricao, preco_centavos, contas_tiktok, voz_premium, creditos_mes, recursos, ordem)
values
  (
    'copy-live',
    'Copy Live',
    'Só a IA de copy: roteiro de vendas pronto para narrar.',
    2990,
    1,
    false,
    null,
    '["Roteiro de vendas por IA", "1 conta TikTok", "Extensão liberada"]'::jsonb,
    10
  ),
  (
    'premium',
    'Premium',
    'A live inteira no automático, com voz premium e extensão premium.',
    29700,
    3,
    true,
    null,
    '["Voz premium", "Respostas no chat", "Sons naturais", "Câmera virtual", "Extensão premium", "3 contas TikTok"]'::jsonb,
    30
  )
on conflict (slug) do nothing;
