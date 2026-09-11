-- =============================================================================
-- Shopia — monetizacao (fase 3)
--
-- Cobranca agnostica de gateway. O banco nao sabe se e Asaas, Mercado Pago ou
-- Pagar.me — a escolha ainda esta em aberto (PLANO.md §9.1) — entao guarda
-- `gateway` e `gateway_id` como texto e aceita o que o adaptador traduzir.
--
-- Tres decisoes sustentam o resto:
--
-- 1. O webhook NAO faz o trabalho. Confirmou pagamento, o gatilho marca a
--    cobranca como paga e ENFILEIRA; creditar e apurar comissao acontecem no
--    worker. Apuracao em tres niveis pega lock em varias linhas, e dentro da
--    transacao do webhook isso e timeout — e gateway que toma timeout reenvia
--    a notificacao, o que multiplica exatamente o problema que a causou.
--
-- 2. Idempotencia vem de FORA: (gateway, evento_id_externo). Toda notificacao
--    chega mais de uma vez, por retentativa do gateway ou por reenvio manual
--    do painel. Chave gerada aqui dentro seria nova a cada chegada e nao
--    protegeria de nada.
--
-- 3. Credito comprado entra na razao que ja existe (creditos_lancamentos), com
--    referencia derivada do pagamento. Nao existe segundo lugar onde saldo
--    muda.
--
-- Sem GATEWAY_NOME/GATEWAY_TOKEN nada disto roda — e nada e simulado. PIX
-- falso e fraude, nao demonstracao (src/lib/env.ts).
-- =============================================================================

create type public.tipo_pagamento as enum ('assinatura', 'creditos');

create type public.meio_pagamento as enum ('pix', 'cartao', 'boleto');

-- 'estornado' e o estado terminal depois de 'pago'; 'cancelado' e a cobranca
-- que venceu ou que o comprador abandonou antes de pagar.
create type public.status_pagamento as enum (
  'pendente',
  'pago',
  'falhou',
  'estornado',
  'cancelado'
);

-- -----------------------------------------------------------------------------
-- creditos_pacotes — compra avulsa, sem trocar de plano.
--
-- `caracteres` e NOT NULL aqui, ao contrario de `planos.creditos_mes`, que
-- continua nulo de proposito: no avulso a quantidade E o produto — vender
-- "10.000 creditos" sem saber quantos sao nao existe. No plano, o teto mensal
-- ainda e a pendencia §9.4 do PLANO.md, e chutar la vira cobranca errada.
--
-- Pacote vendido nao se apaga, se desativa (`ativo = false`): a linha e
-- referenciada por pagamentos antigos, e apagar reescreveria historico.
-- -----------------------------------------------------------------------------
create table public.creditos_pacotes (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  nome           text not null,

  -- Em CARACTERES, a mesma unidade da razao de creditos e da ElevenLabs.
  caracteres     bigint not null check (caracteres > 0),
  preco_centavos integer not null check (preco_centavos > 0),

  ativo          boolean not null default true,
  ordem          smallint not null default 0,
  criado_em      timestamptz not null default now()
);

create index creditos_pacotes_vitrine_idx on public.creditos_pacotes (ativo, ordem);

comment on column public.creditos_pacotes.caracteres is
  'A duracao exibida na vitrine sai daqui (600 chars/min), nunca de texto fixo que envelhece.';

