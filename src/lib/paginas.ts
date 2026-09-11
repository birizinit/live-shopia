/**
 * Especificação de cada tela, tirada de docs/referencia-livefox.md.
 *
 * Enquanto a tela não existe, é isto que ela mostra: o que vai fazer, em que
 * fase entra e com quais endpoints vai falar. O app já navega como o produto
 * final e serve de backlog vivo — cada bloco some quando a tela é construída.
 */
export type EspecPagina = {
  titulo: string;
  descricao: string;
  fase: number;
  entrega: readonly string[];
  api?: readonly string[];
};

export const PAGINAS = {
  "/dashboard": {
    titulo: "Dashboard de vendas",
    descricao: "Faturamento e vendas da live em tempo real.",
    fase: 4,
    entrega: [
      "Filtros de período: hoje, ontem, 7 dias, 30 dias e total",
      "Faturamento, GMV, nº de vendas e espectadores por evento",
      "Série temporal com as cores de gráfico do design system",
      "Atualização ao vivo via Supabase Realtime, no lugar do SSE do original",
    ],
    api: ["GET /vendas", "GET /live/eventos"],
  },
  "/ranking": {
    titulo: "Ranking",
    descricao: "Placar de vendedores por período.",
    fase: 4,
    entrega: [
      "Hoje, ontem, semana e mês",
      "Posição, nome, nº de vendas e total em R$",
      "Destaque da própria posição do usuário",
      "Só nome de exibição: nada de e-mail ou CPF de terceiros (LGPD)",
    ],
    api: ["GET /ranking"],
  },
  "/aulas": {
    titulo: "Aulas",
    descricao: "Treinamento em vídeo e primeiros passos.",
    fase: 7,
    entrega: [
      "Módulos com vídeos incorporados",
      "Trilha de onboarding com progresso salvo",
    ],
    api: ["GET /aulas"],
  },
  "/audio": {
    titulo: "Áudio da live",
    descricao:
      "Monta o áudio contínuo que vai ao ar e joga no cabo virtual do LIVE Studio.",
    fase: 2,
    entrega: [
      "Montagem do loop a partir dos blocos gerados no estúdio",
      "Camada de som ambiente para a live não soar sintética",
      "Player com forma de onda e marcação dos blocos",
      "Download e stream do arquivo final",
      "O loop não gasta crédito de novo: é o que sustenta a margem",
    ],
  },
  "/extensao": {
    titulo: "Extensão",
    descricao: "Download, licença e instalação da extensão do Chrome.",
    fase: 5,
    entrega: [
      "Download do pacote e estado da licença",
      "Passo a passo de instalação, Windows e Mac",
      "Versão instalada x versão publicada, com autoupdate de verdade",
      "Telemetria de quebra de seletor: o painel avisa antes do WhatsApp",
    ],
    api: ["GET /ext/licenca", "GET /ext/baixar"],
  },
  "/live": {
    titulo: "Live IA",
    descricao:
      "A apresentadora no ar: narra o roteiro em loop e responde o chat.",
    fase: 5,
    entrega: [
      "Iniciar e parar a live",
      "Vincular a conta e a sala do TikTok",
      "Estado da extensão, espectadores online e acumulado",
      "Aviso de risco de conta aceito no onboarding, com registro do aceite",
    ],
    api: ["GET /live/estado", "POST /live/iniciar", "POST /live/parar"],
  },
  "/painel": {
    titulo: "Painel ao vivo",
    descricao: "Console em tempo real da transmissão.",
    fase: 5,
    entrega: [
      "Fila de falas, chat e respostas da IA lado a lado",
      "Cadência humana na resposta ao chat: intervalo variável e teto por minuto",
      "Kill switch por cliente",
    ],
  },
  "/vozes": {
    titulo: "Vozes",
    descricao: "Catálogo de vozes premium ultrarrealistas.",
    fase: 1,
    entrega: [
      "Catálogo com gênero, idade, sotaque, categoria e uso",
      "Prévia de cada voz antes de gastar crédito",
      "Definir a voz ativa da live",
      "10 idiomas",
    ],
    api: ["GET /vozes/catalogo", "GET /vozes/biblioteca", "POST /vozes/usar"],
  },
  "/estudio": {
    titulo: "Estúdio de voz",
    descricao: "Gera e guarda os áudios da apresentadora.",
    fase: 1,
    entrega: [
      "Texto para fala com a voz escolhida",
      "Estimativa de custo em caracteres ANTES de confirmar",
      "Débito de crédito antes da chamada, nunca depois",
      "Job em fila com progresso e retry: 3h de áudio não cabe numa requisição",
      "Áudio salvo e reaproveitável sem gastar de novo",
    ],
    api: ["POST /vozes/gerar", "GET /assistente/estimativa"],
  },
  "/clonar": {
    titulo: "Clonagem de voz",
    descricao: "Clona uma voz a partir de uma amostra de áudio.",
    fase: 7,
    entrega: [
      "Upload da amostra com checagem de qualidade",
      "Modos treino e rápido",
      "Consentimento de uso da voz registrado",
    ],
    api: ["POST /vozes/clonar", "GET /vozes/clonadas"],
  },
  "/roteiro": {
    titulo: "Roteiros",
    descricao: "A IA escreve o roteiro de vendas do produto.",
    fase: 1,
    entrega: [
      "Estrutura gancho, oferta, prova, objeções e CTA",
      "Geração a partir do produto cadastrado (Claude)",
      "Editar, salvar, versionar e excluir",
      "Contagem de caracteres ligada à estimativa de áudio",
    ],
    api: ["POST /roteiro/assistente", "GET /roteiros", "POST /roteiros"],
  },
  "/produtos": {
    titulo: "Produtos",
    descricao: "O que vai ser vendido na live.",
    fase: 1,
    entrega: [
      "Nome, imagem, preço, cupom e link",
      "Roteiro associado ao produto",
      "Produto fixado da live",
    ],
    api: ["GET /produtos", "POST /produtos"],
  },
  "/biblioteca": {
    titulo: "Biblioteca",
    descricao: "Áudios e roteiros salvos num lugar só.",
    fase: 1,
    entrega: [
      "Busca e filtro por produto, voz e data",
      "Reaproveitar um áudio sem gerar de novo",
      "Armazenamento no R2, servido por CDN",
    ],
    api: ["GET /vozes/meus"],
  },
  "/indique": {
    titulo: "Indique e ganhe",
    descricao: "Programa de indicação em 3 níveis.",
    fase: 6,
    entrega: [
      "Código e link de indicação",
      "Indicados por nível e comissão de cada um",
      "Saldo pendente x disponível, com prazo de liberação (D+30)",
      "Comissão só nasce em pagamento confirmado; estorno faz clawback nos 3 níveis",
    ],
    api: ["GET /indique/painel", "POST /indique/saque"],
  },
  "/gerente": {
    titulo: "Gerente",
    descricao: "Equipe de afiliados, comissões e saques.",
    fase: 6,
    entrega: [
      "Código MGR, convites e promoção de afiliados",
      "Ganhos da equipe e saldo",
      "Saques com KYC, teto por período e recibo",
      "Nome de exibição e valores agregados da downline, nunca e-mail, CPF ou telefone",
    ],
    api: ["GET /gerente/painel", "GET /gerente/convidados", "POST /gerente/saque"],
  },
  "/afiliado": {
    titulo: "Afiliado PRO",
    descricao: "Indicados, ganhos e saques do afiliado.",
    fase: 6,
    entrega: [
      "Indicados diretos e volume gerado",
      "Taxa de comissão vigente",
      "Extrato e solicitação de saque",
      "Trilha de auditoria por comissão: origem, nível, pagamento e estado",
    ],
    api: ["GET /afiliado/painel", "POST /afiliado/saque"],
  },
  "/creditos": {
    titulo: "Créditos",
    descricao: "Compra de créditos avulsos de voz e texto.",
    fase: 3,
    entrega: [
      "Pacotes avulsos sem trocar de plano",
      "Checkout PIX e cartão",
      "Extrato do consumo medido em caracteres",
      "Saldo derivado de razão append-only, não de um campo que se sobrescreve",
    ],
    api: ["GET /creditos/pacotes", "POST /creditos/comprar", "POST /pagamento/criar"],
  },
  "/planos": {
    titulo: "Planos",
    descricao: "Assinatura, benefícios e checkout.",
    fase: 3,
    entrega: [
      "Comparativo de planos e o que cada um libera",
      "Assinatura recorrente, PIX e cartão",
      "Webhook de pagamento confirmado como origem de verdade da assinatura",
      "Upgrade e downgrade com proporcional",
    ],
    api: ["GET /planos", "POST /pagamento/criar", "GET /pagamento/{id}"],
  },
  "/notificacoes": {
    titulo: "Notificações",
    descricao: "Avisos de venda no celular.",
    fase: 4,
    entrega: [
      "Inscrição e cancelamento de push (VAPID)",
      "Escolha do que notifica: venda, queda da live, crédito acabando",
    ],
    api: ["GET /push/vapid", "POST /push/inscrever"],
  },
} as const satisfies Record<string, EspecPagina>;

export type RotaEspecificada = keyof typeof PAGINAS;
