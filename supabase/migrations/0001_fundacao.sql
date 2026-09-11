-- =============================================================================
-- Shopia — fundação do schema (fase 0)
--
-- Cobre conta, dispositivo, plano, assinatura e a razão de créditos. O que é
-- de IA, live, vendas e comissão entra nas fases seguintes.
--
-- Três decisões que ficam difíceis de mudar depois e por isso já estão aqui:
--   1. papel mora no banco, nunca num claim do token;
--   2. crédito é razão append-only — saldo é consequência, não um campo que
--      alguém sobrescreve;
--   3. RLS ligada em tudo, com escrita de dado sensível só via service_role.
-- =============================================================================

create type public.papel_usuario as enum ('user', 'affiliate', 'manager', 'admin');

create type public.status_assinatura as enum (
  'pendente',
  'ativa',
  'cancelada',
  'inadimplente'
);

-- Motivo de cada lançamento de crédito. 'consumo' é sempre negativo.
create type public.motivo_credito as enum (
  'compra',
  'assinatura',
  'bonus',
  'consumo',
  'estorno',
  'ajuste'
);

-- -----------------------------------------------------------------------------
-- perfis — o usuário do produto. auth.users guarda só credencial.
-- -----------------------------------------------------------------------------
create table public.perfis (
  id            uuid primary key references auth.users (id) on delete cascade,
  nome          text not null default '',
  usuario       text not null,
  papel         public.papel_usuario not null default 'user',

  -- Cache do saldo. A verdade é creditos_lancamentos; este campo é mantido
  -- por trigger para a UI não somar a razão inteira a cada tela.
  creditos      bigint not null default 0,

  codigo_ref    text not null,
  indicado_por  uuid references public.perfis (id) on delete set null,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint perfis_usuario_formato check (usuario ~ '^[a-z0-9_.]{3,24}$'),
  constraint perfis_creditos_nao_negativo check (creditos >= 0),
  constraint perfis_nao_indica_a_si check (indicado_por is null or indicado_por <> id)
);

create unique index perfis_usuario_unico on public.perfis (lower(usuario));
create unique index perfis_codigo_ref_unico on public.perfis (upper(codigo_ref));
create index perfis_indicado_por_idx on public.perfis (indicado_por);

comment on column public.perfis.papel is
  'Autorização vem daqui, lida a cada requisição. Nunca de um claim do JWT.';
comment on column public.perfis.creditos is
  'Cache derivado de creditos_lancamentos, mantido por trigger.';

-- -----------------------------------------------------------------------------
-- dispositivos — a trava de "1 dispositivo por conta" que o original anuncia
-- mas não aplica. Aqui o device_id é registrado de fato.
-- -----------------------------------------------------------------------------
create table public.dispositivos (
  id             uuid primary key default gen_random_uuid(),
  perfil_id      uuid not null references public.perfis (id) on delete cascade,
  device_id      text not null,
  user_agent     text,
  ultimo_acesso  timestamptz not null default now(),
  criado_em      timestamptz not null default now(),

  unique (perfil_id, device_id)
);

create index dispositivos_perfil_idx on public.dispositivos (perfil_id);

-- -----------------------------------------------------------------------------
-- planos — catálogo público.
-- -----------------------------------------------------------------------------
create table public.planos (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  nome           text not null,
  descricao      text,
  preco_centavos integer not null check (preco_centavos >= 0),
  contas_tiktok  smallint not null default 1,
  voz_premium    boolean not null default false,

  -- Teto mensal em CARACTERES, não em horas: é caractere que a ElevenLabs
  -- cobra, e é por isso que o loop sai de graça. null = a definir (PLANO.md §9.4).
  creditos_mes   bigint,

  recursos       jsonb not null default '[]'::jsonb,
  ativo          boolean not null default true,
  ordem          smallint not null default 0,
  criado_em      timestamptz not null default now()
);

create index planos_ativo_ordem_idx on public.planos (ativo, ordem);

-- -----------------------------------------------------------------------------
-- assinaturas — estado vem do webhook do gateway, nunca da tela.
-- -----------------------------------------------------------------------------
create table public.assinaturas (
  id          uuid primary key default gen_random_uuid(),
  perfil_id   uuid not null references public.perfis (id) on delete cascade,
  plano_id    uuid not null references public.planos (id),
  status      public.status_assinatura not null default 'pendente',

  gateway     text,
  gateway_id  text,

  inicio      timestamptz,
  fim         timestamptz,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint assinaturas_periodo check (fim is null or inicio is null or fim > inicio)
);

-- Uma assinatura ativa por perfil.
create unique index assinaturas_uma_ativa
  on public.assinaturas (perfil_id)
  where status = 'ativa';

create index assinaturas_perfil_idx on public.assinaturas (perfil_id);
create unique index assinaturas_gateway_idx
  on public.assinaturas (gateway, gateway_id)
  where gateway_id is not null;

-- -----------------------------------------------------------------------------
-- creditos_lancamentos — razão append-only.
--
-- Toda geração de áudio debita ANTES da chamada à ElevenLabs, com
-- `referencia` idempotente: retry de job não cobra duas vezes.
-- -----------------------------------------------------------------------------
create table public.creditos_lancamentos (
  id          uuid primary key default gen_random_uuid(),
  perfil_id   uuid not null references public.perfis (id) on delete cascade,

  -- Em caracteres. Positivo credita, negativo consome.
  delta       bigint not null check (delta <> 0),
  motivo      public.motivo_credito not null,

  -- Chave de idempotência: id do pagamento, id do job de TTS, etc.
  referencia  text,
  metadados   jsonb not null default '{}'::jsonb,
  criado_em   timestamptz not null default now(),

  constraint creditos_consumo_negativo
    check ((motivo = 'consumo') = (delta < 0))
);

