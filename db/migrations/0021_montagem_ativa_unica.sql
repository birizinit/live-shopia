-- =============================================================================
-- Uma montagem ativa só, lida igual por todo mundo.
--
-- Havia duas: `montagens.ativa` (gravada em /audio, lida pela extensão) e
-- `live_config.montagem_id` (gravada em /live, lida pelo checklist e por
-- iniciarLive). Nada sincronizava as duas. Ativar em /audio deixava /live
-- pedindo "escolha uma montagem"; escolher em /live deixava a extensão com
-- "Nenhuma montagem ativa" — a mesma parede, vista de lados diferentes.
--
-- A fonte da verdade é `montagens.ativa`, que é o que a extensão toca.
-- `live_config.montagem_id` passa a ser espelho, mantido por gatilho nos dois
-- sentidos: as telas que gravam por lá continuam valendo, e nenhuma consegue
-- mais deixar as duas em desacordo.
--
-- `pg_trigger_depth()` corta o pingue-pongue: o espelho gravado por um gatilho
-- não aciona o gatilho do outro lado de volta.
-- =============================================================================

-- 1. Alinhar o que já existe. Quem só escolheu em /live ganha a montagem
--    ativada; depois, todo mundo com montagem ativa ganha o espelho.
update public.montagens m
   set ativa = true
  from public.live_config lc
 where lc.perfil_id = m.perfil_id
   and lc.montagem_id = m.id
   and not m.ativa
   and not exists (
     select 1 from public.montagens o where o.perfil_id = m.perfil_id and o.ativa
   );

insert into public.live_config (perfil_id, montagem_id)
select m.perfil_id, m.id from public.montagens m where m.ativa
on conflict (perfil_id) do update
  set montagem_id = excluded.montagem_id
  where live_config.montagem_id is distinct from excluded.montagem_id;

update public.live_config lc
   set montagem_id = null
 where lc.montagem_id is not null
   and not exists (
     select 1 from public.montagens m where m.id = lc.montagem_id and m.ativa
   );

-- 2. montagens -> live_config
create or replace function public.espelhar_montagem_ativa()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if new.ativa then
    insert into public.live_config (perfil_id, montagem_id)
    values (new.perfil_id, new.id)
    on conflict (perfil_id) do update
      set montagem_id = excluded.montagem_id
      where live_config.montagem_id is distinct from excluded.montagem_id;
  else
    update public.live_config
       set montagem_id = null
     where perfil_id = new.perfil_id and montagem_id = new.id;
  end if;

  return null;
end;
$$;

create trigger montagens_espelhar_ativa_ins
  after insert on public.montagens
  for each row when (new.ativa)
  execute function public.espelhar_montagem_ativa();

create trigger montagens_espelhar_ativa_upd
  after update of ativa on public.montagens
  for each row when (new.ativa is distinct from old.ativa)
  execute function public.espelhar_montagem_ativa();

-- 3. live_config -> montagens
create or replace function public.aplicar_montagem_escolhida()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  -- Desativar antes de ativar: `montagens_ativa_idx` é único e não adiável,
  -- então as duas coisas não podem sair no mesmo UPDATE.
  update public.montagens
     set ativa = false
   where perfil_id = new.perfil_id
     and ativa
     and id is distinct from new.montagem_id;

  if new.montagem_id is not null then
    update public.montagens
       set ativa = true
     where id = new.montagem_id and perfil_id = new.perfil_id and not ativa;
  end if;

  return null;
end;
$$;

create trigger live_config_aplicar_montagem_ins
  after insert on public.live_config
  for each row when (new.montagem_id is not null)
  execute function public.aplicar_montagem_escolhida();

create trigger live_config_aplicar_montagem_upd
  after update of montagem_id on public.live_config
  for each row when (new.montagem_id is distinct from old.montagem_id)
  execute function public.aplicar_montagem_escolhida();
