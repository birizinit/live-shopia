# Shopia — o que é preciso para construir

Documento de partida. Base: engenharia reversa do **Live Fox IA**
(`docs/referencia-livefox.md`), que serve como *spec* — o mapa de rotas, o
contrato da API e o modelo de negócio já estão levantados.

**Decisões tomadas** (09/09/2026): Next.js + Supabase · extensão Chrome como
canal de distribuição · afiliados multinível de 3 níveis dentro do escopo.

**Fase 0 entregue** (10/09/2026): aplicação de pé, navegação das 26 telas, tema
claro/escuro, autenticação, guard de rota e de papel, schema aplicado.

**Fases 1 a 7 entregues** (11/09/2026): as 19 telas restantes, mais um tour
guiado de onboarding. 61 tabelas, fila de jobs em Postgres, worker em processo,
integrações de Claude e ElevenLabs. O que fica de fora está na seção 10.

**Correção de rota** (11/09/2026): saiu o Supabase, entrou **Postgres puro na
Railway** — o mesmo lugar onde a aplicação já ia rodar. Ver §2.

---

## 1. O que o Live Fox realmente é

Tirando o marketing, são **quatro blocos** com pesos muito diferentes:

| # | Bloco | Dificuldade | Valor percebido | Risco |
|---|---|---|---|---|
| A | SaaS web (auth, planos, créditos, produtos, biblioteca, dashboard) | média | médio | baixo |
| B | Pipeline de IA: Claude escreve o roteiro → ElevenLabs sintetiza até 3h de áudio | **baixa** | **alto** | baixo |
| C | Extensão Chrome que injeta o áudio no TikTok LIVE Studio, responde o chat e roda 24h | alta | **alto** | **alto** |
| D | Afiliados multinível de 3 níveis + gerente com 60% | média | (motor de crescimento) | jurídico |

O ponto não óbvio: **B é a parte barata e A é a parte trabalhosa.** O pipeline de
IA é quase cola entre duas APIs. O que consome tempo é tudo em volta — cobrança,
créditos, permissões, painel.

**O truque de margem** está no consumo: gera-se o áudio uma vez e o *loop é grátis*.
É isso que permite vender "live 24h" com custo fixo de ~108k caracteres. Qualquer
concorrente precisa copiar exatamente essa mecânica ou a margem não fecha.

### O que dá para aproveitar
- O mapa de rotas e a árvore de navegação (26 telas) — vale como backlog pronto.
- O contrato da API (~60 endpoints) — reimplementável quase 1:1.
- A modelagem de planos, créditos e consumo.

### O que **não** copiar
Os achados de segurança do original são reais e evitáveis:
- JWT de 30 dias em `localStorage` → um XSS vira sequestro de conta por um mês.
- `device_id` aceito sem validação → a trava de "1 dispositivo" não existe de fato.
- Flag `admin` dentro do JWT → autorização precisa ser checada no servidor, sempre.
- Painel de gerente expondo usernames e valores depositados da rede (PII da downline).

---

## 2. Stack — decidida

### Frontend
- **Next.js 16 (App Router) + React 19 + TypeScript** — o plano dizia 15; a 16 é
  a estável no dia da fundação e não se começa projeto novo numa major anterior.
  O que muda na prática: Turbopack por padrão, `params`/`cookies` assíncronos e
  `middleware.ts` renomeado para `proxy.ts`.
- **Tailwind v4 + shadcn/ui**, tematizado pelos tokens de `design/tokens.css`
- **PWA** (manifest, service worker, Web Push VAPID) — o app é mobile-first
- Estado de servidor com **TanStack Query**; estado local com Zustand

### Backend — Postgres na Railway + worker Node
*Decidido em 11/09/2026, no lugar do Supabase.* A aplicação já ia para a
Railway; manter banco e app no mesmo projeto tira uma conta, um fornecedor e a
latência entre os dois. O preço foi escrever o que vinha pronto:

| Vinha do Supabase | Ficou |
|---|---|
| Auth | Nosso: Argon2id, sessão opaca no banco, tokens de e-mail |
| RLS | Escopo por `perfilId` em cada consulta — ver `db/README.md` |
| Realtime | SSE próprio na fase 4 (é o que o concorrente faz) |
| Storage | Já era R2 no plano |
| Rate limit | Pendente; entra com o Redis da fase 1 |

