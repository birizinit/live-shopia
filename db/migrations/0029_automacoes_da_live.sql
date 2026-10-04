-- =============================================================================
-- As automações da live: avisos programados, gatilhos da loja, refixar produto.
--
-- -----------------------------------------------------------------------------
-- A DESCOBERTA QUE ORGANIZA TUDO ISTO
--
-- Os eventos da loja chegam pelo CHAT. Nas lives já gravadas existe esta linha:
--
--   [comentario] apelido="Gabriel"  texto="compartilhou a LIVE"
--
-- O TikTok publica ação de espectador como mensagem no chat público, com o nome
-- em quem-falou e a ação no que-foi-dito. "adicionou ao carrinho" e a compra
-- chegam pela mesma porta — a que a extensão já lê.
--
-- Logo: não precisa de integração, de API de vendedor, nem de outra tela. O que
-- precisa é SABER DISTINGUIR mensagem de sistema de pergunta de cliente. Era
-- isso que faltava, e a falta já custava: "compartilhou a LIVE" está hoje na
-- lista de "perguntas que ninguém soube responder", como se alguém tivesse
-- perguntado algo.
--
-- Os padrões ficam em TABELA e não em código pelo mesmo motivo do mapa de
-- seletores: quando o TikTok mudar a frase, o conserto é um INSERT e a base
-- inteira volta a funcionar no batimento seguinte. Texto de interface de
-- terceiro muda sem avisar e sem versão.
-- -----------------------------------------------------------------------------

begin;

-- -----------------------------------------------------------------------------
-- 1. Classificar o que chega pelo chat
-- -----------------------------------------------------------------------------

create type public.tipo_mensagem_sistema as enum ('carrinho', 'venda', 'ignorar');

create table public.padroes_sistema (
  id        uuid primary key default gen_random_uuid(),
  tipo      public.tipo_mensagem_sistema not null,

  /**
   * Trecho normalizado (minúsculo, sem acento) que identifica a mensagem.
   * Casamento por CONTÉM, e não por igualdade: a frase do TikTok vem com o
   * nome, emoji e pontuação em volta, e nada disso é estável.
   */
  padrao    text not null check (length(btrim(padrao)) between 3 and 80),

  ativo     boolean not null default true,
  ordem     smallint not null default 0,
  criado_em timestamptz not null default now(),

  unique (tipo, padrao)
);

comment on table public.padroes_sistema is
  'Como reconhecer mensagem de sistema do TikTok no chat. Conserto é INSERT, não deploy.';

-- Os de 'ignorar' são os que eu VI chegando. Os de carrinho e venda são
-- palpites sobre a frase exata — por isso existem vários por tipo, e por isso
-- a tela mostra o que foi detectado para o vendedor conferir. Palpite que o
-- usuário confirma deixa de ser palpite; palpite silencioso vira bug.
insert into public.padroes_sistema (tipo, padrao, ordem) values
  ('ignorar',  'compartilhou a live',      10),
  ('ignorar',  'entrou na live',           20),
  ('ignorar',  'seguiu',                   30),
  ('ignorar',  'enviou um presente',       40),
  ('ignorar',  'curtiu a live',            50),

  ('carrinho', 'adicionou ao carrinho',    10),
  ('carrinho', 'adicionou no carrinho',    20),
  ('carrinho', 'added to cart',            30),
  ('carrinho', 'colocou no carrinho',      40),

  ('venda',    'comprou',                  10),
  ('venda',    'fez um pedido',            20),
  ('venda',    'acabou de comprar',        30),
  ('venda',    'realizou um pedido',       40),
  ('venda',    'placed an order',          50)
on conflict (tipo, padrao) do nothing;

/**
 * Que tipo de mensagem de sistema é esta, se for alguma.
 *
 * Ordem importa: 'ignorar' é conferido primeiro. Se um padrão de ignorar e um
 * de venda casassem com a mesma frase, tratar como venda publicaria hype de
 * compra para quem só curtiu — erro barato de cometer e caro de ver ao vivo.
 */
create or replace function public.classificar_mensagem(p_texto text)
returns public.tipo_mensagem_sistema
language sql
stable
as $$
  with alvo as (select public.normalizar_texto(coalesce(p_texto, '')) as t)
  select p.tipo
    from public.padroes_sistema p, alvo
   where p.ativo
     and alvo.t like '%' || p.padrao || '%'
   order by (p.tipo = 'ignorar') desc, p.ordem
   limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 2. Avisos programados (o "comentário automático" e a "oferta relâmpago")