-- Os quatro do levantamento (docs/referencia-livefox.md §8), em centavos de
-- real. Nenhum tier novo e inventado aqui.
insert into public.creditos_pacotes (slug, nome, caracteres, preco_centavos, ordem) values
  ('avulso-1k',  'Avulso',         1000,   300, 10),
  ('pacote-10k', 'Pacote 10 mil', 10000,  3000, 20),
  ('pacote-20k', 'Pacote 20 mil', 20000,  5000, 30),
  ('pacote-40k', 'Pacote 40 mil', 40000, 10000, 40)
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- pagamentos — uma cobranca, de assinatura ou de creditos.
-- -----------------------------------------------------------------------------
create table public.pagamentos (
  id             uuid primary key default gen_random_uuid(),
  perfil_id      uuid not null references public.perfis (id) on delete cascade,

  tipo           public.tipo_pagamento not null,
  -- Um alvo, nunca os dois. Sem `on delete`: catalogo vendido nao some.
  plano_id       uuid references public.planos (id),
  pacote_id      uuid references public.creditos_pacotes (id),

  valor_centavos integer not null check (valor_centavos > 0),

  -- Fotografia do que foi vendido. Creditar lendo `creditos_pacotes` na hora
  -- daria a quantidade DE HOJE: baixar o pacote de 10.000 para 8.000 amanha
  -- mudaria retroativamente o que o cliente comprou hoje.
  caracteres     bigint check (caracteres is null or caracteres > 0),

  -- Nulo ate o comprador escolher: checkout hospedado do gateway so informa o
  -- meio na notificacao.
  meio           public.meio_pagamento,
  status         public.status_pagamento not null default 'pendente',

  gateway        text,
  gateway_id     text,

  -- QR de PIX vence. Sem isto a tela mostra "aguardando pagamento" para
  -- sempre, e a cobranca morta nunca sai da lista.
  expira_em      timestamptz,
  pago_em        timestamptz,
  metadados      jsonb not null default '{}'::jsonb,

  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  constraint pagamentos_alvo_coerente check (
    (tipo = 'assinatura' and plano_id is not null and pacote_id is null)
    or (tipo = 'creditos' and pacote_id is not null and plano_id is null)
  ),
  constraint pagamentos_compra_tem_caracteres check (
    (tipo = 'creditos') = (caracteres is not null)
  ),
  -- Estornado continua tendo data de pagamento: o dinheiro entrou antes de
  -- voltar, e e essa data que a conciliacao procura.
  constraint pagamentos_pago_datado check (
    (status in ('pago', 'estornado')) = (pago_em is not null)
  )
);

create index pagamentos_perfil_idx on public.pagamentos (perfil_id, criado_em desc);
create index pagamentos_status_idx on public.pagamentos (status, criado_em desc);
create index pagamentos_vencendo_idx on public.pagamentos (expira_em)
  where status = 'pendente' and expira_em is not null;

-- Parcial porque a cobranca nasce antes de existir no gateway: entre o insert
-- e a resposta da API o par e (null, null), e um unico total recusaria a
-- segunda cobranca em aberto de qualquer usuario.
create unique index pagamentos_gateway_idx
  on public.pagamentos (gateway, gateway_id)
  where gateway_id is not null;

create trigger pagamentos_atualizado_em
  before update on public.pagamentos
  for each row execute function public.tocar_atualizado_em();

comment on column public.pagamentos.caracteres is
  'So em tipo = creditos. Quantidade congelada na venda; o catalogo pode mudar depois.';
comment on column public.pagamentos.gateway_id is
  'Id da cobranca NO gateway. Com `gateway`, e o que amarra a notificacao a esta linha.';

-- -----------------------------------------------------------------------------
-- pagamento_eventos — APPEND-ONLY, uma linha por notificacao recebida.
--
-- E a trava contra creditar duas vezes: o adaptador insere com
-- `on conflict (gateway, evento_id_externo) do nothing`, e nada inserido
-- significa nada disparado. A repeticao morre no indice unico, nao numa
-- checagem da aplicacao que corre contra si mesma quando duas entregas do
-- gateway chegam ao mesmo tempo.
--
-- Guarda o payload cru porque, numa disputa, o que vale e o que o gateway
-- mandou — nao o que o nosso parser entendeu.
-- -----------------------------------------------------------------------------
create table public.pagamento_eventos (
  id                bigint generated always as identity primary key,

  gateway           text not null,
  -- Id da NOTIFICACAO no gateway. A idempotencia vem daqui.
  evento_id_externo text not null,
  -- Id da COBRANCA no gateway, para achar o pagamento sem o adaptador precisar
  -- de uma consulta a parte antes do insert.
  gateway_id        text,

  pagamento_id      uuid references public.pagamentos (id) on delete cascade,
  perfil_id         uuid references public.perfis (id) on delete cascade,

  -- Nome cru do evento no gateway: 'PAYMENT_RECEIVED', 'payment.updated'...
  tipo_evento       text not null,
  -- Traducao feita pelo adaptador. Nulo = evento informativo que nao muda
  -- estado (QR gerado, boleto visualizado).
  status_informado  public.status_pagamento,
  meio              public.meio_pagamento,
  -- O que o gateway diz ter recebido. Guardado, nao comparado — PENDENTE 5.
  valor_centavos    integer check (valor_centavos is null or valor_centavos >= 0),

  payload           jsonb not null default '{}'::jsonb,
  recebido_em       timestamptz not null default now(),

  unique (gateway, evento_id_externo)
);

