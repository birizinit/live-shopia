# Banco

Postgres gerenciado pelo Supabase. As migrações aqui são a fonte de verdade do
schema — nada de editar tabela pelo painel e esquecer de refletir no repositório.

## Aplicar

Com a [CLI do Supabase](https://supabase.com/docs/guides/local-development):

```bash
supabase link --project-ref <ref-do-projeto>
supabase db push
```

Sem a CLI: abrir o SQL Editor do projeto e rodar os arquivos de
`migrations/` em ordem.

## Depois de aplicar

Gerar os tipos e commitar — enquanto eles não existem, `src/lib/sessao.ts`
carrega tipos locais escritos à mão só para o TypeScript não inferir `never`:

```bash
supabase gen types typescript --project-id <ref> --schema public > src/lib/database.types.ts
```

## Configuração do projeto que o código pressupõe

| Onde | Ajuste | Por quê |
|---|---|---|
| Auth › Sessions | JWT expiry curto (15 min) e **refresh token rotation** ligada | O token longo do concorrente é o que transforma um XSS em um mês de acesso |
| Auth › Providers | E-mail + senha, confirmação de e-mail ligada | — |
| Auth › URL Configuration | Site URL e redirect de `/redefinir` | Link de redefinição precisa voltar para o app |
| Auth › Rate limits | Limitar login, cadastro e recuperação | `PLANO.md` §2 |

## O que está e o que não está

Fase 0 cobre conta, dispositivo, plano, assinatura e a razão de créditos.
Produtos, roteiros, vozes, áudios, vendas e comissões entram nas fases 1 a 6.

Três decisões já fixadas no schema, porque mudar depois é caro:

1. **Papel mora no banco** (`perfis.papel`), lido a cada requisição sob RLS.
   Nunca num claim do JWT.
2. **Crédito é razão append-only** (`creditos_lancamentos`); `perfis.creditos`
   é só um cache mantido por trigger. Débito acontece *antes* da chamada à
   ElevenLabs e `referencia` dá idempotência — retry de job não cobra de novo.
3. **RLS ligada com grant estreito.** O Supabase libera tudo em `public` por
   padrão; a migração revoga e devolve coluna a coluna. Sem isso, política de
   update deixa o usuário reescrever o próprio papel e o próprio saldo.
