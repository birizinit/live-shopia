-- =============================================================================
-- Shopia — conteúdo e onboarding (fase 7)
--
-- Aulas em vídeo, clonagem de voz e o TOUR GUIADO da primeira sessão.
--
-- Três coisas aqui não são detalhe de tela:
--
-- 1. O tour vive na CONTA, não no navegador. O concorrente guarda a flag em
--    `localStorage` (docs/referencia-livefox.md §3) e o resultado é o tour
--    reaparecendo do zero em cada aparelho, para quem já entendeu tudo — e
--    sumindo de vez quando o usuário limpa o cache, inclusive o passo do
--    aviso de risco. Estado de onboarding é dado de usuário: tem perfil_id,
--    tem linha, e segue a conta quando ela abre no celular.
-- 2. O passo do risco de automação termina em ACEITE REGISTRADO, gravado em
--    `live_config.risco_aceito_em/risco_aceito_versao` (0004). A versão vem de
--    `live.risco_aceito_versao` (0003): quando o texto do aviso mudar, o aceite
--    antigo deixa de valer sozinho, sem migração.
-- 3. Clonar voz sem consentimento registrado é problema jurídico, não pendência
--    de produto. A amostra guarda o TEXTO que estava na tela, a hora e o IP, e
--    esses três campos não se reescrevem depois.
-- =============================================================================

create type public.estado_amostra as enum (
  'enviada',
  'processando',
  'clonada',
  'recusada'
);

-- -----------------------------------------------------------------------------
-- aulas_modulos e aulas — treinamento em vídeo, servido por embed do YouTube.
--
-- Hospedar vídeo é caro e é problema de outra empresa. O que precisa morar aqui
-- é a ordem, o que cada aula exige e quem já assistiu.
-- -----------------------------------------------------------------------------
create table public.aulas_modulos (
  id        uuid primary key default gen_random_uuid(),
  slug      text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  titulo    text not null,
  descricao text,
  ordem     smallint not null default 0,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create index aulas_modulos_ordem_idx on public.aulas_modulos (ativo, ordem);

create table public.aulas (
  id            uuid primary key default gen_random_uuid(),
  modulo_id     uuid not null references public.aulas_modulos (id) on delete cascade,

  slug          text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  titulo        text not null,
  descricao     text,

  -- Só o id de 11 caracteres. Guardar a URL inteira deixa entrar link de
  -- `watch?v=...&t=90` e de encurtador, que o iframe de embed não aceita — a
  -- aula fica preta e ninguém descobre por quê.
  video_youtube text not null check (video_youtube ~ '^[A-Za-z0-9_-]{11}$'),
  duracao_s     integer check (duracao_s is null or duracao_s > 0),

  ordem         smallint not null default 0,

  -- Plano mínimo. Nulo = aula aberta, inclusive para quem ainda não assinou:
  -- é a aula aberta que vende o plano.
  exige_plano   text references public.planos (slug) on delete set null (exige_plano),

  ativa         boolean not null default true,
  criado_em     timestamptz not null default now()
);

create index aulas_modulo_idx on public.aulas (modulo_id, ordem) where ativa;

comment on column public.aulas.duracao_s is
  'Duração do vídeo em segundos, copiada do YouTube. Base do corte de conclusão em aulas_progresso.';

-- A escada de planos é `planos.ordem`, a única coluna que já ordena o catálogo
-- do mais simples ao mais completo. Comparar por preço quebraria na primeira
-- promoção, e comparar por slug exigiria uma regra nova a cada plano novo.
create or replace function public.aula_liberada(p_aula_id uuid, p_perfil_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from public.aulas a
      left join public.planos exigido on exigido.slug = a.exige_plano
     where a.id = p_aula_id
       and a.ativa
       and (
         a.exige_plano is null
         or exists (
           select 1
             from public.assinaturas s
             join public.planos p on p.id = s.plano_id
            where s.perfil_id = p_perfil_id
              and s.status = 'ativa'
              and p.ordem >= exigido.ordem
         )
       )
  );
$$;

-- -----------------------------------------------------------------------------
-- aulas_progresso — uma linha por (perfil, aula).
-- -----------------------------------------------------------------------------
create table public.aulas_progresso (
  perfil_id       uuid not null references public.perfis (id) on delete cascade,
  aula_id         uuid not null references public.aulas (id) on delete cascade,

  segundos_vistos integer not null default 0 check (segundos_vistos >= 0),
  concluida_em    timestamptz,

  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),

  primary key (perfil_id, aula_id)
);

