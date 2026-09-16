-- =============================================================================
-- Excluir a conta volta a ser possível quando existe trilha de auditoria.
--
-- `auditoria.perfil_id` e `ator_id` são `on delete set null`, de propósito: a
-- trilha precisa sobreviver à saída da pessoa — é ela que responde a uma
-- disputa seis meses depois. Mas "set null" é um UPDATE, e o gatilho
-- append-only bloqueia todo UPDATE. Resultado: a primeira conta que gerasse um
-- registro de auditoria ficava impossível de excluir, e exclusão de conta é
-- direito do titular pela LGPD, não funcionalidade opcional.
--
-- Apareceu ao testar a concessão de cortesia, que é justamente o primeiro
-- caminho do produto que escreve em auditoria.
--
-- A saída é a mesma da razão de créditos: numa cascata o perfil JÁ FOI apagado
-- quando o gatilho roda, e é isso que separa "apagaram a conta" de "alguém está
-- reescrevendo a trilha". Aqui vai um passo além e confere também que nada mais
-- mudou na linha: só a anulação do ponteiro passa.
-- =============================================================================

create or replace function public.bloquear_escrita_append_only()
returns trigger
language plpgsql
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_col text;
begin
  -- Remoção em cascata da conta é permitida: o pai já foi apagado aqui.
  if tg_op = 'DELETE' then
    return old;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);

  -- Tira da comparação as colunas que apontam para um perfil e que estão indo
  -- de um valor para NULL por causa da remoção desse perfil.
  foreach v_col in array array['perfil_id', 'ator_id'] loop
    if v_old ? v_col
       and v_old ->> v_col is not null
       and v_new ->> v_col is null
       and not exists (
         select 1 from public.perfis p where p.id = (v_old ->> v_col)::uuid
       )
    then
      v_old := v_old - v_col;
      v_new := v_new - v_col;
    end if;
  end loop;

  -- Se sobrou qualquer outra diferença, é reescrita de trilha.
  if v_old = v_new then
    return new;
  end if;

  raise exception '% e append-only', tg_table_name;
end;
$$;

comment on function public.bloquear_escrita_append_only is
  'Bloqueia reescrita. Permite DELETE em cascata e a anulação de FK de perfil removido (LGPD).';
