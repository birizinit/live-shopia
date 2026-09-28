import {
  AudioLines,
  Bell,
  ChartColumn,
  CreditCard,
  Dna,
  FileText,
  GraduationCap,
  HandCoins,
  Headphones,
  House,
  LayoutGrid,
  Library,
  type LucideIcon,
  Mic,
  Package,
  Puzzle,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trophy,
  User,
  UserCog,
  Zap,
} from "lucide-react";
import type { Papel } from "./roles";

export type ItemNav = {
  href: string;
  rotulo: string;
  icone: LucideIcon;
  /** Ausente = qualquer usuário autenticado. */
  papeis?: readonly Papel[];
  /** Botão elevado no centro da barra inferior do mobile e realçado no menu. */
  destaque?: boolean;
  /** Outras rotas que acendem este item — a tela mora dentro dele. */
  inclui?: readonly string[];
  descricao?: string;
};

export type GrupoNav = {
  /** Vazio = grupo principal, sem título. */
  titulo: string;
  itens: readonly ItemNav[];
};

/**
 * Ferramentas de ajuste fino. Continuam todas existindo, mas saíram do menu
 * principal: quem quer só pôr a live no ar não precisa saber que elas
 * existem — o assistente "Criar live" faz produto, roteiro, voz, áudio e
 * montagem por ele. Moram em /ferramentas, com uma linha dizendo para que
 * serve cada uma.
 */
export const FERRAMENTAS: readonly GrupoNav[] = [
  {
    titulo: "Conteúdo",
    itens: [
      { href: "/produtos", rotulo: "Produtos", icone: Package, descricao: "Cadastrar, editar e fixar o que é vendido na live" },
      { href: "/roteiro", rotulo: "Roteiros", icone: FileText, descricao: "Editar o texto, seção por seção, e ver versões antigas" },
      { href: "/estudio", rotulo: "Estúdio de voz", icone: Headphones, descricao: "Transformar qualquer texto em áudio" },
      { href: "/biblioteca", rotulo: "Biblioteca", icone: Library, descricao: "Todos os áudios e roteiros já feitos" },
    ],
  },
  {
    titulo: "Voz",
    itens: [
      { href: "/vozes", rotulo: "Vozes", icone: Mic, descricao: "Ouvir e escolher a voz da apresentadora" },
      { href: "/clonar", rotulo: "Clonar a sua voz", icone: Dna, descricao: "Criar uma voz a partir de uma gravação sua" },
    ],
  },
  {
    titulo: "Live",
    itens: [
      { href: "/audio", rotulo: "Áudio da live", icone: AudioLines, descricao: "Ordem dos áudios, som ambiente e pausa entre falas" },
      { href: "/painel", rotulo: "Painel ao vivo", icone: SlidersHorizontal, descricao: "Chat e respostas da IA enquanto a live roda" },
      { href: "/ranking", rotulo: "Ranking", icone: Trophy, descricao: "Placar de vendedores por período" },
    ],
  },
  {
    titulo: "Conta",
    itens: [
      { href: "/creditos", rotulo: "Créditos", icone: Zap, descricao: "Saldo, extrato e pacotes avulsos" },
      { href: "/planos", rotulo: "Planos", icone: CreditCard, descricao: "Assinatura e o que cada plano libera" },
      { href: "/notificacoes", rotulo: "Notificações", icone: Bell, descricao: "Aviso de venda no celular" },
    ],
  },
];

const ROTAS_DA_CONTA = ["/creditos", "/planos", "/notificacoes"];

/** Cada tela acende UM item do menu: painel é do "Ao vivo", ranking das "Vendas". */
const ROTAS_DE_FERRAMENTA = FERRAMENTAS.flatMap((g) => g.itens.map((i) => i.href)).filter(
  (rota) => rota !== "/painel" && rota !== "/ranking" && !ROTAS_DA_CONTA.includes(rota),
);

