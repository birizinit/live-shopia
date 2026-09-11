-- =============================================================================
-- Shopia — estudio (fases 1 e 2)
--
-- Produto -> roteiro -> voz -> audio em blocos -> montagem da live.
--
-- Tres correcoes que vieram da revisao adversarial do desenho e que mudam o
-- schema, nao so o codigo:
--
-- 1. Voz de catalogo NAO pode ser alvo de chave estrangeira composta por
--    perfil. `perfil_id` e nulo no catalogo, e FK composta com coluna nula
--    (MATCH SIMPLE) simplesmente nao valida — a checagem some em vez de
--    passar. Aqui a FK e simples e um gatilho exige que a voz seja do dono
--    ou do catalogo.
-- 2. `on delete set null` sem lista de colunas anula TODAS as colunas da FK,
--    inclusive `perfil_id`, que e NOT NULL. Usa-se a lista explicita.
-- 3. Contagem de caracteres e UMA so: code points, que e o que `length()` do
--    Postgres conta e o que `[...texto].length` conta no TypeScript. A UI, a
--    estimativa, o debito e o CHECK falam a mesma lingua.
-- =============================================================================

create type public.genero_voz   as enum ('feminina', 'masculina', 'neutra');
create type public.origem_voz   as enum ('catalogo', 'clonada');
create type public.estado_voz   as enum ('processando', 'pronta', 'falhou');
create type public.estado_audio as enum ('rascunho', 'na_fila', 'gerando', 'pronto', 'falhou');
create type public.secao_roteiro as enum ('gancho', 'oferta', 'prova', 'objecoes', 'cta');

