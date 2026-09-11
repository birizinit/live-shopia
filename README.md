# Shopia

Plataforma de live commerce com IA: gera o roteiro de vendas, sintetiza a voz da
apresentadora e monta o áudio contínuo da live — com acompanhamento de vendas em
tempo real.

Identidade visual em **verde**, com **tema claro e escuro** desde a fundação.

## Rodar

```bash
npm install
npm run dev
```

Sem `.env.local`, o app sobe em **modo demo**: sessão falsa, qualquer e-mail
entra, nada persiste. Use `demo@`, `afiliado@` ou `gerente@` (senha de 8+
caracteres) para ver cada papel. Para ligar no Supabase de verdade, copie
`.env.example` para `.env.local` e aplique as migrações de
[`supabase/`](supabase/README.md).

| Comando | O que faz |
|---|---|
| `npm run dev` | Desenvolvimento (Turbopack) |
| `npm run build` | Build de produção |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

## Estado

**Fase 0 — fundação: concluída.** Existe aplicação: navegação completa das 26
telas, tema claro/escuro, autenticação, guard de rota e de papel, schema do
banco com RLS. As telas de produto ainda são especificação — cada uma mostra o
que vai fazer e em que fase entra, e vira tela de verdade na sua fase.

| Onde | O quê |
|---|---|
| [`docs/PLANO.md`](docs/PLANO.md) | Análise, stack, escopo, custos e fases |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | Paleta verde, claro/escuro, contraste verificado |
| [`design/tokens.css`](design/tokens.css) | Tokens em duas camadas |
| [`supabase/`](supabase/README.md) | Migrações, RLS e configuração do projeto |
| [`docs/referencia-livefox.md`](docs/referencia-livefox.md) | Mapeamento do concorrente, usado como spec |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Supabase
(Postgres + Auth + RLS) · TanStack Query.

## Como o código está organizado

```
src/
├── app/
│   ├── (auth)/          login, cadastro, recuperação — layout próprio
│   ├── (app)/           casca autenticada: sidebar, topbar, barra inferior
│   ├── layout.tsx       fontes, tema sem flash, providers
│   └── page.tsx         landing
├── components/
│   ├── layout/          sidebar, topbar, tab bar, menu do mobile
│   ├── theme/           três estados de tema (sistema / claro / escuro)
│   └── ui/              primitivas, todas consumindo tokens
├── lib/
│   ├── nav.ts           árvore de navegação — fonte única do menu
│   ├── rotas.ts         mapa do guard (privado por padrão)
│   ├── sessao.ts        quem está pedindo + guard de papel
│   └── supabase/        clientes por requisição
└── proxy.ts             guard de sessão e rotação do refresh token
```

Três coisas que valem saber antes de mexer:

- **Navegação tem fonte única.** Rota nova entra em `src/lib/nav.ts` e aparece
  sozinha na sidebar, no menu do mobile e nas checagens de papel.
- **O guard é privado por padrão.** `src/lib/rotas.ts` lista o que é público; o
  resto exige sessão. Rota nova nasce protegida.
- **Componente nunca toca em primitiva de cor.** Só nos tokens semânticos
  (`--surface`, `--primary`, `--text`…). Trocar o tema é redefinir uma lista de
  variáveis, não caçar cor no código.

## Segurança — o que foi feito diferente do original

O levantamento do concorrente ([§9](docs/referencia-livefox.md)) achou problemas
reais. As correções são estruturais e estão no lugar desde a fase 0:

| Lá | Aqui |
|---|---|
| JWT de 30 dias em `localStorage` | Cookie `HttpOnly` + `Secure` + `SameSite=Lax`, com rotação no proxy. O token não é legível por JavaScript de página — nem por um XSS |
| Flag `admin` dentro do JWT | Papel mora em `perfis.papel`, lido do banco sob RLS a cada requisição |
| `device_id` aceito sem validação | Tabela `dispositivos` com registro por conta |
| Painel expondo username e depósito da downline | Nome de exibição e valores agregados; nada de e-mail, CPF ou telefone |
| — | Saldo de crédito é razão append-only com idempotência, não um campo que se sobrescreve |

Rate limit em `/login`, `/cadastro` e recuperação de senha é do lado do
Supabase e entra junto com a configuração do projeto (ver
[`supabase/README.md`](supabase/README.md)).

## Prévia da paleta

Escala, tokens, contraste medido e um painel de vendas montado só com os tokens:

**https://claude.ai/code/artifact/427db682-c6e0-4cfb-8ec5-864c527942b1**
