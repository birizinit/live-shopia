-- =============================================================================
-- Shopia — infraestrutura transversal (fases 1 a 7)
--
-- Tudo que as fases seguintes assumem existir: ponteiro de arquivo, fila de
-- jobs, auditoria, configuracao mutavel e limite de uso.
--
-- A fila e Postgres puro, com SELECT ... FOR UPDATE SKIP LOCKED. Nao e por
-- economia: credito e dinheiro e e debitado ANTES da chamada externa, entao o
-- debito e o enfileiramento precisam do MESMO commit. Com Redis viraria
-- escrita dupla — debita aqui, enfileira la — e uma falha no meio cobraria o
-- usuario por um trabalho que nunca existiu.
-- =============================================================================

create type public.provedor_arquivo as enum ('postgres', 'r2', 'externo');
create type public.estado_arquivo   as enum ('pendente', 'pronto', 'removido');
create type public.estado_job       as enum ('pendente', 'processando', 'concluido', 'falhou', 'cancelado');

-- -----------------------------------------------------------------------------
-- arquivos — ponteiro para todo binario, sem prender o schema a um provedor.
--
-- O conteudo mora em `conteudo` (bytea) so enquanto o provedor for 'postgres'.
-- Isso funciona porque NENHUM arquivo aqui e grande: o audio da live nasce em
-- blocos de ~2 MB (a ElevenLabs ja obriga a fatiar por chamada) e o arquivo
-- continuo de 3h nunca e materializado — o player e a extensao tocam a lista
-- de blocos em ordem. Uma linha de 2 MB e rotina; uma de 173 MB nao e.
-- -----------------------------------------------------------------------------
create table public.arquivos (
  id           uuid primary key default gen_random_uuid(),
  perfil_id    uuid references public.perfis (id) on delete cascade,

  provedor     public.provedor_arquivo not null default 'postgres',
  conteudo     bytea,
  chave        text,
  url_publica  text,

  mime         text not null,
  bytes        bigint not null default 0 check (bytes >= 0),
  sha256       bytea,
  duracao_ms   integer check (duracao_ms is null or duracao_ms > 0),

  estado       public.estado_arquivo not null default 'pendente',
  metadados    jsonb not null default '{}'::jsonb,

  criado_em    timestamptz not null default now(),
  removido_em  timestamptz,

  -- Teto duro por linha. Passar disto significa que alguem tentou materializar
  -- o audio inteiro, que e justamente o que este desenho evita.
  constraint arquivos_tamanho_por_linha check (bytes <= 8 * 1024 * 1024),
  constraint arquivos_conteudo_coerente check (
    (provedor = 'postgres' and (estado <> 'pronto' or conteudo is not null))
    or (provedor <> 'postgres' and (estado <> 'pronto' or chave is not null or url_publica is not null))
  ),
  constraint arquivos_remocao_coerente check ((estado = 'removido') = (removido_em is not null))
);

create index arquivos_perfil_idx on public.arquivos (perfil_id, criado_em desc)
  where removido_em is null;
create unique index arquivos_chave_unica on public.arquivos (provedor, chave)
  where chave is not null;
create index arquivos_orfaos_idx on public.arquivos (criado_em)
  where estado = 'pendente';

comment on column public.arquivos.conteudo is
  'So quando provedor = postgres. Trocar para R2 e UPDATE de provedor/chave, nao migracao de schema.';

-- -----------------------------------------------------------------------------
-- job_tipos — catalogo. Tabela em vez de enum porque cada fase acrescenta um
-- tipo, e `alter type ... add value` nao roda dentro da transacao que o
-- aplicador de migracoes usa por arquivo.
-- -----------------------------------------------------------------------------
create table public.job_tipos (
  tipo             text primary key check (tipo ~ '^[a-z_]{3,40}$'),
  descricao        text not null,
  max_tentativas   smallint not null default 5 check (max_tentativas between 1 and 20),
  lease_segundos   integer not null default 300 check (lease_segundos >= 30),
  prioridade_padrao smallint not null default 100,
  ativo            boolean not null default true
);

