-- =============================================================================
-- Fila: reserva que se renova, e duplo clique que devolve o MESMO job.
--
-- 1. `renovar_lease`. O lease era fixado uma vez na reserva e nunca mais
--    mexido. Um áudio de 3h é UM job de TTS com ~45 chamadas pagas; se elas
--    passavam dos 10 minutos do lease, `recuperar_jobs_travados` devolvia o job
--    para a fila com o worker original ainda no meio — e um segundo worker
--    pagava os mesmos blocos de novo. O worker agora bate aqui a cada 20s
--    enquanto o trabalho roda, e o `false` diz a ele que parou de ser o dono.
--
-- 2. `debitar_e_enfileirar` com trava por referência. Entre o SELECT que
--    procura o lançamento e o INSERT havia uma janela: dois cliques quase
--    simultâneos passavam os dois pelo SELECT vazio, e o segundo morria no
--    índice único com "Esse registro já existe" em vez de receber o job do
--    primeiro. O dinheiro nunca esteve em risco (o índice barra), mas a
--    promessa de idempotência era essa. A trava transacional serializa só as
--    chamadas com a MESMA referência; o resto segue em paralelo.
--
-- 3. O tipo 'montagem' nunca foi enfileirado por ninguém: a montagem virou
--    síncrona (tabela `montagens`, 0004) antes de ganhar handler. Fica
--    desativado para não aparecer como pendência que não existe.
-- =============================================================================

create or replace function public.renovar_lease(p_id uuid, p_worker text)
returns boolean
language sql
as $$
  with renovado as (
    update public.jobs j
       set reservado_ate = now() + make_interval(secs => t.lease_segundos)
      from public.job_tipos t
     where j.id = p_id
       and t.tipo = j.tipo
       and j.estado = 'processando'
       and j.reservado_por = p_worker
    returning 1
  )
  select exists (select 1 from renovado);
$$;

comment on function public.renovar_lease is
  'false = o job não é mais deste worker (lease vencido e recuperado, ou concluído). Quem recebe false para de tocar no job.';

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

  -- Serializa só quem disputa a MESMA referência. Quem chega depois espera o
  -- primeiro commitar e, no SELECT abaixo, já enxerga o lançamento dele.
  perform pg_advisory_xact_lock(
    hashtextextended(p_perfil_id::text || '|' || p_motivo::text || '|' || p_referencia, 0)
  );

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

update public.job_tipos set ativo = false where tipo = 'montagem';
