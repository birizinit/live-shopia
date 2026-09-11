-- =============================================================================
-- Shopia — fundação do schema (fase 0)
--
-- Postgres puro. Sem Supabase: autenticação, sessão e recuperação de senha são
-- nossas, e é por isso que `perfis` guarda credencial e existe uma tabela de
-- sessões de verdade.
--
-- Quatro decisões difíceis de mudar depois, por isso já estão aqui:
--   1. papel mora no banco e é lido a cada requisição — nunca num token;
--   2. sessão é token opaco guardado como hash, com expiração absoluta e
--      rotação — não é JWT, então revogar é um UPDATE e não uma esperança;
--   3. crédito é razão append-only — saldo é consequência, não um campo que
--      alguém sobrescreve;
--   4. tudo em caracteres, que é a unidade que a ElevenLabs cobra.
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

create type public.tipo_token as enum ('verificacao', 'recuperacao');

-- -----------------------------------------------------------------------------
-- perfis — conta e credencial no mesmo lugar.
-- -----------------------------------------------------------------------------
create table public.perfis (
  id                  uuid primary key default gen_random_uuid(),

  email               text not null,
  -- Argon2id. O formato PHC já carrega sal e parâmetros; nada de coluna de sal.
  senha_hash          text not null,
  email_verificado_em timestamptz,

  nome                text not null default '',
  usuario             text not null,
  papel               public.papel_usuario not null default 'user',

  -- Cache do saldo. A verdade é creditos_lancamentos; trigger mantém este campo
  -- para a UI não somar a razão inteira a cada tela.
  creditos            bigint not null default 0,

  codigo_ref          text not null,
  indicado_por        uuid references public.perfis (id) on delete set null,

  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),

  constraint perfis_email_formato check (position('@' in email) > 1),
  constraint perfis_usuario_formato check (usuario ~ '^[a-z0-9_.]{3,24}$'),
  constraint perfis_creditos_nao_negativo check (creditos >= 0),
  constraint perfis_nao_indica_a_si check (indicado_por is null or indicado_por <> id)
);

create unique index perfis_email_unico on public.perfis (lower(email));
create unique index perfis_usuario_unico on public.perfis (lower(usuario));
create unique index perfis_codigo_ref_unico on public.perfis (upper(codigo_ref));
create index perfis_indicado_por_idx on public.perfis (indicado_por);

comment on column public.perfis.papel is
  'Autorização vem daqui, lida a cada requisição. Nunca de um token.';
comment on column public.perfis.creditos is
  'Cache derivado de creditos_lancamentos, mantido por trigger.';

-- -----------------------------------------------------------------------------
-- sessoes — token opaco, guardado só como hash.
--
-- Vazamento de dump não vira sessão válida, porque o que está aqui não serve
-- de cookie. O cookie é o token cru, que só existe no navegador do dono.
-- -----------------------------------------------------------------------------
create table public.sessoes (
  id               uuid primary key default gen_random_uuid(),
  perfil_id        uuid not null references public.perfis (id) on delete cascade,

  token_hash       bytea not null unique,

  -- Teto absoluto: nem sessão ativa passa daqui sem login de novo.
  expira_em        timestamptz not null,
  -- Janela de inatividade, empurrada a cada uso.
  ultima_atividade timestamptz not null default now(),

  revogada_em      timestamptz,

  device_id        text,
  user_agent       text,
  ip               inet,

  criada_em        timestamptz not null default now()
);

create index sessoes_perfil_idx
  on public.sessoes (perfil_id)
  where revogada_em is null;

create index sessoes_expiracao_idx on public.sessoes (expira_em);

-- -----------------------------------------------------------------------------
-- tokens_email — confirmação de cadastro e redefinição de senha.
-- Mesma regra das sessões: o banco só guarda o hash.
-- -----------------------------------------------------------------------------
create table public.tokens_email (
  id         uuid primary key default gen_random_uuid(),
  perfil_id  uuid not null references public.perfis (id) on delete cascade,
  tipo       public.tipo_token not null,
  token_hash bytea not null unique,
  expira_em  timestamptz not null,
  usado_em   timestamptz,
  criado_em  timestamptz not null default now()
);

create index tokens_email_perfil_idx on public.tokens_email (perfil_id, tipo);

-- -----------------------------------------------------------------------------
-- dispositivos — a trava de "1 dispositivo por conta" que o original anuncia
-- mas não aplica. Aqui o device_id é registrado de fato.
-- -----------------------------------------------------------------------------
create table public.dispositivos (
  id            uuid primary key default gen_random_uuid(),
  perfil_id     uuid not null references public.perfis (id) on delete cascade,
  device_id     text not null,
  user_agent    text,
  ultimo_acesso timestamptz not null default now(),
  criado_em     timestamptz not null default now(),

  unique (perfil_id, device_id)
);

