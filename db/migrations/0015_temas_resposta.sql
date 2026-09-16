-- =============================================================================
-- Temas de resposta: como a apresentadora responde o chat sem quebrar a margem.
--
-- A CONTA QUE DEFINE ESTE DESENHO
-- Uma resposta falada tem ~100 caracteres. A cota é 30.000/mês. Se cada
-- resposta gerasse TTS novo, dariam 300 respostas no mês inteiro — e a cadência
-- padrão (3 por minuto) queima isso em 1h40 de live. Voz fresca por resposta é
-- economicamente impossível no preço que praticamos.
--
-- A saída é a mesma do loop: o cliente cadastra TEMAS, cada tema tem o áudio
-- gerado UMA vez com a cota, e tocar durante a live não custa nada. Não é
-- limitação — é o que faz a conta fechar, e é por isso que o concorrente também
-- responde só "os temas que você cadastra".
--
-- O que não casar com tema nenhum cai para texto no chat, que é de graça.
-- =============================================================================

create table public.temas_resposta (
  id          uuid primary key default gen_random_uuid(),
  perfil_id   uuid not null references public.perfis (id) on delete cascade,

  -- Tema preso a um produto responde só quando aquele produto está fixado.
  -- Nulo = vale para qualquer live deste perfil.
  produto_id  uuid references public.produtos (id) on delete cascade,

  chave       text not null check (chave ~ '^[a-z0-9_]{2,30}$'),
  rotulo      text not null,

  /**
   * Os gatilhos. Casamento por palavra, não por IA: é instantâneo, previsível,
   * de graça, e o cliente entende por que a apresentadora respondeu aquilo.
   * Guardados já normalizados (minúsculo, sem acento) pelo gatilho abaixo.
   */
  gatilhos    text[] not null default '{}'::text[],

  /** O que escrever no chat. Sempre existe: é o caminho que nunca custa nada. */
  resposta    text not null check (length(btrim(resposta)) between 2 and 280),

  /**
   * O áudio pré-gerado desta resposta. Nulo = responde só por texto.
   * Gerado uma vez pelo estúdio; tocar em live não escreve na razão de crédito.
   */
  audio_id    uuid references public.audios (id) on delete set null (audio_id),

  ativo       boolean not null default true,
  ordem       smallint not null default 0,
  vezes_usado integer not null default 0 check (vezes_usado >= 0),

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (perfil_id, chave)
);

create index temas_resposta_perfil_idx
  on public.temas_resposta (perfil_id, ordem)
  where ativo;

comment on table public.temas_resposta is
  'Respostas prontas do chat. Áudio gerado uma vez; tocar em live não custa crédito.';

create trigger temas_resposta_atualizado_em
  before update on public.temas_resposta
  for each row execute function public.tocar_atualizado_em();

-- -----------------------------------------------------------------------------
-- Normalização: acento e caixa não podem decidir se a cliente é atendida.
--
-- "Qual o PREÇO?" e "qual o preco" precisam casar com o mesmo gatilho. Guardar
-- já normalizado evita normalizar os dois lados a cada comentário — e numa live
-- movimentada isso é centenas de vezes por minuto.
-- -----------------------------------------------------------------------------
create or replace function public.normalizar_texto(p_texto text)
returns text
language sql
immutable
as $$
  select lower(
    translate(
      btrim(coalesce(p_texto, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
    )
  );
$$;

create or replace function public.normalizar_gatilhos()
returns trigger
language plpgsql
as $$
begin
  new.gatilhos := (
    select coalesce(array_agg(distinct g), '{}'::text[])
      from unnest(new.gatilhos) as g0
      cross join lateral (select public.normalizar_texto(g0) as g) n
     where length(n.g) >= 2
  );
  return new;
end;
$$;

create trigger temas_resposta_normalizar
  before insert or update of gatilhos on public.temas_resposta
  for each row execute function public.normalizar_gatilhos();

-- -----------------------------------------------------------------------------
-- casar_tema — o casador.
--
-- Roda no servidor, e não na extensão, por dois motivos: a cadência precisa ser
-- decidida em um lugar só (duas abas abertas não podem responder em dobro), e
-- mudar a resposta não pode exigir republicar extensão.
-- -----------------------------------------------------------------------------
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
     -- Tema de produto só vale para o produto em cena.
     and (t.produto_id is null or t.produto_id = p_produto_id)
     and exists (
       select 1 from unnest(t.gatilhos) as g
        where alvo.t like '%' || g || '%'
     )
   -- Tema de produto ganha do genérico; depois, a ordem que o cliente definiu.
   order by (t.produto_id is not null) desc, t.ordem, t.criado_em
   limit 1;
$$;

-- -----------------------------------------------------------------------------
-- criar_temas_padrao — o ponto de partida.
--
-- Tela vazia é o lugar onde o cliente desiste. Estes seis cobrem o que mais se
-- pergunta em live de venda, já com os gatilhos, e são editáveis.
-- -----------------------------------------------------------------------------
create or replace function public.criar_temas_padrao(p_perfil_id uuid)
returns integer
language plpgsql
as $$
declare
  v_criados integer := 0;
begin
  insert into public.temas_resposta (perfil_id, chave, rotulo, gatilhos, resposta, ordem)
  values
    (p_perfil_id, 'preco', 'Preço',
     array['quanto','preco','valor','quanto custa','ta quanto','qnt'],
     'O valor está na tela e o cupom já está ativo — aproveita que é por tempo limitado!', 10),
    (p_perfil_id, 'frete', 'Frete',
     array['frete','entrega','envio','chega em quanto','prazo'],
     'O frete aparece no carrinho conforme o seu CEP, e sai rapidinho!', 20),
    (p_perfil_id, 'cupom', 'Cupom',
     array['cupom','desconto','codigo','promo'],
     'O cupom já está aplicado no produto fixado, é só tocar e conferir!', 30),
    (p_perfil_id, 'tamanho', 'Tamanho',
     array['tamanho','tam','numero','medida','veste'],
     'Tem a tabela de medidas na página do produto, dá uma olhadinha antes de escolher!', 40),
    (p_perfil_id, 'estoque', 'Estoque',
     array['tem','acabou','disponivel','estoque','ultima'],
     'Ainda tem, mas está saindo rápido — garante o seu agora!', 50),
    (p_perfil_id, 'como_comprar', 'Como comprar',
     array['como compro','como faz','onde compra','link','carrinho'],
     'É só tocar no produto fixado aqui embaixo da live e finalizar por lá!', 60)
  on conflict (perfil_id, chave) do nothing;

  get diagnostics v_criados = row_count;
  return v_criados;
end;
$$;

-- -----------------------------------------------------------------------------
-- Boas-vindas.
--
-- O nome de quem entra é dinâmico, então falar o nome exigiria TTS por
-- espectador — custo sem teto. A saída: a VOZ diz uma saudação genérica de um
-- punhado pré-gerado, e o NOME vai na mensagem de texto do chat. Custo zero e
-- continua pessoal.
-- -----------------------------------------------------------------------------
alter table public.live_config
  add column if not exists dar_boas_vindas boolean not null default true,
  add column if not exists boas_vindas_texto text
    default 'Seja bem-vindo(a), {nome}! 💚';

comment on column public.live_config.boas_vindas_texto is
  'Mensagem de texto no chat. {nome} é trocado pelo apelido de quem entrou.';
