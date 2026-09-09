# Shopia — o que é preciso para construir

Documento de partida. Base: engenharia reversa do **Live Fox IA**
(`docs/referencia-livefox.md`), que serve como *spec* — o mapa de rotas, o
contrato da API e o modelo de negócio já estão levantados.

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

**O ponto frágil é C.** Uma extensão instalada em *modo desenvolvedor* (o próprio
manual do Live Fox ensina isso) é sinal de que ela não passa na Chrome Web Store.
Ela depende do DOM do TikTok LIVE Studio: uma mudança de layout derruba a base
inteira de clientes em um dia, e a automação tende a violar os Termos do TikTok —
o risco recai sobre a conta do seu cliente. **Ver a seção 6**, é a decisão mais
importante do projeto.

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

## 2. Stack recomendada

### Frontend
- **Next.js 15 (App Router) + React 19 + TypeScript**
- **Tailwind v4 + shadcn/ui**, tematizado pelos tokens de `design/tokens.css`
- **PWA** (manifest, service worker, Web Push VAPID) — o app é mobile-first
- Estado de servidor com **TanStack Query**; estado local com Zustand

> *Alternativa*: Vue 3 + Nuxt, espelhando o original. Escolho Next porque a landing
> precisa de SSR/SEO e porque o shadcn entrega o catálogo de componentes já pronto
> para receber a paleta verde — economiza semanas de UI.

### Backend
Duas rotas defensáveis:

**A) Supabase + worker Node** *(recomendado para o MVP)*
Postgres gerenciado, Auth (com reset de senha e refresh token em cookie), RLS,
Realtime (substitui o SSE do original), Storage para os áudios. Sobra para nós um
serviço Node pequeno: jobs de IA/TTS e webhooks de pagamento. Corta ~40% do backend.

**B) Node + Fastify + Prisma + Postgres próprio**
Controle total, sem lock-in, igual ao original. Mais trabalho de auth e realtime.

### Infra transversal
- **Fila**: BullMQ + Redis. Gerar 3h de áudio **não pode ser requisição síncrona** —
  é job com progresso, retry e idempotência.
- **Storage/CDN**: Cloudflare R2 (egress zero). Áudio de 3h é pesado e é servido
  repetidamente; egress é o custo que surpreende.
- **Deploy**: Vercel (front) + Fly.io ou Railway (API + worker) + Upstash (Redis).

### Autenticação — corrigindo o original
- Access token de 15 min + **refresh token em cookie `HttpOnly; Secure; SameSite=Lax`**, com rotação.
- Papéis no banco, validados no servidor a cada requisição (RLS no Supabase).
- `device_id` registrado e **efetivamente validado** no login.
- Rate limit em `/login`, `/cadastro`, `/senha/*`. Senha com Argon2id.

---

## 3. Escopo — MVP vs. depois

### MVP (é o produto existir)
1. Auth, conta, perfil, planos
2. Produtos
3. Roteiro por IA — gancho → oferta → prova → objeções → CTA (Claude)
4. Catálogo de vozes + TTS + biblioteca de áudios (ElevenLabs)
5. Montagem do áudio da live (loop contínuo + som ambiente) e player
6. Dashboard de vendas
7. Créditos e checkout (PIX + cartão + assinatura)
8. Tema claro/escuro + PWA

### v2
9. Clonagem de voz · 10. Ranking · 11. Aulas · 12. Push notifications
13. Extensão / app desktop (**ver seção 6**)

### v3 — e com cautela
14. Indique e ganhe · 15. Gerente / multinível

> Sobre 14–15: um programa de comissão em **3 níveis de profundidade**, com ganho
> derivado do recrutamento, é o desenho que atrai enquadramento como pirâmide
> (Lei 1.521/51, art. 2º, IX). Vale desenhar com advogado e amarrar a comissão a
> **venda de assinatura**, não a recrutamento. Não é bloqueio para o MVP — é motivo
> para deixar por último, e não para copiar o modelo do original sem revisão.

---

## 4. Contas e serviços que você precisa contratar