create index dispositivos_perfil_idx on public.dispositivos (perfil_id);

-- -----------------------------------------------------------------------------
-- planos — catálogo.
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
  id            uuid primary key default gen_random_uuid(),
  perfil_id     uuid not null references public.perfis (id) on delete cascade,
  plano_id      uuid not null references public.planos (id),
  status        public.status_assinatura not null default 'pendente',

  gateway       text,
  gateway_id    text,

  inicio        timestamptz,
  fim           timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint assinaturas_periodo check (fim is null or inicio is null or fim > inicio)
);

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
-- Toda geração de áudio debita ANTES da chamada à ElevenLabs, com `referencia`
-- idempotente: retry de job não cobra duas vezes.
-- -----------------------------------------------------------------------------
create table public.creditos_lancamentos (
  id         uuid primary key default gen_random_uuid(),
  perfil_id  uuid not null references public.perfis (id) on delete cascade,

  -- Em caracteres. Positivo credita, negativo consome.
  delta      bigint not null check (delta <> 0),
  motivo     public.motivo_credito not null,

  -- Chave de idempotência: id do pagamento, id do job de TTS, etc.
  referencia text,
  metadados  jsonb not null default '{}'::jsonb,
  criado_em  timestamptz not null default now(),

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

-- Mantém perfis.creditos em dia a partir da razão. A constraint de
-- não-negativo em perfis é quem impede saldo estourar: o débito acontece
-- antes da chamada externa e falha alto se não houver saldo.
create or replace function public.aplicar_lancamento_credito()
returns trigger
language plpgsql
as $$
begin
  update public.perfis
     set creditos = creditos + new.delta
   where id = new.perfil_id;

  return new;
end;
$$;

create trigger creditos_aplicar
  after insert on public.creditos_lancamentos
  for each row execute function public.aplicar_lancamento_credito();

-- A razão não se reescreve: erro vira lançamento de estorno.
--
-- A exceção é a remoção da conta inteira (LGPD). Numa cascata o perfil já foi
-- apagado quando este gatilho roda, e é isso que separa "apagaram a conta" de
-- "alguém está mexendo na razão" — sem essa saída, conta com lançamento vira
-- conta que não dá para excluir.
create or replace function public.bloquear_alteracao_lancamento()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from public.perfis where id = old.perfil_id) then
    return old;
  end if;

  raise exception 'creditos_lancamentos é append-only: use um lançamento de estorno';
end;
$$;

create trigger creditos_sem_update
  before update or delete on public.creditos_lancamentos
  for each row execute function public.bloquear_alteracao_lancamento();

-- -----------------------------------------------------------------------------
-- criar_perfil — cadastro numa transação só.
--
-- Resolver colisão de @usuario na aplicação seria duas idas ao banco com uma
-- corrida no meio: dois cadastros simultâneos com o mesmo nome escolheriam o
-- mesmo sufixo. Aqui o laço roda junto com o insert, sob o índice único.
--
-- O papel NUNCA é parâmetro: nasce 'user' e só muda por operação de servidor.
-- Promover no cadastro seria dar painel financeiro de graça.
-- -----------------------------------------------------------------------------
create or replace function public.criar_perfil(
  p_email      text,
  p_senha_hash text,
  p_nome       text,
  p_usuario    text,
  p_ref        text default null
)
returns public.perfis
language plpgsql
as $$
declare
  v_base      text;
  v_usuario   text;
  v_sufixo    int := 0;
  v_indicador uuid;
  v_perfil    public.perfis;
begin
  v_base := lower(coalesce(nullif(trim(p_usuario), ''), split_part(p_email, '@', 1)));
  v_base := regexp_replace(v_base, '[^a-z0-9_.]', '', 'g');
  if length(v_base) < 3 then
    v_base := 'user' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;
  v_base := left(v_base, 20);
  v_usuario := v_base;

  if p_ref is not null then
    select p.id into v_indicador
      from public.perfis p
     where upper(p.codigo_ref) = upper(trim(p_ref))
     limit 1;
  end if;

  loop
    begin
      insert into public.perfis (email, senha_hash, nome, usuario, codigo_ref, indicado_por)
      values (
        lower(trim(p_email)),
        p_senha_hash,
        coalesce(p_nome, ''),
        v_usuario,
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
        v_indicador
      )
      returning * into v_perfil;

      return v_perfil;
    exception
      when unique_violation then
        -- E-mail duplicado é erro de verdade; @usuario duplicado a gente resolve.
        if sqlerrm like '%perfis_email_unico%' then
          raise;
        end if;
        v_sufixo := v_sufixo + 1;
        if v_sufixo > 50 then
          raise exception 'não foi possível gerar um @usuario livre';
        end if;
        v_usuario := left(v_base, 20) || v_sufixo::text;
    end;
  end loop;
end;
$$;
