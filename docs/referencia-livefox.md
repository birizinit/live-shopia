# Live Fox IA — Mapeamento Completo da Aplicação

> **Documento técnico de engenharia reversa / mapeamento funcional**
> Alvo: `https://livefox.com.br/` (redireciona para `/estudio/`)
> Data do levantamento: 08/09/2026
> Método: análise do bundle público (Vue/Vite) + navegação autenticada na API REST com conta de teste (`le29`, role *manager*, plano Premium).
> Slogan oficial: *"Sua apresentadora de IA que vende ao vivo no TikTok Shop."*

---

## 1. Visão geral

**Live Fox** é uma plataforma SaaS brasileira (pt-BR) que automatiza **lives de vendas no TikTok Shop** usando IA. Em vez de um humano apresentar produtos ao vivo por horas, a plataforma:

1. Gera a **copy/roteiro de vendas** com IA (**Claude / Anthropic**).
2. Converte o roteiro em **áudio com voz de IA** (**ElevenLabs**), com voz de catálogo ou **voz clonada**, gerando até **3 horas** de áudio contínuo.
3. Uma **extensão de navegador (Chrome, v5.3)** injeta esse áudio no **TikTok LIVE Studio** através de um cabo de áudio virtual, dá boas-vindas, responde o chat e narra o roteiro **em loop, 24h**.
4. **Rastreia vendas/GMV** da live em tempo real e alimenta um **ranking** e um **dashboard**.

O crescimento é impulsionado por um **programa de afiliados multinível (3 níveis)** com papéis de *afiliado* e *gerente*.

### Proposta de valor (retirada da própria interface)
- 👋 Dá boas-vindas a quem entra/segue, pelo nome
- 💬 Responde o chat sozinha (preço, frete, tamanho, cupom…)
- 🗣️ Narra o roteiro em loop por horas
- 🎧 Joga a voz no LIVE Studio via cabo virtual (como se fosse um microfone)
- 🛒 Aciona cupom e destaca o produto fixado
- 🌙 "Vende enquanto você dorme" — live 24h sem aparecer
- 💸 Corta o custo de apresentador

---

## 2. Arquitetura técnica

### 2.1 Frontend
| Item | Detalhe |
|---|---|
| Framework | **Vue 3** (Composition API) |
| Roteamento | **Vue Router** (history base `/estudio/`) |
| Estado | **Pinia** |
| HTTP | **Axios** (`baseURL: "/api"`) |
| Build | **Vite** — `assets/index-C1Whahio.js` + `assets/index-BOR3r8LM.css` |
| Fonte | Inter (Google Fonts) |
| Tipo de app | **PWA instalável** (standalone, portrait, mobile-first), com **push notifications** |
| Idioma | pt-BR |
| Tema | escuro (`theme_color #0a0d14`) |

**Service worker / PWA**: `manifest.webmanifest`, ícones 192/512/maskable, "adicionar à tela inicial". As vendas notificam o usuário via push no celular.

### 2.2 Backend / Infra
| Item | Detalhe |
|---|---|
| Servidor / proxy | **Caddy** (HTTP/3 / `h3`, HSTS, `Vary: Origin`) |
| API | **REST** sob `/api/*`, respostas JSON no padrão `{ "ok": true, ... }` |
| Autenticação | **JWT** (HS256) via header `Authorization: Bearer <token>` |
| Persistência | PostgreSQL (inferido pelos timestamps `+00` e IDs sequenciais) |
| Headers de segurança | `HSTS`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin` |

### 2.3 Integrações externas
| Serviço | Uso |
|---|---|
| **Anthropic Claude** | Geração da copy/roteiro de vendas |
| **ElevenLabs** | TTS (síntese de voz) + clonagem de voz. IDs no formato `el:sample:<voz>` |
| **TikTok Shop / TikTok LIVE Studio** | Destino da live (via extensão de navegador) |
| **Web Push (VAPID)** | Notificações push no PWA |
| **WhatsApp** (`wa.me`) | Suporte/contato |
| **YouTube** (embed) | Aulas/tutoriais |

### 2.4 Fluxo de dados (pipeline)
```
Produto cadastrado
      │
      ▼
Claude gera roteiro (gancho → oferta → prova → objeções → CTA)
      │
      ▼
ElevenLabs sintetiza áudio (voz de catálogo ou clonada) — até 3h / 108.000 chars
      │
      ▼
Extensão Chrome (v5.3) → cabo de áudio virtual → TikTok LIVE Studio
      │
      ├─ dá boas-vindas + responde chat + narra em loop
      ▼
