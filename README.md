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
caracteres) para ver cada papel. Para ligar no banco de verdade, copie
`.env.example` para `.env.local`, preencha `DATABASE_URL` e rode
`npm run db:migrate` (ver [`db/`](db/README.md)).

| Comando | O que faz |
|---|---|
| `npm run dev` | Desenvolvimento (Turbopack) |
| `npm run build` | Build de produção |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Aplica as migrações pendentes |

## Estado

**Fases 0 a 7 construídas.** As 26 telas existem e funcionam, mais um tour
guiado de onboarding. 61 tabelas, fila de jobs em Postgres, worker no próprio
processo, Claude e ElevenLabs integrados.

Três coisas não rodam de verdade ainda, e não é por falta de código:
`/dashboard` e `/ranking` sobem vazios porque a única origem de venda é a
extensão, que ainda não existe; `/planos` e `/creditos` têm o checkout
desabilitado até o gateway ser escolhido; e o roteiro e o áudio saem como
exemplo rotulado até as chaves de IA entrarem. Detalhe em
[`docs/PLANO.md`](docs/PLANO.md) §10.

| Onde | O quê |
|---|---|
| [`docs/PLANO.md`](docs/PLANO.md) | Análise, stack, escopo, custos e fases |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | Paleta verde, claro/escuro, contraste verificado |
| [`design/tokens.css`](design/tokens.css) | Tokens em duas camadas |
| [`db/`](db/README.md) | Migrações e as decisões fixadas no schema |
| [`docs/referencia-livefox.md`](docs/referencia-livefox.md) | Mapeamento do concorrente, usado como spec |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Postgres
(Railway) · TanStack Query.

Autenticação é nossa: Argon2id para senha, sessão opaca no banco, token de
confirmação e de recuperação por e-mail. Não há cliente de banco no navegador —
toda leitura passa por Server Component ou Server Action.

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
│   ├── auth/            sessões e tokens de e-mail
│   ├── dados/           um módulo por domínio; perfilId é sempre o 1º argumento
│   ├── integracoes/     Claude e ElevenLabs, com exemplo quando falta a chave
│   ├── worker/          fila de jobs e os handlers
│   ├── armazenamento.ts áudio em blocos, hoje no próprio Postgres
│   ├── caracteres.ts    a contagem canônica — crédito é medido aqui
│   ├── db.ts            conexão com o Postgres
│   └── senha.ts         Argon2id
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
- **Sem RLS, o escopo é da consulta.** Toda função em `src/lib/dados/` recebe
  `perfilId` como primeiro argumento e usa no `where`. Sem exceção.
- **Crédito só sai por uma porta**: `debitarEEnfileirar()`. O débito e o
  enfileiramento acontecem no mesmo commit, e a chave de idempotência nasce no
  render do formulário — não dentro da action, senão o duplo clique cobra duas
  vezes.
- **O áudio de 3h não existe como arquivo.** São ~45 blocos de ~2 MB tocados em
  ordem. Repetir a lista em laço não gasta crédito, e é isso que sustenta a
  margem do produto.

## Segurança — o que foi feito diferente do original

O levantamento do concorrente ([§9](docs/referencia-livefox.md)) achou problemas
reais. As correções são estruturais e estão no lugar desde a fase 0:

| Lá | Aqui |
|---|---|
| JWT de 30 dias em `localStorage` | Sessão opaca em cookie `HttpOnly` + `Secure` + `SameSite=Lax`. O banco guarda só o hash do token; sair revoga na hora. Nada legível por JavaScript de página — nem por um XSS |
| Flag `admin` dentro do JWT | Papel mora em `perfis.papel`, lido do banco a cada requisição |
| `device_id` aceito sem validação | Cookie de dispositivo próprio, gravado em `dispositivos` e carimbado na sessão |
| Senha em esquema não declarado | Argon2id com os parâmetros da OWASP; resposta de login com tempo constante, para não entregar quais e-mails têm conta |
| Painel expondo username e depósito da downline | Nome de exibição e valores agregados; nada de e-mail, CPF ou telefone |
| — | Saldo de crédito é razão append-only com idempotência, não um campo que se sobrescreve |

Rate limit em login, cadastro e recuperação ainda não existe — era o que o
Supabase dava de graça e agora é nosso; entra junto com o Redis da fase 1.

## Deploy

Railway, com o serviço apontado para este repositório.
[`railway.json`](railway.json) já define build, start, healthcheck em
`/api/saude` e `npm run db:migrate` como pre-deploy — todo deploy migra o banco
antes de trocar a versão no ar.

Variáveis necessárias no serviço: `DATABASE_URL` (referenciando o serviço
Postgres) e, opcionalmente, `RESEND_API_KEY` para o e-mail sair de verdade.

## Prévia da paleta

Escala, tokens, contraste medido e um painel de vendas montado só com os tokens:

**https://claude.ai/code/artifact/427db682-c6e0-4cfb-8ec5-864c527942b1**
