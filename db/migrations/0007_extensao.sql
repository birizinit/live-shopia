-- =============================================================================
-- Shopia — extensão de navegador (fase 5)
--
-- A fase 5 carrega dois riscos que o PLANO.md §6 nomeia e que NÃO se eliminam:
-- quebra técnica (o TikTok muda o DOM e a base inteira para no mesmo dia) e
-- risco de conta (automação contraria os Termos e o ban recai no cliente).
-- Conter os dois é decisão de schema, não de código, e é por isso que estas
-- seis tabelas existem antes da primeira linha da extensão:
--
--   1. o mapa de seletores é DADO (`seletores_mapas`), não constante compilada.
--      Consertar uma quebra vira um INSERT que todo mundo busca no próximo
--      heartbeat — não uma republicação na Web Store com dias de análise;
--   2. a extensão reporta QUAL seletor falhou (`ext_telemetria`) e o agregado
--      diário (`ext_telemetria_resumo`) diz quando N% da base falha no mesmo
--      ponto. O aviso chega pelo painel, antes do WhatsApp;
--   3. versão tem canal, fatia de canário e kill switch (`ext_versoes`):
--      liberar para 5% antes de todos, e desligar remotamente sem depender de
--      autoupdate — porque no dia em que a extensão derruba a conta do cliente
--      não dá para esperar o Chrome atualizar;
--   4. mixer de áudio e automação de chat são recursos SEPARADOS na licença.
--      Se o chat precisar morrer, o mixer continua e o produto sobrevive.
--
-- O que NÃO está aqui, de propósito: nada do espectador. Ver o comentário de
-- `ext_telemetria`.
-- =============================================================================

create type public.canal_extensao as enum ('estavel', 'canario');

-- Qual módulo reportou a falha. Existe para o painel separar "o mixer parou"
-- (produto morto) de "o chat parou" (recurso a menos) sem ler texto livre.
create type public.modulo_extensao as enum ('nucleo', 'mixer', 'chat', 'painel');