Eventos de venda/GMV → /api/live/eventos → Dashboard + Ranking + Push
```

---

## 3. Autenticação e sessão

- **Login**: `POST /api/login` com corpo `{ usuario, senha, device_id }`.
- Resposta: `{ ok, token (JWT), usuario:{ id, nome, usuario, admin } }`.
- **Payload do JWT**: `{ id, usuario, admin, origem:"web", tv:<id>, iat, exp }` — validade ~30 dias.
- **Armazenamento no navegador** (localStorage):
  - `liveia_token` — o JWT
  - `liveia_device_id` — UUID do dispositivo
  - `liveia_ref` / `liveia_ref_ts` — código de indicação (afiliado) e timestamp
  - `liveia_onboarding` — flag de onboarding concluído
- **Interceptor Axios**: injeta `Authorization: Bearer ${token}` automaticamente quando há token.

### Controle de acesso (route guard `beforeEach`)
- Rotas `meta.publico` → acessíveis sem sessão (login, cadastro, esqueci, redefinir).
- Rotas `meta.aberto` → abertas mesmo sem login (ex.: `/planos`).
- Rotas `meta.semSessao` → esqueci/redefinir senha.
- Sem sessão em rota privada → redireciona para `/` (landing).
- Logado em rota pública → redireciona para `/inicio`.
- **RBAC por papel**:
  - `/afiliado` exige role ∈ `{affiliate, manager}` (senão → `/perfil`)
  - `/gerente` exige role `manager` (senão → `/perfil`)
- `/assistente` está **desativado** ("em breve") → redireciona para `/inicio`.

### Papéis (roles)
| Role | Acesso |
|---|---|
| `user` | Usuário comum |
| `affiliate` | Afiliado PRO (painel de indicações + saques) |
| `manager` | Gerente (equipe de afiliados, 60% de comissão, convites, saques da equipe) |
| `admin` (flag no JWT) | Administração (não exposto na conta de teste) |

---

## 4. Navegação / Menus

### 4.1 Barra inferior (mobile — 10 abas)
| Ícone | Rótulo | Rota |
|---|---|---|
| ⌂ | Início | `/inicio` |
| 📊 | Vendas | `/dashboard` |
| 🏆 | Ranking | `/ranking` |
| 🎓 | Aulas | `/aulas` |
| 🎵 | Áudio *(destaque)* | `/audio` |
| 📺 | Live | `/live` |
| 🧩 | Extensão | `/extensao` |
| ⚡ | Créditos | `/creditos` |
| 💰 | Indique | `/indique` |
| 👤 | Perfil | `/perfil` |

### 4.2 Menu lateral (desktop — agrupado)

**Principal**
- ⌂ Início — `/inicio`
- 📊 Dashboard — `/dashboard`
- 🏆 Ranking — `/ranking`
- 🎓 Aulas — `/aulas`
- 🎵 Áudio da live — `/audio`
- 🧩 Extensão — `/extensao`
- 📺 Live IA — `/live`
- 🤖 Assistente — `/assistente` *(em breve / desativado)*

**Estúdio**
- 🎙️ Vozes — `/vozes`
- 🎧 Estúdio de voz — `/estudio`
- 🧬 Clonagem de voz — `/clonar`
- 📝 Roteiros — `/roteiro`
- 📦 Produtos — `/produtos`
- 📚 Biblioteca — `/biblioteca`
- 🎛️ Painel ao vivo — `/painel`

**Ganhe dinheiro**
- 💰 Indique e ganhe — `/indique`
- 👔 Gerente — `/gerente` *(só role manager)*
- ⭐ Afiliado PRO — `/afiliado` *(só role affiliate/manager)*

**Conta**
- ⚡ Comprar créditos — `/creditos`
- 🔔 Notificações — `/notificacoes`
- 👤 Perfil — `/perfil`
- (Planos — `/planos`)

---

## 5. Tabela de rotas (Vue Router)

| Rota | Componente | Meta | Público? |
|---|---|---|---|
| `/` | Landing | `publico, largo` | ✅ |
| `/login` | Login | `publico, claro` | ✅ |
| `/cadastro` | Cadastro | `publico, claro` | ✅ |
| `/esqueci` | EsqueciSenha | `publico, claro, semSessao` | ✅ |
| `/redefinir` | RedefinirSenha | `publico, claro, semSessao` | ✅ |
| `/planos` | Planos (modal/página) | `aberto, largo, aba:comprar` | ✅ (aberto) |
| `/inicio` | Início | `aba:inicio` | 🔒 |
| `/dashboard` | Dashboard (Painel de vendas) | `aba:dashboard, largo` | 🔒 |
| `/ranking` | Ranking | `aba:ranking, largo` | 🔒 |
| `/aulas` | Aulas | `aba:aulas, largo` | 🔒 |
| `/live` | SalaLive (Live IA) | `aba:live` | 🔒 |
| `/vozes` | Vozes (catálogo) | `largo` | 🔒 |
| `/clonar` | ClonagemVoz | — | 🔒 |
| `/roteiro` | RoteiroAssistente | — | 🔒 |
| `/estudio` | EstudioVoz | `largo` | 🔒 |
| `/produtos` | Produtos | — | 🔒 |
| `/biblioteca` | Biblioteca | — | 🔒 |
| `/painel` | Painel ao vivo | `aba:live` | 🔒 |
| `/perfil` | Perfil | `aba:perfil` | 🔒 |
| `/notificacoes` | Notificacoes | `aba:perfil` | 🔒 |
| `/audio` | Audio (áudio da live) | `aba:audio, largo` | 🔒 |
| `/extensao` | Extensao | `aba:extensao, largo` | 🔒 |
| `/afiliado` | Afiliado (PRO) | `aba:perfil` | 🔒 role affiliate/manager |
| `/gerente` | Gerente | `aba:perfil` | 🔒 role manager |
| `/indique` | Indique | `aba:indique` | 🔒 |
| `/creditos` | Creditos | `aba:creditos` | 🔒 |
| `/assistente` | Assistente | `aba:assistente, largo` | 🔒 (redirect → /inicio) |

---

## 6. Funcionalidades por módulo

### 🏠 Início (`/inicio`)
Painel de controle: checklist para montar a live, status do plano e créditos num só lugar.

### 📊 Dashboard / Vendas (`/dashboard`)
Faturamento e vendas em tempo real. Filtros de período: **Hoje, Ontem, 7 dias, 30 dias, Total**. Mostra valor de venda, GMV e nº de espectadores por evento.

### 🏆 Ranking (`/ranking`)
Leaderboard de vendedores por período (Hoje/Ontem/Semana/Mês). Campos: posição, nome, nº de vendas, total (R$). Marca a posição do próprio usuário (`eu`).

### 🎓 Aulas (`/aulas`)
Módulos de treinamento em vídeo (YouTube embed). Onboarding "Primeiros passos".

### 🎵 Áudio da live (`/audio`)
Monta o áudio contínuo (voz de IA + som ambiente natural) e joga direto no cabo virtual para o LIVE Studio. Áudio "infinito" + camada ao vivo.

### 🧩 Extensão (`/extensao`)
Download da extensão do Chrome (**v5.3**) que roda a live no automático. Inclui passo a passo de instalação (carregar em modo desenvolvedor no Chrome/Windows e Mac). Duas extensões: **principal** e **premium** (análise da live, alertas, proteção, câmera virtual).

### 📺 Live IA / Painel ao vivo (`/live`, `/painel`)
A apresentadora de IA narra o roteiro em loop e responde comentários com voz premium. Painel ao vivo = console em tempo real (online, acumulado, estado da extensão).

### 🎙️ Vozes (`/vozes`)
Catálogo de vozes premium ultrarrealistas (ElevenLabs). Metadados: gênero, idade, sotaque, categoria, uso, idiomas, bandeiras. **10 idiomas** suportados (pt-BR, en, es, fr, de, it, ja, ko, zh, ar).

### 🎧 Estúdio de voz (`/estudio`)
Gera e guarda áudios (Text-to-Speech) com a voz escolhida — reaproveita sem gastar crédito de novo.

### 🧬 Clonagem de voz (`/clonar`)
Clona uma voz a partir de uma amostra de áudio, para usar como apresentadora. Modos: "treino"/"rápido".

### 📝 Roteiros / Assistente de roteiro (`/roteiro`)
A IA (Claude) escreve o roteiro de vendas: **gancho, oferta, prova, objeções e CTA**. Salvar/editar/excluir roteiros.

### 📦 Produtos (`/produtos`)
Cadastro do que será vendido (nome, imagem, roteiro associado).

### 📚 Biblioteca (`/biblioteca`)
Áudios e roteiros salvos num só lugar.

### ⚡ Créditos (`/creditos`)
Compra de créditos avulsos de voz/texto sem trocar de plano.

### 💰 Indique e ganhe (`/indique`)
Programa de indicação **multinível (3 níveis)**: código de referência, link, indicados, comissão por nível, saques.

### 👔 Gerente (`/gerente`) — *role manager*
Painel da equipe: código `MGR-<id>`, comissão de **60%**, convidados, ganhos, saldo da equipe, promover usuários, saques.

### ⭐ Afiliado PRO (`/afiliado`) — *role affiliate/manager*
Painel de afiliado PRO: indicados, banca gerada, ganhos, taxa de comissão, saques.

### 🔔 Notificações (`/notificacoes`)
Gestão de push notifications (VAPID). Inscrever/desinscrever.

### 👤 Perfil (`/perfil`)
Dados da conta, plano, créditos, dispositivo.

### 💳 Planos (`/planos`)
Assinaturas e checkout.

---

## 7. Referência da API (`/api`)

> Todas as respostas seguem `{ "ok": true, ... }`. Autenticadas exigem `Authorization: Bearer <JWT>`.

### 7.1 Autenticação & conta
| Método | Endpoint | Descrição |
|---|---|---|
| POST | `/login` | Login `{usuario, senha, device_id}` → JWT |
| POST | `/cadastro` | Registro de novo usuário |
| POST | `/senha/esqueci` | Solicita recuperação de senha |
| POST | `/senha/redefinir` | Redefine a senha |
| GET | `/eu` | Dados do usuário + assinatura + plano |
| GET | `/conta` | Resumo da conta (role, plano, recursos, créditos, vencimento) |
| GET | `/config` | Config da live (voz, sala, conta TikTok) |
| POST | `/config` | Salva config da live |
| GET | `/idiomas` | Lista de idiomas suportados (10) |

### 7.2 Vozes / Áudio (ElevenLabs)
| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/vozes/catalogo` | Catálogo simplificado (model_id, nome, idioma) |
| GET | `/vozes/biblioteca` | Biblioteca completa com metadados (gênero, sotaque, uso, bandeiras) |
| GET | `/vozes/meus` | Vozes/áudios do usuário |
| GET | `/vozes/clonadas` | Vozes clonadas |
| GET | `/vozes/audio/{id}` | Baixa/serve um áudio |
| POST | `/vozes/gerar` | Gera áudio TTS a partir de texto |
| POST | `/vozes/preview` | Preview de voz |
| POST | `/vozes/usar` | Define a voz ativa da live |
| POST | `/vozes/clonar` | Clona uma voz a partir de amostra |
| POST | `/vozes/meus/{id}` | Atualiza item de voz |
| DELETE | `/vozes/meus/{id}` | Remove voz do usuário |

