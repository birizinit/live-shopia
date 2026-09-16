-- =============================================================================
-- Push: quem enfileira o envio.
--
-- O handler existe (src/lib/worker/trabalhos/push.ts) e o tipo de job está
-- declarado desde a 0003. Faltava quem puxasse o gatilho.
--
-- A escolha aqui é enfileirar no BANCO, não na aplicação. O motivo é que a
-- venda pode chegar por mais de um caminho — extensão, API do TikTok Shop,
-- importação, lançamento manual pelo painel — e notificação amarrada a UM
-- desses caminhos é notificação que some quando o caminho muda. Amarrada à
-- linha da venda, ela vale para todos.
--
-- Nenhum destes gatilhos pode derrubar a escrita que o disparou: notificação é
-- consequência da venda, e uma venda que falha porque o push falhou seria o
-- rabo abanando o cachorro.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- enfileirar_push — porta única para criar job de notificação.
-- -----------------------------------------------------------------------------
create or replace function public.enfileirar_push(
  p_perfil_id  uuid,
  p_titulo     text,
  p_texto      text default null,
  p_url        text default '/inicio',
  p_tag        text default 'shopia',
  p_chave      text default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  -- Sem aparelho inscrito, não há o que enfileirar. Checar aqui evita encher a
  -- fila de jobs que só existem para descobrir que ninguém queria receber.
  if not exists (
    select 1 from public.push_inscricoes
     where perfil_id = p_perfil_id and desativada_em is null
  ) then
    return null;
  end if;

  insert into public.jobs (perfil_id, tipo, chave_idempotencia, entrada, prioridade)
  values (
    p_perfil_id,
    'push',
    p_chave,
    jsonb_build_object(
      'perfil_id', p_perfil_id,
      'carga', jsonb_build_object('titulo', p_titulo, 'texto', p_texto, 'url', p_url, 'tag', p_tag)
    ),
    -- Notificação de venda perde para geração de áudio de propósito: o áudio é
    -- o que o cliente está esperando na tela.
    150
  )
  on conflict (tipo, chave_idempotencia) where chave_idempotencia is not null
    do nothing
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.enfileirar_push is
  'Porta única para notificação. Devolve null quando não há aparelho inscrito.';

-- -----------------------------------------------------------------------------
-- Venda registrada.
-- -----------------------------------------------------------------------------
create or replace function public.avisar_venda()
returns trigger
language plpgsql
as $$
declare
  v_quer boolean;
begin
  select coalesce(p.venda, true) into v_quer
    from public.push_preferencias p
   where p.perfil_id = new.perfil_id;

  if coalesce(v_quer, true) then
    perform public.enfileirar_push(
      new.perfil_id,
      'Venda na sua live 🎉',
      case
        when new.gmv_centavos > 0
          then 'R$ ' || to_char(new.gmv_centavos / 100.0, 'FM999G999D00')
               || coalesce(' · ' || new.comprador_apelido, '')
        else coalesce(new.comprador_apelido, 'Pedido registrado')
      end,
      '/dashboard',
      'venda',
      -- Uma notificação por venda, e não uma por retentativa de ingestão.
      'venda:' || new.id::text
    );
  end if;

  return null;
exception when others then
  -- Notificação nunca derruba a venda.
  return null;
end;
$$;

create trigger vendas_avisar
  after insert on public.vendas
  for each row execute function public.avisar_venda();

-- -----------------------------------------------------------------------------
-- Live caiu — a extensão parou de dar sinal.
--
-- Este é o aviso que mais importa do produto: a live morreu às 3h da manhã e
-- ninguém percebeu é exatamente o cenário que o cliente compra para evitar.
-- -----------------------------------------------------------------------------
create or replace function public.avisar_queda()
returns trigger
language plpgsql
as $$
declare
  v_quer boolean;
begin
  if new.estado = 'caiu' and coalesce(old.estado, 'iniciando') <> 'caiu' then
    select coalesce(p.queda_live, true) into v_quer
      from public.push_preferencias p
     where p.perfil_id = new.perfil_id;

    if coalesce(v_quer, true) then
      perform public.enfileirar_push(
        new.perfil_id,
        'Sua live saiu do ar',
        'A extensão parou de dar sinal. Abra o painel para ver o que houve.',
        '/live',
        'queda',
        'queda:' || new.id::text
      );
    end if;
  end if;

  return null;
exception when others then
  return null;
end;
$$;

create trigger live_sessoes_avisar_queda
  after update of estado on public.live_sessoes
  for each row execute function public.avisar_queda();

-- -----------------------------------------------------------------------------
-- Crédito acabando.
--
-- Avisa ao cruzar a linha, uma vez por dia — e não a cada consumo abaixo dela,
-- que viraria uma notificação por bloco de áudio gerado.
--
-- O limiar é POR PERFIL (push_preferencias.creditos_limiar), não global: quem
-- gera três horas de áudio por semana precisa ser avisado muito antes de quem
-- gera vinte minutos por mês.
-- -----------------------------------------------------------------------------
create or replace function public.avisar_credito_baixo()
returns trigger
language plpgsql
as $$
declare
  v_quer   boolean;
  v_piso   bigint;
  v_antes  bigint;
begin
  if new.delta >= 0 then return null; end if;

  select coalesce(p.creditos_baixos, true), coalesce(p.creditos_limiar, 5000)
    into v_quer, v_piso
    from public.push_preferencias p
   where p.perfil_id = new.perfil_id;

  v_quer := coalesce(v_quer, true);
  v_piso := coalesce(v_piso, 5000);

  -- O gatilho da razão já somou o delta em perfis.creditos, então `v_antes` é
  -- o saldo DEPOIS deste lançamento.
  select creditos into v_antes from public.perfis where id = new.perfil_id;

  -- Só no cruzamento: depois está abaixo da linha e antes não estava.
  if v_antes is null or v_antes >= v_piso or (v_antes - new.delta) < v_piso then
    return null;
  end if;

  if v_quer then
    perform public.enfileirar_push(
      new.perfil_id,
      'Seus créditos estão acabando',
      'Restam ' || v_antes || ' caracteres. Repetir o áudio em laço continua de graça.',
      '/creditos',
      'credito',
      -- Uma vez por dia, no máximo: quem está no fim da cota gera várias vezes.
      'credito:' || new.perfil_id::text || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')
    );
  end if;

  return null;
exception when others then
  return null;
end;
$$;

create trigger creditos_avisar_baixo
  after insert on public.creditos_lancamentos
  for each row execute function public.avisar_credito_baixo();