-- Só o recorte de quem terminou: é o que o dono do produto pergunta ("quantos
-- assistiram a aula da extensão?"), e o índice parcial não paga pelo resto.
create index aulas_progresso_concluidas_idx on public.aulas_progresso (aula_id)
  where concluida_em is not null;

create trigger aulas_progresso_atualizado_em
  before update on public.aulas_progresso
  for each row execute function public.tocar_atualizado_em();

-- Progresso nunca anda para trás: o player manda a posição atual, e voltar o
-- vídeo para rever um trecho não pode desmarcar o que já foi assistido.
--
-- 90% conta como concluída. Exigir o segundo final deixa aula eternamente
-- "não concluída", porque ninguém espera os créditos do vídeo terminarem.
create or replace function public.registrar_progresso_aula(
  p_perfil_id uuid,
  p_aula_id   uuid,
  p_segundos  integer
)
returns public.aulas_progresso
language plpgsql
as $$
declare
  v_duracao  integer;
  v_segundos integer := greatest(coalesce(p_segundos, 0), 0);
  v_linha    public.aulas_progresso;
begin
  select a.duracao_s into v_duracao from public.aulas a where a.id = p_aula_id;
  if not found then
    raise exception 'aula % não existe', p_aula_id using errcode = '23503';
  end if;

  insert into public.aulas_progresso (perfil_id, aula_id, segundos_vistos, concluida_em)
  values (
    p_perfil_id,
    p_aula_id,
    v_segundos,
    case when v_duracao is not null and v_segundos >= v_duracao * 0.9 then now() end
  )
  on conflict (perfil_id, aula_id) do update
     set segundos_vistos = greatest(public.aulas_progresso.segundos_vistos, excluded.segundos_vistos),
         concluida_em    = coalesce(public.aulas_progresso.concluida_em, excluded.concluida_em)
  returning * into v_linha;

  return v_linha;
end;
$$;

-- -----------------------------------------------------------------------------
-- vozes_amostras — o áudio que o usuário envia para clonar a própria voz.
--
-- Tabela separada de `vozes` (0004) porque a voz nasce depois, pode falhar e
-- pode ser apagada — e o consentimento tem que sobreviver às três coisas. É
-- esta linha, não a voz, que responde "quem autorizou, quando, de onde".
-- -----------------------------------------------------------------------------
create table public.vozes_amostras (
  id                  uuid primary key default gen_random_uuid(),
  perfil_id           uuid not null references public.perfis (id) on delete cascade,

  -- A voz gerada a partir desta amostra, quando a clonagem termina.
  voz_id              uuid references public.vozes (id) on delete set null (voz_id),
  arquivo_id          uuid references public.arquivos (id) on delete set null (arquivo_id),
  job_id              uuid references public.jobs (id) on delete set null (job_id),

  nome                text not null check (length(btrim(nome)) between 2 and 60),
  -- 'rapido' é amostra curta com resultado imediato; 'treino' manda mais áudio
  -- e demora, com fidelidade maior (docs/referencia-livefox.md §6).
  modo                text not null default 'rapido' check (modo in ('rapido', 'treino')),

  duracao_ms          integer check (duracao_ms is null or duracao_ms > 0),
  estado              public.estado_amostra not null default 'enviada',
  erro                text,

  -- O texto EXATO que estava na tela quando o usuário aceitou, e não uma chave
  -- apontando para a versão de hoje. O aviso vai ser reescrito; a prova não.
  consentimento_texto text,
  consentimento_em    timestamptz,
  ip_consentimento    inet,

  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),

  -- Sem consentimento a amostra não sai daqui. Clonar a voz de alguém sem
  -- autorização registrada é problema jurídico, não detalhe de produto — é a
  -- mesma regra que `vozes_clonada_com_consentimento` já aplica em 0004.
  constraint vozes_amostras_consentimento_registrado check (
    estado not in ('processando', 'clonada')
    or (consentimento_em is not null and length(btrim(coalesce(consentimento_texto, ''))) > 0)
  ),
  constraint vozes_amostras_recusa_explicada check (estado <> 'recusada' or erro is not null)
);

create index vozes_amostras_perfil_idx on public.vozes_amostras (perfil_id, criado_em desc);
create index vozes_amostras_abertas_idx on public.vozes_amostras (criado_em)
  where estado in ('enviada', 'processando');