Foram ~2 dias de trabalho a mais e uma rede de proteção a menos (a RLS). Em
troca: um fornecedor, sem vendor lock-in de auth, e o banco a um hop da
aplicação. Sobra o mesmo serviço Node para jobs de IA/TTS, webhooks de
pagamento e cálculo de comissões.

### Infra transversal
- **Fila**: BullMQ + Redis (Upstash). Gerar 3h de áudio **não pode ser requisição
  síncrona** — é job com progresso, retry e idempotência.
- **Storage/CDN**: Cloudflare R2 (egress zero). Áudio de 3h é pesado e é servido
  repetidamente; egress é o custo que surpreende.
- **Deploy**: Railway — app, Postgres e, depois, o worker no mesmo projeto.

### Autenticação — corrigindo o original
- **Sessão opaca em cookie `HttpOnly; Secure; SameSite=Lax`**, com o hash no
  banco. Substitui o par access/refresh: rotação de refresh token é mitigação
  para token que não dá para revogar — sessão no banco revoga na hora, que é a
  garantia mais forte.
- Papéis no banco, lidos no servidor a cada requisição.
- `device_id` registrado e carimbado na sessão.
- Senha com **Argon2id** (parâmetros OWASP) e resposta de login com tempo
  constante. Rate limit pendente, com o Redis da fase 1.

---

## 3. Escopo

### MVP — cobrável
1. Auth, conta, perfil, planos
2. Produtos
3. Roteiro por IA — gancho → oferta → prova → objeções → CTA (Claude)
4. Catálogo de vozes + TTS + biblioteca de áudios (ElevenLabs)
5. Montagem do áudio da live (loop contínuo + som ambiente) e player
6. Dashboard de vendas
7. Créditos e checkout (PIX + cartão + assinatura)
8. Tema claro/escuro + PWA

### v1 completa
9. **Extensão Chrome** (seção 6)
10. **Afiliados: indicação em 3 níveis + painel de gerente** (seção 7)
11. Clonagem de voz · Ranking · Aulas · Push notifications

---

## 4. Contas e serviços que você precisa contratar

| Serviço | Para quê | Custo |
|---|---|---|
| **Anthropic (Claude)** | roteiro de vendas | pago por uso; um roteiro custa centavos |
| **ElevenLabs** | TTS + clonagem de voz | **principal custo variável** — ver seção 5 |
| **Gateway BR** (Asaas / Mercado Pago / Pagar.me) | PIX + cartão + **assinatura recorrente** | ~1% PIX, ~3,5% cartão |
| **Railway** (app + Postgres) | banco e aplicação | ~US$10–20/mês |
| **Cloudflare R2** | áudios + CDN | ~US$5/mês |
| **Upstash Redis** | fila de jobs | ~US$10/mês |
| **Vercel** | front | US$0–20/mês |
| **Resend / SES** | e-mail transacional | ~US$0–20/mês |
| **Chrome Web Store** | publicar a extensão | US$5, taxa única |
| **Domínio + SSL** | — | ~R$40/ano |
| **TikTok Shop Partner Center** | dados de venda **legítimos** via API | grátis, mas exige aprovação |

**Infra fixa: ~US$60–90/mês** até algumas centenas de usuários. O que escala com a
base é ElevenLabs.

---

## 5. A conta que define o preço do plano

Esta é a matemática que precisa fechar antes de escrever código:

- ~600 caracteres por minuto de fala → **3h ≈ 108.000 caracteres**
- No plano Creator do ElevenLabs, ~US$0,15/1.000 chars → **~US$16 por geração de 3h**
- O **loop é grátis**: gerado uma vez, roda 24h sem custo adicional

Ou seja: o custo real é **por geração de roteiro novo**, não por hora de live. Um
plano de R$297/mês comporta ~10–15 gerações completas/mês com margem saudável. O
sistema de créditos existe justamente para conter quem gera demais — precisa ser
medido em **caracteres**, debitado *antes* da chamada, e com estimativa mostrada
ao usuário antes de confirmar.

Com o multinível pagando até 60% em comissão, essa planilha fica apertada: o custo
de aquisição some da margem no mesmo mês. **Travar custo por plano, limite de
créditos, percentual de comissão por nível e ponto de prejuízo antes da fase 1.**

---

## 6. Extensão Chrome — construir com rede de proteção

Rota escolhida: extensão que injeta o áudio no LIVE Studio, lê o chat e responde.
É o maior diferencial percebido, e carrega dois riscos concretos: **quebra técnica**
(o TikTok muda o DOM e a base inteira para no mesmo dia) e **risco de conta**
(automação tende a violar os Termos do TikTok, e o ban recai sobre o cliente).