| Serviço | Para quê | Custo |
|---|---|---|
| **Anthropic (Claude)** | roteiro de vendas | pago por uso; um roteiro custa centavos |
| **ElevenLabs** | TTS + clonagem de voz | **principal custo variável** — ver seção 5 |
| **Gateway BR** (Asaas / Mercado Pago / Pagar.me) | PIX + cartão + **assinatura recorrente** | ~1% PIX, ~3,5% cartão |
| **Supabase** | banco, auth, storage, realtime | ~US$25/mês |
| **Cloudflare R2** | áudios + CDN | ~US$5/mês |
| **Upstash Redis** | fila de jobs | ~US$10/mês |
| **Vercel** | front | US$0–20/mês |
| **Resend / SES** | e-mail transacional | ~US$0–20/mês |
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

Recomendo travar essa planilha (custo por plano, limite de créditos, ponto de
prejuízo) **antes** da fase 1.

---

## 6. A decisão que mais pesa: como o áudio chega no TikTok

**Rota A — extensão Chrome (o que o Live Fox faz).** Injeta áudio no LIVE Studio,
lê o chat pelo DOM e responde sozinha. Entrega a experiência completa e é o maior
diferencial percebido. Em troca: instalação em modo desenvolvedor, quebra a cada
atualização do TikTok, e automação de conta que tende a violar os Termos —
com o ban recaindo sobre o cliente.

**Rota B — app desktop "mixer" (Electron/Tauri).** Cria um dispositivo de áudio
virtual que o usuário seleciona como microfone dentro do LIVE Studio. Não automatiza
a conta, não raspa o chat, não injeta script em site de terceiro. Perde a resposta
automática ao chat; mantém roteiro + voz + áudio contínuo + trilha ambiente.

**Rota C — só web, no MVP.** O usuário baixa o áudio pronto e toca por conta
própria. Zero atrito de distribuição, valida o produto em semanas.

**Minha recomendação: C no MVP, B na v2.** Os blocos A e B da seção 1 já são um
produto vendável — roteiro que converte + voz ultrarrealista + 3h de áudio contínuo
— e não dependem de nada que possa ser derrubado por uma atualização do TikTok ou
por uma denúncia. A resposta automática ao chat é a única coisa que exige a Rota A,
e é justamente a que carrega o risco.

É uma decisão de negócio, não técnica: se você quiser a Rota A, ela é construível
e eu construo. Mas ela precisa ser escolhida com o risco na mesa, não por inércia
de estar copiando o concorrente.

---

## 7. Fases

| Fase | Entrega | Duração |
|---|---|---|
| **0 — Fundação** | Repo, design system verde claro/escuro, layout, auth, banco, deploy | 3–5 dias |
| **1 — Núcleo de IA** | Produtos, roteiro (Claude), vozes, TTS, biblioteca, fila de jobs | 1–1,5 semana |
| **2 — Áudio da live** | Montagem do loop, trilha ambiente, player, download/stream | ~1 semana |
| **3 — Monetização** | Planos, créditos, checkout PIX/cartão, webhooks, medidor de consumo | ~1 semana |
| **4 — Dados** | Dashboard de vendas, realtime, ranking, push | ~1 semana |
| **5 — Distribuição** | Rota B ou A, aulas, onboarding | 1–2 semanas |
| **6 — Crescimento** | Indicação e, se for o caso, multinível revisado juridicamente | 1–2 semanas |

**MVP vendável ao fim da fase 3 — ~4 semanas.** Fases 0–1 já produzem telas
navegáveis com dados reais.

---

## 8. O que eu preciso de você para começar

1. **Stack** — confirma Next.js + Supabase, ou prefere Vue/Nuxt e backend próprio?
2. **Rota de distribuição** — A, B ou C (seção 6)?
3. **Gateway de pagamento** — Asaas, Mercado Pago, Pagar.me?
4. **Marca** — "Shopia" é o nome definitivo? Tem logo/tipografia?
5. **Escopo do MVP** — entra afiliados na v1 ou fica para depois?
6. **Chaves** — já tem conta Anthropic e ElevenLabs, ou eu deixo a integração
   pronta atrás de variáveis de ambiente?

Nada disso bloqueia a **fase 0**: o design system verde nos dois temas e o
scaffolding da aplicação podem começar hoje.