create trigger vozes_amostras_atualizado_em
  before update on public.vozes_amostras
  for each row execute function public.tocar_atualizado_em();

comment on column public.vozes_amostras.ip_consentimento is
  'De onde veio o aceite. Sem origem, a prova vale menos numa disputa.';

-- Consentimento não se corrige: amostra com autorização errada se RECUSA e se
-- pede outra. Só UPDATE é bloqueado — DELETE segue livre, para a exclusão da
-- conta em cascata não travar (mesma saída de bloquear_escrita_append_only).
create or replace function public.congelar_consentimento_amostra()
returns trigger
language plpgsql
as $$
begin
  if old.consentimento_em is not null
     and (new.consentimento_em    is distinct from old.consentimento_em
       or new.consentimento_texto is distinct from old.consentimento_texto
       or new.ip_consentimento    is distinct from old.ip_consentimento) then
    raise exception 'o consentimento da amostra % não se reescreve: recuse e peça outra', old.id;
  end if;
  return new;
end;
$$;

create trigger vozes_amostras_consentimento_congelado
  before update on public.vozes_amostras
  for each row execute function public.congelar_consentimento_amostra();

-- -----------------------------------------------------------------------------
-- onboarding_passos — o catálogo do TOUR.
--
-- Texto no banco, e não dentro do componente: o dono do produto reescreve o
-- aviso de risco sem deploy, e a versão aceita continua rastreável.
-- -----------------------------------------------------------------------------
create table public.onboarding_passos (
  chave        text primary key check (chave ~ '^[a-z0-9-]{3,40}$'),
  titulo       text not null,
  corpo        text not null,

  -- Rota interna para onde o passo leva. Caminho relativo, nunca URL absoluta:
  -- um passo de tour que navega sozinho para fora do app é redirecionamento
  -- aberto servido pelo banco.
  rota_alvo    text check (rota_alvo is null or rota_alvo ~ '^/[a-z0-9/_-]*$'),

  ordem        smallint not null default 0,

  -- Trava o uso até ser respondido. Ver a semente: só um passo é.
  obrigatorio  boolean not null default false,

  -- O passo termina num aceite registrado, não num "próximo".
  exige_aceite boolean not null default false,

  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);

create index onboarding_passos_ordem_idx on public.onboarding_passos (ordem) where ativo;

-- -----------------------------------------------------------------------------
-- onboarding_progresso — o que ESTA CONTA já viu.
--
-- Sem coluna nova em `perfis`: um passo a mais no tour viraria um ALTER TABLE
-- na tabela mais quente do sistema, e "viu o passo 4" não é atributo de conta,
-- é linha de fato. E é isto que faz o tour continuar de onde parou quando o
-- usuário abre no celular, em vez de recomeçar por aparelho.
-- -----------------------------------------------------------------------------
create table public.onboarding_progresso (
  perfil_id   uuid not null references public.perfis (id) on delete cascade,
  passo_chave text not null references public.onboarding_passos (chave) on delete cascade,
  visto_em    timestamptz not null default now(),

  primary key (perfil_id, passo_chave)
);

-- Rever o tour não reescreve a data: o primeiro `visto_em` é o que responde
-- "quando esta conta foi avisada".
create or replace function public.marcar_passo_visto(p_perfil_id uuid, p_passo text)
returns void
language sql
as $$
  insert into public.onboarding_progresso (perfil_id, passo_chave)
  select p_perfil_id, p.chave
    from public.onboarding_passos p
   where p.chave = p_passo
  on conflict do nothing;
$$;

create or replace function public.tour_pendente(p_perfil_id uuid)
returns setof public.onboarding_passos
language sql
stable
as $$
  select p.*
    from public.onboarding_passos p
   where p.ativo
     and not exists (
       select 1 from public.onboarding_progresso g
        where g.perfil_id = p_perfil_id and g.passo_chave = p.chave
     )
   order by p.ordem, p.chave;
$$;

-- -----------------------------------------------------------------------------
-- aceitar_risco_automacao — é aqui que o passo 5 do tour termina.
--
-- Grava em `live_config` (0004), que é onde a extensão e a sala de live já
-- olham antes de ligar: aceite que mora só no tour não impede nada.
--
-- A versão vem de `live.risco_aceito_versao` (0003). Subir essa configuração
-- reabre o passo para todo mundo — é assim que um aviso reescrito volta a ser
-- aceito, em vez de valer calado sobre o texto que ninguém leu.
--
-- Reaceitar a MESMA versão não mexe na data: a primeira é a que vale numa
-- disputa, e reabrir a tela do tour não pode empurrar essa data para a frente.
-- -----------------------------------------------------------------------------
create or replace function public.aceitar_risco_automacao(
  p_perfil_id  uuid,
  p_ip         inet default null,
  p_user_agent text default null
)
returns smallint
language plpgsql
as $$
declare
  v_versao smallint := public.config_num('live.risco_aceito_versao', 1)::smallint;
  v_antes  smallint;