-- -----------------------------------------------------------------------------
-- ext_versoes — catálogo de builds publicados.
-- -----------------------------------------------------------------------------
create table public.ext_versoes (
  id                 uuid primary key default gen_random_uuid(),

  versao             text not null check (versao ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$'),
  canal              public.canal_extensao not null default 'estavel',

  -- Ordenar por texto põe 1.10.0 antes de 1.9.0, e "qual é a mais nova" é a
  -- consulta mais quente desta tabela. A escolha de versão sai daqui, nunca
  -- de `versao`.
  ordem              integer generated always as (
                       split_part(versao, '.', 1)::int * 1000000
                       + split_part(versao, '.', 2)::int * 1000
                       + split_part(versao, '.', 3)::int
                     ) stored,

  -- O pacote (ZIP da Web Store ou CRX auto-hospedado). `restrict` porque
  -- apagar o arquivo de uma versão publicada deixa instalação sem para onde
  -- atualizar — e instalação sem atualização é a quebra que não se conserta.
  arquivo_id         uuid references public.arquivos (id) on delete restrict,
  notas              text,

  -- Bloqueia a extensão antiga até atualizar. Reservado para correção que a
  -- versão velha não sabe consumir.
  obrigatoria        boolean not null default false,

  -- Fatia da base que recebe esta versão (0–100). Só o canal canário tem
  -- fatia; estável é para todos, por definição. Quem cai na fatia é decidido
  -- por hash da licença (`ext_bucket`), então a mesma instalação não troca de
  -- versão a cada heartbeat — canário que sorteia a cada chamada é ruído, não
  -- canário.
  percentual_canario smallint check (percentual_canario between 0 and 100),

  publicada_em       timestamptz,

  -- Desliga esta versão em toda a base sem passar pela Web Store. É a única
  -- defesa que funciona no mesmo dia.
  kill_switch        boolean not null default false,
  kill_motivo        text,

  criado_em          timestamptz not null default now(),

  constraint ext_versoes_versao_unica unique (versao),
  constraint ext_versoes_publicada_tem_pacote
    check (publicada_em is null or arquivo_id is not null),
  constraint ext_versoes_canario_tem_fatia
    check ((canal = 'canario') = (percentual_canario is not null)),
  constraint ext_versoes_kill_explicado
    check (not kill_switch or kill_motivo is not null)
);

-- Índice parcial: a resolução de versão só olha o que está no ar.
create index ext_versoes_no_ar_idx on public.ext_versoes (ordem desc)
  where publicada_em is not null and not kill_switch;

comment on column public.ext_versoes.kill_switch is
  'Desliga a versão remotamente. Vale para quem JÁ está rodando ela, não só para quem ia baixar.';

-- -----------------------------------------------------------------------------
-- ext_licencas — uma por perfil. O que a extensão apresenta para existir.
--
-- Mesmo desenho das sessões (0001): o banco guarda só o SHA-256, o token cru
-- de 32 bytes só existe dentro da extensão. Dump vazado não vira licença, e
-- revogar é um UPDATE. Não há pimenta aqui (diferente do HMAC de CPF da fase
-- 6): pimenta protege segredo de baixa entropia, e 32 bytes aleatórios não
-- saem de um hash nem com a tabela inteira na mão.
-- -----------------------------------------------------------------------------
create table public.ext_licencas (
  id              uuid primary key default gen_random_uuid(),
  perfil_id       uuid not null unique references public.perfis (id) on delete cascade,

  token_hash      bytea not null unique,
  -- Últimos 4 caracteres do token, só para a tela dizer de qual token ela
  -- fala. Quatro de sessenta e quatro não reconstroem nada.
  token_dica      text check (token_dica is null or length(token_dica) = 4),

  emitida_em      timestamptz not null default now(),
  rotacionada_em  timestamptz,

  plano_id        uuid references public.planos (id) on delete set null (plano_id),

  -- Os dois módulos do PLANO.md §6, separados desde o schema. O chat pode ser
  -- desligado por conta (aqui) ou na base inteira (`ext.chat_desligado`, em
  -- `configuracoes`) sem derrubar o mixer. Se fossem um recurso só, matar a
  -- automação de chat mataria o produto junto.
  mixer           boolean not null default true,
  chat            boolean not null default false,

  -- Retrato do que o plano liberava na emissão (câmera virtual, sons naturais,
  -- análise da live). É retrato, e não leitura de `planos.recursos`, porque
  -- editar o catálogo não pode mudar em silêncio o que a extensão de todo
  -- mundo faz no meio do mês.
  recursos        jsonb not null default '{}'::jsonb,

  -- Fixa a conta num canal. É assim que a equipe e os testadores recebem o
  -- canário inteiro, independente do sorteio.
  canal           public.canal_extensao not null default 'estavel',

  -- Janela de graça offline: a extensão continua funcionando até aqui sem
  -- falar com a gente. O servidor segue sendo a verdade, mas sem esta janela
  -- uma indisponibilidade nossa derruba a live de toda a base no mesmo minuto
  -- — e a live que cai é a do cliente, no meio da venda dele.
  expira_em       timestamptz not null default now() + interval '7 days',

  revogada_em     timestamptz,
  revogada_motivo text,

  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),

  constraint ext_licencas_revogacao_explicada
    check ((revogada_em is null) = (revogada_motivo is null)),
  -- Alvo da chave estrangeira composta das instalações.
  constraint ext_licencas_id_perfil unique (id, perfil_id)
);

create index ext_licencas_expiracao_idx on public.ext_licencas (expira_em)
  where revogada_em is null;

create trigger ext_licencas_atualizado_em
  before update on public.ext_licencas
  for each row execute function public.tocar_atualizado_em();

comment on column public.ext_licencas.token_hash is
  'SHA-256 dos 32 bytes crus. O token em claro NUNCA entra nesta tabela — mesmo contrato de sessoes.token_hash.';

