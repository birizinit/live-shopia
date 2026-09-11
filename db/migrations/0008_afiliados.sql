-- =============================================================================
-- Shopia — afiliados (fase 6)
--
-- Indicação em 3 níveis, gerente, comissão, clawback, KYC e saque.
--
-- O desenho jurídico manda mais que o técnico aqui. Ganho derivado de
-- recrutamento em profundidade é o formato que atrai enquadramento como
-- pirâmide (Lei 1.521/51, art. 2º, IX); o que separa um programa legítimo é a
-- comissão estar amarrada a PAGAMENTO CONFIRMADO de assinatura, nunca a
-- cadastro. Por isso não existe caminho no schema que crie comissão a partir
-- de um perfil novo: a porta é `apurar_comissoes_do_pagamento`, que lê a linha
-- de `pagamentos` (0005) e recusa qualquer coisa que não esteja em 'pago'. E o
-- caminho de volta é automático: `pagamentos` marcado 'estornado' dispara o
-- clawback dos três níveis no mesmo commit.
--
-- Seis decisões que estão aqui e não no código:
--
--  1. A árvore é MATERIALIZADA (`indicacoes`). Cada abertura do painel
--     perguntaria "quem está abaixo de mim até 3 níveis"; com `indicado_por`
--     puro isso é CTE recursiva por requisição. Aqui é um índice.
--  2. O PERCENTUAL mora em `comissao_regras`, com vigência — não em
--     `configuracoes`. A justificativa está em cima da tabela.
--  3. A comissão é APPEND-ONLY no valor. O status anda (pendente → disponível
--     → paga), o valor não: correção vira lançamento de estorno. Um `update`
--     em `valor_centavos` é reescrever a história de uma disputa.
--  4. Saldo é consequência de uma razão (`comissoes_lancamentos`), igual a
--     crédito na fase 0. `afiliados_saldos` é cache mantido por gatilho.
--  5. CPF é guardado como HMAC-SHA256 com pepper de FORA do banco. SHA cru de
--     CPF não protege nada: 11 dígitos com dois verificadores são ~10^9
--     candidatos, e uma tabela arco-íris derruba a base inteira em minutos.
--  6. Exclusão de conta (LGPD) nunca é bloqueada por dado financeiro. Nenhuma
--     FK desta migração usa `on delete restrict`. O que sobrevive à exclusão é
--     `auditoria` (0003), que guarda `perfil_id` como `set null` — trilha sem
--     identidade, que é exatamente o que o titular pode exigir que reste.
--
-- Os percentuais semeados aqui são PROVISÓRIOS (PLANO.md §9.4). Estão
-- marcados linha a linha, e a tabela tem coluna `provisorio` justamente para
-- que ninguém confunda "está no banco" com "o dono do negócio fechou".
-- =============================================================================

-- 'gerente' não é um nível da árvore: é um papel que cobra sobre a venda do
-- afiliado da equipe. Enfiá-lo num smallint exigiria um valor-sentinela
-- (nível 0? nível 4?), e sentinela em coluna de dinheiro vira erro de
-- relatório que ninguém percebe.
create type public.origem_comissao as enum ('nivel_1', 'nivel_2', 'nivel_3', 'gerente');

create type public.status_comissao as enum ('pendente', 'disponivel', 'paga', 'estornada');

-- Motivo de cada movimento na razão de comissão.
create type public.motivo_comissao as enum (
  'credito',    -- a comissão nasceu, em pendente
  'liberacao',  -- D+30 cumprido: pendente → disponível
  'bloqueio',   -- entrou num saque solicitado: disponível → bloqueado
  'saque',      -- saque pago: bloqueado → sacado
  'estorno',    -- saque recusado ou cancelado: bloqueado → disponível
  'clawback',   -- pagamento estornado: sai de onde estiver
  'ajuste'
);

create type public.status_saque as enum (
  'solicitado',
  'aprovado',
  'pago',
  'recusado',
  'cancelado'
);

create type public.status_kyc as enum ('pendente', 'verificado', 'recusado');

create type public.tipo_dado_bancario as enum ('pix', 'conta');

create type public.tipo_chave_pix as enum ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria');

create type public.status_convite_gerente as enum ('pendente', 'aceito', 'recusado', 'expirado');

-- -----------------------------------------------------------------------------
-- indicacoes — a árvore materializada, até 3 níveis.
--
-- Uma linha por (descendente, ancestral). `perfil_id` é quem foi indicado;
-- `ancestral_id` é quem ganha quando ele paga. O gatilho em `perfis` preenche
-- no nascimento do perfil, copiando a cadeia do indicador e somando 1 ao
-- nível: no máximo 2 linhas lidas por cadastro, contra uma CTE recursiva a
-- cada abertura do painel.
-- -----------------------------------------------------------------------------
create table public.indicacoes (
  perfil_id    uuid not null references public.perfis (id) on delete cascade,
  ancestral_id uuid not null references public.perfis (id) on delete cascade,
  nivel        smallint not null check (nivel between 1 and 3),
  criado_em    timestamptz not null default now(),

  primary key (perfil_id, ancestral_id),
  constraint indicacoes_sem_auto_referencia check (perfil_id <> ancestral_id)
);

-- Um ancestral por nível: a cadeia é um caminho, não um grafo.
create unique index indicacoes_nivel_unico on public.indicacoes (perfil_id, nivel);
-- A consulta do painel: "minha rede, por nível".
create index indicacoes_ancestral_idx on public.indicacoes (ancestral_id, nivel);

comment on table public.indicacoes is
  'Fecho transitivo de perfis.indicado_por, cortado em 3 níveis. Mantido por gatilho.';

-- -----------------------------------------------------------------------------
-- comissao_regras — percentual por origem, com vigência.
--
-- POR QUE AQUI E NÃO EM `configuracoes`, que já existe:
-- `configuracoes` guarda um valor e o sobrescreve. Serve para prazo e teto —
-- números operacionais, cujo efeito já fica congelado na linha da comissão no
-- instante em que ela nasce (`liberada_em`). Percentual é outra coisa: é o
-- número que o afiliado entende como promessa, o que mais muda por
-- renegociação, e o que aparece na disputa ("vocês me prometeram 30%"). Um
-- `update` em `configuracoes` apaga a resposta. Com vigência dá para agendar a
-- troca para o dia 1º do mês que vem e para dizer, meses depois, qual regra
-- valia naquele pagamento — e `comissoes.regra_id` aponta para a linha exata.
--
-- Fica então: PERCENTUAL aqui; PRAZO e TETO em `configuracoes`.
-- -----------------------------------------------------------------------------
create table public.comissao_regras (
  id              uuid primary key default gen_random_uuid(),
  origem          public.origem_comissao not null,

  -- Fração, não porcentagem: 0.30 é 30%. Quatro casas aguentam 12,25%.
  percentual      numeric(6,4) not null check (percentual >= 0 and percentual <= 1),

  vigencia_inicio timestamptz not null default now(),
  vigencia_fim    timestamptz,

  -- Enquanto isto for true o número NÃO foi fechado com o dono do negócio.
  provisorio      boolean not null default true,
  observacao      text,

  criado_em       timestamptz not null default now(),
  criado_por      uuid references public.perfis (id) on delete set null (criado_por),

  constraint comissao_regras_vigencia check (
    vigencia_fim is null or vigencia_fim > vigencia_inicio
  )
);

-- Uma regra em aberto por origem. Duas regras abertas é o erro que faz a
-- apuração escolher percentual por sorte de `order by`.
--
-- O ideal seria `exclude using gist (origem with =, tstzrange(...) with &&)`,
-- que barraria qualquer sobreposição. Custa a extensão `btree_gist`, e uma
-- extensão que falta derruba o deploy inteiro no `preDeployCommand`. O índice
-- parcial pega o caso real (esquecer de fechar a regra anterior); janelas
-- fechadas que se sobrepõem são resolvidas pelo `order by vigencia_inicio
-- desc` da função de leitura.
create unique index comissao_regras_aberta_idx
  on public.comissao_regras (origem)
  where vigencia_fim is null;