begin
  select lc.risco_aceito_versao into v_antes
    from public.live_config lc
   where lc.perfil_id = p_perfil_id;

  insert into public.live_config (perfil_id, risco_aceito_em, risco_aceito_versao)
  values (p_perfil_id, now(), v_versao)
  on conflict (perfil_id) do update
     set risco_aceito_em     = now(),
         risco_aceito_versao = v_versao
   where public.live_config.risco_aceito_versao is distinct from v_versao;

  perform public.marcar_passo_visto(p_perfil_id, 'risco-automacao');

  -- Trilha imutável do aceite: é o que responde a uma reclamação de bloqueio
  -- de conta seis meses depois. Só quando a versão muda, para não virar ruído
  -- a cada vez que a tela do tour é reaberta.
  if v_antes is distinct from v_versao then
    insert into public.auditoria
      (perfil_id, ator_id, acao, entidade, entidade_id, antes, depois, ip, user_agent)
    values (
      p_perfil_id, p_perfil_id, 'aceitar_risco_automacao', 'live_config', p_perfil_id::text,
      jsonb_build_object('versao', v_antes),
      jsonb_build_object('versao', v_versao),
      p_ip, p_user_agent
    );
  end if;

  return v_versao;
end;
$$;

-- -----------------------------------------------------------------------------
-- dicas_vistas — as dicas de primeira visita das telas do estúdio.
--
-- Sem catálogo, de propósito: a dica mora no componente que a mostra, junto do
-- que ela explica. Exigir uma linha de catálogo transformaria cada dica nova
-- numa migração, e aí a dica simplesmente deixa de ser escrita.
-- -----------------------------------------------------------------------------
create table public.dicas_vistas (
  perfil_id uuid not null references public.perfis (id) on delete cascade,
  chave     text not null check (chave ~ '^[a-z0-9_.-]{3,60}$'),
  visto_em  timestamptz not null default now(),

  primary key (perfil_id, chave)
);

create or replace function public.marcar_dica_vista(p_perfil_id uuid, p_chave text)
returns void
language sql
as $$
  insert into public.dicas_vistas (perfil_id, chave)
  values (p_perfil_id, p_chave)
  on conflict do nothing;
$$;

-- =============================================================================
-- Semente do tour.
--
-- Texto de verdade, escrito para ser lido. Tour que só diz "clique aqui" ensina
-- a apertar botão; o que este produto precisa ensinar é POR QUE a ferramenta
-- funciona assim — quem entende que o loop é de graça para de regerar áudio
-- pronto, e é essa conta que decide se o plano dura o mês.
--
-- Só o aviso de risco é obrigatório. Tour inteiro obrigatório vira clique cego
-- no "próximo", e aí o que deveria ser aceite informado vira formalidade sem
-- valor nenhum — justamente no passo em que o valor é jurídico.
-- =============================================================================
insert into public.onboarding_passos
  (chave, titulo, corpo, rota_alvo, ordem, obrigatorio, exige_aceite)
