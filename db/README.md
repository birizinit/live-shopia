# Banco

Postgres puro, rodando na Railway. As migrações em `migrations/` são a fonte de
verdade do schema — nada de mexer em tabela pelo cliente gráfico e esquecer de
refletir aqui.

## Aplicar

```bash
npm run db:migrate
```

Roda os `.sql` em ordem, uma transação por arquivo, e anota o que já foi em
`_migracoes`. Rodar duas vezes não faz nada — é por isso que o comando está
pendurado no `preDeployCommand` do [`railway.json`](../railway.json): todo
deploy migra sozinho antes de trocar a versão no ar.

Localmente precisa de `DATABASE_URL` no `.env.local`. Na Railway a variável já
vem injetada.

## O que a saída do Supabase custou, e o que ficou no lugar

O Supabase dava RLS: mesmo com bug na aplicação, o banco recusava devolver a
linha de outro usuário. Postgres puro com um único papel de conexão não tem
essa rede — **o escopo por usuário passou a ser responsabilidade de cada
consulta**.

A convenção que substitui a rede, e que precisa valer sem exceção:

> Toda função que lê ou escreve dado de usuário recebe `perfilId` como primeiro
> argumento e o usa no `where`. Nenhuma consulta parte de um id vindo da URL
> sem confrontar com o dono.

Isso é sustentável porque a arquitetura já fechava esse caminho: não existe
cliente de banco no navegador, toda leitura passa por Server Component ou
Server Action. Se um dia aparecer acesso direto do cliente, RLS volta a ser
obrigatória — com papel de conexão restrito e `set local app.perfil_id`.

Também saíram: Auth (virou `perfis` + `sessoes` + `tokens_email`), Storage (já
era R2 no plano) e Realtime (o dashboard da fase 4 vai de SSE próprio, que é o
que o concorrente faz).

## Decisões fixadas no schema

1. **Papel mora no banco** (`perfis.papel`), lido a cada requisição. Nunca num
   token. `criar_perfil` não aceita papel como parâmetro: nasce `user` e só
   muda por operação de servidor.
2. **Sessão é token opaco.** O banco guarda só o SHA-256; o cookie carrega os
   32 bytes crus. Dump vazado não vira sessão, e revogar é um `update` — que é
   garantia mais forte do que a rotação de refresh token do plano original
   (rotação existe porque JWT não dá para revogar; aqui dá).
3. **Crédito é razão append-only** (`creditos_lancamentos`), com `referencia`
   como chave de idempotência: retry de job de TTS não cobra duas vezes.
   `perfis.creditos` é cache mantido por trigger, e a constraint de
   não-negativo é quem impede o saldo estourar — o débito acontece *antes* da
   chamada à ElevenLabs e falha alto se não houver saldo.
4. **Colisão de @usuario é resolvida dentro da transação** (`criar_perfil`).
   Resolver na aplicação seriam duas idas ao banco com uma corrida no meio:
   dois cadastros simultâneos escolheriam o mesmo sufixo.

## Cobertura

Fase 0: conta, credencial, sessão, token de e-mail, dispositivo, plano,
assinatura e razão de créditos. Produtos, roteiros, vozes, áudios, vendas e
comissões entram nas fases 1 a 6.

## Manutenção pendente

- Faxina de `sessoes` e `tokens_email` expirados (job periódico). Enquanto o
  volume é pequeno as linhas mortas não incomodam; passa a incomodar.
- Rate limit em login, cadastro e recuperação. Era do Supabase; agora é nosso,
  e entra junto com o Redis da fase 1.