create index comissao_regras_origem_idx
  on public.comissao_regras (origem, vigencia_inicio desc);

comment on column public.comissao_regras.provisorio is
  'true = número de trabalho, ainda não fechado com o dono do negócio (PLANO.md §9.4).';

-- Semeia com os mesmos números que a fase 1 deixou em `configuracoes`, todos
-- marcados como provisórios — inclusive o do gerente.
insert into public.comissao_regras (origem, percentual, provisorio, observacao) values
  ('nivel_1', 0.3000, true,
   'PROVISÓRIO. Indicação direta. Fechar com o dono do negócio antes de ir ao ar.'),
  ('nivel_2', 0.1000, true,
   'PROVISÓRIO. Segundo nível.'),
  ('nivel_3', 0.0500, true,
   'PROVISÓRIO. Terceiro nível — é o que mais pesa no enquadramento jurídico.'),
  ('gerente', 0.6000, true,
   'PROVISÓRIO. Os 60% do concorrente incidem sobre a COMISSÃO do afiliado, não sobre a venda. Ver comissao.gerente_base.');

-- Aponta o `comissao.*` da fase 1 para cá, para não sobrarem dois lugares
-- dizendo qual é o percentual — é assim que um deles fica velho em silêncio.
update public.configuracoes
   set descricao = 'OBSOLETO: o percentual agora vem de comissao_regras (com vigência). Mantido só como registro do valor semeado.'
 where chave in ('comissao.nivel_1', 'comissao.nivel_2', 'comissao.nivel_3', 'comissao.gerente');

-- Regra vigente num instante. `stable` porque lê tabela: entra em subconsulta,
-- não entra em índice.
create or replace function public.regra_comissao_vigente(
  p_origem  public.origem_comissao,
  p_momento timestamptz default now()
)
returns public.comissao_regras
language sql
stable
as $$
  select r.*
    from public.comissao_regras r
   where r.origem = p_origem
     and r.vigencia_inicio <= p_momento
     and (r.vigencia_fim is null or r.vigencia_fim > p_momento)
   order by r.vigencia_inicio desc
   limit 1;
$$;

-- -----------------------------------------------------------------------------
-- comissoes — uma por (pagamento, beneficiário, origem).
--
-- `perfil_id` é o BENEFICIÁRIO (quem recebe), seguindo a regra do projeto de
-- toda tabela de dado de usuário ter `perfil_id`. Quem gerou a venda é
-- `origem_perfil_id`.
--
-- A chave de idempotência é `pagamento_ref`: a referência que veio do WEBHOOK
-- do gateway. Nunca um uuid criado dentro da apuração — chave derivada da
-- própria operação não protege de nada, porque cada retry gera uma nova. Com
-- `pagamento_ref`, reprocessar o mesmo webhook doze vezes cria a comissão uma
-- vez só.
--
-- `pagamento_ref` usa a MESMA string que a fase 3 já usa como chave de
-- idempotência do job e da razão de créditos ('pagamento:<id>'), para que
-- cobrança, crédito e comissão possam ser conciliados por uma busca só.
--
-- `pagamento_id` é FK de conveniência, e é `set null`: `pagamentos.perfil_id`
-- cascateia, então excluir a conta do COMPRADOR apaga o pagamento — e a
-- comissão do upline, que é dinheiro de outra pessoa, não pode cair junto. O
-- vínculo que sobrevive é o texto de `pagamento_ref`.
-- -----------------------------------------------------------------------------
create table public.comissoes (
  id               uuid primary key default gen_random_uuid(),

  perfil_id        uuid not null references public.perfis (id) on delete cascade,
  origem_perfil_id uuid references public.perfis (id) on delete set null (origem_perfil_id),

  origem           public.origem_comissao not null,
  -- Conveniência de relatório: null quando a origem é o gerente, que não é
  -- nível da árvore.
  nivel            smallint generated always as (
                     case origem
                       when 'nivel_1' then 1::smallint
                       when 'nivel_2' then 2::smallint
                       when 'nivel_3' then 3::smallint
                     end
                   ) stored,

  pagamento_ref    text not null check (length(btrim(pagamento_ref)) > 0),
  pagamento_id     uuid references public.pagamentos (id) on delete set null (pagamento_id),
  assinatura_id    uuid references public.assinaturas (id) on delete set null (assinatura_id),
  regra_id         uuid references public.comissao_regras (id) on delete set null (regra_id),

  base_centavos    integer not null check (base_centavos > 0),
  percentual       numeric(6,4) not null check (percentual > 0 and percentual <= 1),
  valor_centavos   integer not null check (valor_centavos > 0),

  status           public.status_comissao not null default 'pendente',

  -- Data do pagamento CONFIRMADO. Não é a data do cadastro nem a da promessa.
  pago_em          timestamptz not null,
  -- pago_em + comissao.dias_liberacao, congelado no nascimento da linha.
  -- Mudar o prazo depois não pode mexer em comissão que já existe.
  liberada_em      timestamptz not null,
  liberado_em      timestamptz,

  estornada_em     timestamptz,
  motivo_estorno   text,

  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  constraint comissoes_nao_paga_a_si check (
    origem_perfil_id is null or origem_perfil_id <> perfil_id
  ),
  constraint comissoes_liberacao_futura check (liberada_em >= pago_em),
  constraint comissoes_estorno_coerente check (
    (status = 'estornada') = (estornada_em is not null)
  ),
  constraint comissoes_estorno_explicado check (
    status <> 'estornada' or motivo_estorno is not null
  )
);

-- A garantia de que o mesmo webhook não paga duas vezes. `origem` entra na
-- chave de propósito: quem é ancestral de nível 1 E gerente da equipe recebe
-- duas comissões distintas pela mesma venda, e isso é correto.
create unique index comissoes_pagamento_unica
  on public.comissoes (pagamento_ref, perfil_id, origem);

create index comissoes_perfil_idx
  on public.comissoes (perfil_id, status, liberada_em);
create index comissoes_origem_perfil_idx
  on public.comissoes (origem_perfil_id, criado_em desc)
  where origem_perfil_id is not null;
-- O job de liberação varre só o que ainda está pendente.
create index comissoes_liberacao_idx
  on public.comissoes (liberada_em)
  where status = 'pendente';

comment on column public.comissoes.perfil_id is
  'Beneficiário: quem recebe. Quem gerou a venda é origem_perfil_id.';
comment on column public.comissoes.pagamento_ref is
  'Referência externa do pagamento (webhook do gateway). É a chave de idempotência da apuração.';

create trigger comissoes_atualizado_em
  before update on public.comissoes
  for each row execute function public.tocar_atualizado_em();