create index pagamento_eventos_pagamento_idx
  on public.pagamento_eventos (pagamento_id, recebido_em desc)
  where pagamento_id is not null;

-- Notificacao de cobranca que nao e nossa, ou que chegou antes de a cobranca
-- existir, fica orfa de proposito: e evidencia, e nao pode sumir sem alguem
-- olhar.
create index pagamento_eventos_orfaos_idx
  on public.pagamento_eventos (recebido_em desc)
  where pagamento_id is null;

-- So UPDATE e bloqueado, e isso e intencional: a funcao publica libera DELETE
-- porque bloquear tudo transformaria conta com pagamento em conta que nao da
-- para excluir (LGPD).
create trigger pagamento_eventos_append_only
  before update on public.pagamento_eventos
  for each row execute function public.bloquear_escrita_append_only();

-- -----------------------------------------------------------------------------
-- assinatura_ciclos — um ciclo por periodo cobrado.
--
-- A cota mensal e concedida POR CICLO, e nao por assinatura: sem a linha do
-- periodo, "ja creditei este mes?" viraria conta de datas na aplicacao, e duas
-- execucoes do cron no mesmo minuto dariam a cota duas vezes.
-- -----------------------------------------------------------------------------
create table public.assinatura_ciclos (
  id            uuid primary key default gen_random_uuid(),
  assinatura_id uuid not null references public.assinaturas (id) on delete cascade,
  perfil_id     uuid not null references public.perfis (id) on delete cascade,

  inicio        timestamptz not null,
  fim           timestamptz not null,

  -- Lista explicita de colunas: sem ela, `set null` anularia TODAS as colunas
  -- da FK, inclusive perfil_id, que e NOT NULL.
  pagamento_id  uuid references public.pagamentos (id) on delete set null (pagamento_id),

  -- Quando, e nao apenas se: booleano responde "ja concedeu?" e nada mais, e a
  -- pergunta que chega no suporte e "quando caiu".
  creditos_concedidos_em timestamptz,
  caracteres_concedidos  bigint not null default 0 check (caracteres_concedidos >= 0),

  criado_em     timestamptz not null default now(),

  constraint assinatura_ciclos_periodo check (fim > inicio),
  constraint assinatura_ciclos_concessao_coerente check (
    (creditos_concedidos_em is null) = (caracteres_concedidos = 0)
  )
);

-- Reentrega do webhook do mesmo periodo esbarra aqui em vez de abrir um ciclo
-- novo — e ciclo novo seria cota mensal em dobro.
create unique index assinatura_ciclos_periodo_idx
  on public.assinatura_ciclos (assinatura_id, inicio);

create index assinatura_ciclos_perfil_idx
  on public.assinatura_ciclos (perfil_id, inicio desc);
create index assinatura_ciclos_sem_concessao_idx
  on public.assinatura_ciclos (fim)
  where creditos_concedidos_em is null;

-- -----------------------------------------------------------------------------
-- O tipo de job desta fase.
--
-- `job_tipos` e tabela justamente para isto: cada fase acrescenta o seu sem
-- `alter type`, que nao roda dentro da transacao por arquivo do aplicador.
-- Prioridade menor que a de 'comissao' porque quem acabou de pagar esta na
-- tela esperando o saldo; a apuracao da rede pode esperar alguns segundos.
--
-- O tipo tambem precisa entrar em `TipoJob` (src/lib/dados/tipos.ts) e no
-- worker — arquivos de outro dono nesta rodada.
-- -----------------------------------------------------------------------------
insert into public.job_tipos (tipo, descricao, max_tentativas, lease_segundos, prioridade_padrao) values
  ('credito', 'Credita caracteres de um pagamento confirmado', 8, 60, 10)
on conflict (tipo) do nothing;

