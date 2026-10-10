-- =============================================================================
-- 0030 — O app passa a respeitar a extensão 3.0
--
-- A extensão 3.0 (extensao/) é a fonte da regra de negócio: login por e-mail e
-- senha, 1 conta = 1 dispositivo, o ciclo "Ligar a extensão" (timer, proteção
-- contra violação, fixar, comentários e bloqueio locais), "Ler a tela" para
-- responder pelo manual e aviso de venda no celular. Esta migração deixa o
-- banco de acordo:
--
--   1. ext_licencas.token_hash_anterior — o token que acabou de ser trocado.
--      Sem ele, a máquina antiga recebia 401 "token inválido" e continuava
--      automatizando; com ele, recebe "entrou em outro dispositivo" e para.
--   2. live_sessoes.encerrada_por — quem fechou a sessão. Quando é o PAINEL,
--      a extensão não reabre sozinha no próximo batimento: ela desliga.
--   3. Textos que descreviam o produto antigo (voz, áudio, LIVE Studio,
--      "Entrar no ar"): planos, tour e módulos de aula.
--   4. live.batimento_segundos de 90 para 180: o batimento da sessão sai a
--      cada 60s por chrome.alarms, que atrasa; 90s marcava queda falsa.
-- =============================================================================

begin;

-- 1 --------------------------------------------------------------------------
alter table public.ext_licencas
  add column if not exists token_hash_anterior bytea;

create index if not exists ext_licencas_token_anterior
  on public.ext_licencas (token_hash_anterior)
  where token_hash_anterior is not null;

-- 2 --------------------------------------------------------------------------
alter table public.live_sessoes
  add column if not exists encerrada_por text
  check (encerrada_por is null or encerrada_por in ('painel', 'extensao', 'faxina'));

-- 3 --------------------------------------------------------------------------
update public.planos
   set recursos = (
         '["Extensão Shopia para Chrome (1 conta = 1 dispositivo)",'
         ' "Timer de encerramento e proteção contra violação",'
         ' "Fixar produto (manual, automático e modo cupom)",'
         ' "Comentários automáticos e bloqueio por nome",'
         ' "Respostas no chat pelo seu manual",'
         ' "Aviso de venda no celular",'
         ' "3 contas TikTok"]'
       )::jsonb
       || case slug
            when 'trimestral' then '["Economia de 32% sobre o mensal"]'::jsonb
            when 'anual'      then '["Economia de 57% sobre o mensal"]'::jsonb
            else '[]'::jsonb
          end
 where slug in ('mensal', 'trimestral', 'anual');

update public.onboarding_passos
   set titulo = 'O que a Shopia faz',
       corpo = 'A Shopia cuida da sua live no TikTok Shop pelo Chrome: encerra no '
               'horário que você marcar ou quando o TikTok mandar aviso de violação, '
               'fixa o produto, posta comentários automáticos, bloqueia nomes '
               'suspeitos, avisa cada venda no seu celular e responde o chat só com '
               'o que está no seu manual. A transmissão continua sendo sua.'
 where chave = 'boas-vindas';

update public.onboarding_passos
   set corpo = 'As Aulas trazem o passo a passo em vídeo, inclusive a instalação da '
               'extensão, que é onde mais gente trava. A página Extensão também tem o '
               'roteiro de "Ligar a extensão, na prática". E este tour não é de uma '
               'vez só: ele fica salvo na sua CONTA, não no navegador — dá para sair '
               'no meio e continuar depois, de qualquer aparelho, pelo cartão no Início.'
 where chave = 'ajuda';

update public.aulas_modulos
   set titulo = 'Produto e manual',
       descricao = 'Descrever o produto e escrever as respostas que a Shopia usa no chat.'
 where slug = 'roteiro-e-voz';

update public.aulas_modulos
   set titulo = 'Extensão e live',
       descricao = 'Baixar o ZIP, carregar a pasta shopia-extensao, entrar com e-mail e '
                   'senha, ligar a extensão, timer, proteção contra violação e fixar produto.'
 where slug = 'extensao-e-live';

-- O refixar do servidor saiu (a extensão fixa sozinha). Desligar o que estava
-- ligado deixa a tela /automacoes dizendo a verdade.
update public.live_config set refixar_ativo = false where refixar_ativo;

-- 4 --------------------------------------------------------------------------
update public.configuracoes
   set valor = '180'::jsonb
 where chave = 'live.batimento_segundos';

commit;