### 7.3 Assistente / Roteiros (Claude)
| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/assistente/estimativa` | Estimativa de custo (chars/min, max_chars, max_horas) |
| POST | `/assistente/chat` | Chat da IA / geração de copy |
| POST | `/assistente/audio` | Gera áudio a partir do assistente |
| POST | `/roteiro/assistente` | Gera roteiro de vendas via IA |
| GET | `/roteiros` | Lista roteiros salvos |
| POST | `/roteiros` | Cria roteiro |
| POST | `/roteiros/{id}` | Atualiza roteiro |
| DELETE | `/roteiros/{id}` | Exclui roteiro |

### 7.4 Produtos
| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/produtos` | Lista produtos |
| POST | `/produtos` | Cadastra produto |

### 7.5 Live
| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/live/estado` | Estado atual (ativo, online, acumulado, extensão online) |
| GET | `/live/historico` | Histórico de eventos da live |
| GET | `/live/eventos` | **Stream de eventos** em tempo real (SSE) |
| POST | `/live/iniciar` | Inicia a live/IA |
| POST | `/live/parar` | Para a live/IA |
| POST | `/live/vincular` | Vincula conta TikTok / sala |
| GET | `/vendas` | Vendas registradas (valor, GMV, viewers, timestamp) |

### 7.6 Extensão
| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/ext/licenca` | Licença/recursos da extensão + versão + URL do ZIP |
| GET | `/ext/baixar` | Download do pacote da extensão (ZIP) |

