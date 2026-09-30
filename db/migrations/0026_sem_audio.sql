-- =============================================================================
-- Fora o áudio: a Shopia deixa de ser apresentadora de IA e passa a ser
-- moderação de live.
--
-- O produto mudou, não o banco. A parte que MORRE é a que existia só para
-- transformar texto em voz e tocar isso em laço: catálogo de vozes, clonagem,
-- geração em blocos, montagem do loop, trilha de ambiente. A parte que FICA é
-- tudo o que já era de live e de chat — sessão, evento, comentário, tema de
-- resposta, produto, telemetria de seletor.
--
-- Por que DROP e não uma coluna `ativo = false`: o schema é a documentação mais
-- honesta que existe. Tabela de voz parada no banco faz a próxima pessoa
-- perguntar "então dá para gerar áudio?" e alguém vai responder que sim. Quem
-- quiser o áudio de volta tira do git, onde ele está inteiro.
--
-- O QUE NÃO SE APAGA AQUI, DE PROPÓSITO:
--
--   `creditos_lancamentos` e `perfis.creditos` — a razão de crédito. Ela media
--   caracteres de TTS, e agora não mede nada: fica dormente. Não se apaga
--   porque a moderação vai precisar medir ALGUMA coisa (resposta de chat pela
--   IA, provavelmente), e a razão append-only com débito antes da chamada é a
--   peça mais difícil de construir de novo. Trocar a unidade é decisão de
--   preço, e preço foi deliberadamente adiado.
--
--   `arquivos.duracao_ms` — nasceu para o bloco de áudio e serve igual para o
--   vídeo de reação, que é o recurso que entra no lugar.
--
--   `modulo_extensao` tem o valor 'mixer'. Postgres não remove valor de enum
--   sem recriar o tipo, e recriar para apagar um rótulo que só aparece em
--   telemetria histórica seria estragar dado antigo por estética.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Colunas que apontam para o que vai morrer
--
-- Antes das tabelas: a FK seguraria o DROP, e derrubar com `cascade` levaria
-- embora coisa que eu não olhei.
-- -----------------------------------------------------------------------------

-- Os dois espelhos de "qual montagem está no ar" (ver 0021) perdem o sentido
-- junto com a montagem.
drop trigger if exists live_config_aplicar_montagem_ins on public.live_config;
drop trigger if exists live_config_aplicar_montagem_upd on public.live_config;
drop trigger if exists montagens_espelhar_ativa_ins on public.montagens;
drop trigger if exists montagens_espelhar_ativa_upd on public.montagens;

alter table public.live_config drop column if exists voz_id;
alter table public.live_config drop column if exists montagem_id;

-- A sessão de live continua existindo; ela é que registra a transmissão. O que
-- sai é o vínculo com o áudio que estava tocando.
drop trigger if exists live_sessoes_vinculos on public.live_sessoes;
alter table public.live_sessoes drop column if exists montagem_id;

-- Tema de resposta perde a resposta FALADA e fica só com a escrita — que é o
-- caminho que a moderação usa, e o único que nunca custou nada.
alter table public.temas_resposta drop column if exists audio_id;

-- Voz premium era o único recurso de plano ligado a áudio.
alter table public.planos drop column if exists voz_premium;

-- O interruptor do mixer de áudio na licença da extensão. `chat` fica.
alter table public.ext_licencas drop column if exists mixer;

-- -----------------------------------------------------------------------------
-- 2. As tabelas de áudio, das folhas para a raiz
-- -----------------------------------------------------------------------------

drop table if exists public.montagem_itens;
drop table if exists public.montagens;
drop table if exists public.audio_blocos;
drop table if exists public.audios;
drop table if exists public.vozes_amostras;
drop table if exists public.vozes;
drop table if exists public.trilhas_ambiente;
drop table if exists public.idiomas;

-- O roteiro de vendas vai junto.
--
-- Não é "texto que sobrou sem voz": era um roteiro para a apresentadora LER, e
-- a apresentadora não existe mais. O que a moderação precisa saber sobre o
-- produto tem forma diferente — pergunta e resposta, em `temas_resposta` — e
-- não se extrai de um roteiro corrido. Manter as duas tabelas deixaria no
-- schema um segundo lugar plausível para "o que a Shopia sabe", e alguém ia
-- cadastrar no lugar errado.
drop table if exists public.roteiro_versoes;
drop table if exists public.roteiros;

-- -----------------------------------------------------------------------------
-- 2b. Os bytes do áudio gerado
--
-- `arquivos` guarda binário de tudo — imagem de produto, pacote da extensão,
-- comprovante de saque — e as linhas de áudio ficaram órfãs quando
-- `audio_blocos` saiu: nada mais aponta para elas, e cada uma ocupa até 8 MB
-- de bytea. Um áudio de 3 horas eram ~45 delas.
--
-- O filtro é por mime, e não por "tudo que não é imagem": arquivo de tipo que
-- eu não previ não pode ser apagado por descarte.
-- -----------------------------------------------------------------------------