Nenhum dos dois se elimina. Os dois se **contêm**, e isso é decisão de arquitetura
tomada no dia 1 — depois fica caro:

**Contra a quebra técnica**
- **Mapa de seletores servido pela API**, não compilado na extensão. Quando o TikTok
  muda o layout, você publica um JSON novo e todo mundo volta a funcionar em minutos,
  sem republicar nem pedir reinstalação. É a diferença entre 10 minutos e 3 dias parados.
- **Seletores ancorados em texto, `aria-label` e estrutura** — nunca em classe hasheada
  (`.css-1x2y3z`), que muda a cada build deles. Cascata de fallback por seletor.
- **Telemetria de quebra**: a extensão reporta qual seletor falhou. Alerta quando
  N% dos clientes falham no mesmo ponto — você descobre pelo painel, não pelo WhatsApp.
- **Kill switch remoto** e *canary*: liberar versão nova para 5% antes de todos.
- **Autoupdate de verdade**: instalação em modo desenvolvedor não recebe atualização.
  Publicar na Web Store, ou hospedar com `update_url` próprio. O manual de "modo
  desenvolvedor" do concorrente é a maior fonte de suporte deles.
- **MV3**: service worker + *offscreen document* para o áudio (o service worker morre;
  o offscreen document é o que segura reprodução contínua).

**Contra o risco de conta**
- **Separar em dois módulos desde o começo**: (a) mixer de áudio — cria o dispositivo
  virtual e toca o loop; (b) automação de chat — lê e responde. Se (b) precisar morrer,
  (a) continua e o produto sobrevive. Se estiverem acoplados, cai tudo junto.
- **Aviso explícito de risco nos Termos de Uso e no onboarding**, com aceite registrado.
- Limites de cadência humanos na resposta ao chat (intervalo variável, teto por minuto).
- Plano B pronto e testado: app desktop mixer, que não automatiza conta.

---

## 7. Afiliados multinível — o que precisa estar certo

Escopo escolhido: 3 níveis de profundidade + papel de gerente com 60%.

**Risco jurídico, dito uma vez.** Ganho derivado de recrutamento em profundidade é
o desenho que atrai enquadramento como pirâmide (Lei 1.521/51, art. 2º, IX). O que
separa um programa legítimo é a comissão estar amarrada a **venda de assinatura
paga**, não a cadastro. Vale passar por advogado antes de ir ao ar — não é bloqueio
para construir, é bloqueio para lançar.

**No código, o que evita prejuízo e processo:**
- Comissão gerada **só em pagamento confirmado**, nunca em cadastro ou promoção.
- **Clawback**: chargeback ou reembolso estorna a comissão dos três níveis.
- **Saldo pendente × disponível**, com prazo de liberação (D+30 é o usual) — sem isso
  você paga comissão de venda que vai ser estornada.
- **KYC no saque** (CPF, conta bancária no mesmo titular), teto por período,
  retenção de IR e recibo.
- **LGPD**: o painel de gerente do Live Fox expõe usernames e valores depositados da
  downline. O nosso mostra nome de exibição e valores agregados — nunca e-mail, CPF
  ou telefone de quem o gerente não cadastrou pessoalmente.
- **Trilha de auditoria** imutável de cada comissão: origem, nível, pagamento que a
  gerou, estado. É o que responde a uma disputa seis meses depois.

---

## 8. Fases

| Fase | Entrega | Duração |
|---|---|---|
| ✅ **0 — Fundação** | Repo, design system verde claro/escuro, layout, auth, banco | **feito** |
| ✅ **1 — Núcleo de IA** | Produtos, roteiro (Claude), vozes, TTS, biblioteca, fila de jobs | 1–1,5 semana |
| ✅ **2 — Áudio da live** | Montagem do loop, trilha ambiente, player, download/stream | ~1 semana |
| ✅ **3 — Monetização** | Planos, créditos, checkout PIX/cartão, webhooks, medidor de consumo | ~1 semana |
| ✅ **4 — Dados** | Dashboard de vendas, realtime, ranking, push | ~1 semana |
| ✅ **5 — Extensão** | MV3, mixer de áudio, mapa remoto de seletores, telemetria, chat | 2–3 semanas |
| ✅ **6 — Afiliados** | 3 níveis, gerente, comissões, clawback, saques, KYC | 1,5–2 semanas |
| ✅ **7 — Conteúdo** | Aulas, onboarding, clonagem de voz, landing | ~1 semana |