-- -----------------------------------------------------------------------------
-- kyc_dados — identidade do afiliado, exigida no saque.
--
-- O CPF NÃO é guardado. Guarda-se HMAC-SHA256(cpf, KYC_PEPPER), com o pepper
-- em variável de ambiente (`env.kycPepper`, src/lib/env.ts) e calculado na
-- aplicação: o banco nunca vê o pepper, então dump vazado não vira lista de
-- CPFs. SHA cru não serviria — 11 dígitos com dois verificadores são ~10^9
-- candidatos, e é tabela arco-íris de minutos, não de anos.
--
-- Uma linha por perfil, e `cpf_hash` único na base inteira: o mesmo CPF em
-- duas contas de afiliado é o padrão mais barato de fraude de rede (inventar a
-- própria downline para cobrar de si mesmo).
--
-- LGPD: `on delete cascade` e nada aponta para cá com `restrict`. Pedido de
-- exclusão não esbarra em KYC.
-- -----------------------------------------------------------------------------
create table public.kyc_dados (
  perfil_id      uuid primary key references public.perfis (id) on delete cascade,

  nome           text not null check (length(btrim(nome)) between 3 and 160),
  nascimento     date not null,

  cpf_hash       bytea not null check (octet_length(cpf_hash) = 32),
  -- Só para o atendimento confirmar identidade por telefone sem ler o CPF.
  cpf_final      text check (cpf_final ~ '^[0-9]{2}$'),

  status         public.status_kyc not null default 'pendente',
  verificado_em  timestamptz,
  verificado_por uuid references public.perfis (id) on delete set null (verificado_por),
  motivo_recusa  text,

  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  constraint kyc_verificacao_coerente check (
    (status = 'verificado') = (verificado_em is not null)
  ),
  constraint kyc_recusa_explicada check (
    status <> 'recusado' or motivo_recusa is not null
  ),
  -- Data absurda é erro de digitação, não idade. A checagem de maioridade é da
  -- aplicação: `current_date` não é imutável e não cabe em CHECK.
  constraint kyc_nascimento_plausivel check (nascimento > date '1900-01-01')
);

create unique index kyc_cpf_unico on public.kyc_dados (cpf_hash);

create trigger kyc_dados_atualizado_em
  before update on public.kyc_dados
  for each row execute function public.tocar_atualizado_em();

comment on column public.kyc_dados.cpf_hash is
  'HMAC-SHA256(cpf, KYC_PEPPER). O pepper vive no ambiente e nunca no banco — ver src/lib/env.ts.';

-- -----------------------------------------------------------------------------
-- dados_bancarios — para onde o saque vai.
--
-- O titular TEM de ser o mesmo do KYC. Isso é gatilho e não FK composta: a
-- checagem envolve `kyc_dados.status = 'verificado'`, que FK nenhuma expressa,
-- e FK composta com coluna anulável (MATCH SIMPLE) não valida nada.
--
-- A chave PIX fica em claro, e tem de ficar: é o dado que o operador digita no
-- banco para pagar. Quando o tipo é 'cpf', a aplicação calcula o HMAC da
-- própria chave e o grava em `titular_cpf_hash` — é o que amarra a chave ao
-- KYC sem trazer o pepper para dentro do banco.
-- -----------------------------------------------------------------------------
create table public.dados_bancarios (
  id               uuid primary key default gen_random_uuid(),
  perfil_id        uuid not null references public.perfis (id) on delete cascade,

  tipo             public.tipo_dado_bancario not null default 'pix',

  chave_tipo       public.tipo_chave_pix,
  chave            text,

  banco_ispb       text check (banco_ispb is null or banco_ispb ~ '^[0-9]{8}$'),
  banco_nome       text,
  agencia          text,
  conta            text,
  conta_digito     text,

  titular_nome     text not null check (length(btrim(titular_nome)) between 3 and 160),
  titular_cpf_hash bytea not null check (octet_length(titular_cpf_hash) = 32),

  principal        boolean not null default false,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  constraint dados_bancarios_pix_coerente check (
    tipo <> 'pix' or (chave_tipo is not null and length(btrim(coalesce(chave, ''))) > 0)
  ),
  constraint dados_bancarios_conta_coerente check (
    tipo <> 'conta' or (
      banco_ispb is not null and agencia is not null and conta is not null
    )
  )
);

create unique index dados_bancarios_principal_idx
  on public.dados_bancarios (perfil_id)
  where principal;
create index dados_bancarios_perfil_idx on public.dados_bancarios (perfil_id);

create trigger dados_bancarios_atualizado_em
  before update on public.dados_bancarios
  for each row execute function public.tocar_atualizado_em();

-- -----------------------------------------------------------------------------
-- saques — o pedido de pagamento.
--
-- O banco registra um pagamento que ACONTECEU do lado de fora; ele não simula
-- nenhum. Por isso `pagar_saque` exige comprovante (arquivo) ou referência da
-- transferência: sem prova, o saque não vira 'pago'.
--
-- `referencia` é a chave de idempotência do pedido e vem do FORMULÁRIO, não de
-- um uuid criado aqui dentro — duplo clique em "Solicitar saque" tem de
-- devolver o mesmo saque.
-- -----------------------------------------------------------------------------
create table public.saques (
  id                 uuid primary key default gen_random_uuid(),
  perfil_id          uuid not null references public.perfis (id) on delete cascade,

  dados_bancarios_id uuid references public.dados_bancarios (id)
                       on delete set null (dados_bancarios_id),
  -- Cópia do destino no instante do pedido. A conta pode ser trocada depois, e
  -- o recibo precisa dizer para onde o dinheiro foi de fato.
  destino            jsonb not null default '{}'::jsonb,

  valor_centavos     integer not null check (valor_centavos > 0),
  -- Retenção de IR. Fica em zero até o contador definir o regime — número
  -- fingido em campo de imposto é pior que campo vazio.
  retencao_centavos  integer not null default 0 check (retencao_centavos >= 0),
  liquido_centavos   integer generated always as (valor_centavos - retencao_centavos) stored,

  status             public.status_saque not null default 'solicitado',
  referencia         text not null check (length(btrim(referencia)) > 0),

  solicitado_em      timestamptz not null default now(),
  decidido_em        timestamptz,
  decidido_por       uuid references public.perfis (id) on delete set null (decidido_por),
  pago_em            timestamptz,

  comprovante_id     uuid references public.arquivos (id) on delete set null (comprovante_id),
  comprovante_ref    text,
  motivo_recusa      text,

  atualizado_em      timestamptz not null default now(),

  constraint saques_retencao_cabe check (retencao_centavos < valor_centavos),
  constraint saques_pagamento_coerente check ((status = 'pago') = (pago_em is not null)),
  constraint saques_pago_tem_prova check (
    status <> 'pago' or comprovante_id is not null or comprovante_ref is not null
  ),
  constraint saques_recusa_explicada check (
    status <> 'recusado' or motivo_recusa is not null
  )
);

create unique index saques_referencia_idx on public.saques (perfil_id, referencia);
create index saques_perfil_idx on public.saques (perfil_id, solicitado_em desc);
-- A fila do financeiro.
create index saques_fila_idx
  on public.saques (solicitado_em)
  where status in ('solicitado', 'aprovado');

create trigger saques_atualizado_em
  before update on public.saques
  for each row execute function public.tocar_atualizado_em();

comment on column public.saques.referencia is
  'Idempotência do pedido, vinda do formulário. Nunca gerada dentro da operação.';

-- -----------------------------------------------------------------------------
-- saque_comissoes — quais comissões cada saque liquidou.
--
-- `unique (comissao_id)` é a linha que impede sacar a mesma comissão duas
-- vezes. Não é convenção de código: é constraint.
--
-- Saque recusado ou cancelado APAGA os vínculos (gatilho), devolvendo as
-- comissões ao disponível. A história não se perde: ela está na razão, que é
-- append-only. Esta tabela é a alocação corrente, não o histórico.
-- -----------------------------------------------------------------------------
create table public.saque_comissoes (
  saque_id       uuid not null references public.saques (id) on delete cascade,
  comissao_id    uuid not null references public.comissoes (id) on delete cascade,
  perfil_id      uuid not null references public.perfis (id) on delete cascade,
  valor_centavos integer not null check (valor_centavos > 0),
  criado_em      timestamptz not null default now(),

  primary key (saque_id, comissao_id),
  constraint saque_comissoes_uma_vez unique (comissao_id)
);

create index saque_comissoes_perfil_idx on public.saque_comissoes (perfil_id);