insert into public.job_tipos (tipo, descricao, max_tentativas, lease_segundos, prioridade_padrao) values
  ('roteiro',   'Gera roteiro de vendas com o Claude',        3,  180, 50),
  ('tts',       'Sintetiza um bloco de audio na ElevenLabs',  5,  600, 100),
  ('montagem',  'Fecha a lista de blocos do audio da live',   3,  120, 80),
  ('clonagem',  'Envia amostra e cria voz clonada',           3,  900, 120),
  ('comissao',  'Apura comissao de um pagamento confirmado',  8,  120, 20),
  ('push',      'Entrega notificacao push',                   3,   60, 150),
  ('faxina',    'Remove arquivos orfaos e sessoes expiradas',  1,  600, 200);

-- -----------------------------------------------------------------------------
-- jobs — a fila.
-- -----------------------------------------------------------------------------
create table public.jobs (
  id                 uuid primary key default gen_random_uuid(),
  perfil_id          uuid references public.perfis (id) on delete cascade,
  tipo               text not null references public.job_tipos (tipo),

  estado             public.estado_job not null default 'pendente',
  prioridade         smallint not null default 100,
  disponivel_em      timestamptz not null default now(),

  tentativas         smallint not null default 0,
  max_tentativas     smallint not null default 5,

  reservado_por      text,
  reservado_ate      timestamptz,

  -- Enfileirar o mesmo trabalho duas vezes devolve o MESMO job. E isto que
  -- faz o retry (e o duplo clique) nao cobrar credito de novo.
  chave_idempotencia text,

  entrada            jsonb not null default '{}'::jsonb,
  resultado          jsonb,
  erro               text,
  progresso          smallint not null default 0 check (progresso between 0 and 100),

  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  concluido_em       timestamptz,

  constraint jobs_lease_coerente check ((estado = 'processando') = (reservado_ate is not null)),
  constraint jobs_fim_coerente check (
    (estado in ('concluido', 'falhou', 'cancelado')) = (concluido_em is not null)
  ),
  constraint jobs_falha_explicada check (estado <> 'falhou' or erro is not null)
) with (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.02);

-- Indice PARCIAL: a reserva so varre o que esta pendente, e o indice encolhe
-- sozinho conforme os jobs terminam.
create index jobs_fila_idx on public.jobs (prioridade, disponivel_em, id)
  where estado = 'pendente';
create index jobs_lease_idx on public.jobs (reservado_ate)
  where estado = 'processando';
create unique index jobs_idempotencia_idx on public.jobs (tipo, chave_idempotencia)
  where chave_idempotencia is not null;
create index jobs_perfil_idx on public.jobs (perfil_id, criado_em desc)
  where perfil_id is not null;

create trigger jobs_atualizado_em
  before update on public.jobs
  for each row execute function public.tocar_atualizado_em();

-- Worker acorda por evento, nao por polling apertado.
create or replace function public.avisar_job_novo()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify('shopia_jobs', new.tipo);
  return new;
end;
$$;

create trigger jobs_notificar
  after insert on public.jobs
  for each row when (new.estado = 'pendente')
  execute function public.avisar_job_novo();

-- -----------------------------------------------------------------------------
-- jobs_tentativas — uma linha por execucao. Append-only: e o que responde
-- "por que esse audio demorou" sem poluir a linha do job.
-- -----------------------------------------------------------------------------
create table public.jobs_tentativas (
  id           bigint generated always as identity primary key,
  job_id       uuid not null references public.jobs (id) on delete cascade,
  numero       smallint not null check (numero > 0),
  worker       text,
  iniciada_em  timestamptz not null default now(),
  terminada_em timestamptz,
  resultado    public.estado_job,
  erro         text,
  duracao_ms   integer,
  custo        jsonb not null default '{}'::jsonb,

  unique (job_id, numero)
);

create index jobs_tentativas_job_idx on public.jobs_tentativas (job_id, iniciada_em desc);