--
-- Uma tabela para os dois porque são o MESMO mecanismo: um texto que vai ao
-- chat de tempo em tempo. O que muda é o papel que cada um cumpre na live, e
-- isso é o `tipo` — que existe para a tela separar os dois blocos e para o
-- relâmpago poder reagir junto com o refixar do produto.
-- -----------------------------------------------------------------------------

create type public.tipo_aviso as enum ('aviso', 'relampago');

create table public.avisos_programados (
  id          uuid primary key default gen_random_uuid(),
  perfil_id   uuid not null references public.perfis (id) on delete cascade,
  tipo        public.tipo_aviso not null default 'aviso',

  -- 150 é o teto do campo do chat do TikTok (ver 0028). Recusar aqui é a única
  -- hora em que o aviso serve: ao vivo não dá para pedir para reescrever.
  texto       text not null check (length(btrim(texto)) between 2 and 150),

  /**
   * De 30s a 1h. O piso não é capricho: aviso a cada 10 segundos é a coisa mais
   * parecida com robô que existe num chat, e quem configura isso está pedindo
   * para a conta ser restringida. O teto por minuto da cadência ainda vale por
   * cima disto — este intervalo diz "no máximo tão rápido", não "sempre".
   */
  intervalo_s integer not null default 300 check (intervalo_s between 30 and 3600),

  ativo       boolean not null default true,
  ordem       smallint not null default 0,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index avisos_programados_perfil_idx
  on public.avisos_programados (perfil_id, ativo, ordem);

create trigger avisos_programados_atualizado_em
  before update on public.avisos_programados
  for each row execute function public.tocar_atualizado_em();

comment on table public.avisos_programados is
  'Textos que a Shopia repete no chat. O intervalo é um teto de frequência, não uma promessa.';

-- -----------------------------------------------------------------------------
-- 3. O resto mora em live_config: é configuração única por conta
-- -----------------------------------------------------------------------------

alter table public.live_config
  -- Item 1: refixar o produto de tempo em tempo. O TikTok desafixa quando o
  -- vendedor mexe na vitrine, e a live segue sem produto na tela sem ninguém
  -- perceber. Piso de 30s pelo mesmo motivo dos avisos.
  add column if not exists refixar_ativo       boolean not null default false,
  add column if not exists refixar_intervalo_s integer not null default 180
    check (refixar_intervalo_s between 30 and 3600),
  add column if not exists refixar_posicao     smallint not null default 1
    check (refixar_posicao between 1 and 99),

  -- Itens 5 e 6: reagir a carrinho e a venda. `{nome}` é trocado pelo apelido
  -- de quem agiu, que vem na própria mensagem do chat.
  add column if not exists carrinho_ativo boolean not null default false,
  add column if not exists carrinho_texto text
    check (carrinho_texto is null or length(btrim(carrinho_texto)) between 2 and 120),

  add column if not exists venda_ativo boolean not null default false,
  add column if not exists venda_texto text
    check (venda_texto is null or length(btrim(venda_texto)) between 2 and 120),

  -- Item 7: o sininho. Toca no painel lateral, que é uma página de verdade e
  -- pode tocar som; o service worker não pode.
  add column if not exists sino_ativo boolean not null default true;

comment on column public.live_config.refixar_ativo is
  'Refixa o produto periodicamente: o TikTok desafixa sozinho quando o vendedor mexe na vitrine.';

-- -----------------------------------------------------------------------------
-- 4. Os eventos novos no fluxo da live
--
-- `carrinho` entra no catálogo para o painel ao vivo poder mostrar e contar.
-- `historico = false` nos dois: carrinho e venda detectada são sinal de
-- momento, e guardar no histórico daria a impressão de medição — que não é.
-- Venda DETECTADA pelo chat não é venda MEDIDA, e a tabela `vendas` (que
-- alimenta dashboard e ranking) continua sem receber nada daqui, de propósito.
-- -----------------------------------------------------------------------------

insert into public.live_evento_tipos (tipo, rotulo, descricao, historico, ordem, ativo)
values
  ('carrinho', 'Carrinho',
   'Espectador adicionou o produto ao carrinho, detectado pela mensagem do chat.',
   false, 55, true),
  ('aviso', 'Aviso programado',
   'Texto que a Shopia repetiu no chat por configuração, não por pergunta.',
   false, 58, true)
on conflict (tipo) do nothing;

commit;
