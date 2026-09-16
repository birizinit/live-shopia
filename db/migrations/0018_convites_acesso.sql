-- =============================================================================
-- Convites de acesso e cortesia.
--
-- Serve para o dono liberar gente escolhida para usar sem pagar: teste fechado,
-- parceiro, primeiro cliente. É a alternativa honesta a "deixar o checkout
-- aberto sem cobrar de verdade" — a cortesia fica REGISTRADA como cortesia, com
-- prazo e com quem concedeu, em vez de virar uma assinatura falsa que ninguém
-- consegue distinguir de uma paga na hora de fechar o mês.
--
-- Por que passa por `assinaturas` em vez de um campo solto no perfil: o resto do
-- produto já pergunta "qual a assinatura ativa?" em dez lugares — licença da
-- extensão, cota de crédito, aulas com exige_plano, teto de contas TikTok.
-- Cortesia que não passasse por ali precisaria ser lembrada em cada um deles, e
-- seria esquecida em pelo menos um.
-- =============================================================================

create table public.convites_acesso (
  id          uuid primary key default gen_random_uuid(),

  -- Curto e legível: vai por WhatsApp, e código que se digita errado não é
  -- convite, é suporte. Sem O/0 e I/1 pelo mesmo motivo.
  codigo      text not null unique
                check (codigo ~ '^[A-HJ-NP-Z2-9]{6,12}$'),

  criado_por  uuid references public.perfis (id) on delete set null (criado_por),
  plano_id    uuid not null references public.planos (id),

  /** Duração da cortesia, em dias, a partir do resgate. */
  dias        smallint not null default 30 check (dias between 1 and 3650),

  usos_max    smallint not null default 1 check (usos_max between 1 and 1000),
  usos        smallint not null default 0 check (usos >= 0),

  /** O convite em si vence, mesmo sem ninguém usar. */
  expira_em   timestamptz not null default now() + interval '30 days',

  observacao  text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),

  constraint convites_acesso_usos check (usos <= usos_max)
);

create index convites_acesso_ativos_idx
  on public.convites_acesso (criado_em desc)
  where ativo;

comment on table public.convites_acesso is
  'Códigos que dão acesso de cortesia. Um código pode valer para várias pessoas (usos_max).';

-- Quem resgatou qual convite. Append-only: é a trilha que responde "por que
-- esta conta tem acesso sem nunca ter pago".
create table public.convites_resgates (
  id         uuid primary key default gen_random_uuid(),
  convite_id uuid not null references public.convites_acesso (id) on delete cascade,
  perfil_id  uuid not null references public.perfis (id) on delete cascade,
  criado_em  timestamptz not null default now(),

  -- A mesma pessoa não resgata o mesmo convite duas vezes.
  unique (convite_id, perfil_id)
);

create trigger convites_resgates_append_only
  before update on public.convites_resgates
  for each row execute function public.bloquear_escrita_append_only();

-- -----------------------------------------------------------------------------
-- gerar_codigo_convite — código curto, sem caractere ambíguo.
-- -----------------------------------------------------------------------------
create or replace function public.gerar_codigo_convite(p_tamanho integer default 8)
returns text
language plpgsql
as $$
declare
  v_alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_codigo   text;
  v_tentativa integer := 0;
begin
  loop
    v_codigo := '';
    for i in 1..greatest(6, least(12, p_tamanho)) loop
      v_codigo := v_codigo || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    end loop;

    exit when not exists (select 1 from public.convites_acesso where codigo = v_codigo);

    v_tentativa := v_tentativa + 1;
    if v_tentativa > 50 then
      raise exception 'não foi possível gerar um código livre';
    end if;
  end loop;

  return v_codigo;
end;
$$;

-- -----------------------------------------------------------------------------
-- conceder_cortesia — a porta única para dar acesso sem pagamento.
--
-- Usada tanto pelo resgate de convite quanto pela concessão direta do admin.
-- Idempotente por perfil: conceder de novo ESTENDE o prazo em vez de criar uma
-- segunda assinatura ativa, que o índice único recusaria.
-- -----------------------------------------------------------------------------
create or replace function public.conceder_cortesia(
  p_perfil_id uuid,
  p_plano_id  uuid,
  p_dias      integer,
  p_ator_id   uuid default null,
  p_motivo    text default 'cortesia'
)
returns public.assinaturas
language plpgsql
as $$
declare
  v_assinatura public.assinaturas;
  v_cota       bigint;
  v_antes      jsonb;