-- -----------------------------------------------------------------------------
-- ext_instalacoes — uma por máquina que rodou a extensão.
--
-- É o denominador do alerta de quebra: sem saber quantas instalações estão
-- vivas numa versão, "30 falhas hoje" não quer dizer nada.
-- -----------------------------------------------------------------------------
create table public.ext_instalacoes (
  id               uuid primary key default gen_random_uuid(),
  licenca_id       uuid not null,
  perfil_id        uuid not null,

  -- Id gerado pela própria extensão na instalação. Reinstalar gera outro, e é
  -- isso que separa "dez máquinas" de "uma máquina que reabriu o navegador".
  instalacao_chave text not null check (length(instalacao_chave) between 8 and 128),

  -- Sem chave estrangeira para `ext_versoes`, de propósito: instalação em modo
  -- desenvolvedor roda build que nunca publicamos, e é exatamente esse caso
  -- que precisa aparecer no painel (PLANO.md §6: quem instala assim não recebe
  -- autoupdate, e vira a maior fonte de suporte). Uma FK aqui recusaria a
  -- linha e esconderia o problema.
  versao           text not null,
  mapa_versao      integer,

  user_agent       text,
  sistema          text,
  navegador        text,

  primeiro_contato timestamptz not null default now(),
  ultimo_contato   timestamptz not null default now(),

  constraint ext_instalacoes_unica unique (licenca_id, instalacao_chave),
  -- Alvo da chave estrangeira composta da telemetria.
  constraint ext_instalacoes_id_perfil unique (id, perfil_id),

  -- Chave estrangeira COMPOSTA, e aqui ela valida de verdade porque as DUAS
  -- colunas são NOT NULL: MATCH SIMPLE só desliga a checagem quando alguma
  -- delas é nula (foi o caso das vozes de catálogo em 0004, e lá a solução
  -- teve que ser gatilho). Amarra a instalação ao dono da licença, então
  -- nenhuma consulta mistura instalação de um perfil com licença de outro nem
  -- por engano.
  constraint ext_instalacoes_licenca_do_perfil
    foreign key (licenca_id, perfil_id)
    references public.ext_licencas (id, perfil_id)
    on delete cascade
);

create index ext_instalacoes_perfil_idx
  on public.ext_instalacoes (perfil_id, ultimo_contato desc);
-- Denominador do alerta: instalações vivas por versão.
create index ext_instalacoes_vivas_idx
  on public.ext_instalacoes (versao, ultimo_contato desc);