/**
 * O menu. Sete itens na ordem em que a pessoa usa: começar, criar, instalar,
 * acompanhar, vender, aprender — e as ferramentas no fim para quem quiser.
 *
 * Antes eram 20 itens copiados um a um do concorrente, e a ordem não seguia o
 * caminho da live: quem abria o app pela primeira vez não sabia por onde ir.
 */
export const NAVEGACAO: readonly GrupoNav[] = [
  {
    titulo: "",
    itens: [
      { href: "/inicio", rotulo: "Início", icone: House, descricao: "Onde você está no caminho até a live" },
      { href: "/criar", rotulo: "Criar live", icone: Sparkles, destaque: true, descricao: "Do produto ao áudio da live, em 3 passos" },
      { href: "/extensao", rotulo: "Extensão", icone: Puzzle, descricao: "Instalar, conectar e atualizar" },
      { href: "/live", rotulo: "Ao vivo", icone: Radio, inclui: ["/painel"], descricao: "Se a live está no ar e o que ela está fazendo" },
      { href: "/dashboard", rotulo: "Vendas", icone: ChartColumn, inclui: ["/ranking"], descricao: "Faturamento e vendas das lives" },
      { href: "/aulas", rotulo: "Aulas", icone: GraduationCap, descricao: "Vídeos curtos de como usar" },
      {
        href: "/ferramentas",
        rotulo: "Ferramentas",
        icone: LayoutGrid,
        inclui: ROTAS_DE_FERRAMENTA,
        descricao: "Ajustes finos de produto, roteiro, voz e áudio",
      },
    ],
  },
  {
    titulo: "Conta",
    itens: [
      { href: "/perfil", rotulo: "Minha conta", icone: User, inclui: ROTAS_DA_CONTA, descricao: "Dados, plano, créditos e notificações" },
      { href: "/indique", rotulo: "Indique e ganhe", icone: HandCoins, descricao: "Indicação em 3 níveis" },
      { href: "/afiliado", rotulo: "Afiliado PRO", icone: Star, papeis: ["affiliate", "manager"], descricao: "Indicados, ganhos e saques" },
      { href: "/gerente", rotulo: "Gerente", icone: UserCog, papeis: ["manager"], descricao: "Equipe, comissões e saques" },
      { href: "/admin", rotulo: "Operação", icone: ShieldCheck, papeis: ["admin"], descricao: "Convites de acesso, cortesias e contas" },
    ],
  },
];

/**
 * Barra inferior do mobile: quatro destinos e o "Mais". Criar fica no centro,
 * em destaque, porque é o começo de tudo.
 */
export const ABAS_MOBILE: readonly ItemNav[] = [
  { href: "/inicio", rotulo: "Início", icone: House },
  { href: "/live", rotulo: "Ao vivo", icone: Radio, inclui: ["/painel"] },
  { href: "/criar", rotulo: "Criar", icone: Sparkles, destaque: true },
  { href: "/dashboard", rotulo: "Vendas", icone: ChartColumn, inclui: ["/ranking"] },
];

/** Tudo que tem nome — o tour usa para escrever "Ver em Produtos" e afins. */
export const TODOS_OS_ITENS: readonly ItemNav[] = [...NAVEGACAO, ...FERRAMENTAS].flatMap(
  (g) => g.itens,
);

function dentroDe(rota: string, caminho: string) {
  return caminho === rota || caminho.startsWith(`${rota}/`);
}

export function itemAtivo(item: ItemNav, caminho: string) {
  return dentroDe(item.href, caminho) || (item.inclui ?? []).some((r) => dentroDe(r, caminho));
}

export function visivelPara(item: ItemNav, papel: Papel | null) {
  if (!item.papeis) return true;
  if (!papel) return false;
  if (papel === "admin") return true;
  if (papel === "manager" && item.papeis.includes("affiliate")) return true;
  return item.papeis.includes(papel);
}
