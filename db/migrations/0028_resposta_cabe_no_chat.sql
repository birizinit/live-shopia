-- =============================================================================
-- A resposta tem de caber no chat do TikTok: 150 caracteres, não 280.
--
-- O CHECK era `between 2 and 280`, e o 280 não vinha de lugar nenhum — foi um
-- número que eu escolhi por parecer razoável. O número REAL está declarado pelo
-- próprio TikTok no campo do chat da live:
--
--   <div contenteditable="plaintext-only" data-e2e="room-chat-input-field"
--        maxlength="150" …>
--
-- Visto na página salva de uma live de verdade (27/09). Com o teto em 280, uma
-- resposta de 200 caracteres passava no cadastro, era aceita pelo banco, e
-- chegava ao chat CORTADA no meio da palavra — ou não chegava. E ninguém ficava
-- sabendo: nem quem escreveu, nem quem perguntou.
--
-- Recusar no cadastro é a única hora em que o aviso serve para algo. Ao vivo,
-- com a audiência esperando, não dá para pedir para reescrever.
--
-- Apertar CHECK só é seguro porque nenhuma linha existente passa de 150 (a
-- maior tem 82). Se tivesse, o `alter` falharia alto — que é o certo: truncar
-- resposta de cliente em silêncio para fazer a migração passar seria exatamente
-- o problema que esta migração conserta.
-- =============================================================================

begin;

alter table public.temas_resposta
  drop constraint if exists temas_resposta_resposta_check;

alter table public.temas_resposta
  add constraint temas_resposta_resposta_check
  check (length(btrim(resposta)) between 2 and 150);

-- As boas-vindas saem pelo mesmo campo e pelo mesmo caminho, então respondem ao
-- mesmo teto. `{nome}` é substituído antes do envio, e um apelido longo pode
-- empurrar a frase para fora do limite — por isso 120 aqui, deixando folga para
-- o nome entrar sem estourar.
alter table public.live_config
  drop constraint if exists live_config_boas_vindas_tamanho;

alter table public.live_config
  add constraint live_config_boas_vindas_tamanho
  check (boas_vindas_texto is null or length(btrim(boas_vindas_texto)) between 2 and 120);

commit;