-- -----------------------------------------------------------------------------
-- seletores_mapas — O MAPA REMOTO. A defesa principal contra a quebra técnica.
--
-- A extensão não compila seletor nenhum: busca o mapa ativo e resolve cada
-- âncora pela cascata. Quando o TikTok muda o layout, o conserto é publicar um
-- JSON novo — minutos, sem republicar extensão e sem pedir reinstalação. Com
-- seletor compilado seriam dias de análise da Web Store com a base parada.
--
-- FORMATO (validado por `seletores_mapa_valido`, que é CHECK e não convenção):
--   { "<ancora>": ["<estrategia>=<valor>", ...] }
-- A chave é o ponto de ancoragem que o código pede pelo nome. O valor é a
-- CASCATA DE FALLBACK, na ordem: o primeiro candidato que resolver ganha.
-- Estratégias:
--   css=    seletor CSS
--   aria=   casamento por aria-label
--   texto=  casamento por texto visível
--   papel=  papel ARIA + nome acessível
--
-- O CHECK recusa classe hasheada (`.css-1x2y3z`, `.e1a2b3c4`): ela muda a cada
-- build do TikTok, então mapa ancorado nela já nasce quebrado — e o lugar de
-- descobrir isso é no INSERT, não no cliente.
-- -----------------------------------------------------------------------------
create or replace function public.seletores_mapa_valido(p_mapa jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when jsonb_typeof(p_mapa) <> 'object' or p_mapa = '{}'::jsonb then false
    else not exists (
           select 1
             from jsonb_each(p_mapa) as ancora(chave, cascata)
            where ancora.chave !~ '^[a-z0-9_.]{3,60}$'
               or jsonb_typeof(ancora.cascata) <> 'array'
               or jsonb_array_length(ancora.cascata) = 0
         )
         and not exists (
           select 1
             from jsonb_each(p_mapa) as ancora(chave, cascata)
             cross join lateral jsonb_array_elements(ancora.cascata) as c(candidato)
            where jsonb_typeof(c.candidato) <> 'string'
               or (c.candidato #>> '{}') !~ '^(css|aria|texto|papel)=.'
               or (c.candidato #>> '{}') ~ '\.css-[0-9a-z]{4,}'
               or (c.candidato #>> '{}') ~ '\.e[0-9][0-9a-z]{4,}'
         )
  end;
$$;

create table public.seletores_mapas (
  id            uuid primary key default gen_random_uuid(),

  -- Texto e não enum, pelo mesmo motivo de `job_tipos` em 0003: cada alvo novo
  -- (outro app, outra tela) seria um `alter type ... add value`, que não roda
  -- dentro da transação do aplicador de migrações.
  alvo          text not null default 'tiktok_live_studio' check (alvo ~ '^[a-z_]{3,40}$'),

  -- Inteiro incremental por alvo: é o que a extensão devolve para perguntar
  -- "mudou?" e o que a telemetria carimba para dizer QUAL mapa falhou.
  versao        integer not null check (versao > 0),

  mapa          jsonb not null,
  notas         text,
  ativo         boolean not null default false,
  publicado_em  timestamptz,
  publicado_por uuid references public.perfis (id) on delete set null (publicado_por),
  criado_em     timestamptz not null default now(),

  constraint seletores_mapas_versao_unica unique (alvo, versao),
  constraint seletores_mapas_ativo_publicado check (not ativo or publicado_em is not null),
  constraint seletores_mapas_formato check (public.seletores_mapa_valido(mapa))
);

-- Um mapa ativo por alvo. Dois no ar é a base metade consertada e metade não.
create unique index seletores_mapas_ativo_idx on public.seletores_mapas (alvo) where ativo;

-- -----------------------------------------------------------------------------
-- ext_telemetria — APPEND-ONLY. Qual seletor falhou, em que versão, quantas
-- vezes. É o que faz o painel avisar antes do WhatsApp.
--
-- PROIBIDO GRAVAR AQUI, e por isso não existe coluna para nada disso:
--   · comentário, mensagem ou resposta do chat — nem trecho, nem tamanho;
--   · @usuário, apelido, foto ou id de espectador;
--   · id da sala, URL completa ou qualquer coisa com identificador na query;
--   · IP (existe em `auditoria`, e lá é para disputa de conta — aqui não tem
--     nem essa desculpa).
-- O espectador do cliente não é usuário nosso, nunca consentiu com nada e não
-- tem a quem pedir exclusão. Dado dele que a gente não coleta é dado que não
-- vaza, não se pede para apagar e não aparece em fiscalização.
--
-- `contexto` é fechado por CHECK numa lista de chaves, então acrescentar campo
-- é migração revisada — e não um `metadados` que cresce sozinho até alguém
-- despejar o comentário inteiro lá dentro "só para depurar".
-- -----------------------------------------------------------------------------
create or replace function public.telemetria_sem_pessoal(p_contexto jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when jsonb_typeof(p_contexto) <> 'object' then false
    else not exists (
           select 1
             from jsonb_each(p_contexto) as campo(chave, valor)
            where campo.chave not in ('rota', 'idioma', 'ms', 'tentativas', 'motivo', 'candidatos')
               or jsonb_typeof(campo.valor) in ('object', 'array')
               -- '@' pega e-mail e @usuário de uma vez. 120 code points (o que
               -- `length()` conta, ver src/lib/caracteres.ts) não comportam
               -- comentário de live disfarçado de motivo.
               or (jsonb_typeof(campo.valor) = 'string'
                   and (length(campo.valor #>> '{}') > 120
                        or campo.valor #>> '{}' like '%@%'))
         )
  end;
$$;

create table public.ext_telemetria (
  id            bigint generated always as identity primary key,
  perfil_id     uuid not null,
  instalacao_id uuid not null,

  alvo          text not null default 'tiktok_live_studio' check (alvo ~ '^[a-z_]{3,40}$'),
  modulo        public.modulo_extensao not null default 'nucleo',

  -- A âncora do mapa que falhou, pelo nome da chave.
  seletor       text not null check (seletor ~ '^[a-z0-9_.]{3,60}$'),

  -- Posição do candidato da cascata que ainda resolveu. `null` = a cascata
  -- inteira falhou, que é o alarme de verdade; 2 num mapa de 3 avisa que o
  -- primeiro candidato morreu enquanto o conserto ainda dá para ser planejado.
  candidato     smallint check (candidato >= 0),

  versao        text not null,
  mapa_versao   integer,

  -- A extensão agrupa antes de mandar: 40 falhas do mesmo seletor viram uma
  -- linha com ocorrencias = 40. Telemetria de uma requisição por falha derruba
  -- a nossa API justamente no dia da quebra.
  ocorrencias   integer not null default 1 check (ocorrencias > 0),

  contexto      jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),

  -- Dia em horário de Brasília, não UTC: quem lê o alerta está no Brasil, e um
  -- dia que vira às 21h parte o pico de uma quebra em duas linhas.
  dia           date generated always as ((criado_em at time zone 'America/Sao_Paulo')::date) stored,

  constraint ext_telemetria_sem_pessoal check (public.telemetria_sem_pessoal(contexto)),
  constraint ext_telemetria_instalacao_do_perfil
    foreign key (instalacao_id, perfil_id)
    references public.ext_instalacoes (id, perfil_id)
    on delete cascade
);

-- Serve a duas coisas: contar instalação distinta no gatilho de agregação e
-- apagar a telemetria de uma instalação em cascata.
create index ext_telemetria_distinta_idx
  on public.ext_telemetria (instalacao_id, alvo, seletor, versao, dia);
-- Faxina por retenção (`ext.telemetria_retencao_dias`).
create index ext_telemetria_faxina_idx on public.ext_telemetria (criado_em);

-- Append-only com a função pública de 0003, que deixa o DELETE passar — é o
-- que permite excluir a conta em cascata. Aqui o DELETE liberado também é
-- feature: telemetria crua tem prazo de validade e é podada por retenção; o
-- agregado é que fica.
create trigger ext_telemetria_append_only
  before update on public.ext_telemetria
  for each row execute function public.bloquear_escrita_append_only();

comment on table public.ext_telemetria is
  'Telemetria de DOM. Proibido gravar: comentário do chat, @usuário, id ou URL de sala e IP. O espectador não é usuário nosso e não consentiu com nada.';

-- -----------------------------------------------------------------------------
-- ext_telemetria_resumo — agregado por (alvo, seletor, versao, dia).
--
-- Não tem perfil_id, e isso é de propósito: aqui não há dado de ninguém, só
-- contagem. É o que permite o agregado sobreviver à exclusão de uma conta e à
-- poda da telemetria crua — a série histórica de quebras não pode depender de
-- manter dado pessoal por perto.
-- -----------------------------------------------------------------------------
create table public.ext_telemetria_resumo (
  alvo        text not null,
  seletor     text not null,
  versao      text not null,
  dia         date not null,

  ocorrencias bigint not null default 0,
  -- Instalações DISTINTAS que falharam neste ponto. É o numerador do alerta:
  -- uma máquina falhando 400 vezes é uma máquina com problema; 400 máquinas
  -- falhando uma vez é o TikTok tendo mudado o DOM.
  instalacoes integer not null default 0,

  primeira_em timestamptz not null default now(),
  ultima_em   timestamptz not null default now(),
  alertado_em timestamptz,

  primary key (alvo, seletor, versao, dia)
);

create index ext_telemetria_resumo_dia_idx
  on public.ext_telemetria_resumo (dia desc, instalacoes desc);

-- Agregar no gatilho, e não num job noturno, porque o momento em que este
-- número importa é o da quebra acontecendo. `count(distinct)` sobre a tabela
-- crua fica caro exatamente quando a telemetria explode — que é a hora em que
-- o painel precisa responder.
create or replace function public.agregar_telemetria_ext()
returns trigger
language plpgsql
as $$
declare
  v_nova_instalacao boolean;
begin
  v_nova_instalacao := not exists (
    select 1
      from public.ext_telemetria t
     where t.instalacao_id = new.instalacao_id
       and t.alvo    = new.alvo
       and t.seletor = new.seletor
       and t.versao  = new.versao
       and t.dia     = new.dia
       and t.id     <> new.id
  );

  insert into public.ext_telemetria_resumo as r
    (alvo, seletor, versao, dia, ocorrencias, instalacoes, primeira_em, ultima_em)
  values (new.alvo, new.seletor, new.versao, new.dia, new.ocorrencias,
          case when v_nova_instalacao then 1 else 0 end, new.criado_em, new.criado_em)
  on conflict (alvo, seletor, versao, dia) do update
     set ocorrencias = r.ocorrencias + excluded.ocorrencias,
         instalacoes = r.instalacoes + excluded.instalacoes,
         ultima_em   = greatest(r.ultima_em, excluded.ultima_em);

  return null;
end;
$$;

create trigger ext_telemetria_agregar
  after insert on public.ext_telemetria
  for each row execute function public.agregar_telemetria_ext();

-- -----------------------------------------------------------------------------
-- Resolução de versão: canal, canário determinístico e kill switch.
-- -----------------------------------------------------------------------------

-- Fatia estável da licença, 0–99. Determinístico: a mesma licença cai sempre no
-- mesmo balde, então subir o canário de 5% para 20% ACRESCENTA instalações em
-- vez de sortear um conjunto novo, e ninguém vê a extensão trocando de versão
-- a cada heartbeat.
create or replace function public.ext_bucket(p_licenca_id uuid)
returns smallint
language sql
immutable
as $$
  select (('x' || substr(md5(p_licenca_id::text), 1, 4))::bit(16)::int % 100)::smallint;
$$;

-- O que esta instalação deve estar rodando. `parar_agora` é sobre a versão que
-- ela JÁ tem: o kill switch precisa mandar parar mesmo quando ainda não existe
-- versão nova para onde ir.
create or replace function public.ext_versao_para(
  p_licenca_id   uuid,
  p_versao_atual text default null
)
returns table (
  versao      text,
  canal       public.canal_extensao,
  arquivo_id  uuid,
  obrigatoria boolean,
  notas       text,
  parar_agora boolean
)
language plpgsql
stable
as $$
declare
  v_canal   public.canal_extensao := 'estavel';
  v_bucket  smallint;
  v_escolha public.ext_versoes;
  v_parar   boolean;
begin
  select l.canal into v_canal
    from public.ext_licencas l
   where l.id = p_licenca_id;

  v_bucket := public.ext_bucket(p_licenca_id);

  v_parar := coalesce(
    (select v.kill_switch from public.ext_versoes v where v.versao = p_versao_atual),
    false
  );

  select v.* into v_escolha
    from public.ext_versoes v
   where v.publicada_em is not null
     and not v.kill_switch
     and (
       v.canal = 'estavel'
       or coalesce(v_canal, 'estavel') = 'canario'
       or v_bucket < v.percentual_canario
     )
   order by v.ordem desc
   limit 1;

  if not found then
    return;
  end if;

  return query
    select v_escolha.versao, v_escolha.canal, v_escolha.arquivo_id,
           v_escolha.obrigatoria, v_escolha.notas, v_parar;
end;
$$;

-- -----------------------------------------------------------------------------
-- Operações. Tudo que precisa de mais de um comando mora aqui, para a
-- semântica ser a mesma em qualquer chamador.
-- -----------------------------------------------------------------------------

-- Emite ou rotaciona a licença. O token cru nasce na aplicação
-- (`randomBytes(32)`) e não entra nesta função: o que chega é o hash.
create or replace function public.emitir_licenca_ext(
  p_perfil_id  uuid,
  p_token_hash bytea,
  p_token_dica text default null,
  p_plano_id   uuid default null,
  p_chat       boolean default false,
  p_recursos   jsonb default '{}'::jsonb,
  p_dias       integer default 7
)
returns public.ext_licencas
language plpgsql
as $$
declare
  v_linha public.ext_licencas;
begin
  insert into public.ext_licencas as l
    (perfil_id, token_hash, token_dica, plano_id, chat, recursos, expira_em)
  values (p_perfil_id, p_token_hash, p_token_dica, p_plano_id, p_chat, p_recursos,
          now() + make_interval(days => greatest(p_dias, 1)))
  on conflict (perfil_id) do update
     set token_hash      = excluded.token_hash,
         token_dica      = excluded.token_dica,
         plano_id        = excluded.plano_id,
         chat            = excluded.chat,
         recursos        = excluded.recursos,
         expira_em       = excluded.expira_em,
         rotacionada_em  = now(),
         revogada_em     = null,
         revogada_motivo = null
  returning * into v_linha;

  return v_linha;
end;
$$;

-- Empurra a janela de graça offline. Separado da emissão porque quem sabe se a
-- assinatura está em dia é a aplicação: a janela só anda quando ela diz que
-- anda, e licença revogada não renova nem por engano.
create or replace function public.renovar_licenca_ext(
  p_perfil_id uuid,
  p_dias      integer default 7
)
returns timestamptz
language sql
as $$
  update public.ext_licencas
     set expira_em = now() + make_interval(days => greatest(p_dias, 1))
   where perfil_id = p_perfil_id
     and revogada_em is null
  returning expira_em;
$$;

-- Heartbeat. Registra a máquina e carimba o contato — é o que dá denominador
-- ao alerta de quebra e o que mostra, no painel, quem está preso numa versão
-- velha por ter instalado em modo desenvolvedor.
create or replace function public.registrar_contato_ext(
  p_licenca_id       uuid,
  p_instalacao_chave text,
  p_versao           text,
  p_user_agent       text default null,
  p_sistema          text default null,
  p_navegador        text default null,
  p_mapa_versao      integer default null
)
returns public.ext_instalacoes
language plpgsql
as $$
declare
  v_perfil uuid;
  v_linha  public.ext_instalacoes;
begin
  select l.perfil_id into v_perfil
    from public.ext_licencas l
   where l.id = p_licenca_id
     and l.revogada_em is null;

  if not found then
    raise exception 'licença de extensão inválida ou revogada' using errcode = '28000';
  end if;

  insert into public.ext_instalacoes as i
    (licenca_id, perfil_id, instalacao_chave, versao, user_agent, sistema, navegador, mapa_versao)
  values (p_licenca_id, v_perfil, p_instalacao_chave, p_versao,
          p_user_agent, p_sistema, p_navegador, p_mapa_versao)
  on conflict (licenca_id, instalacao_chave) do update
     set versao         = excluded.versao,
         user_agent     = coalesce(excluded.user_agent, i.user_agent),
         sistema        = coalesce(excluded.sistema, i.sistema),
         navegador      = coalesce(excluded.navegador, i.navegador),
         mapa_versao    = coalesce(excluded.mapa_versao, i.mapa_versao),
         ultimo_contato = now()
  returning * into v_linha;

  return v_linha;
end;
$$;

-- Publica um mapa novo e aposenta o anterior no MESMO commit: nunca existe
-- instante com dois mapas ativos nem com nenhum. É a operação do dia da
-- quebra, e nesse dia ninguém vai lembrar de desativar o antigo à mão.
create or replace function public.publicar_mapa_seletores(
  p_mapa  jsonb,
  p_alvo  text default 'tiktok_live_studio',
  p_notas text default null,
  p_por   uuid default null
)
returns public.seletores_mapas
language plpgsql
as $$
declare
  v_linha public.seletores_mapas;
begin
  update public.seletores_mapas
     set ativo = false
   where alvo = p_alvo and ativo;

  insert into public.seletores_mapas
    (alvo, versao, mapa, notas, ativo, publicado_em, publicado_por)
  values (
    p_alvo,
    coalesce((select max(m.versao) from public.seletores_mapas m where m.alvo = p_alvo), 0) + 1,
    p_mapa, p_notas, true, now(), p_por
  )
  returning * into v_linha;

  return v_linha;
end;
$$;

-- Devolve o mapa só quando ele mudou. A extensão manda a versão que tem; se
-- for a mesma, não vem nada — o heartbeat é de minuto em minuto, e trafegar o
-- JSON inteiro toda vez é banda paga por nós, à toa.
create or replace function public.seletores_ativos(
  p_alvo             text default 'tiktok_live_studio',
  p_versao_conhecida integer default null
)
returns table (versao integer, mapa jsonb)
language sql
stable
as $$
  select m.versao, m.mapa
    from public.seletores_mapas m
   where m.alvo = p_alvo
     and m.ativo
     and (p_versao_conhecida is null or m.versao > p_versao_conhecida);
$$;

-- O alerta: pontos em que uma fatia relevante das instalações VIVAS naquela
-- versão falhou no mesmo dia. Percentual, e não contagem absoluta, porque 30
-- falhas é rotina com 3.000 instalações e é incêndio com 40.
-- `current_date` NÃO serve de padrão aqui: o banco roda em UTC e `dia` é
-- carimbado em Brasília, então entre 21h e a meia-noite o padrão apontaria
-- para um dia que ainda não começou e o painel mostraria tudo em ordem no
-- horário de maior live do país.
create or replace function public.ext_quebras(
  p_dia    date default (now() at time zone 'America/Sao_Paulo')::date,
  p_minimo numeric default 5
)
returns table (
  alvo        text,
  seletor     text,
  versao      text,
  afetadas    integer,
  vivas       bigint,
  percentual  numeric,
  ocorrencias bigint,
  alertado_em timestamptz
)
language sql
stable
as $$
  with vivas as (
    select i.versao, count(*)::bigint total
      from public.ext_instalacoes i
     where i.ultimo_contato >= now() - interval '24 hours'
     group by i.versao
  )
  select r.alvo, r.seletor, r.versao, r.instalacoes,
         coalesce(v.total, 0),
         round(r.instalacoes * 100.0 / greatest(coalesce(v.total, 0), 1), 1),
         r.ocorrencias,
         r.alertado_em
    from public.ext_telemetria_resumo r
    left join vivas v on v.versao = r.versao
   where r.dia = p_dia
     and r.instalacoes * 100.0 >= p_minimo * greatest(coalesce(v.total, 0), 1)
   order by r.instalacoes desc, r.ocorrencias desc;
$$;

-- -----------------------------------------------------------------------------
-- Semente — o contrato do mapa, em forma de mapa.
--
-- Âncoras em `data-e2e`, aria-label, papel e texto: são os atributos que o
-- TikTok mantém entre builds porque o teste automatizado deles também depende.
-- As chaves são o vocabulário que a extensão pede pelo nome, e é por elas que
-- a telemetria vai reclamar.
-- -----------------------------------------------------------------------------
insert into public.seletores_mapas (alvo, versao, mapa, notas, ativo, publicado_em)
values (
  'tiktok_live_studio',
  1,
  '{
    "estudio.raiz":              ["css=[data-e2e=\"live-studio\"]", "papel=main", "css=#root main"],
    "estudio.botao_iniciar":     ["css=[data-e2e=\"live-start-button\"]", "texto=Iniciar transmissão", "texto=Go LIVE"],
    "estudio.botao_parar":       ["css=[data-e2e=\"live-stop-button\"]", "texto=Encerrar transmissão", "texto=End LIVE"],
    "estudio.indicador_ao_vivo": ["css=[data-e2e=\"live-status\"]", "aria=Ao vivo", "aria=LIVE"],
    "audio.seletor_entrada":     ["css=[data-e2e=\"audio-source-select\"]", "aria=Fonte de áudio", "texto=Microfone"],
    "chat.lista":                ["css=[data-e2e=\"chat-list\"]", "papel=log", "aria=Comentários"],
    "chat.item":                 ["css=[data-e2e=\"chat-item\"]", "css=[data-e2e=\"chat-list\"] > div > div"],
    "chat.item_autor":           ["css=[data-e2e=\"chat-nickname\"]", "css=[data-e2e=\"chat-item\"] a"],
    "chat.item_texto":           ["css=[data-e2e=\"chat-text\"]", "css=[data-e2e=\"chat-item\"] span:last-child"],
    "chat.campo":                ["css=[data-e2e=\"chat-input\"]", "aria=Enviar um comentário", "papel=textbox"],
    "chat.enviar":               ["css=[data-e2e=\"chat-send\"]", "aria=Enviar", "texto=Enviar"],
    "espectadores.contador":     ["css=[data-e2e=\"live-viewer-count\"]", "aria=Espectadores"]
  }'::jsonb,
  'Mapa inicial da fase 5. Sem classe hasheada de propósito: o CHECK recusa, e ela quebraria no próximo build do TikTok.',
  true,
  now()
)
on conflict (alvo, versao) do nothing;

-- -----------------------------------------------------------------------------
-- Configuração — o que se ajusta sem deploy no dia do incêndio.
-- -----------------------------------------------------------------------------
insert into public.configuracoes (chave, valor, descricao) values
  ('ext.chat_desligado', 'false',
   'Mata a automação de chat na base inteira sem tocar no mixer (PLANO.md §6). É o freio para o dia em que o TikTok apertar contra automação.'),
  ('ext.canario_percentual', '5',
   'Fatia padrão do canário ao publicar versão nova.'),
  ('ext.heartbeat_segundos', '120',
   'Intervalo do contato da extensão. Define o atraso máximo entre publicar um mapa novo e a base voltar a funcionar.'),
  ('ext.quebra_percentual_alerta', '5',
   'A partir de que percentual das instalações vivas numa versão uma falha de seletor vira alerta.'),
  ('ext.telemetria_retencao_dias', '30',
   'Prazo da telemetria crua. Passado isso fica só o agregado, que não identifica ninguém.'),
  ('ext.licenca_graca_dias', '7',
   'Janela em que a extensão segue funcionando sem falar com a nossa API. Indisponibilidade nossa não pode derrubar a live do cliente.')
on conflict (chave) do nothing;
