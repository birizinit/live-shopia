-- =============================================================================
-- Shopia — live, vendas e push (fase 4)
--
-- O que a fase entrega: painel ao vivo, dashboard de faturamento, ranking e
-- aviso no celular. Três decisões moram no schema porque na aplicação elas não
-- param em pé:
--
-- 1. O DIA do rollup é calculado em America/Sao_Paulo, numa coluna gerada de
--    `vendas`. Em UTC, tudo que vende das 21h à meia-noite cai no dia seguinte:
--    o "hoje" da tela e o "hoje" do ranking discordariam todo santo dia, e um
--    painel de faturamento que discorda de si mesmo não é aberto duas vezes.
-- 2. A idempotência da ingestão é do par ORIGEM + ID EXTERNO que vem de fora,
--    nunca de um uuid gerado aqui dentro: a extensão reenvia o mesmo lote
--    quando a rede oscila, e uuid novo a cada tentativa dobraria o faturamento.
-- 3. Não existe CHECK cosmético sobre o que a extensão raspa. Regra apertada na
--    borda de ingestão não protege dado nenhum — ela derruba a transação e
--    PERDE a venda. Ver o comentário de `vendas.comprador_apelido`.
-- =============================================================================

create type public.estado_live as enum ('iniciando', 'ativa', 'caiu', 'encerrada');

-- De onde o dado veio. Entra na chave de idempotência da venda porque a mesma
-- compra vista pela extensão e pela API do TikTok são dois registros com ids
-- diferentes: casar as duas origens é conciliação, não restrição de coluna.
create type public.origem_dado as enum ('extensao', 'api_tiktok', 'manual', 'importacao');

-- -----------------------------------------------------------------------------
-- live_sessoes — uma transmissão, do "começou" ao "acabou".
--
-- `contas_tiktok` e `montagens` são do 0004 e continuam intocadas; aqui só
-- apontamos para elas. A lista de colunas no `set null` é obrigatória: sem ela
-- o Postgres anularia TODAS as colunas da referência, `perfil_id` incluso, que
-- é NOT NULL — desvincular uma conta do TikTok quebraria com erro ilegível.
-- -----------------------------------------------------------------------------
create table public.live_sessoes (
  id                uuid primary key default gen_random_uuid(),
  perfil_id         uuid not null references public.perfis (id) on delete cascade,
  conta_tiktok_id   uuid references public.contas_tiktok (id) on delete set null (conta_tiktok_id),
  montagem_id       uuid references public.montagens (id) on delete set null (montagem_id),

  estado            public.estado_live not null default 'iniciando',
  origem            public.origem_dado not null default 'extensao',

  inicio            timestamptz not null default now(),
  fim               timestamptz,

  -- Último batimento da extensão. É o que separa "live rodando" de "o navegador
  -- do usuário fechou às 3h da manhã e ninguém percebeu": sem um instante de
  -- referência, a queda só apareceria quando alguém abrisse a tela.
  visto_em          timestamptz not null default now(),

  -- Mantido pelo próprio UPDATE do batimento, com greatest(). Gatilho por evento
  -- custaria uma escrita na sessão a cada espectador que entra na sala.
  espectadores_pico integer not null default 0 check (espectadores_pico >= 0),

  erro              text,
  criado_em         timestamptz not null default now(),

  constraint live_sessoes_periodo check (fim is null or fim >= inicio),
  constraint live_sessoes_fim_coerente check (
    (estado in ('encerrada', 'caiu')) = (fim is not null)
  )
);

create index live_sessoes_perfil_idx on public.live_sessoes (perfil_id, inicio desc);

-- A mesma conta do TikTok não transmite em duas sessões ao mesmo tempo. O índice
-- é da CONTA, não do perfil: o plano Premium dá 3 contas, e travar por perfil
-- impediria justamente o que o usuário pagou para fazer. Sessão sem conta
-- vinculada fica fora do índice, porque nulo não colide com nulo — e é isso que
-- mantém a exclusão de uma conta do TikTok possível mesmo com live aberta.
create unique index live_sessoes_conta_ativa_idx
  on public.live_sessoes (conta_tiktok_id)
  where conta_tiktok_id is not null and estado in ('iniciando', 'ativa');