-- -----------------------------------------------------------------------------
-- registrar_evento_pagamento — a UNICA porta de entrada do webhook.
--
-- Devolve null quando a notificacao ja tinha chegado antes. Concentrar o
-- `on conflict do nothing` aqui evita que um adaptador novo — troca de gateway
-- e questao de tempo — reinvente o insert sem ele e credite duas vezes.
-- -----------------------------------------------------------------------------
create or replace function public.registrar_evento_pagamento(
  p_gateway        text,
  p_evento_id      text,
  p_tipo_evento    text,
  p_gateway_id     text default null,
  p_status         public.status_pagamento default null,
  p_meio           public.meio_pagamento default null,
  p_valor_centavos integer default null,
  p_payload        jsonb default '{}'::jsonb
)
returns bigint
language sql
as $$
  insert into public.pagamento_eventos (
    gateway, evento_id_externo, tipo_evento, gateway_id,
    status_informado, meio, valor_centavos, payload
  )
  values (
    p_gateway, p_evento_id, p_tipo_evento, p_gateway_id,
    p_status, p_meio, p_valor_centavos, coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (gateway, evento_id_externo) do nothing
  returning id;
$$;

comment on function public.registrar_evento_pagamento is
  'null = notificacao repetida. Nao e erro: e o caso normal de retentativa do gateway.';

-- Amarra o evento a cobranca antes de gravar, para o adaptador nao precisar de
-- uma ida extra ao banco — e para o perfil do evento nao depender de ele ter
-- acertado essa consulta.
create or replace function public.resolver_evento_pagamento()
returns trigger
language plpgsql
as $$
begin
  if new.pagamento_id is null and new.gateway_id is not null then
    select p.id into new.pagamento_id
      from public.pagamentos p
     where p.gateway = new.gateway and p.gateway_id = new.gateway_id;
  end if;

  if new.perfil_id is null and new.pagamento_id is not null then
    select p.perfil_id into new.perfil_id
      from public.pagamentos p
     where p.id = new.pagamento_id;
  end if;

  return new;
end;
$$;

create trigger pagamento_eventos_resolver
  before insert on public.pagamento_eventos
  for each row execute function public.resolver_evento_pagamento();

-- -----------------------------------------------------------------------------
-- aplicar_evento_pagamento — o que o webhook PODE fazer na propria transacao:
-- mudar o status da cobranca e enfileirar. Nada alem disso.
--
-- Creditar caractere e apurar comissao de tres niveis ficam nos jobs. O
-- gateway espera segundos por um 200; apuracao com lock em varias linhas da
-- rede de indicacao passa disso, e o timeout faz o gateway reenviar — o que
-- poe uma segunda transacao disputando os mesmos locks da primeira.
-- -----------------------------------------------------------------------------
create or replace function public.aplicar_evento_pagamento()
returns trigger
language plpgsql
as $$
declare
  v_pag public.pagamentos;
  v_ref text;
begin
  if new.pagamento_id is null or new.status_informado is null then
    return null;
  end if;

  -- Duas entregas do gateway podem chegar juntas com eventos diferentes. O
  -- lock serializa a decisao sobre a MESMA cobranca.
  select * into v_pag from public.pagamentos where id = new.pagamento_id for update;
  if not found then
    return null;
  end if;

  if new.status_informado <> 'pago' then
    -- Estado terminal nao regride: notificacao atrasada de 'pendente' ou
    -- 'falhou' nao despaga o que ja foi pago. So o estorno anda a partir de
    -- pago.
    update public.pagamentos
       set status = new.status_informado,
           meio   = coalesce(meio, new.meio)
     where id = v_pag.id
       and (status = 'pendente'
            or (status = 'pago' and new.status_informado = 'estornado'));
    return null;
  end if;

  -- Ja confirmado: a repeticao para aqui e nao reenfileira nada.
  if v_pag.status = 'pago' then
    return null;
  end if;

  -- Vale inclusive para a cobranca que a faxina cancelou por vencimento: se o
  -- gateway diz que entrou dinheiro, o gateway ganha.
  update public.pagamentos
     set status  = 'pago',
         pago_em = coalesce(v_pag.pago_em, new.recebido_em),
         meio    = coalesce(v_pag.meio, new.meio)
   where id = v_pag.id;

  -- Uma referencia so, para os dois jobs e para a razao de creditos, derivada
  -- do PAGAMENTO — que e externo a esta transacao. Reentrega do webhook cai no
  -- indice de idempotencia da fila e no da razao: nem enfileira de novo, nem
  -- credita de novo.
  v_ref := 'pagamento:' || v_pag.id::text;

  insert into public.jobs (perfil_id, tipo, chave_idempotencia, entrada)
  values (
    v_pag.perfil_id, 'credito', v_ref,
    jsonb_build_object('pagamento_id', v_pag.id, 'referencia', v_ref, 'tipo', v_pag.tipo)
  )
  on conflict (tipo, chave_idempotencia) where chave_idempotencia is not null do nothing;

  insert into public.jobs (perfil_id, tipo, chave_idempotencia, entrada)
  values (
    v_pag.perfil_id, 'comissao', v_ref,
    jsonb_build_object('pagamento_id', v_pag.id, 'valor_centavos', v_pag.valor_centavos)
  )
  on conflict (tipo, chave_idempotencia) where chave_idempotencia is not null do nothing;

  return null;
end;
$$;

create trigger pagamento_eventos_aplicar
  after insert on public.pagamento_eventos
  for each row execute function public.aplicar_evento_pagamento();

-- -----------------------------------------------------------------------------
-- creditar_compra — o que o job 'credito' executa quando tipo = 'creditos'.
--
-- A idempotencia e a da propria razao: (perfil_id, motivo, referencia). Job
-- que morreu no meio e tentou de novo nao credita duas vezes.
-- -----------------------------------------------------------------------------
create or replace function public.creditar_compra(p_pagamento_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_pag  public.pagamentos;
  v_lanc uuid;
begin
  select * into v_pag from public.pagamentos where id = p_pagamento_id for update;

  -- Creditar cobranca nao confirmada seria dar credito de graca. O job so
  -- nasce depois do webhook, entao cair aqui e sinal de chamada indevida.
  if not found or v_pag.status <> 'pago' or v_pag.tipo <> 'creditos' then
    return null;
  end if;

  insert into public.creditos_lancamentos (perfil_id, delta, motivo, referencia, metadados)
  values (
    v_pag.perfil_id,
    v_pag.caracteres,
    'compra',
    'pagamento:' || p_pagamento_id::text,
    jsonb_build_object(
      'pagamento_id', p_pagamento_id,
      'pacote_id', v_pag.pacote_id,
      'valor_centavos', v_pag.valor_centavos
    )
  )
  on conflict (perfil_id, motivo, referencia) where referencia is not null do nothing
  returning id into v_lanc;

  return v_lanc;
end;
$$;

comment on function public.creditar_compra is
  'null = ja estava creditado. O saldo esta certo nos dois casos.';

-- -----------------------------------------------------------------------------
-- conceder_creditos_ciclo — a cota mensal do plano, uma vez por ciclo.
-- -----------------------------------------------------------------------------
create or replace function public.conceder_creditos_ciclo(p_ciclo_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_ciclo public.assinatura_ciclos;
  v_cota  bigint;
  v_lanc  uuid;
begin
  select * into v_ciclo from public.assinatura_ciclos where id = p_ciclo_id for update;
  if not found or v_ciclo.creditos_concedidos_em is not null then
    return null;
  end if;

  select p.creditos_mes into v_cota
    from public.assinaturas a
    join public.planos p on p.id = a.plano_id
   where a.id = v_ciclo.assinatura_id;

  -- `planos.creditos_mes` e nulo de proposito ate a pendencia §9.4 fechar. Sem
  -- numero decidido o ciclo fica visivelmente sem concessao, em vez de creditar
  -- um chute que depois ninguem consegue estornar direito.
  if v_cota is null or v_cota <= 0 then
    return null;
  end if;

  insert into public.creditos_lancamentos (perfil_id, delta, motivo, referencia, metadados)
  values (
    v_ciclo.perfil_id,
    v_cota,
    'assinatura',
    'ciclo:' || p_ciclo_id::text,
    jsonb_build_object(
      'ciclo_id', p_ciclo_id,
      'assinatura_id', v_ciclo.assinatura_id,
      'pagamento_id', v_ciclo.pagamento_id
    )
  )
  on conflict (perfil_id, motivo, referencia) where referencia is not null do nothing
  returning id into v_lanc;

  -- Marca mesmo quando o insert nao devolveu linha: conflito significa que a
  -- razao ja tem o lancamento e o processo morreu antes de marcar. Deixar sem
  -- marca faria o cron tentar para sempre um ciclo que ja foi concedido.
  update public.assinatura_ciclos
     set creditos_concedidos_em = now(),
         caracteres_concedidos  = v_cota
   where id = p_ciclo_id;

  return v_lanc;
end;
$$;

-- -----------------------------------------------------------------------------
-- expirar_pagamentos — chamada pelo job 'faxina'.
--
-- QR de PIX vencido que continua 'pendente' e uma tela mentindo "aguardando
-- pagamento" e uma cobranca que nunca sai do extrato. Cancelar aqui nao e
-- definitivo: se o gateway confirmar depois, o gatilho reabre para 'pago'.
-- -----------------------------------------------------------------------------
create or replace function public.expirar_pagamentos()
returns integer
language sql
as $$
  with vencidos as (
    update public.pagamentos
       set status = 'cancelado'
     where status = 'pendente'
       and expira_em is not null
       and expira_em < now()
    returning 1
  )
  select count(*)::int from vencidos;
$$;

insert into public.configuracoes (chave, valor, descricao) values
  ('pagamento.pix_expira_minutos', '30',
   'Validade do QR de PIX. Provisorio: o TTL real vem do gateway escolhido.')
on conflict (chave) do nothing;

-- =============================================================================
-- PENDENTE — o que depende de escolher o gateway (PLANO.md §9.1)
--
-- Nada aqui foi chutado: as colunas existem e ficam vazias ate a decisao. Sem
-- GATEWAY_NOME/GATEWAY_TOKEN a operacao de dinheiro nao acontece e NAO e
-- fingida.
--
-- 1. QUAL GATEWAY — Asaas, Mercado Pago ou Pagar.me. `gateway` e texto livre
--    porque a resposta muda o formato de todo o resto (id de cobranca, nome de
--    evento, objeto de assinatura) e porque trocar de gateway nao pode exigir
--    migracao de enum.
--
-- 2. TRADUCAO DE EVENTO -> `status_informado`. Cada gateway nomeia o seu
--    ('PAYMENT_RECEIVED', 'payment.updated', 'charge.paid'). O mapa mora no
--    adaptador em TypeScript, nao no banco. Enquanto nao existir adaptador,
--    nada entra em `pagamento_eventos` e nenhum gatilho dispara.
--
-- 3. RECORRENCIA DE QUEM. Se o gateway tem objeto de assinatura,
--    `assinaturas.gateway_id` aponta para ele e cada cobranca do mes vira um
--    ciclo; se nao tem, somos nos que criamos a cobranca mensal. E por isso
--    que a linha de `assinatura_ciclos` NAO nasce no gatilho do webhook: as
--    datas de inicio e fim sao do gateway, e inventa-las aqui erraria o mes
--    inteiro. Pela mesma razao o gatilho nao ativa a assinatura em
--    `assinaturas` — quem conhece o periodo e quem grava o ciclo.
--
-- 4. TAXA DO GATEWAY. Nao existe `taxa_centavos` nem `liquido_centavos`
--    porque a base da comissao (bruto ou liquido) e decisao de negocio que so
--    fecha com o custo real na mao. Ate la o relatorio de taxa fica em
--    `pagamentos.metadados`.
--
-- 5. DIVERGENCIA DE VALOR. `pagamento_eventos.valor_centavos` guarda o que o
--    gateway diz ter recebido, mas o gatilho nao compara com o cobrado: o que
--    fazer com PIX pago a menor (recusar, creditar proporcional, devolver) e
--    regra de negocio, e a regra errada trava venda boa ou libera venda
--    incompleta.
--
-- 6. ESTORNO E CHARGEBACK. O evento marca `estornado`. Devolver credito ja
--    consumido e fazer clawback de comissao sao da fase 6 e dependem da janela
--    que o gateway pratica (`comissao.dias_liberacao` = 30 e o palpite atual
--    em `configuracoes`).
--
-- 7. SPLIT NA ORIGEM. Se o gateway divide o valor entre as partes, o job
--    'comissao' passa a so registrar o que ja foi pago, em vez de gerar saldo
--    a sacar — muda o significado da fase 6, nao este schema.
--
-- 8. VALIDADE DO PIX. `pagamento.pix_expira_minutos` = 30 e chute; o TTL real
--    vem do gateway e deve substituir o valor em `configuracoes`.
--
-- 9. COTA MENSAL. `planos.creditos_mes` continua nulo (PLANO.md §9.4).
--    Enquanto ficar, `conceder_creditos_ciclo` nao concede nada — de
--    proposito, e nao por falta de codigo.
-- =============================================================================
