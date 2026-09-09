# Shopia — Design System

Base: `design/tokens.css`. Regra única — **componentes só consomem tokens semânticos**
(`--surface`, `--text`, `--primary`…), nunca as primitivas (`--green-600`).
Trocar o tema passa a ser redefinir uma lista de variáveis, não caçar cor no código.

## 1. A paleta

### Verde da marca
| Token | Hex | Onde entra |
|---|---|---|
| `--green-50` | `#ECFDF3` | fundo de badge/alerta no claro |
| `--green-100` | `#D1FADF` | hover de badge |
| `--green-200` | `#A6F4C5` | borda suave |
| `--green-300` | `#6CE9A6` | hover do primário no escuro |
| `--green-400` | `#32D583` | **primário no escuro**, séries de gráfico |
| `--green-500` | `#12B76A` | foco (`--ring`), destaque |
| `--green-600` | `#039855` | sucesso no claro, gráfico |
| `--green-700` | `#027A48` | **primário no claro** |
| `--green-800` | `#05603A` | hover do primário no claro |
| `--green-900` | `#054F31` | pressionado |
| `--green-950` | `#032B1C` | fim do gradiente |

### Neutros
Neutros puros ficam sujos ao lado de verde saturado, então a escala `--gray-*`
tem um viés verde de ~4% de croma. Isso é o que faz a interface parecer
"de uma marca só" em vez de "cinza com botão verde".

## 2. Claro vs. escuro — as três decisões que importam

**1. O primário troca de tom entre os temas.** `#027A48` num fundo escuro é
quase invisível; `#32D583` num fundo branco não tem contraste com texto branco.
Um verde só para os dois temas é o erro mais comum.

| | claro | escuro |
|---|---|---|
| `--primary` | `#027A48` | `#32D583` |
| `--primary-fg` (texto sobre o primário) | `#FFFFFF` | `#042E1C` |
| contraste | **5.4:1** ✅ | **7.8:1** ✅ |

No escuro o texto do botão é **verde-escuro sobre verde-claro**, não branco.

**2. No escuro, elevação é cor, não sombra.** Sombra some em fundo preto.
`--bg` (`#0A100D`) → `--surface` (`#151E19`) → `--surface-raised` (`#26322C`):
cada camada sobe um degrau.

**3. Três estados de tema, não dois.** O padrão é "seguir o sistema".
`data-theme="dark"` / `data-theme="light"` no `<html>` sobrepõe a preferência do SO
nos dois sentidos — o `tokens.css` já cobre os três casos.

## 3. Contraste verificado (WCAG AA)

| Combinação | Tema | Razão |
|---|---|---|
| `--primary-fg` sobre `--primary` | claro | 5.4:1 ✅ |
| `--primary-fg` sobre `--primary` | escuro | 7.8:1 ✅ |
| `--primary` como texto sobre `--bg` | claro | 5.0:1 ✅ |
| `--primary` sobre `--surface` | escuro | 8.1:1 ✅ |
| `--text-muted` sobre `--bg` | escuro | 9.6:1 ✅ |
| `--text-subtle` sobre `--surface` | escuro | 6.0:1 ✅ |

Nunca usar `--green-500`/`--green-600` como fundo de botão com texto branco no
tema claro (3.7:1 — reprova). É por isso que o primário claro é o `700`.

## 4. Fora da cor

- **Tipografia**: **Bricolage Grotesque** (display, 600/800) + **Public Sans**
  (interface e texto) + **IBM Plex Mono** (números, tokens, códigos). Escala
  12 / 14 / 16 / 20 / 24 / 32 / 48. Números de faturamento em *tabular-nums* —
  senão o dashboard "treme" a cada atualização.
  *Não usar Inter*: é a fonte do Live Fox e o padrão de todo SaaS — não diferencia nada.
- **Raio**: 10px é o padrão (`--radius-md`); 14px em cards; pill só em badge e avatar.
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
e todo o catálogo de componentes já sai verde nos dois temas.

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

E `<meta name="theme-color">` em duas versões (`media="(prefers-color-scheme: dark)"`)
para a barra do navegador no PWA acompanhar o tema.