create index live_sessoes_batimento_idx on public.live_sessoes (visto_em)
  where estado in ('iniciando', 'ativa');

-- -----------------------------------------------------------------------------
-- live_evento_tipos — catálogo. Tabela e não enum pelo mesmo motivo de
-- `job_tipos`: cada fase acrescenta um tipo, e `alter type ... add value` não
-- roda dentro da transação que o aplicador de migrações usa por arquivo.
-- -----------------------------------------------------------------------------
create table public.live_evento_tipos (
  tipo      text primary key check (tipo ~ '^[a-z_]{3,40}$'),
  rotulo    text not null,
  descricao text not null,

  -- Entrada de espectador em live movimentada são centenas de linhas por minuto:
  -- aparece no painel ao vivo e some do histórico. A política mora no catálogo
  -- para a consulta do histórico não carregar uma lista de tipos no código.
  historico boolean not null default true,

  ordem     smallint not null default 0,
  ativo     boolean not null default true
);

insert into public.live_evento_tipos (tipo, rotulo, descricao, historico, ordem) values
  ('inicio',      'Live iniciada',  'A extensão assumiu a transmissão.',             true,  10),
  ('entrada',     'Entrou na live', 'Espectador entrou na sala.',                    false, 20),
  ('seguidor',    'Novo seguidor',  'Espectador passou a seguir a conta.',           true,  30),
  ('comentario',  'Comentário',     'Comentário lido do chat do TikTok.',            true,  40),
  ('resposta_ia', 'Resposta da IA', 'A apresentadora respondeu no chat ou na fala.', true,  50),
  ('venda',       'Venda',          'Venda registrada durante a transmissão.',       true,  60),
  ('queda',       'Live caiu',      'A extensão parou de dar sinal.',                true,  70),
  ('fim',         'Live encerrada', 'Transmissão encerrada pelo usuário.',           true,  80),
  ('erro',        'Erro',           'Falha da extensão ou do áudio durante a live.', true,  90)
on conflict (tipo) do nothing;

-- -----------------------------------------------------------------------------
-- live_eventos — o fluxo. Alimenta o painel ao vivo (SSE) e o histórico.
--
-- Chave `bigint` e não uuid porque esta é a tabela que mais cresce do schema, e
-- a data está em todo índice: virar `partition by range (criado_em)` depois é
-- reparticionamento, não redesenho — só exige que a chave primária passe a ser
-- (id, criado_em), que é o que o Postgres cobra de tabela particionada. A faxina
-- por idade fica para esse dia, como DROP PARTITION; um índice solto por data
-- agora só encareceria a escrita sem pagar nenhuma leitura.
-- -----------------------------------------------------------------------------
create table public.live_eventos (
  id             bigint generated always as identity primary key,
  live_sessao_id uuid not null references public.live_sessoes (id) on delete cascade,
  perfil_id      uuid not null references public.perfis (id) on delete cascade,
  tipo           text not null references public.live_evento_tipos (tipo),

  apelido        text,
  texto          text,
  espectadores   integer check (espectadores is null or espectadores >= 0),
  dados          jsonb not null default '{}'::jsonb,

  criado_em      timestamptz not null default now()
);

-- O escopo por usuário continua sendo do `where` de cada consulta (db/README.md);
-- filtrar por perfil_id junto com a sessão não pede índice novo, a sessão já
-- seleciona as linhas.
create index live_eventos_sessao_idx on public.live_eventos (live_sessao_id, criado_em desc);

create trigger live_eventos_append_only
  before update on public.live_eventos
  for each row execute function public.bloquear_escrita_append_only();

