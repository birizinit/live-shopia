-- =============================================================================
-- O casamento passa a exigir início de palavra.
--
-- Com `like '%' || g || '%'`, o gatilho "tem" (do tema Estoque) casa dentro de
-- "item", "sistema", "tempo", "tentar". A cliente pergunta uma coisa e a
-- apresentadora responde outra, na frente de todo mundo, ao vivo.
--
-- A correção exige que o gatilho comece em fronteira de palavra, mas NÃO exige
-- que termine: em português o plural e a flexão vêm depois, e "preco" precisa
-- continuar casando com "precos" e "preço?". Ancorar os dois lados quebraria
-- mais do que conserta.
--
--   antes:  "item"  casa com o gatilho "tem"      ❌
--   depois: "item"  não casa; "tempo" não casa
--           "precos" ainda casa com "preco"        ✅
-- =============================================================================

create or replace function public.casar_tema(
  p_perfil_id  uuid,
  p_comentario text,
  p_produto_id uuid default null
)
returns public.temas_resposta
language sql
stable
as $$
  with alvo as (select public.normalizar_texto(p_comentario) as t)
  select t.*
    from public.temas_resposta t, alvo
   where t.perfil_id = p_perfil_id
     and t.ativo
     and (t.produto_id is null or t.produto_id = p_produto_id)
     and exists (
       select 1
         from unnest(t.gatilhos) as g
        -- Fronteira só no início: começo do texto ou caractere que não é
        -- letra nem número. `\m` do Postgres exigiria fim de palavra também.
        where alvo.t ~ ('(^|[^a-z0-9])' || regexp_replace(g, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'))
     )
   order by (t.produto_id is not null) desc, t.ordem, t.criado_em
   limit 1;
$$;

comment on function public.casar_tema is
  'Casa o comentário com um tema. Gatilho precisa começar em fronteira de palavra.';
