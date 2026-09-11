import {
  AudioLines,
  Bell,
  Bot,
  ChartColumn,
  CreditCard,
  Dna,
  FileText,
  GraduationCap,
  HandCoins,
  Headphones,
  House,
  Library,
  type LucideIcon,
  Mic,
  Package,
  Puzzle,
  Radio,
  SlidersHorizontal,
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
  /** Rota existe mas está desativada — aparece esmaecida com selo. */
  emBreve?: boolean;
  /** Botão elevado no centro da barra inferior do mobile. */
  destaque?: boolean;
  descricao?: string;
};

export type GrupoNav = {
  titulo: string;
  itens: readonly ItemNav[];
};

/**
 * Fonte única da navegação: menu lateral, menu "Mais" do mobile e o mapa de
 * rotas protegidas do proxy saem todos daqui. Mudar uma rota é mudar uma linha.
 */
export const NAVEGACAO: readonly GrupoNav[] = [
  {
    titulo: "Principal",
    itens: [
      { href: "/inicio", rotulo: "Início", icone: House, descricao: "Checklist da live, plano e créditos" },
      { href: "/dashboard", rotulo: "Dashboard", icone: ChartColumn, descricao: "Faturamento e vendas em tempo real" },
      { href: "/ranking", rotulo: "Ranking", icone: Trophy, descricao: "Placar de vendedores por período" },
      { href: "/aulas", rotulo: "Aulas", icone: GraduationCap, descricao: "Treinamento em vídeo" },
      { href: "/audio", rotulo: "Áudio da live", icone: AudioLines, descricao: "Monta o áudio contínuo da transmissão" },
      { href: "/extensao", rotulo: "Extensão", icone: Puzzle, descricao: "Instalação e licença da extensão" },
      { href: "/live", rotulo: "Live IA", icone: Radio, descricao: "A apresentadora no ar" },
      { href: "/assistente", rotulo: "Assistente", icone: Bot, emBreve: true, descricao: "Em breve" },
    ],
  },
  {
    titulo: "Estúdio",
    itens: [
      { href: "/vozes", rotulo: "Vozes", icone: Mic, descricao: "Catálogo de vozes premium" },
      { href: "/estudio", rotulo: "Estúdio de voz", icone: Headphones, descricao: "Gera e guarda áudios" },
      { href: "/clonar", rotulo: "Clonagem de voz", icone: Dna, descricao: "Clona uma voz a partir de amostra" },
      { href: "/roteiro", rotulo: "Roteiros", icone: FileText, descricao: "Gancho, oferta, prova, objeções e CTA" },
      { href: "/produtos", rotulo: "Produtos", icone: Package, descricao: "O que vai ser vendido na live" },
      { href: "/biblioteca", rotulo: "Biblioteca", icone: Library, descricao: "Áudios e roteiros salvos" },
      { href: "/painel", rotulo: "Painel ao vivo", icone: SlidersHorizontal, descricao: "Console em tempo real" },
    ],
  },
  {
    titulo: "Ganhe dinheiro",
    itens: [
      { href: "/indique", rotulo: "Indique e ganhe", icone: HandCoins, descricao: "Indicação em 3 níveis" },
      { href: "/gerente", rotulo: "Gerente", icone: UserCog, papeis: ["manager"], descricao: "Equipe, comissões e saques" },
      { href: "/afiliado", rotulo: "Afiliado PRO", icone: Star, papeis: ["affiliate", "manager"], descricao: "Indicados, ganhos e saques" },
    ],
  },
  {
    titulo: "Conta",
    itens: [
      { href: "/creditos", rotulo: "Créditos", icone: Zap, descricao: "Compra de créditos avulsos" },
      { href: "/planos", rotulo: "Planos", icone: CreditCard, descricao: "Assinatura e checkout" },
      { href: "/notificacoes", rotulo: "Notificações", icone: Bell, descricao: "Push no celular" },
      { href: "/perfil", rotulo: "Perfil", icone: User, descricao: "Dados da conta e dispositivo" },
    ],
  },
];

/**
 * Barra inferior do mobile. O Live Fox põe 10 abas aqui; 10 alvos de toque
 * numa barra de 360px não é navegável. Ficam 4 + o botão de áudio em
 * destaque, e o resto sai no menu "Mais", que lista a árvore inteira.
 */
export const ABAS_MOBILE: readonly ItemNav[] = [
  { href: "/inicio", rotulo: "Início", icone: House },
  { href: "/dashboard", rotulo: "Vendas", icone: ChartColumn },
  { href: "/audio", rotulo: "Áudio", icone: AudioLines, destaque: true },
  { href: "/live", rotulo: "Live", icone: Radio },
];

export const TODOS_OS_ITENS: readonly ItemNav[] = NAVEGACAO.flatMap((g) => g.itens);

/** Rotas que exigem sessão — consumido pelo proxy (src/proxy.ts). */
export const ROTAS_PRIVADAS: readonly string[] = TODOS_OS_ITENS.map((i) => i.href);

/** Rotas com exigência de papel, para o guard do servidor. */
export const ROTAS_POR_PAPEL: Readonly<Record<string, readonly Papel[]>> =
  Object.fromEntries(
    TODOS_OS_ITENS.filter((i) => i.papeis).map((i) => [i.href, i.papeis!]),
  );

/** Rotas desativadas — redirecionam para /inicio. */
export const ROTAS_EM_BREVE: readonly string[] = TODOS_OS_ITENS.filter(
  (i) => i.emBreve,
).map((i) => i.href);

export function itemAtivo(href: string, caminho: string) {
  return caminho === href || caminho.startsWith(`${href}/`);
}

export function visivelPara(item: ItemNav, papel: Papel | null) {
  if (!item.papeis) return true;
  if (!papel) return false;
  if (papel === "admin") return true;
  if (papel === "manager" && item.papeis.includes("affiliate")) return true;
  return item.papeis.includes(papel);
}