-- -----------------------------------------------------------------------------
-- vendas — o dado que o dashboard, o ranking e o push consomem.
-- -----------------------------------------------------------------------------
create table public.vendas (
  id                uuid primary key default gen_random_uuid(),
  perfil_id         uuid not null references public.perfis (id) on delete cascade,
  live_sessao_id    uuid references public.live_sessoes (id) on delete set null (live_sessao_id),
  produto_id        uuid references public.produtos (id) on delete set null (produto_id),

  -- valor = o que o comprador pagou por unidade; gmv = o total do pedido.
  -- Não existe CHECK amarrando um ao outro: frete, cupom e taxa do TikTok fazem
  -- os dois divergirem de forma legítima, e a regra só serviria para recusar
  -- venda de verdade.
  valor_centavos    bigint not null default 0 check (valor_centavos >= 0),
  gmv_centavos      bigint not null default 0 check (gmv_centavos >= 0),
  -- Invariante de domínio, não cosmética: pedido de zero item não é venda. A
  -- borda que não sabe a quantidade manda 1, que é o padrão da coluna.
  quantidade        integer not null default 1 check (quantidade > 0),

  comprador_apelido text,
  espectadores      integer check (espectadores is null or espectadores >= 0),

  ocorrido_em       timestamptz not null default now(),

  -- O dia do rollup, congelado em America/Sao_Paulo na própria linha. Conversão
  -- com fuso nomeado é IMMUTABLE, então cabe em coluna gerada — e assim o
  -- gatilho do rollup e qualquer conferência falam do MESMO dia, sem depender do
  -- fuso da conexão de quem escreveu a linha.
  dia               date generated always as ((ocorrido_em at time zone 'America/Sao_Paulo')::date) stored,

  origem            public.origem_dado not null default 'extensao',
  id_externo        text,
  dados             jsonb not null default '{}'::jsonb,
  criado_em         timestamptz not null default now()
);

comment on column public.vendas.comprador_apelido is
  'O TikTok exibe o comprador como @usuario e a extensão raspa exatamente isso. '
  'NÃO criar CHECK proibindo o "@" aqui: a ingestão chega em lote, um CHECK '
  'derruba a transação inteira e a venda se perde — some do faturamento do '
  'usuário por um detalhe de formatação. A defesa de LGPD é normalizar na borda, '
  'antes de gravar, e nunca expor este campo no ranking ou no painel de gerente.';

-- A mesma venda reenviada pela extensão não pode virar duas. A chave vem de FORA
-- (id do pedido no TikTok) porque chave gerada aqui dentro muda a cada tentativa
-- e não protege de nada. `id_externo` nulo (venda lançada à mão) fica fora do
-- índice de propósito: não há o que deduplicar.
create unique index vendas_ingestao_idx
  on public.vendas (perfil_id, origem, id_externo)
  where id_externo is not null;

create index vendas_perfil_idx on public.vendas (perfil_id, ocorrido_em desc);
create index vendas_sessao_idx on public.vendas (live_sessao_id, ocorrido_em desc)
  where live_sessao_id is not null;
-- Sem este, excluir um produto varreria `vendas` inteira para achar o que anular.
create index vendas_produto_idx on public.vendas (produto_id) where produto_id is not null;

-- -----------------------------------------------------------------------------
-- vendas_diarias — rollup por (perfil, dia).
--
-- Dashboard e ranking leem daqui, e por isso custam um index scan em vez de um
-- agregado sobre a tabela que mais cresce depois de live_eventos. O ranking do
-- período é uma CONSULTA, não uma tabela de snapshot:
--
--   select perfil_id, sum(quantidade_vendas), sum(gmv_centavos)
--     from vendas_diarias where dia between $1 and $2 group by perfil_id
--    order by 3 desc limit $3
--
-- Snapshot só se ganhasse alguma coisa, e não ganha: seriam as mesmas linhas com
-- atraso, mais um job para mantê-las e mais uma fonte para discordar do
-- dashboard na frente do usuário. Se um dia a base doer, o caminho é índice
-- coberto ou matview com refresh — nunca uma segunda verdade escrita à mão.
-- -----------------------------------------------------------------------------
create table public.vendas_diarias (
  perfil_id         uuid not null references public.perfis (id) on delete cascade,
  dia               date not null,

  quantidade_vendas integer not null default 0,
  quantidade_itens  integer not null default 0,
  valor_centavos    bigint not null default 0,
  gmv_centavos      bigint not null default 0,

  atualizado_em     timestamptz not null default now(),

  primary key (perfil_id, dia)
);