values
  (
    'boas-vindas',
    'O que a Shopia faz',
    'A Shopia é uma apresentadora de IA para o TikTok Shop. Ela narra o seu roteiro de vendas com voz realista, sem parar, e responde os comentários do chat enquanto a live está no ar. Você não precisa aparecer, não precisa falar e não precisa ficar acordado. O que vende numa live é roteiro bom e constância — e constância é justamente o que uma pessoa sozinha não consegue manter: a Shopia narra às três da manhã com a mesma energia das duas da tarde.',
    '/inicio',
    10, false, false
  ),
  (
    'caminho',
    'O caminho: produto → roteiro → voz → áudio → extensão → live',
    'São seis etapas, sempre nessa ordem. Você cadastra o PRODUTO (preço, benefícios, objeções de quem não compra); a IA escreve o ROTEIRO de vendas em cima desses dados; você escolhe a VOZ, do catálogo ou clonada; a gente gera o ÁUDIO; a EXTENSÃO do Chrome entrega esse áudio ao LIVE Studio como se fosse o seu microfone; e a LIVE entra no ar. Cada etapa se apoia na anterior, e é por isso que vale gastar tempo na primeira: sem produto bem descrito o roteiro sai genérico, e nenhuma voz do mundo salva um roteiro genérico.',
    '/produtos',
    20, false, false
  ),
  (
    'loop-gratis',
    'Por que o loop é de graça',
    'O áudio é gerado UMA vez e repete por horas sem custar crédito de novo. Três horas de live consomem o mesmo que os poucos minutos que a geração levou — depois disso o loop roda a noite inteira sem debitar mais nada. É este desenho que faz o seu plano durar o mês inteiro, e não a quantidade de horas que você fica no ar. O único jeito de queimar crédito à toa é mandar gerar de novo o que já está pronto: refazer o áudio para trocar uma palavra, gerar três versões para escolher uma, reescrever o roteiro por capricho. Gerou, ficou bom, deixa rodando.',
    '/audio',
    30, false, false
  ),
  (
    'creditos',
    'Crédito é caractere, não é minuto',
    'O provedor de voz cobra por CARACTERE de texto, então é assim que o crédito é medido aqui — sem conversão escondida no meio do caminho. Cerca de 600 caracteres viram 1 minuto de fala, o que dá aproximadamente 108 mil caracteres para três horas de live. O débito acontece ANTES da geração, e você vê a estimativa antes de confirmar: quantos caracteres, quanto tempo de áudio e quanto sobra depois. Se a geração falhar, o crédito volta por estorno. Se o saldo não der, a operação nem começa — ninguém fica devendo e ninguém paga por um áudio que não existe.',
    '/creditos',
    40, false, false
  ),
  (
    'risco-automacao',
    'O aviso que a gente precisa dar antes de você ligar a extensão',
    'Isto precisa ficar claro agora, e não depois: automatizar o LIVE Studio — injetar áudio e deixar o chat sendo respondido sozinho — tende a violar os Termos de Serviço do TikTok. Não existe modo oficial de fazer isso, e nenhum fornecedor honesto promete o contrário. O risco de restrição ou bloqueio recai sobre a SUA conta do TikTok, não sobre a Shopia. A gente reduz o que dá para reduzir: a resposta ao chat sai com intervalo variável e teto por minuto, para não ter cara de robô, e o áudio e a automação de chat são módulos separados, então dá para usar só o áudio. Reduzir não é eliminar. Quem decide correr esse risco é você, e é por isso que o seu aceite fica registrado com data e com a versão deste texto.',
    '/extensao',
    50, true, true
  ),
  (
    'ajuda',
    'Onde pedir ajuda e como retomar este tour',
    'As Aulas trazem o passo a passo em vídeo de tudo que acabamos de falar, inclusive a instalação da extensão, que é onde mais gente trava. Se travar mesmo assim, o suporte fica no Perfil. E este tour não é de uma vez só: ele fica salvo na sua CONTA, não no navegador. Você pode sair no meio e voltar amanhã, e se abrir de outro computador ou do celular ele continua do ponto onde parou, em vez de recomeçar do zero.',
    '/aulas',
    60, false, false
  )
on conflict (chave) do nothing;

-- =============================================================================
-- Semente dos módulos de aula.
--
-- Só os módulos. As aulas entram quando os vídeos existirem de fato: id de
-- YouTube inventado aqui vira embed preto em produção — e, como o CHECK só
-- valida o formato de 11 caracteres, um placeholder passaria por vídeo de
-- verdade até alguém clicar.
-- =============================================================================
insert into public.aulas_modulos (slug, titulo, descricao, ordem)
values
  ('primeiros-passos', 'Primeiros passos',
   'Da criação da conta até a primeira live no ar, sem pular etapa.', 10),
  ('roteiro-e-voz', 'Roteiro e voz',
   'Descrever o produto para a IA acertar o roteiro, e escolher a voz que combina com ele.', 20),
  ('extensao-e-live', 'Extensão e LIVE Studio',
   'Instalar a extensão, ligar o áudio no LIVE Studio e o que fazer quando o TikTok muda a tela.', 30),
  ('vender-na-live', 'Vender na live',
   'Oferta, prova e objeção: o que muda no faturamento quando o roteiro é reescrito.', 40),
  ('indique-e-ganhe', 'Indique e ganhe',
   'Como funciona a indicação em três níveis e quando a comissão fica disponível para saque.', 50)
on conflict (slug) do nothing;