-- -----------------------------------------------------------------------------
-- comissoes_lancamentos — a razão append-only da comissão.
--
-- Espelha `creditos_lancamentos` da fase 0, com uma diferença: crédito tem um
-- balde só, comissão tem quatro. Um lançamento é uma MOVIMENTAÇÃO entre
-- baldes, e é por isso que são quatro deltas numa linha em vez de um delta e
-- uma coluna de balde — assim cada linha fecha em si mesma (a soma dos quatro
-- deltas é zero, exceto quando entra ou sai dinheiro do sistema) e o cache é
-- uma soma direta.
--
-- 'bloqueado' é o quarto balde e não estava no pedido original: sem ele, o
-- saldo "disponível" continuaria contando comissão já comprometida num saque
-- em análise, e o afiliado veria dinheiro que não pode pedir de novo.
-- -----------------------------------------------------------------------------
create table public.comissoes_lancamentos (
  id               uuid primary key default gen_random_uuid(),
  perfil_id        uuid not null references public.perfis (id) on delete cascade,

  comissao_id      uuid references public.comissoes (id) on delete cascade,
  saque_id         uuid references public.saques (id) on delete set null (saque_id),

  motivo           public.motivo_comissao not null,

  delta_pendente   bigint not null default 0,
  delta_disponivel bigint not null default 0,
  delta_bloqueado  bigint not null default 0,
  delta_sacado     bigint not null default 0,

  -- Chave de idempotência do lançamento. Nula nas transições que podem repetir
  -- legitimamente (um saque recusado e um novo pedido movem as mesmas
  -- comissões de novo); nessas, quem garante a unicidade é a máquina de estado
  -- do saque mais o `unique (comissao_id)` de saque_comissoes.
  referencia       text,
  metadados        jsonb not null default '{}'::jsonb,
  criado_em        timestamptz not null default now(),

  constraint comissoes_lancamentos_nao_vazio check (
    delta_pendente <> 0 or delta_disponivel <> 0
    or delta_bloqueado <> 0 or delta_sacado <> 0
  )
);

create index comissoes_lancamentos_perfil_idx
  on public.comissoes_lancamentos (perfil_id, criado_em desc);
create index comissoes_lancamentos_comissao_idx
  on public.comissoes_lancamentos (comissao_id)
  where comissao_id is not null;
create unique index comissoes_lancamentos_referencia_idx
  on public.comissoes_lancamentos (perfil_id, motivo, referencia)
  where referencia is not null;

-- Só UPDATE é bloqueado. DELETE passa porque a exclusão da conta cascateia até
-- aqui, e razão que recusa delete vira conta que não dá para apagar (LGPD).
create trigger comissoes_lancamentos_append_only
  before update on public.comissoes_lancamentos
  for each row execute function public.bloquear_escrita_append_only();

-- -----------------------------------------------------------------------------
-- afiliados_saldos — cache, mantido por gatilho a partir da razão.
--
-- `disponivel` pode ficar NEGATIVO, e isso é de propósito: clawback de venda
-- que já foi sacada deixa dívida real. Zerar na marra esconderia o prejuízo —
-- o número negativo é o que faz alguém cobrar de volta ou baixar como perda.
-- -----------------------------------------------------------------------------
create table public.afiliados_saldos (
  perfil_id     uuid primary key references public.perfis (id) on delete cascade,
  pendente      bigint not null default 0,
  disponivel    bigint not null default 0,
  bloqueado     bigint not null default 0,
  sacado        bigint not null default 0,
  atualizado_em timestamptz not null default now(),

  constraint afiliados_saldos_sacado_nao_negativo check (sacado >= 0),
  constraint afiliados_saldos_bloqueado_nao_negativo check (bloqueado >= 0)
);

comment on table public.afiliados_saldos is
  'Cache derivado de comissoes_lancamentos, mantido por gatilho. A verdade é a razão.';

-- -----------------------------------------------------------------------------
-- convites_gerente — como um afiliado entra na equipe de um gerente.
--
-- O convite ACEITO é o vínculo: não existe coluna `gerente_id` em `perfis`
-- (tabela de outra migração) e não precisa existir. Um índice parcial garante
-- um único gerente ativo por afiliado.
--
-- Aceitar convite NÃO promove ninguém: papel mora em `perfis.papel` e só muda
-- por operação de servidor (regra da fase 0).
-- -----------------------------------------------------------------------------
create table public.convites_gerente (
  id             uuid primary key default gen_random_uuid(),
  gerente_id     uuid not null references public.perfis (id) on delete cascade,
  perfil_id      uuid not null references public.perfis (id) on delete cascade,

  status         public.status_convite_gerente not null default 'pendente',
  mensagem       text,

  expira_em      timestamptz not null,
  respondido_em  timestamptz,
  criado_em      timestamptz not null default now(),

  constraint convites_gerente_nao_convida_a_si check (gerente_id <> perfil_id),
  constraint convites_gerente_resposta_coerente check (
    (status in ('aceito', 'recusado')) = (respondido_em is not null)
  ),
  constraint convites_gerente_prazo check (expira_em > criado_em)
);

-- Um gerente por afiliado.
create unique index convites_gerente_equipe_idx
  on public.convites_gerente (perfil_id)
  where status = 'aceito';
-- Um convite pendente por par, para o gerente não encher a caixa do afiliado.
create unique index convites_gerente_pendente_idx
  on public.convites_gerente (gerente_id, perfil_id)
  where status = 'pendente';
create index convites_gerente_gerente_idx
  on public.convites_gerente (gerente_id, criado_em desc);
create index convites_gerente_expiracao_idx
  on public.convites_gerente (expira_em)
  where status = 'pendente';

-- =============================================================================
-- Gatilhos
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Materialização da árvore.
--
-- Roda no nascimento do perfil e também quando um `indicado_por` que era nulo
-- é preenchido depois (atribuição tardia de um código de indicação). Nesse
-- segundo caso a cadeia nova também precisa descer para quem já está abaixo:
-- é a segunda inserção da função.
--
-- Trocar um indicador JÁ definido é proibido: a árvore aqui é materializada e
-- comissões já pagas apontam para ela. Reescrever o pai em silêncio produz
-- rede que não bate com o dinheiro que saiu.
-- -----------------------------------------------------------------------------
create or replace function public.materializar_indicacao()
returns trigger
language plpgsql
as $$
begin
  if new.indicado_por is null then
    return null;
  end if;

  -- A cadeia do próprio perfil: o indicador no nível 1, mais os ancestrais
  -- dele empurrados um nível para baixo.
  insert into public.indicacoes (perfil_id, ancestral_id, nivel)
  select new.id, new.indicado_por, 1::smallint
  union all
  select new.id, i.ancestral_id, (i.nivel + 1)::smallint
    from public.indicacoes i
   where i.perfil_id = new.indicado_por
     and i.nivel < 3
     and i.ancestral_id <> new.id
  on conflict do nothing;

  -- Atribuição tardia: quem já estava abaixo deste perfil herda os ancestrais
  -- novos, até onde os 3 níveis alcançam.
  insert into public.indicacoes (perfil_id, ancestral_id, nivel)
  select d.perfil_id, a.ancestral_id, (d.nivel + a.nivel)::smallint
    from public.indicacoes d
    join public.indicacoes a on a.perfil_id = new.id
   where d.ancestral_id = new.id
     and d.nivel + a.nivel <= 3
     and a.ancestral_id <> d.perfil_id
  on conflict do nothing;

  return null;
end;
$$;

create trigger perfis_materializar_indicacao
  after insert or update of indicado_por on public.perfis
  for each row
  when (new.indicado_por is not null)
  execute function public.materializar_indicacao();

