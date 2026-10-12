-- =============================================================================
-- 0031 — Fluxos de resposta
--
-- "Quando alguém comentar X, responda Y depois de N segundos, marcando a
-- pessoa (ou não)." A pessoa monta no app; a EXTENSÃO executa, lendo o chat
-- da própria aba — não depende de "Ler a tela" nem gasta crédito.
--
-- Por que não é o manual (temas_resposta)? O manual é "a pergunta que a
-- audiência faz", casada por começo de palavra, com espera sorteada pelo
-- servidor. O fluxo é uma regra que a pessoa controla inteira: casa por
-- mensagem EXATA ou por expressão contida, espera o tempo que ela escolheu,
-- marca ou não, e responde uma vez por pessoa. Quando um fluxo casa, o manual
-- não responde o mesmo comentário — ninguém recebe duas respostas.
-- =============================================================================

begin;

create type public.modo_fluxo as enum ('contem', 'exato');

create table public.fluxos (
  id          uuid primary key default gen_random_uuid(),
  perfil_id   uuid not null references public.perfis (id) on delete cascade,
  nome        text not null check (length(btrim(nome)) between 1 and 60),
  modo        public.modo_fluxo not null default 'contem',

  -- Gatilhos e respostas: listas curtas. Mais de uma resposta = a extensão
  -- sorteia, e o chat não vê a mesma frase repetida.
  gatilhos    text[] not null check (cardinality(gatilhos) between 1 and 20),
  respostas   text[] not null check (cardinality(respostas) between 1 and 5),

  -- Quanto esperar antes de responder. Zero é permitido, mas resposta em
  -- 0 s é a coisa mais parecida com robô que existe; o padrão é 10.
  atraso_s    integer not null default 10 check (atraso_s between 0 and 300),
  -- "@nome, ..." no começo da resposta.
  marcar      boolean not null default true,
  -- A mesma pessoa repetindo o gatilho não ganha a mesma resposta de novo.
  uma_vez_por_pessoa boolean not null default true,
  -- Intervalo mínimo entre duas respostas DESTE fluxo, para quem quer que
  -- dez pessoas perguntando o frete não virem dez mensagens em dez segundos.
  intervalo_s integer not null default 20 check (intervalo_s between 0 and 3600),

  ativo       boolean not null default true,
  ordem       smallint not null default 0,
  vezes_usado integer not null default 0,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index fluxos_perfil_idx on public.fluxos (perfil_id, ativo, ordem);

create trigger fluxos_atualizado_em
  before update on public.fluxos
  for each row execute function public.tocar_atualizado_em();

comment on table public.fluxos is
  'Regras gatilho → resposta montadas pela pessoa. Executadas pela extensão, na aba da live.';

commit;