-- O ranking varre uma faixa de dias; a chave primária (perfil_id, dia) já serve
-- o dashboard de um usuário só.
create index vendas_diarias_ranking_idx on public.vendas_diarias (dia, gmv_centavos desc);

comment on table public.vendas_diarias is
  'Derivado de vendas, mantido por gatilho. Sem CHECK de não-negativo de '
  'propósito: a linha é somada e subtraída por delta, e um CHECK aqui viraria '
  'erro no meio de uma correção de venda ou de uma exclusão de conta.';

-- -----------------------------------------------------------------------------
-- Gatilhos
-- -----------------------------------------------------------------------------

-- Chave estrangeira composta por (perfil_id, id) não entra aqui: as tabelas pai
-- são de outra migração e não têm essa unicidade, e FK composta cujo lado pode
-- ser nulo não valida nada (MATCH SIMPLE). Checagem em gatilho, como o 0004 faz
-- com a voz, é o que impede a sessão de um perfil apontar para a conta do TikTok
-- ou a montagem de outro.
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

  if new.montagem_id is not null and not exists (
       select 1 from public.montagens m
        where m.id = new.montagem_id and m.perfil_id = new.perfil_id
     ) then
    raise exception 'montagem % não é do perfil %', new.montagem_id, new.perfil_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create trigger live_sessoes_vinculos
  before insert or update of perfil_id, conta_tiktok_id, montagem_id on public.live_sessoes
  for each row execute function public.checar_vinculos_live_sessao();

-- Mesma checagem para quem pendura na sessão: evento e venda. Uma função por
-- tabela, e não uma genérica com `tg_table_name`: o plpgsql resolve os campos de
-- `new` ao planejar a expressão inteira, então uma condição sobre uma coluna que
-- só existe na outra tabela estoura mesmo protegida por um `and` antes dela.
create or replace function public.checar_sessao_do_evento()
returns trigger
language plpgsql
as $$
begin
  if not exists (
       select 1 from public.live_sessoes s
        where s.id = new.live_sessao_id and s.perfil_id = new.perfil_id
     ) then
    raise exception 'sessão de live % não é do perfil %', new.live_sessao_id, new.perfil_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create trigger live_eventos_vinculos
  before insert or update of perfil_id, live_sessao_id on public.live_eventos
  for each row execute function public.checar_sessao_do_evento();

create or replace function public.checar_vinculos_venda()
returns trigger
language plpgsql
as $$
begin
  if new.live_sessao_id is not null and not exists (
       select 1 from public.live_sessoes s
        where s.id = new.live_sessao_id and s.perfil_id = new.perfil_id
     ) then
    raise exception 'sessão de live % não é do perfil %', new.live_sessao_id, new.perfil_id
      using errcode = '23503';
  end if;

  if new.produto_id is not null and not exists (
       select 1 from public.produtos p
        where p.id = new.produto_id and p.perfil_id = new.perfil_id
     ) then
    raise exception 'produto % não é do perfil %', new.produto_id, new.perfil_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create trigger vendas_vinculos
  before insert or update of perfil_id, live_sessao_id, produto_id on public.vendas
  for each row execute function public.checar_vinculos_venda();

