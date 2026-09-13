-- =============================================================================
-- planos.creditos_mes — a cota mensal de caracteres de cada plano.
--
-- Nasceu nula de propósito em 0002, esperando a decisão de negócio. Ficar nula
-- tem custo dos dois lados: quem paga não recebe caractere nenhum, e do outro
-- lado não existe teto entre um cliente e a fatura da ElevenLabs.
--
-- A CONTA (premissa: US$0,20/1.000 caracteres, que é o tier Creator/Pro onde os
-- primeiros clientes caem — os US$0,15 do plano só valem em volume de Scale;
-- dólar a R$5,50):
--
--   1 geração de 3h = 108.000 caracteres = R$118,80 de custo
--   Ponto de equilíbrio do Premium, sem afiliado: 270.000 caracteres/mês
--
--   Copy Live  R$ 29,90 ·  10.000 chars · custo R$ 11,00 · sobra R$  18,90
--   Premium    R$297,00 · 120.000 chars · custo R$132,00 · sobra R$ 165,00
--
-- ATENÇÃO, E ISSO É DECISÃO DE NEGÓCIO, NÃO DE CÓDIGO:
-- essas sobras são SEM comissão de afiliado. Com a cadeia cheia a 63% da venda,
-- o Copy Live sobra R$0,06 e o Premium dá PREJUÍZO de R$22,11 por cliente/mês.
-- Ou a comissão cai, ou o preço sobe, ou a cota diminui. As cotas abaixo estão
-- dimensionadas para o cenário SEM afiliado; ligar o programa multinível com
-- estes números é vender no prejuízo.
--
-- Os números vivem aqui e mudam com um update, sem deploy.
-- =============================================================================

update public.planos
   set creditos_mes = 10000,
       descricao = 'Roteiro de vendas por IA e uma amostra de voz. Para quem escreve a copy e narra por conta própria.'
 where slug = 'copy-live';

update public.planos
   set creditos_mes = 120000,
       descricao = 'Voz premium e áudio contínuo da live. 120 mil caracteres por mês — cerca de 3h20 de fala, ou uma geração completa com folga.'
 where slug = 'premium';

insert into public.configuracoes (chave, valor, descricao) values
  ('creditos.custo_usd_por_mil', '0.20',
   'Custo da ElevenLabs por 1.000 caracteres, no tier contratado. Base de toda conta de margem. Revise ao trocar de tier.'),
  ('creditos.cambio_usd', '5.50',
   'Câmbio usado nas contas de margem do painel. Não é cotação ao vivo; é a premissa conservadora.')
on conflict (chave) do nothing;

-- O tier intermediário entre R$29,90 e R$297,00 continua faltando (PLANO §9.4).
-- Não foi inventado aqui de propósito: preço chutado vira preço errado no
-- checkout, e o levantamento do concorrente só confirmou estes dois.