create or replace function public.bloquear_troca_de_indicador()
returns trigger
language plpgsql
as $$
begin
  if old.indicado_por is not null and new.indicado_por is distinct from old.indicado_por then
    raise exception 'indicador já definido: trocar o pai invalidaria a rede e as comissões pagas'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger perfis_indicador_imutavel
  before update of indicado_por on public.perfis
  for each row execute function public.bloquear_troca_de_indicador();

-- Rede de quem já existia antes desta migração. O corte em `nivel < 3` também
-- é o que impede laço infinito caso alguém tenha criado um ciclo de indicação.
with recursive cadeia as (
  select p.id as perfil_id, p.indicado_por as ancestral_id, 1::smallint as nivel
    from public.perfis p
   where p.indicado_por is not null
  union all
  select c.perfil_id, p.indicado_por, (c.nivel + 1)::smallint
    from cadeia c
    join public.perfis p on p.id = c.ancestral_id
   where p.indicado_por is not null
     and c.nivel < 3
)
insert into public.indicacoes (perfil_id, ancestral_id, nivel)
select perfil_id, ancestral_id, nivel
  from cadeia
 where ancestral_id <> perfil_id
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Razão e cache de saldo.
-- -----------------------------------------------------------------------------
create or replace function public.aplicar_lancamento_comissao()
returns trigger
language plpgsql
as $$
begin
  insert into public.afiliados_saldos as s
    (perfil_id, pendente, disponivel, bloqueado, sacado)
  values
    (new.perfil_id, new.delta_pendente, new.delta_disponivel,
     new.delta_bloqueado, new.delta_sacado)
  on conflict (perfil_id) do update
     set pendente      = s.pendente + excluded.pendente,
         disponivel    = s.disponivel + excluded.disponivel,
         bloqueado     = s.bloqueado + excluded.bloqueado,
         sacado        = s.sacado + excluded.sacado,
         atualizado_em = now();

  return null;
end;
$$;

create trigger comissoes_lancamentos_aplicar
  after insert on public.comissoes_lancamentos
  for each row execute function public.aplicar_lancamento_comissao();