**MVP cobrável ao fim da fase 3 — ~4 semanas. v1 completa — ~10 a 11 semanas.**
A fase 5 é a de estimativa menos confiável: depende do DOM de um sistema de
terceiro que ninguém controla.

---

## 9. O que ainda falta definir

Nada disso bloqueia as fases 1 e 2:

1. **Gateway de pagamento** — Asaas, Mercado Pago ou Pagar.me? *(bloqueia a fase 3)*
2. **Marca** — "Shopia" está no código, no manifesto do PWA e no ícone. Falta
   dizer se é definitivo, e se há logo e domínio.
3. **Chaves de API** — Anthropic e ElevenLabs ficaram atrás de variáveis de
   ambiente (`.env.example`). O código de integração entra na fase 1; a conta
   precisa existir antes de testar de ponta a ponta.
4. **Tabela de planos e comissões** — os números da seção 5, fechados.
   `supabase/migrations/0002_planos_seed.sql` semeia só os dois preços que o
   levantamento confirmou; o tier intermediário e o teto de créditos por plano
   (`planos.creditos_mes`, em caracteres) estão nulos de propósito.
5. **E-mail transacional** — o fluxo de confirmação e recuperação está pronto,
   com token no banco. Falta o provedor: sem `RESEND_API_KEY` o conteúdo vai
   para o log do servidor e nenhum e-mail sai.


---

## 10. O que está no ar e o que ainda não roda de verdade

Todas as 19 telas foram construídas e sobem funcionando. Três delas dependem
de coisas que ainda não existem, e isso não se resolve com código:

| Depende de | Telas | O que acontece hoje |
|---|---|---|
| **Extensão de navegador** | `/dashboard`, `/ranking`, `/painel`, e a parte de dados de `/live` | Sobem e consultam o banco de verdade, mas mostram estado vazio: a única origem de venda e de evento é a extensão, que ainda não existe como código |
| **Gateway de pagamento** (§9.1) | `/planos`, `/creditos` | Comparativo, extrato e projeção funcionam. Assinar e comprar ficam **desabilitados**, com aviso — cobrança nunca é simulada |
| **Chaves de IA e voz** | `/roteiro`, `/estudio`, `/clonar`, `/vozes` | Funcionam de ponta a ponta com exemplo rotulado. Com a chave, passam a gerar de verdade sem mudar uma linha |
| **Parecer jurídico** (§7) | `/indique`, `/gerente`, `/afiliado` | Construídas e funcionando, com aviso no topo. Nenhum pagamento sai automaticamente: saque cria pendência de aprovação |

### Correção de duas afirmações erradas deste documento

**A ingestão de venda NÃO está pronta.** Uma versão anterior desta seção dizia
que sim. As rotas que existem em `/api/ext/` são quatro — `licenca`,
`seletores`, `telemetria` e `baixar`. Não há rota para a extensão abrir ou
fechar sessão, mandar batimento, registrar evento de chat ou registrar venda.
O schema e os gatilhos de rollup existem (0006); os endpoints, não. São 3 a 5
dias de trabalho que ninguém fez.

**A extensão não são 2 a 3 semanas.** A estimativa da fase 5 está errada por um
fator de 3 a 4. A conta honesta, de uma auditoria de prontidão feita em
11/09/2026: 6 a 10 semanas de um dev só para o pacote MV3, e ela sozinha não
fecha nada — some o spike de injeção de áudio (3 a 5 dias, e é ele que pode
dizer que não dá para fazer com extensão), os endpoints de ingestão (3 a 5
dias), a metade servidor do "responde o chat" (1 a 1,5 semana), o console para
publicar versão e mapa (3 a 5 dias) e a revisão da Chrome Web Store.

### A conta de margem do §5 está otimista

Um áudio de 3h custa 108.000 caracteres ≈ US$16,20. O ponto de equilíbrio do
Premium sem afiliado é **3,3 gerações/mês**; com afiliado de nível 1, 2,3; com
a cadeia cheia mais gerente (63% da venda), **1,2**. As "10 a 15 gerações com
margem saudável" que este documento prometia dão **prejuízo de ~US$107 por
cliente por mês**. E o preço de US$0,15/1.000 caracteres só vale em volume de
Scale — nos primeiros clientes você está em Creator/Pro, a US$0,20–0,31/1.000.

**Decidir `planos.creditos_mes` com esses números é pré-requisito de cobrar.**