-- -----------------------------------------------------------------------------
-- idiomas — os 10 que o catalogo de vozes cobre.
-- -----------------------------------------------------------------------------
create table public.idiomas (
  codigo   text primary key check (codigo ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  nome     text not null,
  bandeira text not null,
  ordem    smallint not null default 0
);

insert into public.idiomas (codigo, nome, bandeira, ordem) values
  ('pt-BR','Português (Brasil)','🇧🇷',1), ('en','Inglês','🇺🇸',2), ('es','Espanhol','🇪🇸',3),
  ('fr','Francês','🇫🇷',4), ('de','Alemão','🇩🇪',5), ('it','Italiano','🇮🇹',6),
  ('ja','Japonês','🇯🇵',7), ('ko','Coreano','🇰🇷',8), ('zh','Chinês','🇨🇳',9), ('ar','Árabe','🇸🇦',10)
on conflict (codigo) do nothing;

-- -----------------------------------------------------------------------------
-- vozes — catalogo (perfil_id nulo) e clonadas (perfil_id do dono).
-- -----------------------------------------------------------------------------
create table public.vozes (
  id             uuid primary key default gen_random_uuid(),
  perfil_id      uuid references public.perfis (id) on delete cascade,
  origem         public.origem_voz not null default 'catalogo',
  estado         public.estado_voz not null default 'pronta',

  nome           text not null,
  descricao      text,
  genero         public.genero_voz not null default 'feminina',
  idade          text,
  sotaque        text,
  categoria      text,
  uso            text,
  idioma         text not null default 'pt-BR' references public.idiomas (codigo),

  -- Identificador no provedor de TTS (ex.: el:sample:<voz>).
  provedor       text not null default 'elevenlabs',
  provedor_voz_id text,

  premium        boolean not null default false,
  previa_id      uuid references public.arquivos (id) on delete set null,
  amostra_id     uuid references public.arquivos (id) on delete set null,
  consentimento_em timestamptz,

  ordem          smallint not null default 0,
  ativa          boolean not null default true,
  criado_em      timestamptz not null default now(),

  constraint vozes_origem_coerente check (
    (origem = 'catalogo' and perfil_id is null)
    or (origem = 'clonada' and perfil_id is not null)
  ),
  -- Clonar a voz de alguem sem registrar consentimento e problema juridico,
  -- nao detalhe de produto.
  constraint vozes_clonada_com_consentimento check (
    origem <> 'clonada' or estado <> 'pronta' or consentimento_em is not null
  )
);

create index vozes_catalogo_idx on public.vozes (idioma, ordem) where perfil_id is null and ativa;
create index vozes_perfil_idx on public.vozes (perfil_id, criado_em desc) where perfil_id is not null;
create unique index vozes_provedor_idx on public.vozes (provedor, provedor_voz_id)
  where provedor_voz_id is not null;

-- Uma voz e usavel por um perfil se for dele ou se for do catalogo.
create or replace function public.voz_acessivel(p_voz_id uuid, p_perfil_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.vozes v
     where v.id = p_voz_id and v.ativa
       and (v.perfil_id is null or v.perfil_id = p_perfil_id)
  );
$$;

-- -----------------------------------------------------------------------------
-- produtos — a raiz do pipeline.
-- -----------------------------------------------------------------------------
create table public.produtos (
  id             uuid primary key default gen_random_uuid(),
  perfil_id      uuid not null references public.perfis (id) on delete cascade,

  nome           text not null check (length(btrim(nome)) between 2 and 140),
  descricao      text,
  preco_centavos integer check (preco_centavos is null or preco_centavos >= 0),
  preco_de_centavos integer check (preco_de_centavos is null or preco_de_centavos >= 0),
  cupom          text,
  link           text,
  imagem_id      uuid references public.arquivos (id) on delete set null,

  beneficios     jsonb not null default '[]'::jsonb,
  objecoes       jsonb not null default '[]'::jsonb,

  fixado         boolean not null default false,
  arquivado_em   timestamptz,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  constraint produtos_desconto_coerente check (
    preco_de_centavos is null or preco_centavos is null or preco_de_centavos >= preco_centavos
  )
);

create index produtos_perfil_idx on public.produtos (perfil_id, criado_em desc)
  where arquivado_em is null;
-- Um produto fixado por perfil: e o que a live destaca.
create unique index produtos_fixado_idx on public.produtos (perfil_id)
  where fixado and arquivado_em is null;

create trigger produtos_atualizado_em
  before update on public.produtos
  for each row execute function public.tocar_atualizado_em();

-- -----------------------------------------------------------------------------
-- roteiros e versoes — o texto e versionado porque a IA reescreve e o usuario
-- edita; perder a versao anterior e perder o unico ativo que ele produziu.
-- -----------------------------------------------------------------------------
create table public.roteiros (
  id            uuid primary key default gen_random_uuid(),
  perfil_id     uuid not null references public.perfis (id) on delete cascade,

  -- Lista explicita de colunas: sem ela, `set null` anularia perfil_id junto,
  -- que e NOT NULL, e excluir um produto quebraria com erro incompreensivel.
  produto_id    uuid references public.produtos (id) on delete set null (produto_id),

  titulo        text not null default 'Roteiro sem título',
  versao_atual  smallint not null default 0,
  arquivado_em  timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index roteiros_perfil_idx on public.roteiros (perfil_id, atualizado_em desc)
  where arquivado_em is null;
create index roteiros_produto_idx on public.roteiros (produto_id) where produto_id is not null;

create trigger roteiros_atualizado_em
  before update on public.roteiros
  for each row execute function public.tocar_atualizado_em();

create table public.roteiro_versoes (
  id          uuid primary key default gen_random_uuid(),
  roteiro_id  uuid not null references public.roteiros (id) on delete cascade,
  perfil_id   uuid not null references public.perfis (id) on delete cascade,
  numero      smallint not null check (numero > 0),

  -- Uma secao por bloco do roteiro de vendas.
  secoes      jsonb not null default '[]'::jsonb,
  texto       text not null,

  -- `length()` conta code points, igual a `[...texto].length` no TypeScript.
  -- E a mesma unidade que a estimativa e o debito usam. Ver src/lib/caracteres.ts.
  caracteres  integer generated always as (length(texto)) stored,

  gerado_por_ia boolean not null default false,
  modelo      text,
  criado_em   timestamptz not null default now(),

  unique (roteiro_id, numero)
);

create index roteiro_versoes_roteiro_idx on public.roteiro_versoes (roteiro_id, numero desc);

-- -----------------------------------------------------------------------------
-- audios — uma geracao de fala. O arquivo continuo NAO existe: o audio e a
-- soma ordenada dos seus blocos, e e assim que o player e a extensao tocam.
-- Isso remove a necessidade de ffmpeg e o objeto de 173 MB do desenho original.
-- -----------------------------------------------------------------------------
create table public.audios (
  id            uuid primary key default gen_random_uuid(),
  perfil_id     uuid not null references public.perfis (id) on delete cascade,
  voz_id        uuid not null references public.vozes (id) on delete restrict,
  roteiro_versao_id uuid references public.roteiro_versoes (id) on delete set null (roteiro_versao_id),
  produto_id    uuid references public.produtos (id) on delete set null (produto_id),

  titulo        text not null default 'Áudio sem título',
  texto         text not null,
  caracteres    integer generated always as (length(texto)) stored,
  estado        public.estado_audio not null default 'rascunho',

  job_id        uuid references public.jobs (id) on delete set null (job_id),
  -- Debito na razao de creditos que pagou por esta geracao.
  lancamento_id uuid references public.creditos_lancamentos (id) on delete set null (lancamento_id),

  duracao_ms    integer check (duracao_ms is null or duracao_ms >= 0),
  blocos_total  smallint not null default 0,
  blocos_prontos smallint not null default 0,
  erro          text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint audios_progresso_coerente check (blocos_prontos <= blocos_total),
  constraint audios_pronto_tem_blocos check (estado <> 'pronto' or blocos_total > 0)
);

create index audios_perfil_idx on public.audios (perfil_id, criado_em desc);
create index audios_estado_idx on public.audios (perfil_id, estado);

create trigger audios_atualizado_em
  before update on public.audios
  for each row execute function public.tocar_atualizado_em();

-- A voz precisa ser do dono ou do catalogo. Gatilho e nao FK composta, porque
-- no catalogo `perfil_id` e nulo e FK composta com nulo nao valida nada.
create or replace function public.checar_voz_do_perfil()
returns trigger
language plpgsql
as $$
begin
  if not public.voz_acessivel(new.voz_id, new.perfil_id) then
    raise exception 'voz % nao pertence ao perfil % nem ao catalogo', new.voz_id, new.perfil_id
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger audios_voz_permitida
  before insert or update of voz_id on public.audios
  for each row execute function public.checar_voz_do_perfil();

-- -----------------------------------------------------------------------------
-- audio_blocos — ~45 por audio de 3h, cada um <= 2.400 caracteres (teto da
-- chamada de TTS) e ~2 MB. E a granularidade que torna bytea viavel.
-- -----------------------------------------------------------------------------
create table public.audio_blocos (
  id          uuid primary key default gen_random_uuid(),
  audio_id    uuid not null references public.audios (id) on delete cascade,
  perfil_id   uuid not null references public.perfis (id) on delete cascade,
  ordem       smallint not null check (ordem > 0),

  texto       text not null,
  caracteres  integer generated always as (length(texto)) stored,
  arquivo_id  uuid references public.arquivos (id) on delete set null (arquivo_id),
  duracao_ms  integer,
  estado      public.estado_audio not null default 'na_fila',
  erro        text,

  criado_em   timestamptz not null default now(),

  unique (audio_id, ordem)
);

create index audio_blocos_audio_idx on public.audio_blocos (audio_id, ordem);
create index audio_blocos_pendentes_idx on public.audio_blocos (audio_id)
  where estado in ('na_fila', 'gerando');

-- Mantem o contador do audio a partir dos blocos.
create or replace function public.recontar_blocos()
returns trigger
language plpgsql
as $$
declare
  v_audio uuid := coalesce(new.audio_id, old.audio_id);
begin
  update public.audios a
     set blocos_total   = (select count(*) from public.audio_blocos b where b.audio_id = v_audio),
         blocos_prontos = (select count(*) from public.audio_blocos b
                            where b.audio_id = v_audio and b.estado = 'pronto'),
         duracao_ms     = (select coalesce(sum(b.duracao_ms), 0) from public.audio_blocos b
                            where b.audio_id = v_audio and b.estado = 'pronto')
   where a.id = v_audio;

  update public.audios a
     set estado = 'pronto'
   where a.id = v_audio and a.blocos_total > 0
     and a.blocos_prontos = a.blocos_total and a.estado in ('gerando', 'na_fila');

  return null;
end;
$$;

create trigger audio_blocos_recontar
  after insert or update or delete on public.audio_blocos
  for each row execute function public.recontar_blocos();

-- -----------------------------------------------------------------------------
-- trilhas_ambiente — som de fundo para a live nao soar sintetica.
-- -----------------------------------------------------------------------------
create table public.trilhas_ambiente (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  descricao  text,
  arquivo_id uuid references public.arquivos (id) on delete set null,
  ordem      smallint not null default 0,
  ativa      boolean not null default true
);

-- -----------------------------------------------------------------------------
-- montagens — o audio continuo da live. E uma LISTA ORDENADA de audios, nao um
-- arquivo. Repetir a lista em laco e o que sai de graca: nenhuma escrita na
-- razao de creditos acontece aqui, e e isso que sustenta a margem do produto.
-- -----------------------------------------------------------------------------
create table public.montagens (
  id             uuid primary key default gen_random_uuid(),
  perfil_id      uuid not null references public.perfis (id) on delete cascade,
  nome           text not null default 'Montagem da live',

  trilha_id      uuid references public.trilhas_ambiente (id) on delete set null (trilha_id),
  volume_trilha  smallint not null default 15 check (volume_trilha between 0 and 100),
  intervalo_ms   integer not null default 800 check (intervalo_ms between 0 and 10000),
  embaralhar     boolean not null default false,

  duracao_ms     integer not null default 0,
  ativa          boolean not null default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create index montagens_perfil_idx on public.montagens (perfil_id, atualizado_em desc);
create unique index montagens_ativa_idx on public.montagens (perfil_id) where ativa;

create trigger montagens_atualizado_em
  before update on public.montagens
  for each row execute function public.tocar_atualizado_em();

create table public.montagem_itens (
  id           uuid primary key default gen_random_uuid(),
  montagem_id  uuid not null references public.montagens (id) on delete cascade,
  perfil_id    uuid not null references public.perfis (id) on delete cascade,
  audio_id     uuid not null references public.audios (id) on delete cascade,
  ordem        smallint not null check (ordem > 0),

  unique (montagem_id, ordem),
  unique (montagem_id, audio_id)
);

create index montagem_itens_montagem_idx on public.montagem_itens (montagem_id, ordem);

-- -----------------------------------------------------------------------------
-- contas_tiktok e live_config.
--
-- O unico por perfil, nao global: uma trava global sem prova de posse deixa
-- qualquer um registrar a conta dos maiores vendedores e bloquea-los.
-- -----------------------------------------------------------------------------
create table public.contas_tiktok (
  id             uuid primary key default gen_random_uuid(),
  perfil_id      uuid not null references public.perfis (id) on delete cascade,
  usuario_tiktok text not null check (usuario_tiktok ~ '^[A-Za-z0-9._]{2,24}$'),
  apelido        text,
  verificada_em  timestamptz,
  ativa          boolean not null default true,
  criado_em      timestamptz not null default now()
);

create unique index contas_tiktok_perfil_idx
  on public.contas_tiktok (perfil_id, lower(usuario_tiktok));

create table public.live_config (
  perfil_id           uuid primary key references public.perfis (id) on delete cascade,
  voz_id              uuid references public.vozes (id) on delete set null (voz_id),
  montagem_id         uuid references public.montagens (id) on delete set null (montagem_id),
  conta_tiktok_id     uuid references public.contas_tiktok (id) on delete set null (conta_tiktok_id),

  responder_chat      boolean not null default true,
  saudar_entrada      boolean not null default true,
  chat_intervalo_min_s smallint not null default 12 check (chat_intervalo_min_s >= 5),
  chat_intervalo_max_s smallint not null default 45,
  chat_teto_por_minuto smallint not null default 3 check (chat_teto_por_minuto between 1 and 20),

  -- Aceite do aviso de automacao no TikTok, registrado com versao e data.
  risco_aceito_em     timestamptz,
  risco_aceito_versao smallint,

  atualizado_em       timestamptz not null default now(),

  constraint live_config_cadencia check (chat_intervalo_max_s >= chat_intervalo_min_s)
);

create trigger live_config_atualizado_em
  before update on public.live_config
  for each row execute function public.tocar_atualizado_em();

-- -----------------------------------------------------------------------------
-- debitar_e_enfileirar — a UNICA porta de gasto de credito.
--
-- O debito e o enfileiramento acontecem no mesmo commit: ou o usuario foi
-- cobrado E o trabalho existe, ou nada aconteceu. E por isso que a fila mora
-- no Postgres e nao num Redis.
--
-- `p_referencia` e a chave de idempotencia e vem do FORMULARIO (campo oculto
-- gerado no render), nunca de um uuid criado dentro da acao — chave derivada
-- do proprio id nao protege de nada, porque cada clique gera um id novo.
-- Duplo clique, retry de rede e reexecucao da action devolvem o MESMO job.
--
-- Saldo insuficiente estoura na constraint perfis_creditos_nao_negativo, que
-- e checagem do banco e nao corrida de leitura-depois-escrita da aplicacao.
-- -----------------------------------------------------------------------------
create or replace function public.debitar_e_enfileirar(
  p_perfil_id  uuid,
  p_caracteres bigint,
  p_referencia text,
  p_tipo_job   text,
  p_entrada    jsonb default '{}'::jsonb,
  p_motivo     public.motivo_credito default 'consumo'
)
returns table (job_id uuid, lancamento_id uuid, ja_existia boolean)
language plpgsql
as $$
declare
  v_lanc uuid;
  v_job  uuid;
begin
  if p_caracteres <= 0 then
    raise exception 'nada a debitar' using errcode = '22023';
  end if;

  -- Ja cobrado? Devolve o que existe, sem tocar no saldo.
  select l.id into v_lanc
    from public.creditos_lancamentos l
   where l.perfil_id = p_perfil_id and l.motivo = p_motivo and l.referencia = p_referencia;

  if found then
    select j.id into v_job
      from public.jobs j
     where j.tipo = p_tipo_job and j.chave_idempotencia = p_referencia;
    return query select v_job, v_lanc, true;
    return;
  end if;

  insert into public.creditos_lancamentos (perfil_id, delta, motivo, referencia, metadados)
  values (p_perfil_id, -p_caracteres, p_motivo, p_referencia,
          jsonb_build_object('tipo_job', p_tipo_job))
  returning id into v_lanc;

  insert into public.jobs (perfil_id, tipo, chave_idempotencia, entrada)
  values (p_perfil_id, p_tipo_job, p_referencia,
          p_entrada || jsonb_build_object('lancamento_id', v_lanc))
  on conflict (tipo, chave_idempotencia) where chave_idempotencia is not null
    do update set atualizado_em = now()
  returning id into v_job;

  return query select v_job, v_lanc, false;
end;
$$;

-- -----------------------------------------------------------------------------
-- estornar_creditos — job que morreu de vez devolve o que cobrou.
-- Idempotente: estornar duas vezes nao credita duas vezes.
-- -----------------------------------------------------------------------------
create or replace function public.estornar_creditos(
  p_lancamento_id uuid,
  p_motivo_texto  text default 'falha na geracao'
)
returns uuid
language plpgsql
as $$
declare
  v_orig public.creditos_lancamentos;
  v_novo uuid;
begin
  select * into v_orig from public.creditos_lancamentos where id = p_lancamento_id;
  if not found or v_orig.delta >= 0 then
    return null;
  end if;

  insert into public.creditos_lancamentos (perfil_id, delta, motivo, referencia, metadados)
  values (v_orig.perfil_id, -v_orig.delta, 'estorno',
          'estorno:' || p_lancamento_id::text,
          jsonb_build_object('lancamento_origem', p_lancamento_id, 'motivo', p_motivo_texto))
  on conflict (perfil_id, motivo, referencia) where referencia is not null do nothing
  returning id into v_novo;

  return v_novo;
end;
$$;

-- Creditos de boas-vindas para a conta nascer utilizavel.
insert into public.configuracoes (chave, valor, descricao) values
  ('creditos.boas_vindas', '2000', 'Caracteres dados no cadastro, para o usuario testar antes de assinar.')
on conflict (chave) do nothing;