-- -----------------------------------------------------------------------------
-- Reserva e conclusao. Toda a mecanica da fila mora aqui, para o worker nao
-- reinventar SQL e para a semantica ser a mesma em qualquer chamador.
-- -----------------------------------------------------------------------------
create or replace function public.reservar_jobs(
  p_worker text,
  p_tipos  text[] default null,
  p_limite integer default 1
)
returns setof public.jobs
language sql
as $$
  with escolhidos as (
    select j.id, t.lease_segundos
      from public.jobs j
      join public.job_tipos t on t.tipo = j.tipo
     where j.estado = 'pendente'
       and j.disponivel_em <= now()
       and t.ativo
       and (p_tipos is null or j.tipo = any (p_tipos))
     order by j.prioridade, j.disponivel_em, j.id
     limit greatest(p_limite, 1)
     for update of j skip locked
  )
  update public.jobs j
     set estado        = 'processando',
         tentativas    = j.tentativas + 1,
         reservado_por = p_worker,
         reservado_ate = now() + make_interval(secs => e.lease_segundos)
    from escolhidos e
   where j.id = e.id
  returning j.*;
$$;

create or replace function public.concluir_job(
  p_id        uuid,
  p_resultado jsonb default '{}'::jsonb
)
returns void
language sql
as $$
  update public.jobs
     set estado = 'concluido', resultado = p_resultado, progresso = 100,
         reservado_por = null, reservado_ate = null, concluido_em = now(), erro = null
   where id = p_id;
$$;

-- Backoff exponencial com teto. Esgotadas as tentativas, o job morre e quem
-- devolve o credito e o proprio handler — o banco so registra.
create or replace function public.falhar_job(
  p_id  uuid,
  p_erro text
)
returns public.estado_job
language plpgsql
as $$
declare
  v_job    public.jobs;
  v_estado public.estado_job;
begin
  select * into v_job from public.jobs where id = p_id for update;
  if not found then
    return null;
  end if;

  if v_job.tentativas >= v_job.max_tentativas then
    v_estado := 'falhou';
    update public.jobs
       set estado = 'falhou', erro = p_erro, reservado_por = null,
           reservado_ate = null, concluido_em = now()
     where id = p_id;
  else
    v_estado := 'pendente';
    update public.jobs
       set estado = 'pendente', erro = p_erro, reservado_por = null, reservado_ate = null,
           disponivel_em = now() + make_interval(secs => least(600, power(3, v_job.tentativas)::int))
     where id = p_id;
  end if;

  return v_estado;
end;
$$;

-- Worker que morreu no meio deixa o job reservado. Isto devolve para a fila.
create or replace function public.recuperar_jobs_travados()
returns integer
language sql
as $$
  with soltos as (
    update public.jobs
       set estado = 'pendente', reservado_por = null, reservado_ate = null,
           erro = coalesce(erro, 'worker perdeu o lease')
     where estado = 'processando' and reservado_ate < now()
    returning 1
  )
  select count(*)::int from soltos;
$$;

-- -----------------------------------------------------------------------------
-- Append-only generico — reaproveitado por jobs_tentativas e auditoria.
-- -----------------------------------------------------------------------------
create or replace function public.bloquear_escrita_append_only()
returns trigger
language plpgsql
as $$
begin
  -- Mesma saida da razao de creditos: remocao em cascata da conta e permitida,
  -- porque nela o pai ja foi apagado quando este gatilho roda.
  if tg_op = 'DELETE' then
    return old;
  end if;
  raise exception '% e append-only', tg_table_name;
end;
$$;

create trigger jobs_tentativas_append_only
  before update on public.jobs_tentativas
  for each row execute function public.bloquear_escrita_append_only();

-- -----------------------------------------------------------------------------
-- auditoria — trilha imutavel. E o que responde a uma disputa seis meses
-- depois: quem fez, em nome de quem, sobre o que, com qual valor antes.
-- -----------------------------------------------------------------------------
create table public.auditoria (
  id          bigint generated always as identity primary key,
  perfil_id   uuid references public.perfis (id) on delete set null,
  ator_id     uuid references public.perfis (id) on delete set null,
  acao        text not null,
  entidade    text not null,
  entidade_id text,
  antes       jsonb,
  depois      jsonb,
  ip          inet,
  user_agent  text,
  criado_em   timestamptz not null default now()
);

