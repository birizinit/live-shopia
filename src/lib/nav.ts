import {
  Bell,
  BookOpenCheck,
  ChartColumn,
  GraduationCap,
  HandCoins,
  House,
  LayoutGrid,
  type LucideIcon,
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
 * Ferramentas de ajuste fino. Saíram do menu principal: quem quer só pôr a
 * Shopia na live não precisa saber que elas existem — o assistente cuida do
 * caminho. Moram em /ferramentas, com uma linha dizendo para que serve cada uma.
 *
 * Crédito e plano NÃO estão aqui de propósito. Enquanto a cobrança está
 * desligada, um item "Planos" no menu é uma porta que leva a uma decisão que
 * ninguém precisa tomar — e crédito medido em caractere de fala deixou de
 * medir qualquer coisa quando a voz saiu.
 */
export const FERRAMENTAS: readonly GrupoNav[] = [
  {
    titulo: "A sua live",
    itens: [
      { href: "/produtos", rotulo: "Produtos", icone: Package, descricao: "Cadastrar, editar e fixar o que é vendido na live" },
      { href: "/manual", rotulo: "Manual", icone: BookOpenCheck, descricao: "As perguntas que a Shopia sabe responder no chat" },
      { href: "/painel", rotulo: "Painel ao vivo", icone: SlidersHorizontal, descricao: "Chat e respostas enquanto a live roda" },
      { href: "/ranking", rotulo: "Ranking", icone: Trophy, descricao: "Placar de vendedores por período" },
    ],
  },
  {
    titulo: "Conta",
    itens: [
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
 * O menu, na ordem em que a pessoa usa: começar, preparar, ensinar, instalar,
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
      { href: "/criar", rotulo: "Preparar live", icone: Sparkles, destaque: true, descricao: "Do produto ao manual, em 3 passos" },
      { href: "/manual", rotulo: "Manual", icone: BookOpenCheck, descricao: "O que a Shopia responde no chat" },
      { href: "/extensao", rotulo: "Extensão", icone: Puzzle, descricao: "Instalar, conectar e atualizar" },
      { href: "/live", rotulo: "Ao vivo", icone: Radio, inclui: ["/painel"], descricao: "Se a live está no ar e o que ela está fazendo" },
      { href: "/dashboard", rotulo: "Vendas", icone: ChartColumn, inclui: ["/ranking"], descricao: "Faturamento e vendas das lives" },
      { href: "/aulas", rotulo: "Aulas", icone: GraduationCap, descricao: "Vídeos curtos de como usar" },
      {
        href: "/ferramentas",
        rotulo: "Ferramentas",
        icone: LayoutGrid,
        inclui: ROTAS_DE_FERRAMENTA,
        descricao: "Ajustes finos de produto, manual e painel ao vivo",
      },
    ],
  },
  {
    titulo: "Conta",
    itens: [
      { href: "/perfil", rotulo: "Minha conta", icone: User, inclui: ROTAS_DA_CONTA, descricao: "Dados da conta e notificações" },
      { href: "/indique", rotulo: "Indique e ganhe", icone: HandCoins, descricao: "Indicação em 3 níveis" },
      { href: "/afiliado", rotulo: "Afiliado PRO", icone: Star, papeis: ["affiliate", "manager"], descricao: "Indicados, ganhos e saques" },
      { href: "/gerente", rotulo: "Gerente", icone: UserCog, papeis: ["manager"], descricao: "Equipe, comissões e saques" },
      { href: "/admin", rotulo: "Operação", icone: ShieldCheck, papeis: ["admin"], descricao: "Convites de acesso, cortesias e contas" },
    ],
  },
];

/**
 * Barra inferior do mobile: quatro destinos e o "Mais". Preparar fica no
 * centro, em destaque, porque é o começo de tudo.
 */
export const ABAS_MOBILE: readonly ItemNav[] = [
  { href: "/inicio", rotulo: "Início", icone: House },
  { href: "/live", rotulo: "Ao vivo", icone: Radio, inclui: ["/painel"] },
  { href: "/criar", rotulo: "Preparar", icone: Sparkles, destaque: true },
  { href: "/manual", rotulo: "Manual", icone: BookOpenCheck },
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