begin
  select to_jsonb(a) into v_antes
    from public.assinaturas a
   where a.perfil_id = p_perfil_id and a.status = 'ativa';

  insert into public.assinaturas (perfil_id, plano_id, status, gateway, inicio, fim)
  values (p_perfil_id, p_plano_id, 'ativa', 'cortesia', now(), now() + make_interval(days => p_dias))
  on conflict (perfil_id) where status = 'ativa'
  do update set
    plano_id = excluded.plano_id,
    gateway  = 'cortesia',
    -- Estende a partir do que for maior: cortesia dada a quem ainda tem prazo
    -- não pode encurtar o que já existia.
    fim      = greatest(coalesce(public.assinaturas.fim, now()), now()) + make_interval(days => p_dias)
  returning * into v_assinatura;

  -- A cota do plano entra como bônus, uma vez por concessão. `referencia`
  -- amarra o lançamento à assinatura: reconceder no mesmo instante não duplica.
  select creditos_mes into v_cota from public.planos where id = p_plano_id;

  if coalesce(v_cota, 0) > 0 then
    insert into public.creditos_lancamentos (perfil_id, delta, motivo, referencia, metadados)
    values (
      p_perfil_id, v_cota, 'bonus',
      'cortesia:' || v_assinatura.id::text || ':' || to_char(now(), 'YYYY-MM-DD"T"HH24'),
      jsonb_build_object('motivo', p_motivo, 'dias', p_dias)
    )
    on conflict (perfil_id, motivo, referencia) where referencia is not null do nothing;
  end if;

  insert into public.auditoria (perfil_id, ator_id, acao, entidade, entidade_id, antes, depois)
  values (p_perfil_id, p_ator_id, 'cortesia_concedida', 'assinaturas', v_assinatura.id,
          v_antes, to_jsonb(v_assinatura));

  return v_assinatura;
end;
$$;

comment on function public.conceder_cortesia is
  'Acesso sem pagamento, registrado como cortesia. Reconceder estende o prazo.';

-- -----------------------------------------------------------------------------
-- resgatar_convite — o que acontece quando alguém usa o código.
-- -----------------------------------------------------------------------------
create or replace function public.resgatar_convite(
  p_perfil_id uuid,
  p_codigo    text
)
returns table (ok boolean, motivo text, plano text, dias integer)
language plpgsql
as $$
declare
  v_convite public.convites_acesso;
begin
  select * into v_convite
    from public.convites_acesso c
   where upper(btrim(c.codigo)) = upper(btrim(p_codigo))
   for update;

  if v_convite.id is null then
    return query select false, 'nao_encontrado', null::text, null::integer; return;
  end if;
  if not v_convite.ativo then
    return query select false, 'revogado', null::text, null::integer; return;
  end if;
  if v_convite.expira_em <= now() then
    return query select false, 'expirado', null::text, null::integer; return;
  end if;
  if v_convite.usos >= v_convite.usos_max then
    return query select false, 'esgotado', null::text, null::integer; return;
  end if;
  if exists (select 1 from public.convites_resgates r
              where r.convite_id = v_convite.id and r.perfil_id = p_perfil_id) then
    return query select false, 'ja_usado', null::text, null::integer; return;
  end if;

  insert into public.convites_resgates (convite_id, perfil_id)
  values (v_convite.id, p_perfil_id);

  update public.convites_acesso set usos = usos + 1 where id = v_convite.id;

  perform public.conceder_cortesia(
    p_perfil_id, v_convite.plano_id, v_convite.dias, v_convite.criado_por,
    'convite ' || v_convite.codigo
  );

  return query
    select true, 'ok', p.nome, v_convite.dias::integer
      from public.planos p where p.id = v_convite.plano_id;
end;
$$;
