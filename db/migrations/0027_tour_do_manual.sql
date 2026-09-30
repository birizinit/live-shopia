-- =============================================================================
-- Conserta o tour depois da virada de produto.
--
-- Duas coisas erradas ficaram da 0026:
--
-- 1. O texto novo do passo `caminho` prometia "silencia comentário ofensivo".
--    Isso NÃO EXISTE. Foi descuido meu escrevendo a 0026 a partir da lista de
--    intenções em vez da lista do que está construído — e prometer no tour o
--    que a ferramenta não faz é pior do que não falar nada: a pessoa vai
--    procurar o botão, não achar, e deixar de confiar no resto que é verdade.
--
-- 2. A 0026 apagou os passos `loop-gratis` e `creditos`, que explicavam a
--    economia do áudio, e não pôs nada no lugar. O tour ficou sem explicar a
--    única coisa que a pessoa PRECISA entender antes de entrar no ar: que a
--    Shopia só responde o que está no manual, e cala no resto. Quem não sabe
--    disso acha que ela quebrou.
-- =============================================================================

begin;

update public.onboarding_passos
   set corpo = 'Você cadastra o produto e responde algumas perguntas sobre ele. '
               'A partir daí a Shopia assume o chat: responde quem pergunta usando '
               'só o que você respondeu, dá boas-vindas pelo nome e fixa o produto '
               'na tela. Ela nunca inventa resposta — quando não sabe, ela cala e '
               'te avisa depois, para você ensinar.'
 where chave = 'caminho';

insert into public.onboarding_passos
  (chave, titulo, corpo, rota_alvo, ordem, obrigatorio, exige_aceite, ativo)
values (
  'manual',
  'Ela nunca inventa resposta',
  'Tudo o que a Shopia escreve no chat sai do manual que você cadastrou — '
  'palavra por palavra. Ela não gera texto: escolhe uma resposta que já '
  'existe. Quando a pergunta não está no manual, ela cala, e o comentário '
  'fica registrado para você ensinar antes da próxima live. É o que garante '
  'que nenhuma promessa que você não fez chegue à sua audiência.',
  '/manual',
  30,
  false,
  false,
  true
)
on conflict (chave) do update
   set titulo = excluded.titulo,
       corpo = excluded.corpo,
       rota_alvo = excluded.rota_alvo,
       ordem = excluded.ordem,
       ativo = true;

-- -----------------------------------------------------------------------------
-- O aviso de risco: texto novo E versão nova
--
-- Ele falava de "áudio e chat em módulos separados" como mitigação, e isso
-- deixou de existir. Mas trocar o texto SEM subir a versão seria pior do que
-- deixar errado: `live_config.risco_aceito_versao` guarda QUAL versão a pessoa
-- aceitou, e reescrever a versão 1 faria o registro de quatro aceites apontar
-- para um texto que ninguém daqueles quatro leu.
--
-- Subir para 2 pede o aceite de novo — que é o comportamento desenhado na 0009
-- justamente para este caso. `riscoAceitoNaVersaoVigente` recusa abrir sessão
-- até o novo aceite, e o painel leva a pessoa até lá.
-- -----------------------------------------------------------------------------

update public.onboarding_passos
   set corpo = 'Automatizar o chat do TikTok tende a violar os Termos de Serviço. '
               'Não existe modo oficial de fazer isso. O risco de restrição ou '
               'bloqueio recai sobre a SUA conta do TikTok, não sobre a Shopia. '
               'A gente reduz o que dá para reduzir — espera sorteada entre as '
               'respostas, teto por minuto e revisão do seu manual contra o que '
               'costuma restringir uma live —, mas reduzir não é eliminar.'
 where chave = 'risco-automacao';

update public.configuracoes
   set valor = '2'::jsonb,
       atualizado_em = now()
 where chave = 'live.risco_aceito_versao';

commit;