### 7.7 Planos, créditos e pagamento
| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/planos` | Lista de planos + benefícios |
| GET | `/creditos/pacotes` | Pacotes de créditos avulsos |
| POST | `/creditos/comprar` | Compra créditos |
| GET | `/pagamento/{id}` | Status de pagamento |
| POST | `/pagamento/criar` | Cria cobrança/checkout |

### 7.8 Afiliados / Indicação / Gerente
| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/indique/painel` | Painel de indicação (3 níveis) |
| GET | `/indique/saques` | Saques de indicação |
| POST | `/indique/saque` | Solicita saque |
| GET | `/afiliado/painel` | Painel do afiliado PRO |
| GET | `/afiliado/saques` | Saques do afiliado |
| POST | `/afiliado/saque` | Solicita saque |
| GET | `/gerente/painel` | Painel do gerente (equipe, comissão 60%) |
| GET | `/gerente/convidados` | Lista de convidados/equipe |
| GET | `/gerente/saques` | Saques da equipe |
| POST | `/gerente/promover` | Promove usuário |
| POST | `/gerente/saque` | Saque do gerente |

### 7.9 Ranking, aulas e notificações
| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/ranking` | Ranking de vendedores por período |
| GET | `/aulas` | Módulos de aulas/treinamento |
| GET | `/push/vapid` | Chave pública VAPID |
| POST | `/push/inscrever` | Inscreve para push |
| POST | `/push/desinscrever` | Cancela push |

---

## 8. Planos e monetização (dados reais)

### Planos de assinatura
| Plano | Preço | Contas TikTok | Voz premium | Recursos-chave |
|---|---|---|---|---|
| **Copy Live** | R$ 29,90/mês | 1 | ❌ | Só a IA de copy/roteiro |
| … (intermediários) | … | … | … | … |
| **Premium** | R$ 297,00/mês | 3 | ✅ | Voz premium, câmera virtual, respostas no chat, sons naturais, extensão premium |

> Todos os planos incluem `horas_mes: 9999` (praticamente ilimitado) e liberam a extensão.

### Pacotes de créditos avulsos
| Pacote | Créditos | Preço |
|---|---|---|
| Avulso | 1.000 | R$ 3 |
| P1 | 10.000 | R$ 30 |
| P2 | 20.000 | R$ 50 |
| P3 | 40.000 | R$ 100 |

**Consumo**: cada bloco de áudio gerado custa crédito; **repetições em loop são grátis**. Estimativa: ~600 chars/min, máx. 108.000 chars ≈ 3h por geração.

### Programa de afiliados (MLM 3 níveis)
- **Gerente**: comissão de **60%**, código `MGR-<id>`, convida e promove afiliados, saques da equipe.
- **Afiliado PRO**: indicações diretas, "banca gerada", saques.
- **Indique e ganhe**: 3 níveis de comissão em profundidade.

---

## 9. Observações de segurança

| Severidade | Achado |
|---|---|
| 🟠 MÉDIO | **`device_id` não validado no login** — o backend aceitou um `device_id` arbitrário; se a intenção é limitar a 1 dispositivo/conta, a trava não está no login. |
| 🟠 MÉDIO | **JWT de ~30 dias sem rotação aparente** — token de longa duração; se vazar do localStorage (XSS), dá acesso prolongado. |
| 🟠 MÉDIO | Token e device_id em **localStorage** (acessível a JS) → superfície de XSS. Preferir cookie `HttpOnly` + `SameSite`. |
| 🟡 BAIXO | Flag `admin` presente no JWT — garantir validação **server-side** do papel, nunca confiar apenas no claim do token. |
| 🟡 BAIXO | Painel de gerente/afiliado expõe **usernames e valores depositados** da rede (por design, mas é PII da downline). |
| 🟡 BAIXO | Senha de teste fraca (`12345678`) em conta com painel financeiro. |
| ✅ BOM | Servidor Caddy com HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN`, HTTP/3. |

### Risco de plataforma (não técnico)
O núcleo do produto depende de uma **extensão que automatiza o TikTok LIVE Studio** (áudio de IA fazendo-se passar por transmissão ao vivo). Isso tende a violar os **Termos de Serviço do TikTok** e é o maior risco estratégico do negócio — sujeito a bloqueio/ban de contas caso o TikTok detecte automação.

---

## 10. Resumo executivo

Live Fox é um **SaaS de "live commerce autônomo"**: transforma texto de produto em uma live de vendas com apresentadora de IA (Claude para copy + ElevenLabs para voz), transmitida no TikTok Shop via extensão de navegador, com métricas de venda/GMV em tempo real e um forte motor de crescimento por **afiliação multinível**. Stack moderna e enxuta (Vue 3 + Vite + PWA no front; API REST + JWT sob Caddy no back). Os principais pontos de atenção são a **conformidade com os termos do TikTok** e o **endurecimento da autenticação** (device binding e armazenamento do token).
