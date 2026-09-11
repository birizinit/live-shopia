import type { Voz } from "../vozes";

/**
 * Catálogo de EXEMPLO — o que a tela mostra quando não há ELEVENLABS_API_KEY.
 *
 * Existe por causa da regra que não se discute: sem chave de serviço externo,
 * ou se mostra exemplo claramente rotulado, ou se desliga. O que nunca se faz é
 * fingir que estas vozes vieram da ElevenLabs — por isso cada uma carrega
 * `exemplo: true`, a tela põe o selo "Exemplo" no cartão e o botão que exigiria
 * a API fica desabilitado.
 *
 * Os ids são uuid de verdade (formato, não conteúdo) porque viajam na URL da
 * prévia e o handler valida o formato antes de qualquer coisa. Nenhum deles tem
 * linha na tabela `vozes`: `ehVozExemplo()` resolve a prévia com um tom local,
 * sem tocar no banco e sem chamar provedor nenhum.
 *
 * Os sotaques são os que um vendedor brasileiro reconhece de ouvido. A voz da
 * live é a apresentadora do produto: "paulistano" e "carioca" dizem mais para
 * quem escolhe do que "Accent A" e "Accent B".
 */

/** Data fixa: `new Date()` aqui daria valor diferente a cada render. */
const CRIADO_EM = "2026-01-01T12:00:00.000Z";

const BANDEIRA = "🇧🇷";
const IDIOMA = "pt-BR";
const IDIOMA_NOME = "Português (Brasil)";

type Base = Omit<
  Voz,
  "origem" | "estado" | "idioma" | "idiomaNome" | "bandeira" | "temPrevia" | "exemplo" | "criadoEm"
>;

const BASE: Base[] = [
  {
    id: "e0000000-0000-4000-8000-000000000001",
    nome: "Helena",
    descricao:
      "Locução calorosa e firme, com o ritmo de quem já vendeu muito ao vivo. A escolha segura para a apresentadora principal.",
    genero: "feminina",
    idade: "Adulta",
    sotaque: "Paulistano",
    categoria: "Narração",
    uso: "Apresentação da live",
    premium: true,
  },
  {
    id: "e0000000-0000-4000-8000-000000000002",
    nome: "Beatriz",
    descricao:
      "Jovem, leve e rápida. Boa para gancho e chamada de urgência, quando a live precisa de energia no primeiro segundo.",
    genero: "feminina",
    idade: "Jovem adulta",
    sotaque: "Carioca",
    categoria: "Conversacional",
    uso: "Gancho e CTA",
    premium: true,
  },
  {
    id: "e0000000-0000-4000-8000-000000000003",
    nome: "Mariana",
    descricao:
      "Fala pausada, acolhedora, de quem explica sem pressa. Segura bem a parte de prova social e depoimento.",
    genero: "feminina",
    idade: "Adulta",
    sotaque: "Mineiro",
    categoria: "Conversacional",
    uso: "Prova e objeções",
    premium: false,
  },
  {
    id: "e0000000-0000-4000-8000-000000000004",
    nome: "Camila",
    descricao:
      "Animada e expressiva, com muita variação de tom. Combina com produto de moda, beleza e lançamento.",
    genero: "feminina",
    idade: "Jovem",
    sotaque: "Nordestino",
    categoria: "Publicidade",
    uso: "Oferta e promoção",
    premium: true,
  },
  {
    id: "e0000000-0000-4000-8000-000000000005",
    nome: "Rafael",
    descricao:
      "Voz grave e estável, de locutor. Passa autoridade quando o roteiro precisa sustentar preço alto.",
    genero: "masculina",
    idade: "Adulto",
    sotaque: "Paulistano",
    categoria: "Narração",
    uso: "Apresentação da live",
    premium: true,
  },
  {
    id: "e0000000-0000-4000-8000-000000000006",
    nome: "Thiago",
    descricao:
      "Descontraído, como quem conversa com o público em vez de narrar para ele. Bom para o meio da live.",
    genero: "masculina",
    idade: "Jovem adulto",
    sotaque: "Gaúcho",
    categoria: "Conversacional",
    uso: "Resposta ao chat",
    premium: false,
  },
  {
    id: "e0000000-0000-4000-8000-000000000007",
    nome: "Lucas",
    descricao:
      "Malandro no bom sentido: ritmo de quem faz oferta na rua. Funciona em produto popular e cupom relâmpago.",
    genero: "masculina",
    idade: "Adulto",
    sotaque: "Carioca",
    categoria: "Publicidade",
    uso: "Oferta e promoção",
    premium: false,
  },
  {
    id: "e0000000-0000-4000-8000-000000000008",
    nome: "Alex",
    descricao:
      "Timbre neutro, sem marca regional forte. A opção quando a marca não quer sotaque nenhum em cena.",
    genero: "neutra",
    idade: "Adulto",
    sotaque: "Neutro",
    categoria: "Institucional",
    uso: "Abertura e encerramento",
    premium: false,
  },
];

export const VOZES_EXEMPLO: Voz[] = BASE.map((base, indice) => ({
  ...base,
  origem: "catalogo",
  estado: "pronta",
  idioma: IDIOMA,
  idiomaNome: IDIOMA_NOME,
  bandeira: BANDEIRA,
  // A prévia existe — como tom rotulado, gerado na hora pelo handler. Dizer
  // que não existe esconderia o botão que prova que a tela funciona.
  temPrevia: true,
  exemplo: true,
  criadoEm: new Date(Date.parse(CRIADO_EM) - indice * 60_000).toISOString(),
}));

const IDS = new Set(VOZES_EXEMPLO.map((voz) => voz.id));

/** A prévia desta voz sai de um tom local: ela não existe no banco nem no provedor. */
export function ehVozExemplo(id: string): boolean {
  return IDS.has(id);
}