create index auditoria_perfil_idx on public.auditoria (perfil_id, criado_em desc);
create index auditoria_entidade_idx on public.auditoria (entidade, entidade_id, criado_em desc);

create trigger auditoria_append_only
  before update on public.auditoria
  for each row execute function public.bloquear_escrita_append_only();

comment on column public.auditoria.ator_id is
  'Quem executou. Diferente de perfil_id quando um gerente ou admin age sobre outra conta.';

-- -----------------------------------------------------------------------------
-- configuracoes — numeros de negocio que mudam sem deploy.
--
-- Percentual de comissao por nivel, prazo de liberacao, teto de saque: tudo
-- que o dono do negocio ajusta e que nao pode estar fixo no codigo.
-- -----------------------------------------------------------------------------
create table public.configuracoes (
  chave         text primary key check (chave ~ '^[a-z0-9_.]{3,60}$'),
  valor         jsonb not null,
  descricao     text not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.perfis (id) on delete set null
);

create or replace function public.config_num(p_chave text, p_padrao numeric)
returns numeric
language sql
stable
as $$
  select coalesce((select (valor #>> '{}')::numeric from public.configuracoes where chave = p_chave), p_padrao);
$$;

insert into public.configuracoes (chave, valor, descricao) values
  ('creditos.chars_por_minuto', '600', 'Caracteres por minuto de fala. Base de toda estimativa de duracao.'),
  ('creditos.max_chars_por_bloco', '2400', 'Teto por chamada de TTS. A ElevenLabs obriga a fatiar; e o que define o tamanho do bloco.'),
  ('comissao.nivel_1', '0.30', 'ATENCAO: valor provisorio. Fechar com o dono do negocio (PLANO.md §9.4).'),
  ('comissao.nivel_2', '0.10', 'ATENCAO: valor provisorio.'),
  ('comissao.nivel_3', '0.05', 'ATENCAO: valor provisorio.'),
  ('comissao.gerente', '0.60', 'Comissao do gerente, confirmada no levantamento do concorrente.'),
  ('comissao.dias_liberacao', '30', 'D+30 antes de o saldo pendente virar disponivel — janela de chargeback.'),
  ('saque.minimo_centavos', '5000', 'Saldo minimo para solicitar saque.'),
  ('live.risco_aceito_versao', '1', 'Versao do aviso de risco de automacao aceito no onboarding.')
on conflict (chave) do nothing;

-- -----------------------------------------------------------------------------
-- limites_acesso — rate limit. Era o que o Supabase dava de graca.
--
-- Janela deslizante por contador: barato, sem dependencia nova, e suficiente
-- para o que precisa barrar (forca bruta de login, abuso de acao cara).
-- -----------------------------------------------------------------------------
create table public.limites_acesso (
  chave       text not null,
  janela_em   timestamptz not null,
  contagem    integer not null default 0,
  primary key (chave, janela_em)
);

create index limites_acesso_janela_idx on public.limites_acesso (janela_em);

create or replace function public.consumir_limite(
  p_chave    text,
  p_teto     integer,
  p_janela_s integer
)
returns boolean
language plpgsql
as $$
declare
  v_janela timestamptz := to_timestamp(floor(extract(epoch from now()) / p_janela_s) * p_janela_s);
  v_atual  integer;
begin
  insert into public.limites_acesso (chave, janela_em, contagem)
  values (p_chave, v_janela, 1)
  on conflict (chave, janela_em) do update set contagem = public.limites_acesso.contagem + 1
  returning contagem into v_atual;

  return v_atual <= p_teto;
end;
$$;

comment on function public.consumir_limite is
  'true = pode seguir. Conta antes de decidir, entao o teto e exato mesmo sob concorrencia.';