-- Porta única da razão. Existe para que nenhum chamador monte os quatro deltas
-- na mão e erre o sinal.
create or replace function public.lancar_comissao(
  p_perfil_id  uuid,
  p_motivo     public.motivo_comissao,
  p_pendente   bigint,
  p_disponivel bigint,
  p_bloqueado  bigint,
  p_sacado     bigint,
  p_comissao_id uuid default null,
  p_saque_id    uuid default null,
  p_referencia  text default null,
  p_metadados   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  if p_pendente = 0 and p_disponivel = 0 and p_bloqueado = 0 and p_sacado = 0 then
    return null;
  end if;

  insert into public.comissoes_lancamentos
    (perfil_id, comissao_id, saque_id, motivo,
     delta_pendente, delta_disponivel, delta_bloqueado, delta_sacado,
     referencia, metadados)
  values
    (p_perfil_id, p_comissao_id, p_saque_id, p_motivo,
     p_pendente, p_disponivel, p_bloqueado, p_sacado,
     p_referencia, p_metadados)
  on conflict (perfil_id, motivo, referencia) where referencia is not null
    do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- Comissão nasceu: entra em pendente.
--
-- A referência do lançamento deriva do id da comissão, e isso NÃO é a chave de
-- idempotência gerada de dentro da operação que a regra do projeto proíbe: a
-- linha de comissão só existe porque passou pelo índice único de
-- `pagamento_ref`, que veio do webhook. Aqui a referência só amarra 1:1 o
-- lançamento à comissão.
create or replace function public.lancar_comissao_criada()
returns trigger
language plpgsql
as $$
begin
  perform public.lancar_comissao(
    new.perfil_id, 'credito',
    new.valor_centavos, 0, 0, 0,
    new.id, null, 'comissao:' || new.id::text,
    jsonb_build_object('pagamento_ref', new.pagamento_ref, 'origem', new.origem)
  );
  return null;
end;
$$;

create trigger comissoes_lancar_criacao
  after insert on public.comissoes
  for each row execute function public.lancar_comissao_criada();

-- Append-only no VALOR: status anda, dinheiro não se reescreve.
create or replace function public.bloquear_reescrita_comissao()
returns trigger
language plpgsql
as $$
begin
  if new.perfil_id     is distinct from old.perfil_id
     or new.origem     is distinct from old.origem
     or new.pagamento_ref  is distinct from old.pagamento_ref
     or new.base_centavos  is distinct from old.base_centavos
     or new.percentual     is distinct from old.percentual
     or new.valor_centavos is distinct from old.valor_centavos
     or new.pago_em        is distinct from old.pago_em then
    raise exception 'comissão é append-only no valor: corrija com estorno, não com update'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger comissoes_valor_imutavel
  before update on public.comissoes
  for each row execute function public.bloquear_reescrita_comissao();

-- Cada transição de status vira movimento na razão. Um lugar só, para que
-- liberação, pagamento e clawback não possam divergir do saldo.
create or replace function public.lancar_mudanca_comissao()
returns trigger
language plpgsql
as $$
declare
  v_valor bigint := new.valor_centavos;
begin
  if new.status = old.status then
    return null;
  end if;

  if old.status = 'pendente' and new.status = 'disponivel' then
    perform public.lancar_comissao(
      new.perfil_id, 'liberacao', -v_valor, v_valor, 0, 0,
      new.id, null, 'liberacao:' || new.id::text);

  elsif old.status = 'disponivel' and new.status = 'paga' then
    -- Sai do bloqueado, que é onde o vínculo com o saque a colocou.
    perform public.lancar_comissao(
      new.perfil_id, 'saque', 0, 0, -v_valor, v_valor, new.id, null, null);

  elsif old.status = 'paga' and new.status = 'disponivel' then
    perform public.lancar_comissao(
      new.perfil_id, 'estorno', 0, 0, v_valor, -v_valor, new.id, null, null);

  elsif new.status = 'estornada' then
    -- Clawback tira de onde o dinheiro estava. Se já tinha sido sacado, o
    -- saldo disponível fica negativo: é dívida de verdade e aparece como tal.
    perform public.lancar_comissao(
      new.perfil_id, 'clawback',
      case when old.status = 'pendente' then -v_valor else 0 end,
      case when old.status in ('disponivel', 'paga') then -v_valor else 0 end,
      0, 0,
      new.id, null, 'clawback:' || new.id::text,
      jsonb_build_object('status_anterior', old.status, 'motivo', new.motivo_estorno));
  end if;

  return null;
end;
$$;

create trigger comissoes_lancar_mudanca
  after update of status on public.comissoes
  for each row execute function public.lancar_mudanca_comissao();

-- Vincular a comissão a um saque BLOQUEIA o valor; desvincular devolve. É o
-- vínculo que move o saldo, então não existe caminho em que um saque em
-- análise deixe o valor contado como disponível.
create or replace function public.lancar_bloqueio_saque()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.lancar_comissao(
      new.perfil_id, 'bloqueio', 0, -new.valor_centavos, new.valor_centavos, 0,
      new.comissao_id, new.saque_id, null);
    return null;
  end if;

  -- Cascata de exclusão de conta: o perfil já não existe, não há saldo a
  -- corrigir e o lançamento só criaria lixo.
  if exists (select 1 from public.perfis where id = old.perfil_id) then
    perform public.lancar_comissao(
      old.perfil_id, 'estorno', 0, old.valor_centavos, -old.valor_centavos, 0,
      old.comissao_id, old.saque_id, null);
  end if;

  return null;
end;
$$;

create trigger saque_comissoes_bloquear
  after insert or delete on public.saque_comissoes
  for each row execute function public.lancar_bloqueio_saque();

-- O valor do saque é a soma do que ele liquida, mantida pelos vínculos. Só
-- enquanto o pedido está aberto: depois de decidido, o valor é histórico.
create or replace function public.recontar_saque()
returns trigger
language plpgsql
as $$
declare
  v_saque uuid;
begin
  -- `new` não existe no DELETE: ler o campo direto quebraria o gatilho.
  if tg_op = 'DELETE' then
    v_saque := old.saque_id;
  else
    v_saque := new.saque_id;
  end if;

  update public.saques s
     set valor_centavos = (
           select coalesce(sum(sc.valor_centavos), 0)
             from public.saque_comissoes sc
            where sc.saque_id = v_saque
         )
   where s.id = v_saque
     and s.status = 'solicitado'
     and exists (select 1 from public.saque_comissoes sc where sc.saque_id = v_saque);

  return null;
end;
$$;

create trigger saque_comissoes_recontar
  after insert or delete on public.saque_comissoes
  for each row execute function public.recontar_saque();

-- Saque recusado ou cancelado solta as comissões. O gatilho de bloqueio
-- devolve cada uma ao disponível, e elas voltam a poder entrar num pedido novo.
create or replace function public.soltar_comissoes_do_saque()
returns trigger
language plpgsql
as $$
begin
  -- Só de um pedido AINDA ABERTO. Saque já pago tem as comissões em 'sacado',
  -- e soltá-las devolveria ao disponível dinheiro que já saiu da conta.
  if old.status in ('solicitado', 'aprovado')
     and new.status in ('recusado', 'cancelado') then
    delete from public.saque_comissoes where saque_id = new.id;
  end if;
  return null;
end;
$$;

create trigger saques_soltar_comissoes
  after update of status on public.saques
  for each row execute function public.soltar_comissoes_do_saque();

-- Titular da conta = titular do KYC. Gatilho, não FK: a checagem depende do
-- status da verificação, que FK nenhuma enxerga.
create or replace function public.checar_titular_kyc()
returns trigger
language plpgsql
as $$
declare
  v_hash bytea;
begin
  select k.cpf_hash into v_hash
    from public.kyc_dados k
   where k.perfil_id = new.perfil_id and k.status = 'verificado';

  if not found then
    raise exception 'conta de recebimento exige KYC verificado no perfil %', new.perfil_id
      using errcode = '42501';
  end if;

  if v_hash is distinct from new.titular_cpf_hash then
    raise exception 'o titular da conta precisa ser o mesmo do KYC'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger dados_bancarios_titular_confere
  before insert or update of titular_cpf_hash, perfil_id on public.dados_bancarios
  for each row execute function public.checar_titular_kyc();

-- =============================================================================
-- Operações
-- =============================================================================

-- -----------------------------------------------------------------------------
-- apurar_comissoes — o motor. Quem chama é `apurar_comissoes_do_pagamento`,
-- logo abaixo, que é a porta e a única que sabe ler o status do pagamento.
-- Fica exposta para a correção manual de um caso raro, e mesmo aí exige os
-- dados de um pagamento confirmado: base, data e referência externa.
--
-- `p_pagamento_ref` é a referência do gateway e é a chave de idempotência:
-- reprocessar o mesmo webhook não duplica nada (`on conflict do nothing`).
--
-- O TETO existe porque a planilha do PLANO.md §5 é apertada de verdade: 30% +
-- 10% + 5% + 60% dá 105% da venda. Se os quatro percentuais incidissem sobre a
-- mesma base, cada assinatura vendida daria prejuízo. Em vez de capar em
-- silêncio (o que muda a taxa prometida e vira disputa), a apuração FALHA
-- alto: o job tem 8 tentativas e depois morre visível, alguém arruma a regra e
-- reprocessa. Dever a um afiliado por um dia é recuperável; pagar 105% da
-- receita todo mês não é.
-- -----------------------------------------------------------------------------
create or replace function public.apurar_comissoes(
  p_pagador_id    uuid,
  p_pagamento_ref text,
  p_base_centavos integer,
  p_pago_em       timestamptz default now(),
  p_assinatura_id uuid default null,
  p_pagamento_id  uuid default null
)
returns setof public.comissoes
language plpgsql
as $$
declare
  v_liberada_em timestamptz;
  v_regra       public.comissao_regras;
  v_ancestral   record;
  v_afiliado    uuid;
  v_valor_n1    integer := 0;
  v_gerente     uuid;
  v_base_ger    text;
  v_base        integer;
  v_valor       integer;
  v_soma        bigint;
  v_teto        bigint;
begin
  if p_base_centavos is null or p_base_centavos <= 0 then
    raise exception 'comissão exige base positiva' using errcode = '22023';
  end if;
  if p_pagamento_ref is null or btrim(p_pagamento_ref) = '' then
    raise exception 'comissão exige a referência externa do pagamento'
      using errcode = '22023';
  end if;

  v_liberada_em := p_pago_em
    + make_interval(days => public.config_num('comissao.dias_liberacao', 30)::int);

  for v_ancestral in
    select i.ancestral_id, i.nivel
      from public.indicacoes i
     where i.perfil_id = p_pagador_id
     order by i.nivel
  loop
    v_regra := public.regra_comissao_vigente(
      ('nivel_' || v_ancestral.nivel)::public.origem_comissao, p_pago_em);

    if v_regra.id is null or v_regra.percentual <= 0 then
      continue;
    end if;

    v_valor := round(p_base_centavos * v_regra.percentual)::int;
    if v_valor <= 0 then
      continue;
    end if;

    insert into public.comissoes (
      perfil_id, origem_perfil_id, origem, pagamento_ref, pagamento_id,
      assinatura_id, regra_id, base_centavos, percentual, valor_centavos,
      pago_em, liberada_em
    ) values (
      v_ancestral.ancestral_id, p_pagador_id,
      ('nivel_' || v_ancestral.nivel)::public.origem_comissao,
      btrim(p_pagamento_ref), p_pagamento_id,
      p_assinatura_id, v_regra.id, p_base_centavos, v_regra.percentual, v_valor,
      p_pago_em, v_liberada_em
    )
    on conflict (pagamento_ref, perfil_id, origem) do nothing;

    if v_ancestral.nivel = 1 then
      v_afiliado := v_ancestral.ancestral_id;
      v_valor_n1 := v_valor;
    end if;
  end loop;

  -- O gerente cobra sobre a venda do afiliado da equipe, então quem define se
  -- há gerente é o ancestral de nível 1 — não o comprador.
  if v_afiliado is not null then
    select cg.gerente_id into v_gerente
      from public.convites_gerente cg
     where cg.perfil_id = v_afiliado and cg.status = 'aceito'
     limit 1;
  end if;

  v_regra := public.regra_comissao_vigente('gerente', p_pago_em);

  if v_gerente is not null and v_gerente <> p_pagador_id
     and v_regra.id is not null and v_regra.percentual > 0 then

    -- Duas leituras possíveis dos "60% do gerente" do concorrente: 60% da
    -- VENDA (e aí o programa inteiro paga 105% e sangra) ou 60% da COMISSÃO do
    -- afiliado que ele gerencia (0,60 × 0,30 = 18% da venda, e o total fecha
    -- em 63%). O padrão é a segunda; a primeira fica disponível, e o teto
    -- abaixo é quem avisa se alguém ligar a primeira sem refazer a conta.
    v_base_ger := coalesce(
      (select c.valor #>> '{}' from public.configuracoes c
        where c.chave = 'comissao.gerente_base'),
      'nivel_1');

    v_base := case when v_base_ger = 'pagamento' then p_base_centavos else v_valor_n1 end;
    v_valor := round(coalesce(v_base, 0) * v_regra.percentual)::int;

    if v_valor > 0 then
      insert into public.comissoes (
        perfil_id, origem_perfil_id, origem, pagamento_ref, pagamento_id,
        assinatura_id, regra_id, base_centavos, percentual, valor_centavos,
        pago_em, liberada_em
      ) values (
        v_gerente, p_pagador_id, 'gerente',
        btrim(p_pagamento_ref), p_pagamento_id,
        p_assinatura_id, v_regra.id, v_base, v_regra.percentual, v_valor,
        p_pago_em, v_liberada_em
      )
      on conflict (pagamento_ref, perfil_id, origem) do nothing;
    end if;
  end if;

  select coalesce(sum(c.valor_centavos), 0) into v_soma
    from public.comissoes c
   where c.pagamento_ref = btrim(p_pagamento_ref)
     and c.status <> 'estornada';

  v_teto := round(p_base_centavos * public.config_num('comissao.teto_total', 1.0));

  if v_soma > v_teto then
    raise exception
      'comissões de % somam % centavos sobre venda de % — acima do teto de % (comissao.teto_total). Regra errada: ajuste comissao_regras e reprocesse.',
      btrim(p_pagamento_ref), v_soma, p_base_centavos, v_teto
      using errcode = '23514';
  end if;

  return query
    select c.* from public.comissoes c
     where c.pagamento_ref = btrim(p_pagamento_ref)
     order by c.origem;
end;
$$;

-- -----------------------------------------------------------------------------
-- liberar_comissoes — o D+30. Roda no job periódico.
--
-- A janela existe porque chargeback chega depois da venda: liberar na hora é
-- pagar comissão de dinheiro que ainda pode voltar.
-- -----------------------------------------------------------------------------
create or replace function public.liberar_comissoes(p_limite integer default 1000)
returns integer
language plpgsql
as $$
declare
  v_n integer;
begin
  with alvo as (
    select c.id
      from public.comissoes c
     where c.status = 'pendente'
       and c.liberada_em <= now()
     order by c.liberada_em
     limit greatest(p_limite, 1)
     for update skip locked
  )
  update public.comissoes c
     set status = 'disponivel', liberado_em = now()
    from alvo
   where c.id = alvo.id;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- estornar_comissoes — o clawback dos 3 níveis (e do gerente).
--
-- Chargeback, reembolso ou assinatura cancelada dentro da janela derrubam
-- TODAS as comissões daquele pagamento de uma vez. Idempotente: rodar de novo
-- não encontra mais nada em aberto.
--
-- Saque ainda não decidido que contenha comissão afetada é cancelado inteiro.
-- Cancelar e deixar o afiliado pedir de novo é mais honesto — e muito mais
-- simples de auditar — do que remendar o valor de um pedido em análise.
-- -----------------------------------------------------------------------------
create or replace function public.estornar_comissoes(
  p_pagamento_ref text,
  p_motivo        text default 'pagamento estornado pelo gateway'
)
returns integer
language plpgsql
as $$
declare
  v_n integer;
begin
  update public.saques s
     set status = 'cancelado',
         decidido_em = now(),
         motivo_recusa = 'cancelado pelo estorno do pagamento ' || btrim(p_pagamento_ref)
   where s.status in ('solicitado', 'aprovado')
     and exists (
       select 1
         from public.saque_comissoes sc
         join public.comissoes c on c.id = sc.comissao_id
        where sc.saque_id = s.id
          and c.pagamento_ref = btrim(p_pagamento_ref)
     );

  update public.comissoes c
     set status = 'estornada',
         estornada_em = now(),
         motivo_estorno = p_motivo
   where c.pagamento_ref = btrim(p_pagamento_ref)
     and c.status <> 'estornada';

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- As duas pontas ligadas à fase 3.
--
-- `apurar_comissoes_do_pagamento` é o que o job 'comissao' (enfileirado pelo
-- webhook em 0005) executa. Ele não recebe o valor por parâmetro: lê da linha
-- de `pagamentos` e RECUSA o que não está confirmado. É aqui que a regra
-- jurídica vira código — comissão de venda paga, nunca de cadastro. Um handler
-- em TypeScript que passasse o valor errado não teria como criar comissão
-- maior do que a venda.
--
-- A referência é a mesma string que 0005 usa na fila e na razão de créditos,
-- e é por isso que reprocessar o webhook não duplica nada em lugar nenhum.
-- -----------------------------------------------------------------------------
create or replace function public.apurar_comissoes_do_pagamento(p_pagamento_id uuid)
returns setof public.comissoes
language plpgsql
as $$
declare
  v_pag public.pagamentos;
begin
  select * into v_pag from public.pagamentos where id = p_pagamento_id;
  if not found then
    raise exception 'pagamento % não existe', p_pagamento_id using errcode = '22023';
  end if;

  if v_pag.status <> 'pago' or v_pag.pago_em is null then
    raise exception 'pagamento % não está confirmado (status %): comissão não nasce daqui',
      p_pagamento_id, v_pag.status
      using errcode = '22023';
  end if;

  return query select *
    from public.apurar_comissoes(
      v_pag.perfil_id,
      'pagamento:' || v_pag.id::text,
      v_pag.valor_centavos,
      v_pag.pago_em,
      null::uuid,
      v_pag.id
    );
end;
$$;

create or replace function public.estornar_comissoes_do_pagamento(
  p_pagamento_id uuid,
  p_motivo       text default 'pagamento estornado pelo gateway'
)
returns integer
language sql
as $$
  select public.estornar_comissoes('pagamento:' || p_pagamento_id::text, p_motivo);
$$;

-- O clawback é SÍNCRONO, e a apuração não.
--
-- Apurar é trabalho que pode esperar o worker: a comissão nasce pendente e só
-- serve dali a 30 dias. Estornar não pode esperar nada — enquanto a fila não
-- roda, o afiliado vê saldo de uma venda que já voltou, e num dia ruim pede
-- saque em cima dela. Então o estorno acontece no mesmo commit que marca o
-- pagamento como estornado, que é onde ele não tem como se perder.
create or replace function public.clawback_do_pagamento()
returns trigger
language plpgsql
as $$
begin
  perform public.estornar_comissoes_do_pagamento(
    new.id, 'estorno do pagamento ' || new.id::text);
  return null;
end;
$$;

create trigger pagamentos_clawback_comissao
  after update of status on public.pagamentos
  for each row
  when (new.status = 'estornado' and old.status <> 'estornado')
  execute function public.clawback_do_pagamento();

-- -----------------------------------------------------------------------------
-- solicitar_saque — junta o disponível e abre o pedido.
--
-- Exige KYC verificado e conta do próprio perfil. Respeita mínimo e teto por
-- período, ambos de `configuracoes`. Quando o teto corta no meio, o pedido
-- leva as comissões mais antigas que couberem em vez de recusar tudo.
--
-- `p_referencia` vem do formulário: é ela que faz duplo clique devolver o
-- mesmo saque, e não um uuid criado aqui dentro.
-- -----------------------------------------------------------------------------
create or replace function public.solicitar_saque(
  p_perfil_id          uuid,
  p_dados_bancarios_id uuid,
  p_referencia         text
)
returns public.saques
language plpgsql
as $$
declare
  v_saque   public.saques;
  v_conta   public.dados_bancarios;
  v_min     bigint;
  v_teto    bigint;
  v_periodo integer;
  v_janela  bigint;
  v_limite  bigint;
  v_total   bigint;
  v_alvo    uuid[];
  v_id      uuid;
begin
  if p_referencia is null or btrim(p_referencia) = '' then
    raise exception 'saque exige referência de idempotência vinda do formulário'
      using errcode = '22023';
  end if;

  select * into v_saque
    from public.saques
   where perfil_id = p_perfil_id and referencia = btrim(p_referencia);
  if found then
    return v_saque;
  end if;

  if not exists (
    select 1 from public.kyc_dados k
     where k.perfil_id = p_perfil_id and k.status = 'verificado'
  ) then
    raise exception 'saque exige KYC verificado' using errcode = '42501';
  end if;

  select * into v_conta
    from public.dados_bancarios
   where id = p_dados_bancarios_id and perfil_id = p_perfil_id;
  if not found then
    raise exception 'conta de recebimento não pertence ao perfil' using errcode = '42501';
  end if;

  v_min     := public.config_num('saque.minimo_centavos', 5000)::bigint;
  v_teto    := public.config_num('saque.teto_periodo_centavos', 500000)::bigint;
  v_periodo := public.config_num('saque.periodo_dias', 30)::int;

  select coalesce(sum(s.valor_centavos), 0) into v_janela
    from public.saques s
   where s.perfil_id = p_perfil_id
     and s.status in ('solicitado', 'aprovado', 'pago')
     and s.solicitado_em > now() - make_interval(days => v_periodo);

  v_limite := v_teto - v_janela;
  if v_limite < v_min then
    raise exception 'teto de saque do período já foi atingido' using errcode = '22023';
  end if;

  -- Mais antigas primeiro, somando até onde o teto do período deixa. Se dois
  -- pedidos concorrentes escolherem a mesma comissão, quem garante que ela não
  -- sai duas vezes é o `unique (comissao_id)` de saque_comissoes — o segundo
  -- pedido estoura em vez de pagar de novo.
  with elegiveis as (
    select c.id, c.valor_centavos,
           sum(c.valor_centavos) over (order by c.liberada_em, c.id) as acumulado
      from public.comissoes c
     where c.perfil_id = p_perfil_id
       and c.status = 'disponivel'
       and not exists (
         select 1 from public.saque_comissoes sc where sc.comissao_id = c.id
       )
  )
  select array_agg(id order by acumulado), coalesce(max(acumulado), 0)
    into v_alvo, v_total
    from elegiveis
   where acumulado <= v_limite;

  if v_total < v_min then
    raise exception 'saldo disponível (% centavos) abaixo do mínimo de %', v_total, v_min
      using errcode = '22023';
  end if;

  insert into public.saques (
    perfil_id, dados_bancarios_id, destino, valor_centavos, referencia
  ) values (
    p_perfil_id, v_conta.id,
    jsonb_build_object(
      'tipo', v_conta.tipo,
      'chave_tipo', v_conta.chave_tipo,
      'chave', v_conta.chave,
      'banco_ispb', v_conta.banco_ispb,
      'banco_nome', v_conta.banco_nome,
      'agencia', v_conta.agencia,
      'conta', v_conta.conta,
      'conta_digito', v_conta.conta_digito,
      'titular_nome', v_conta.titular_nome
    ),
    v_total, btrim(p_referencia)
  )
  returning * into v_saque;

  v_id := v_saque.id;

  insert into public.saque_comissoes (saque_id, comissao_id, perfil_id, valor_centavos)
  select v_id, c.id, p_perfil_id, c.valor_centavos
    from public.comissoes c
   where c.id = any (v_alvo);

  -- Relê porque o gatilho de recontagem tocou a linha depois do `returning`.
  select * into v_saque from public.saques where id = v_id;
  return v_saque;
end;
$$;

-- -----------------------------------------------------------------------------
-- pagar_saque — registra um pagamento que ACONTECEU fora daqui.
--
-- Sem comprovante (arquivo) ou referência da transferência, não vira 'pago'.
-- O banco não finge transferência, do mesmo jeito que não finge PIX de
-- assinatura: dinheiro só existe no schema depois de existir no mundo.
-- -----------------------------------------------------------------------------
create or replace function public.pagar_saque(
  p_saque_id       uuid,
  p_ator_id        uuid default null,
  p_comprovante_id uuid default null,
  p_comprovante_ref text default null
)
returns public.saques
language plpgsql
as $$
declare
  v_saque public.saques;
begin
  if p_comprovante_id is null and (p_comprovante_ref is null or btrim(p_comprovante_ref) = '') then
    raise exception 'saque só vira pago com comprovante ou referência da transferência'
      using errcode = '22023';
  end if;

  update public.saques s
     set status = 'pago',
         pago_em = now(),
         decidido_em = coalesce(s.decidido_em, now()),
         decidido_por = coalesce(p_ator_id, s.decidido_por),
         comprovante_id = coalesce(p_comprovante_id, s.comprovante_id),
         comprovante_ref = coalesce(nullif(btrim(p_comprovante_ref), ''), s.comprovante_ref)
   where s.id = p_saque_id
     and s.status in ('solicitado', 'aprovado')
  returning * into v_saque;

  if not found then
    raise exception 'saque % não está aberto para pagamento', p_saque_id
      using errcode = '22023';
  end if;

  update public.comissoes c
     set status = 'paga'
    from public.saque_comissoes sc
   where sc.saque_id = p_saque_id
     and c.id = sc.comissao_id
     and c.status = 'disponivel';

  return v_saque;
end;
$$;

create or replace function public.recusar_saque(
  p_saque_id uuid,
  p_motivo   text,
  p_ator_id  uuid default null
)
returns public.saques
language plpgsql
as $$
declare
  v_saque public.saques;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'recusa de saque exige motivo' using errcode = '22023';
  end if;

  update public.saques s
     set status = 'recusado',
         motivo_recusa = p_motivo,
         decidido_em = now(),
         decidido_por = coalesce(p_ator_id, s.decidido_por)
   where s.id = p_saque_id
     and s.status in ('solicitado', 'aprovado')
  returning * into v_saque;

  if not found then
    raise exception 'saque % não está aberto', p_saque_id using errcode = '22023';
  end if;

  return v_saque;
end;
$$;

-- Convite que venceu não fica pendente para sempre — entra na faxina do 0003.
create or replace function public.expirar_convites_gerente()
returns integer
language plpgsql
as $$
declare
  v_n integer;
begin
  update public.convites_gerente
     set status = 'expirado'
   where status = 'pendente' and expira_em <= now();

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Gerente ativo de um afiliado. O painel do gerente parte daqui.
create or replace function public.gerente_de(p_perfil_id uuid)
returns uuid
language sql
stable
as $$
  select cg.gerente_id
    from public.convites_gerente cg
   where cg.perfil_id = p_perfil_id and cg.status = 'aceito'
   limit 1;
$$;

-- A varredura do D+30 e a expiração de convite precisam de quem as acorde.
-- `job_tipos` é catálogo justamente para cada fase acrescentar o seu (0003).
insert into public.job_tipos (tipo, descricao, max_tentativas, lease_segundos, prioridade_padrao) values
  ('comissao_liberar', 'Libera comissões que cumpriram o D+30', 3, 300, 190)
on conflict (tipo) do nothing;

-- =============================================================================
-- Números operacionais. Percentual NÃO entra aqui — mora em comissao_regras.
-- =============================================================================
insert into public.configuracoes (chave, valor, descricao) values
  ('saque.teto_periodo_centavos', '500000',
   'Teto de saque por período, em centavos. Contém fraude que descobre um furo e esvazia o caixa numa noite.'),
  ('saque.periodo_dias', '30',
   'Janela do teto de saque, em dias.'),
  ('comissao.teto_total', '1.00',
   'Fração máxima da venda que pode virar comissão somando todos os níveis. Acima disto a apuração falha em vez de pagar prejuízo.'),
  ('comissao.gerente_base', '"nivel_1"',
   'Base da comissão do gerente: "nivel_1" (fração da comissão do afiliado, padrão) ou "pagamento" (fração da venda — ver o teto antes de mudar).'),
  ('afiliado.convite_gerente_dias', '7',
   'Validade do convite de gerente, em dias.')
on conflict (chave) do nothing;
