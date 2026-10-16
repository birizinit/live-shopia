-- =============================================================================
-- 0032 — Sai a seção Aulas
--
-- O app fica mais enxuto: a página Aulas saiu do menu e da navegação. O passo
-- a passo que ela tinha já mora onde a pessoa precisa dele — na página
-- Extensão (instalar e "ligar a extensão, na prática") e no botão "Testar
-- antes da live" do painel da extensão.
--
-- As tabelas de aulas ficam: apagar conteúdo é irreversível, e desligar a
-- tela não exige isso.
-- =============================================================================

begin;

update public.onboarding_passos
   set corpo = 'A página Extensão tem o passo a passo de instalação e de ligar a '
               'extensão na prática, e o botão "Testar antes da live", no painel da '
               'extensão, confere tudo antes de você entrar ao vivo. E este tour não é '
               'de uma vez só: ele fica salvo na sua CONTA, não no navegador — dá para '
               'sair no meio e continuar depois, de qualquer aparelho, pelo cartão no Início.',
       rota_alvo = '/extensao'
 where chave = 'ajuda';

commit;