create index creditos_perfil_data_idx
  on public.creditos_lancamentos (perfil_id, criado_em desc);

create unique index creditos_referencia_unica
  on public.creditos_lancamentos (perfil_id, motivo, referencia)
  where referencia is not null;

-- -----------------------------------------------------------------------------
-- Gatilhos
-- -----------------------------------------------------------------------------

create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

create trigger perfis_atualizado_em
  before update on public.perfis
  for each row execute function public.tocar_atualizado_em();

create trigger assinaturas_atualizado_em
  before update on public.assinaturas
  for each row execute function public.tocar_atualizado_em();

-- Mantém perfis.creditos em dia a partir da razão.
create or replace function public.aplicar_lancamento_credito()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.perfis
     set creditos = creditos + new.delta
   where id = new.perfil_id;

  -- A constraint de não-negativo em perfis é quem impede saldo estourar:
  -- o débito acontece antes da chamada externa e falha alto se não houver saldo.
  return new;
end;
$$;

create trigger creditos_aplicar
  after insert on public.creditos_lancamentos
  for each row execute function public.aplicar_lancamento_credito();

-- A razão não se reescreve.
create or replace function public.bloquear_alteracao_lancamento()
returns trigger
language plpgsql
as $$
begin
  raise exception 'creditos_lancamentos é append-only: use um lançamento de estorno';
end;
$$;

create trigger creditos_sem_update
  before update or delete on public.creditos_lancamentos
  for each row execute function public.bloquear_alteracao_lancamento();

-- -----------------------------------------------------------------------------
-- Criação do perfil no cadastro.
--
-- O papel NUNCA vem do metadata enviado pelo cliente: nasce 'user' e só muda
-- por operação de servidor. Promover pelo formulário de cadastro seria dar
-- painel financeiro de graça.
-- -----------------------------------------------------------------------------
create or replace function public.tratar_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario   text;
  v_base      text;
  v_sufixo    int := 0;
  v_ref       text;
  v_indicador uuid;
begin
  v_base := lower(coalesce(new.raw_user_meta_data ->> 'usuario', split_part(new.email, '@', 1)));
  v_base := regexp_replace(v_base, '[^a-z0-9_.]', '', 'g');
  if length(v_base) < 3 then
    v_base := 'user' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;
  v_base := left(v_base, 20);

  v_usuario := v_base;
  while exists (select 1 from public.perfis p where lower(p.usuario) = v_usuario) loop
    v_sufixo := v_sufixo + 1;
    v_usuario := left(v_base, 20) || v_sufixo::text;
  end loop;

  v_ref := new.raw_user_meta_data ->> 'ref';
  if v_ref is not null then
    select p.id into v_indicador
      from public.perfis p
     where upper(p.codigo_ref) = upper(v_ref)
     limit 1;
  end if;

  insert into public.perfis (id, nome, usuario, codigo_ref, indicado_por)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', ''),
    v_usuario,
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    v_indicador
  );

  return new;
end;
$$;

create trigger auth_usuario_criado
  after insert on auth.users
  for each row execute function public.tratar_novo_usuario();

-- Papel do chamador, sem recursão de RLS (security definer).
create or replace function public.papel_atual()
returns public.papel_usuario
language sql
stable
security definer
set search_path = public
as $$
  select papel from public.perfis where id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- RLS
--
-- O Supabase concede tudo em public para anon/authenticated por padrão; aqui
-- a permissão é revogada e devolvida coluna a coluna. Política sem grant
-- estreito ainda deixa o usuário reescrever o próprio papel.
-- -----------------------------------------------------------------------------
alter table public.perfis                enable row level security;
alter table public.dispositivos          enable row level security;
alter table public.planos                enable row level security;
alter table public.assinaturas           enable row level security;
alter table public.creditos_lancamentos  enable row level security;

revoke all on public.perfis,
              public.dispositivos,
              public.planos,
              public.assinaturas,
              public.creditos_lancamentos
  from anon, authenticated;

-- perfis: lê o seu; edita só o nome.
grant select on public.perfis to authenticated;
grant update (nome) on public.perfis to authenticated;

create policy "perfis: lê o próprio"
  on public.perfis for select to authenticated
  using (id = (select auth.uid()));

create policy "perfis: edita o próprio"
  on public.perfis for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- planos: catálogo é público, inclusive para quem não entrou.
grant select on public.planos to anon, authenticated;

create policy "planos: catálogo público"
  on public.planos for select to anon, authenticated
  using (ativo);

-- assinaturas e créditos: leitura própria. Escrita só por webhook/job,
-- que roda com service_role e passa por cima da RLS.
grant select on public.assinaturas, public.creditos_lancamentos, public.dispositivos
  to authenticated;

create policy "assinaturas: lê as próprias"
  on public.assinaturas for select to authenticated
  using (perfil_id = (select auth.uid()));

create policy "créditos: lê os próprios"
  on public.creditos_lancamentos for select to authenticated
  using (perfil_id = (select auth.uid()));

create policy "dispositivos: lê os próprios"
  on public.dispositivos for select to authenticated
  using (perfil_id = (select auth.uid()));
