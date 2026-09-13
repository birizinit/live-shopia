-- =============================================================================
-- Planos unificados: um produto, três periodicidades.
--
-- Sai o par Copy Live / Premium (dois produtos diferentes) e entra um produto
-- só com acesso a tudo, cobrado por mês, trimestre ou ano. Decisão do dono do
-- negócio em 11/09/2026.
--
--   Mensal      R$  97,00  = R$ 97,00/mês
--   Trimestral  R$ 197,00  = R$ 65,67/mês
--   Anual       R$ 497,00  = R$ 41,42/mês
--
-- A COTA É A MESMA NOS TRÊS, e quem a dimensiona é o ANUAL: ele é o plano com
-- menos receita por mês, então é ele que define o teto de custo de todos.
--
-- Com US$0,20/1.000 caracteres (tier Creator/Pro, que é onde os primeiros
-- clientes caem) e dólar a R$5,50, cada 1.000 caracteres custa R$1,10:
--
--   cota 30.000/mês → custo R$33,00/mês
--     Mensal      margem R$64,00  (66%)
--     Trimestral  margem R$32,67  (50%)
--     Anual       margem R$ 8,42  (20%)
--
-- 30.000 caracteres são ~50 minutos de fala por mês. Parece pouco e não é: o
-- loop é de graça. Um áudio de 25 minutos roda 24h por dia o mês inteiro, e a
-- cota dá para dois deles — ou seja, trocar o discurso duas vezes por mês sem
-- pagar nada a mais. Quem gerar 3h de uma vez (108.000 caracteres) estoura a
-- cota, e é exatamente esse o comportamento que a cota existe para conter.
--
-- DUAS COISAS QUE O DONO PRECISA SABER, E QUE NÃO SÃO DECISÃO DE CÓDIGO:
--
-- 1. O anual a R$497 é 57% de desconto sobre o mensal (R$97 × 12 = R$1.164).
--    Ele fecha com 20% de margem e nenhuma folga para erro de câmbio ou de tier.
--
-- 2. Com a comissão de afiliado a 63% da venda, SÓ O MENSAL sobrevive — e por
--    R$2,89. O trimestral perde R$8,70/mês e o anual perde R$17,68/mês. Ligar o
--    multinível com esta tabela de preço é vender no prejuízo nos dois planos
--    mais longos. Ou a comissão cai, ou ela vale só para o mensal.
-- =============================================================================

-- Periodicidade: quantos meses cada cobrança cobre. Faltava, e sem ela não dá
-- para fechar o ciclo da assinatura nem comparar preço mensalizado na tela.
alter table public.planos
  add column if not exists meses smallint not null default 1
    check (meses in (1, 3, 12));

comment on column public.planos.meses is
  'Meses cobertos por cobrança. creditos_mes continua sendo a cota MENSAL.';

-- Os planos antigos saem de cena sem serem apagados: assinatura histórica e
-- aula com exige_plano continuam apontando para linha que existe.
update public.planos set ativo = false where slug in ('copy-live', 'premium');

insert into public.planos
  (slug, nome, descricao, preco_centavos, meses, contas_tiktok, voz_premium, creditos_mes, recursos, ordem, ativo)
values
  (
    'mensal', 'Mensal',
    'Acesso a tudo, cobrado todo mês. Cancele quando quiser.',
    9700, 1, 3, true, 30000,
    '["Acesso a tudo", "Voz premium", "Roteiro por IA", "Áudio contínuo da live", "Respostas no chat", "Extensão liberada", "3 contas TikTok", "30 mil caracteres por mês"]'::jsonb,
    10, true
  ),
  (
    'trimestral', 'Trimestral',
    'Os mesmos recursos, cobrados a cada três meses. Sai R$65,67 por mês.',
    19700, 3, 3, true, 30000,
    '["Acesso a tudo", "Voz premium", "Roteiro por IA", "Áudio contínuo da live", "Respostas no chat", "Extensão liberada", "3 contas TikTok", "30 mil caracteres por mês", "Economia de 32% sobre o mensal"]'::jsonb,
    20, true
  ),
  (
    'anual', 'Anual',
    'Os mesmos recursos, cobrados uma vez por ano. Sai R$41,42 por mês.',
    49700, 12, 3, true, 30000,
    '["Acesso a tudo", "Voz premium", "Roteiro por IA", "Áudio contínuo da live", "Respostas no chat", "Extensão liberada", "3 contas TikTok", "30 mil caracteres por mês", "Economia de 57% sobre o mensal"]'::jsonb,
    30, true
  )
on conflict (slug) do update set
  nome           = excluded.nome,
  descricao      = excluded.descricao,
  preco_centavos = excluded.preco_centavos,
  meses          = excluded.meses,
  contas_tiktok  = excluded.contas_tiktok,
  voz_premium    = excluded.voz_premium,
  creditos_mes   = excluded.creditos_mes,
  recursos       = excluded.recursos,
  ordem          = excluded.ordem,
  ativo          = excluded.ativo;

-- Registra a premissa de comissão que esta tabela de preço suporta.
insert into public.configuracoes (chave, valor, descricao) values
  ('comissao.so_no_mensal', 'true',
   'Com o preço unificado, só o plano mensal comporta a comissão de 63%. Trimestral e anual dariam prejuízo. Revisar junto com comissao_regras.')
on conflict (chave) do update set descricao = excluded.descricao;