-- Painel ao vivo por SSE, que é o que a saída do Supabase deixou de cobrir. Sem
-- o aviso, cada aba aberta viraria uma consulta por segundo no banco.
create or replace function public.avisar_evento_live()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify(
    'shopia_live',
    json_build_object(
      'perfil', new.perfil_id,
      'sessao', new.live_sessao_id,
      'tipo',   new.tipo,
      'id',     new.id
    )::text
  );
  return null;
end;
$$;

create trigger live_eventos_notificar
  after insert on public.live_eventos
  for each row execute function public.avisar_evento_live();

-- A venda entra no fluxo da live pelo gatilho, não pela aplicação. Assim ela
-- herda a idempotência da ingestão: venda reenviada bate no índice único, não
-- insere, e portanto não gera evento repetido — nem segundo aviso no celular.
create or replace function public.registrar_evento_de_venda()
returns trigger
language plpgsql
as $$
begin
  insert into public.live_eventos
    (live_sessao_id, perfil_id, tipo, apelido, espectadores, dados, criado_em)
  values (
    new.live_sessao_id, new.perfil_id, 'venda', new.comprador_apelido, new.espectadores,
    jsonb_build_object(
      'venda_id',       new.id,
      'valor_centavos', new.valor_centavos,
      'gmv_centavos',   new.gmv_centavos,
      'quantidade',     new.quantidade
    ),
    new.ocorrido_em
  );
  return null;
end;
$$;

create trigger vendas_no_fluxo
  after insert on public.vendas
  for each row when (new.live_sessao_id is not null)
  execute function public.registrar_evento_de_venda();

-- Rollup por delta, não por recontagem.
--
-- Recontar com `sum()` dentro do gatilho perde venda sob concorrência: duas
-- ingestões simultâneas somam cada uma o que enxerga, e a segunda sobrescreve a
-- primeira com um total que já nasceu velho. Somar o delta é atômico.
--
-- O gatilho é declarado sobre COLUNAS: quando a exclusão de uma sessão ou de um
-- produto anula a referência da venda, nada aqui roda. Sem esse recorte, a
-- exclusão da conta em cascata acabaria recriando a linha do rollup de um perfil
-- que já não existe — e a exclusão morreria na chave estrangeira, que é o mesmo
-- desastre do gatilho append-only que impedia excluir a conta.
create or replace function public.aplicar_venda_no_rollup()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    -- Só UPDATE, nunca insert: numa cascata de exclusão a linha do rollup já
    -- pode ter ido embora, e ressuscitá-la aqui quebraria a exclusão da conta.
    update public.vendas_diarias d
       set quantidade_vendas = d.quantidade_vendas - 1,
           quantidade_itens  = d.quantidade_itens - old.quantidade,
           valor_centavos    = d.valor_centavos - old.valor_centavos,
           gmv_centavos      = d.gmv_centavos - old.gmv_centavos,
           atualizado_em     = now()
     where d.perfil_id = old.perfil_id and d.dia = old.dia;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.vendas_diarias
      (perfil_id, dia, quantidade_vendas, quantidade_itens, valor_centavos, gmv_centavos)
    values (new.perfil_id, new.dia, 1, new.quantidade, new.valor_centavos, new.gmv_centavos)
    on conflict (perfil_id, dia) do update
       set quantidade_vendas = public.vendas_diarias.quantidade_vendas + 1,
           quantidade_itens  = public.vendas_diarias.quantidade_itens + excluded.quantidade_itens,
           valor_centavos    = public.vendas_diarias.valor_centavos + excluded.valor_centavos,
           gmv_centavos      = public.vendas_diarias.gmv_centavos + excluded.gmv_centavos,
           atualizado_em     = now();
  end if;

  return null;
end;
$$;

create trigger vendas_rollup
  after insert or delete
      or update of perfil_id, ocorrido_em, quantidade, valor_centavos, gmv_centavos
  on public.vendas
  for each row execute function public.aplicar_venda_no_rollup();

