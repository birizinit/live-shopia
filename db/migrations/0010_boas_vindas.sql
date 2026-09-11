-- =============================================================================
-- Crédito de boas-vindas no cadastro.
--
-- A configuração `creditos.boas_vindas` foi semeada em 0004 e nunca teve quem
-- a lesse: `criar_perfil` não inseria lançamento nenhum. Resultado — toda
-- conta nova nascia com saldo zero, e como as únicas entradas na razão são
-- compra (que depende de um gateway que ainda não existe) e assinatura (cuja
-- cota está nula), NÃO HAVIA NENHUMA PORTA para conseguir crédito.
--
-- Na prática a jornada morria para 100% dos visitantes, sempre no mesmo ponto:
-- o tour funciona, o produto cadastra, o roteiro gera (texto é de graça), a voz
-- é escolhida — e a primeira tentativa de gerar áudio é recusada por saldo
-- insuficiente antes de qualquer chamada ao provedor. Ninguém nunca ouviu a
-- apresentadora falar.
--
-- O valor fica em `configuracoes` de propósito: quantos caracteres dar de
-- amostra é decisão de negócio e muda sem deploy.
-- =============================================================================

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
  v_base       text;
  v_usuario    text;
  v_sufixo     int := 0;
  v_indicador  uuid;
  v_perfil     public.perfis;
  v_boas_vindas bigint;
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

      exit;
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

  v_boas_vindas := public.config_num('creditos.boas_vindas', 0)::bigint;

  if v_boas_vindas > 0 then
    -- Referência derivada do perfil: se esta função for chamada duas vezes para
    -- o mesmo id (retry, migração), o índice de idempotência recusa o segundo.
    insert into public.creditos_lancamentos (perfil_id, delta, motivo, referencia, metadados)
    values (
      v_perfil.id, v_boas_vindas, 'bonus', 'boas-vindas:' || v_perfil.id::text,
      jsonb_build_object('origem', 'cadastro')
    )
    on conflict (perfil_id, motivo, referencia) where referencia is not null do nothing;

    -- O gatilho da razão já somou no cache; devolve o perfil com o saldo certo.
    select * into v_perfil from public.perfis where id = v_perfil.id;
  end if;

  return v_perfil;
end;
$$;

comment on function public.criar_perfil is
  'Cria o perfil e concede o crédito de amostra. Papel nunca é parâmetro: nasce user.';
