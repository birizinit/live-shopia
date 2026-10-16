# Shopia — Design System

Base: `design/tokens.css`. Regra única — **componentes só consomem tokens semânticos**
(`--surface`, `--text`, `--primary`…), nunca as primitivas (`--red-500`).
Trocar o tema passa a ser redefinir uma lista de variáveis, não caçar cor no código.

## 1. A paleta — a do TikTok

A Shopia vive dentro do TikTok Shop, então usa a paleta e a fonte do TikTok.
O **logo continua o da Shopia** (as barras), no ladrilho preto com o
deslocamento ciano/vermelho: paleta do TikTok, marca nossa — a Shopia não é
produto oficial do TikTok e não usa o logo dele.

| Token | Hex | Onde entra |
|---|---|---|
| `--red-500` | `#FE2C55` | **primário** (botão, link, foco) nos dois temas |
| `--red-600` | `#E8174A` | hover do primário no claro |
| `--red-700` | `#C4103D` | texto sobre o rosa claro, perigo no claro |
| `--red-50` | `#FFF0F3` | fundo de badge/alerta no claro |
| `--cyan-400` | `#25F4EE` | segundo acento (`--accent-2`), detalhes e brilhos |
| `--gray-900` | `#161823` | texto no claro (o escuro do TikTok) |
| `--gray-950` | `#121212` | fundo no escuro (o do TikTok na web) |

Neutros: a escala `--gray-*` é a do TikTok, sem viés de cor.

## 2. Claro vs. escuro

**1. O primário é o mesmo vermelho nos dois temas**, como no TikTok. O que
muda é o "texto de marca" em fundo suave: `--primary-soft-fg` é `#C4103D` no
claro e `#FF8FA6` no escuro.

**2. No escuro, elevação é cor, não sombra.** `--bg` (`#121212`) →
`--surface` (`#1F1F1F`) → `--surface-raised` (`#2A2A2A`).

**3. Três estados de tema, não dois.** O padrão é "seguir o sistema";
`data-theme` no `<html>` sobrepõe nos dois sentidos.

## 3. Contraste (WCAG)

| Combinação | Razão | Uso |
|---|---|---|
| branco sobre `#FE2C55` | 3.7:1 | ✅ botão e texto grande/negrito (AA 3:1); ❌ texto corrido pequeno |
| `#C4103D` sobre `#FFF0F3` | 5.4:1 | ✅ texto de badge/alerta no claro |
| `#161823` sobre `#FFFFFF` | 17.9:1 | ✅ texto |
| `#F1F1F2` sobre `#121212` | 16.9:1 | ✅ texto no escuro |

O vermelho do TikTok com texto branco não chega a 4.5:1 — é a escolha do
próprio TikTok para botões. Por isso ele fica em botão, link curto e destaque,
e o texto pequeno sobre fundo rosa usa o `--red-700`.

## 4. Fora da cor

- **Tipografia**: **TikTok Sans** (licença OFL) em tudo — título 700/800 e
  texto 400/500, como no app do TikTok — e **IBM Plex Mono** só para números
  e códigos. No app vem do `next/font`; na extensão, de `extensao/fontes/`.
  Números de faturamento em *tabular-nums*.
- **Raio**: 8px é o padrão (`--radius-md`); 12px em cards; pill só em badge e avatar.
- **Espaçamento**: múltiplos de 4. Respiro interno de card = 20px mobile, 24px desktop.
- **Movimento**: 120ms para hover, 200ms para painel/modal, `--ease-out`.
  Respeitar `prefers-reduced-motion`.
- **Gráficos**: `--chart-1..6`. A série 1 é sempre a marca; as outras foram
  escolhidas para se separarem também em escala de cinza e em daltonismo.

## 5. Ligando no Tailwind v4

```css
@import "./tokens.css";

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-border: var(--border);
  --color-fg: var(--text);
  --color-fg-muted: var(--text-muted);
  --color-primary: var(--primary);
  --color-primary-fg: var(--primary-fg);
  --radius: var(--radius-md);
}
```

Com shadcn/ui, mapear os nomes dele (`--background`, `--foreground`, `--card`,
`--primary`, `--muted`, `--accent`, `--destructive`, `--ring`) para estes tokens
e todo o catálogo de componentes já sai nas cores do TikTok nos dois temas.

## 6. Evitar o flash branco

O tema tem que ser aplicado **antes** da primeira pintura. Script inline no `<head>`:

```html
<script>
  (function () {
    try {
      var t = localStorage.getItem("shopia_theme");
      if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
    } catch (e) {}
  })();
</script>
```

Para a barra do navegador no PWA: um único `<meta name="theme-color">`, que o
mesmo script ajusta antes da primeira pintura e o provider mantém em dia. Duas
tags com `media="(prefers-color-scheme: …)"` só resolveriam o caso "seguir o
sistema" — quando o usuário escolhe explicitamente o tema oposto ao do SO, o
navegador continua casando pela media query e a barra fica com a cor errada.

Implementado em `src/components/theme/` — `theme-script.tsx` (antes da pintura),
`theme-provider.tsx` (estado, via `useSyncExternalStore`) e `theme-toggle.tsx`
(os três estados).
