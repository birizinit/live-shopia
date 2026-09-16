-- =============================================================================
-- Dinheiro na notificação sai em formato brasileiro.
--
-- `to_char` usa o lc_numeric da conexão, e o do container é `C` — então
-- R$ 129,90 saía como "R$ 129.90" na notificação, que é o texto que o cliente
-- lê no celular quando vende. Trocar o locale do servidor por causa disso
-- seria mexer numa configuração global para consertar uma string.
--
-- `translate` com os dois separadores trocados resolve no lugar certo:
-- em lc_numeric C, G vira "," e D vira "." — a troca devolve o formato daqui.
-- =============================================================================

create or replace function public.reais(p_centavos bigint)
returns text
language sql
immutable
as $$
  select 'R$ ' || translate(to_char(p_centavos / 100.0, 'FM999G999G990D00'), '.,', ',.');
$$;

comment on function public.reais is
  'Centavos para texto em formato brasileiro, independente do locale do servidor.';

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
          then public.reais(new.gmv_centavos) || coalesce(' · ' || new.comprador_apelido, '')
        else coalesce(new.comprador_apelido, 'Pedido registrado')
      end,
      '/dashboard',
      'venda',
      'venda:' || new.id::text
    );
  end if;

  return null;
exception when others then
  -- Notificação nunca derruba a venda.
  return null;
end;
$$;