delete from public.arquivos where mime like 'audio/%';

-- -----------------------------------------------------------------------------
-- 3. Funções e tipos que sobraram sem dono
-- -----------------------------------------------------------------------------

drop function if exists public.voz_acessivel(uuid, uuid);
drop function if exists public.checar_voz_do_perfil();
drop function if exists public.recontar_blocos();
drop function if exists public.congelar_consentimento_amostra();
drop function if exists public.espelhar_montagem_ativa();
drop function if exists public.aplicar_montagem_escolhida();

drop type if exists public.genero_voz;
drop type if exists public.origem_voz;
drop type if exists public.estado_voz;
drop type if exists public.estado_audio;
drop type if exists public.estado_amostra;
-- Criado em 0004 e nunca referenciado: `roteiro_versoes.secoes` sempre foi
-- jsonb. Sai agora porque, com o roteiro virando manual do produto, um enum
-- órfão de seções de roteiro de vendas só engana quem for ler.
drop type if exists public.secao_roteiro;

-- -----------------------------------------------------------------------------
-- 4. A função de vínculos da sessão, sem a montagem
-- -----------------------------------------------------------------------------

-- Igual à de 0006 menos o bloco da montagem, inclusive o errcode: a camada de
-- dados traduz 23503 em erro de domínio, e trocar o código transformaria
-- "conta não é sua" em erro 500.
create or replace function public.checar_vinculos_live_sessao()
returns trigger
language plpgsql
as $$
begin
  if new.conta_tiktok_id is not null and not exists (
       select 1 from public.contas_tiktok c
        where c.id = new.conta_tiktok_id and c.perfil_id = new.perfil_id
     ) then
    raise exception 'conta do TikTok % não é do perfil %', new.conta_tiktok_id, new.perfil_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create trigger live_sessoes_vinculos
  before insert or update of perfil_id, conta_tiktok_id on public.live_sessoes
  for each row execute function public.checar_vinculos_live_sessao();

-- -----------------------------------------------------------------------------
-- 5. Tipos de job que não têm mais quem processe
--
-- Aqui é `ativo=false` e NÃO delete, ao contrário das tabelas: `jobs.tipo` é FK
-- para cá, e existe histórico de TTS concluído apontando para 'tts'. Apagar a
-- linha do catálogo exigiria apagar o histórico junto — jogar fora o registro
-- de trabalho que a conta de alguém pagou, por estética de schema.
--
-- É para isto que `job_tipos.ativo` existe (0003): catálogo com desligamento,
-- em vez de enum. A 0020 já usou o mesmo caminho para 'montagem'.
--
-- O que sai de verdade é o que ainda ia RODAR: sem handler, um job pendente
-- destes tentaria para sempre até esgotar as tentativas.
-- -----------------------------------------------------------------------------

delete from public.jobs
 where tipo in ('tts', 'clonagem', 'montagem', 'roteiro')
   and estado in ('pendente', 'processando');

update public.job_tipos
   set ativo = false,
       descricao = descricao || ' (desligado em 0026: a Shopia modera, não gera)'
 where tipo in ('tts', 'clonagem', 'montagem', 'roteiro') and ativo;

-- -----------------------------------------------------------------------------
-- 6. Configurações que eram só de TTS
--
-- `creditos.boas_vindas` FICA: é o crédito que a conta nova recebe, e
-- `criar_perfil` ainda o concede. As que saem são as que traduziam caractere
-- em minuto de fala e em dólar da ElevenLabs.
-- -----------------------------------------------------------------------------

delete from public.configuracoes
 where chave in (
   'creditos.chars_por_minuto',
   'creditos.max_chars_por_bloco',
   'creditos.custo_usd_por_mil',
   'creditos.cambio_usd'
 );

-- -----------------------------------------------------------------------------
-- 7. O tour falava de áudio em dois passos
--
-- O texto do tour mora no banco de propósito (0009), justamente para ser
-- reescrito sem deploy. O passo `loop-gratis` explicava que repetir o áudio não
-- custa nada — argumento que deixou de existir. `creditos` explicava a cota em
-- caracteres de fala.
-- -----------------------------------------------------------------------------

delete from public.onboarding_passos where chave in ('loop-gratis', 'creditos');

update public.onboarding_passos
   set titulo = 'Como a Shopia cuida da sua live',
       corpo = 'Você cadastra o produto e responde algumas perguntas sobre ele. '
               'A partir daí a Shopia assume o chat: responde quem pergunta usando '
               'só o que você respondeu, dá boas-vindas pelo nome, fixa o produto '
               'e silencia comentário ofensivo. Ela nunca inventa resposta — '
               'quando não sabe, ela cala e te avisa depois, para você ensinar.'
 where chave = 'caminho';

commit;