-- -----------------------------------------------------------------------------
-- marcar_lives_caidas — o que a faxina chama para fechar transmissão órfã.
--
-- A extensão roda no navegador do usuário, então ela some sem avisar: aba
-- fechada, máquina dormiu, internet caiu. Sem isto a sessão fica 'ativa' para
-- sempre, o índice de conta ativa impede começar a próxima, e o aviso de queda
-- — que é o push que o usuário mais quer — nunca sai.
--
-- Devolve as sessões fechadas para o worker decidir o push, que depende de
-- push_preferencias e de limite de envio: decisão de rede não se toma no banco.
-- -----------------------------------------------------------------------------
create or replace function public.marcar_lives_caidas(p_segundos integer default 90)
returns setof public.live_sessoes
language sql
as $$
  with caidas as (
    -- `greatest` porque a live que nunca deu um batimento acaba onde começou, e
    -- um fim anterior ao início derrubaria o CHECK — fechando a faxina inteira
    -- por causa de uma sessão torta.
    update public.live_sessoes s
       set estado = 'caiu', fim = greatest(s.visto_em, s.inicio)
     where s.estado in ('iniciando', 'ativa')
       and s.visto_em < now() - make_interval(secs => greatest(p_segundos, 30))
    returning s.*
  ), registradas as (
    -- CTE que escreve roda até o fim mesmo que ninguém leia a saída dela.
    insert into public.live_eventos (live_sessao_id, perfil_id, tipo, texto, criado_em)
    select c.id, c.perfil_id, 'queda', 'A extensão parou de responder.', c.visto_em
      from caidas c
    returning id
  )
  select * from caidas;
$$;

-- -----------------------------------------------------------------------------
-- push_inscricoes — uma inscrição Web Push por navegador.
--
-- O endpoint é único no mundo (é a URL que o serviço de push do navegador
-- emite), então é ele a chave natural, e não o par (perfil, dispositivo). Quem
-- troca de conta no mesmo navegador reaproveita a linha:
--   on conflict (endpoint) do update set perfil_id = excluded.perfil_id, ...
-- Sem isso o push da conta antiga continuaria chegando naquele aparelho.
-- -----------------------------------------------------------------------------
create table public.push_inscricoes (
  id              uuid primary key default gen_random_uuid(),
  perfil_id       uuid not null references public.perfis (id) on delete cascade,

  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,

  device_id       text,
  user_agent      text,

  -- 404/410 do serviço de push significa inscrição morta. Sem desativar, o job
  -- de push tentaria para sempre um aparelho que não existe mais.
  falhas          smallint not null default 0 check (falhas >= 0),
  desativada_em   timestamptz,
  ultimo_envio_em timestamptz,

  criado_em       timestamptz not null default now()
);

create index push_inscricoes_perfil_idx on public.push_inscricoes (perfil_id)
  where desativada_em is null;

-- -----------------------------------------------------------------------------
-- push_preferencias — o que vale a pena acordar o usuário para contar.
-- -----------------------------------------------------------------------------
create table public.push_preferencias (
  perfil_id       uuid primary key references public.perfis (id) on delete cascade,

  venda           boolean not null default true,
  queda_live      boolean not null default true,
  creditos_baixos boolean not null default true,

  -- Em CARACTERES, a mesma unidade de perfis.creditos e da razão de crédito.
  creditos_limiar bigint not null default 5000 check (creditos_limiar >= 0),

  atualizado_em   timestamptz not null default now()
);

create trigger push_preferencias_atualizado_em
  before update on public.push_preferencias
  for each row execute function public.tocar_atualizado_em();

-- Números de operação que mudam sem deploy (0003).
insert into public.configuracoes (chave, valor, descricao) values
  ('live.batimento_segundos', '90',
   'Silêncio da extensão que caracteriza queda da live. É o argumento de marcar_lives_caidas().'),
  ('push.creditos_limiar', '5000',
   'Padrão do aviso de crédito acabando, em caracteres, para quem nunca abriu as preferências.')
on conflict (chave) do nothing;
