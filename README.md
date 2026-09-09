# Shopia

Plataforma de live commerce com IA: gera o roteiro de vendas, sintetiza a voz da
apresentadora e monta o áudio contínuo da live — com acompanhamento de vendas em
tempo real.

Identidade visual em **verde**, com **tema claro e escuro** desde a fundação.

## Estado

Fase 0 — fundação. Ainda sem aplicação; o que existe é a base de decisão:

| Arquivo | Conteúdo |
|---|---|
| [`docs/PLANO.md`](docs/PLANO.md) | O que é preciso para construir: análise, stack, escopo, custos, fases |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | Paleta verde, regras de claro/escuro, contraste verificado |
| [`design/tokens.css`](design/tokens.css) | Tokens prontos para uso (CSS custom properties) |
| [`docs/referencia-livefox.md`](docs/referencia-livefox.md) | Mapeamento do concorrente, usado como especificação |

## Prévia da paleta

Página com a escala, os tokens, o contraste medido e o painel de vendas montado
só com os tokens — com controle de tema (sistema / claro / escuro):

**https://claude.ai/code/artifact/427db682-c6e0-4cfb-8ec5-864c527942b1**

## Tema

Um token semântico por decisão visual; os componentes nunca tocam nas primitivas.

```css
@import "./design/tokens.css";

.botao {
  background: var(--primary);
  color: var(--primary-fg);
  border-radius: var(--radius-md);
}
```

Três estados de tema: seguir o sistema (padrão), `data-theme="light"` e
`data-theme="dark"` no elemento raiz.
