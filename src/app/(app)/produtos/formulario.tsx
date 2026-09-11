"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { ImageUp, Plus, Trash2, X } from "lucide-react";
import { salvarProduto, type EstadoFormProduto } from "./actions";
import { Alerta } from "@/components/ui/alerta";
import { Button } from "@/components/ui/button";
import { Campo, Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { AreaTexto } from "@/components/ui/selecao";
import type { LimitesProduto, Produto } from "@/lib/dados/produtos";
import { brl, cn } from "@/lib/utils";

/**
 * Cadastro e edicao do produto.
 *
 * Os campos sao controlados de proposito. O React 19 limpa campos NAO
 * controlados quando a action de um formulario termina — com a action voltando
 * erro, o usuario perderia tudo que digitou exatamente no momento em que mais
 * precisa do que digitou.
 *
 * A imagem nao viaja na Server Action: ela sobe pela rota
 * /api/produtos/[id]/imagem, que nao tem o teto de 1 MB de corpo que as
 * Server Actions tem. No cadastro o arquivo espera o produto existir (precisa
 * do id na URL); na edicao sobe na hora em que e escolhido.
 */

export type ModalProdutoProps = {
  aberto: boolean;
  aoFechar: () => void;
  /** `null` abre o formulario em branco, para cadastro. */
  produto: Produto | null;
  limites: LimitesProduto;
  demo: boolean;
  aoSalvar: (info: { nome: string; novo: boolean; avisoImagem?: string }) => void;
};

type Campos = {
  nome: string;
  descricao: string;
  preco: string;
  precoDe: string;
  cupom: string;
  link: string;
  beneficios: string[];
  objecoes: string[];
};

const INICIAL: EstadoFormProduto = {};

function emReais(centavos: number | null): string {
  return centavos === null ? "" : (centavos / 100).toFixed(2).replace(".", ",");
}

function camposDe(produto: Produto | null): Campos {
  return {
    nome: produto?.nome ?? "",
    descricao: produto?.descricao ?? "",
    preco: emReais(produto?.precoCentavos ?? null),
    precoDe: emReais(produto?.precoDeCentavos ?? null),
    cupom: produto?.cupom ?? "",
    link: produto?.link ?? "",
    beneficios: produto?.beneficios.length ? [...produto.beneficios] : [""],
    objecoes: produto?.objecoes.length ? [...produto.objecoes] : [""],
  };
}

/** Leitura solta do campo de preco, so para a previa. O servidor reconta. */
function reaisAproximados(valor: string): number | null {
  const limpo = valor.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  const numero = Number(limpo);
  return limpo && Number.isFinite(numero) ? numero : null;
}

async function enviarImagem(produtoId: string, arquivo: File) {
  const corpo = new FormData();
  corpo.append("imagem", arquivo);

  const resposta = await fetch(`/api/produtos/${produtoId}/imagem`, {
    method: "POST",
    body: corpo,
  });

  if (resposta.ok) return { ok: true as const };

  const dados = (await resposta.json().catch(() => null)) as { erro?: string } | null;
  return {
    ok: false as const,
    erro: dados?.erro ?? "Não foi possível enviar a imagem. Tente de novo.",
  };
}

export function ModalProduto({
  aberto,
  aoFechar,
  produto,
  limites,
  demo,
  aoSalvar,
}: ModalProdutoProps) {
  const idForm = useId();
  const [estado, acao, enviando] = useActionState(salvarProduto, INICIAL);

  const [campos, setCampos] = useState<Campos>(() => camposDe(produto));
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [temImagem, setTemImagem] = useState(Boolean(produto?.imagemId));
  const [versaoImagem, setVersaoImagem] = useState(0);
  const [erroImagem, setErroImagem] = useState<string | null>(null);
  const [ocupadoImagem, setOcupadoImagem] = useState(false);

  // Recomeca no proprio render em que a caixa abre ou troca de produto. Num
  // efeito, o formulario anterior apareceria por um quadro — e num cadastro
  // novo isso seria o produto de antes, pronto para ser salvo de novo.
  const chave = `${aberto ? "1" : "0"}:${produto?.id ?? "novo"}`;
  const [chaveAnterior, setChaveAnterior] = useState(chave);
  if (chave !== chaveAnterior) {
    setChaveAnterior(chave);
    setCampos(camposDe(produto));
    setArquivo(null);
    setPrevia(null);
    setTemImagem(Boolean(produto?.imagemId));
    setErroImagem(null);
    setOcupadoImagem(false);
  }

  // Object URL e memoria retida ate ser revogada; sem isto cada troca de foto
  // deixaria o blob anterior vivo pelo resto da sessao.
  useEffect(() => {
    if (!previa) return;
    return () => URL.revokeObjectURL(previa);
  }, [previa]);

  // A resposta da action e tratada uma vez so: `em` muda a cada resposta e o
  // ref guarda a ultima tratada, senao um re-render repetiria o upload.
  const tratada = useRef<number | null>(null);
  useEffect(() => {
    if (!estado.em || estado.erro || !estado.produtoId) return;
    if (tratada.current === estado.em) return;
    tratada.current = estado.em;

    const produtoId = estado.produtoId;
    const novo = !produto;
    const nome = campos.nome;

    (async () => {
      let avisoImagem: string | undefined;

      if (arquivo) {
        setOcupadoImagem(true);
        const resultado = await enviarImagem(produtoId, arquivo);
        setOcupadoImagem(false);
        if (!resultado.ok) avisoImagem = resultado.erro;
      }

      // Fecha mesmo quando a imagem falha. O produto JA existe: manter a caixa
      // aberta convidaria a clicar em "Cadastrar" de novo e criar um segundo
      // produto identico. O aviso da foto vai junto e a imagem se resolve na
      // edicao, onde o envio e imediato.
      aoSalvar({ nome, novo, avisoImagem });
    })();
  }, [estado, arquivo, campos.nome, produto, aoSalvar]);

  function mudar<C extends keyof Campos>(campo: C, valor: Campos[C]) {
    setCampos((atuais) => ({ ...atuais, [campo]: valor }));
  }

  async function escolherArquivo(escolhido: File | null) {
    setErroImagem(null);
    if (!escolhido) return;

    if (!(limites.tiposImagem as readonly string[]).includes(escolhido.type)) {
      setErroImagem("Formato não aceito. Use JPEG, PNG, WebP, AVIF ou GIF.");
      return;
    }
    if (escolhido.size > limites.imagemBytes) {
      setErroImagem(
        `A imagem tem ${Math.ceil(escolhido.size / 1024 / 1024)} MB e o limite é de ` +
          `${limites.imagemBytes / 1024 / 1024} MB.`,
      );
      return;
    }

    setPrevia(URL.createObjectURL(escolhido));

    // Produto que ainda nao existe nao tem URL para receber a imagem: o arquivo
    // espera o salvamento e sobe logo depois.
    if (!produto) {
      setArquivo(escolhido);
      return;
    }

    setOcupadoImagem(true);
    const resultado = await enviarImagem(produto.id, escolhido);
    setOcupadoImagem(false);

    if (!resultado.ok) {
      setErroImagem(resultado.erro);
      setPrevia(null);
      return;
    }

    setArquivo(null);
    setTemImagem(true);
    setVersaoImagem((v) => v + 1);
  }

  async function removerImagem() {
    setErroImagem(null);
    setPrevia(null);
    setArquivo(null);

    if (!produto || !temImagem) return;

    setOcupadoImagem(true);
    const resposta = await fetch(`/api/produtos/${produto.id}/imagem`, { method: "DELETE" });
    setOcupadoImagem(false);

    if (!resposta.ok) {
      const dados = (await resposta.json().catch(() => null)) as { erro?: string } | null;
      setErroImagem(dados?.erro ?? "Não foi possível remover a imagem.");
      return;
    }
    setTemImagem(false);
    setVersaoImagem((v) => v + 1);
  }

  const ocupado = enviando || ocupadoImagem;
  const precoAgora = reaisAproximados(campos.preco);
  const precoAntes = reaisAproximados(campos.precoDe);
  const desconto =
    precoAgora !== null && precoAntes !== null && precoAntes > precoAgora
      ? Math.round(((precoAntes - precoAgora) / precoAntes) * 100)
      : null;

  const urlImagem = previa
    ? previa
    : temImagem && produto
      ? `/api/produtos/${produto.id}/imagem?v=${versaoImagem}`
      : null;

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={produto ? "Editar produto" : "Novo produto"}
      descricao={
        produto
          ? "O que mudar aqui vale para os próximos roteiros — os já gerados não são reescritos."
          : "Quanto mais concreto o benefício e a objeção, melhor o roteiro que a IA escreve."
      }
      tamanho="lg"
      travado={ocupado}
      rodape={
        <>
          <Button variante="secondary" onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button type="submit" form={idForm} disabled={ocupado || demo}>
            {ocupado ? "Salvando…" : produto ? "Salvar alterações" : "Cadastrar produto"}
          </Button>
        </>
      }
    >
      <form id={idForm} action={acao} className="space-y-5">
        {produto && <input type="hidden" name="id" value={produto.id} />}

        {demo && (
          <Alerta tom="info">
            Modo demo: a sessão de exemplo não tem linha no banco, então salvar
            está desligado. Configure <code>DATABASE_URL</code> para cadastrar de
            verdade.
          </Alerta>
        )}

        {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}

        <Campo rotulo="Nome do produto" htmlFor="nome" erro={erroDe(estado, "nome")}>
          <Input
            id="nome"
            name="nome"
            value={campos.nome}
            onChange={(evento) => mudar("nome", evento.target.value)}
            placeholder="Kit Skincare Vitamina C"
            aria-invalid={estado.campo === "nome" || undefined}
            autoComplete="off"
            required
            autoFocus
          />
        </Campo>

        <div className="space-y-1.5">
          <Label htmlFor="descricao">Descrição</Label>
          <AreaTexto
            id="descricao"
            name="descricao"
            value={campos.descricao}
            onChange={(evento) => mudar("descricao", evento.target.value)}
            maximo={limites.descricao}
            placeholder="O que é, o que acompanha e para quem serve."
            auxiliar="É daqui que a IA tira o contexto do roteiro."
            aria-invalid={estado.campo === "descricao" || undefined}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Preço na live (R$)"
            htmlFor="preco"
            dica="Deixe em branco se o preço só sai ao vivo."
            erro={erroDe(estado, "preco")}
          >
            <Input
              id="preco"
              name="preco"
              value={campos.preco}
              onChange={(evento) => mudar("preco", evento.target.value)}
              inputMode="decimal"
              placeholder="89,90"
              className="num"
              aria-invalid={estado.campo === "preco" || undefined}
            />
          </Campo>

          <Campo
            rotulo="Preço anterior (R$)"
            htmlFor="precoDe"
            dica={
              desconto !== null
                ? `${desconto}% de desconto — ${brl(precoAntes! - precoAgora!)} a menos.`
                : "Vira o preço riscado do “de / por”."
            }
            erro={erroDe(estado, "precoDe")}
          >
            <Input
              id="precoDe"
              name="precoDe"
              value={campos.precoDe}
              onChange={(evento) => mudar("precoDe", evento.target.value)}
              inputMode="decimal"
              placeholder="149,90"
              className="num"
              aria-invalid={estado.campo === "precoDe" || undefined}
            />
          </Campo>

          <Campo rotulo="Cupom" htmlFor="cupom" erro={erroDe(estado, "cupom")}>
            <Input
              id="cupom"
              name="cupom"
              value={campos.cupom}
              onChange={(evento) => mudar("cupom", evento.target.value)}
              placeholder="LIVE40"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={estado.campo === "cupom" || undefined}
            />
          </Campo>

          <Campo
            rotulo="Link do produto"
            htmlFor="link"
            dica="Para onde o chat manda quem quer comprar."
            erro={erroDe(estado, "link")}
          >
            <Input
              id="link"
              name="link"
              type="url"
              value={campos.link}
              onChange={(evento) => mudar("link", evento.target.value)}
              placeholder="https://"
              inputMode="url"
              aria-invalid={estado.campo === "link" || undefined}
            />
          </Campo>
        </div>

        <BlocoImagem
          url={urlImagem}
          nome={campos.nome}
          ocupado={ocupadoImagem}
          erro={erroImagem}
          demo={demo}
          tiposImagem={limites.tiposImagem}
          tetoMb={limites.imagemBytes / 1024 / 1024}
          pendente={Boolean(arquivo)}
          aoEscolher={escolherArquivo}
          aoRemover={removerImagem}
        />

        <ListaEditavel
          titulo="Benefícios"
          singular="Benefício"
          dica="O que muda na vida de quem compra. Concreto vende; adjetivo não."
          nome="beneficio"
          placeholder="Clareia manchas em 28 dias"
          itens={campos.beneficios}
          maximo={limites.itens}
          aoMudar={(itens) => mudar("beneficios", itens)}
        />

        <ListaEditavel
          titulo="Objeções"
          singular="Objeção"
          dica="O que faz a pessoa não comprar — e a resposta. A IA usa isto no bloco de objeções."
          nome="objecao"
          placeholder="«É caro» — sai a R$ 3 por dia"
          itens={campos.objecoes}
          maximo={limites.itens}
          aoMudar={(itens) => mudar("objecoes", itens)}
        />
      </form>
    </Modal>
  );
}

/** Mensagem do servidor so no campo que ela acusa. */
function erroDe(estado: EstadoFormProduto, campo: string) {
  return estado.campo === campo ? estado.erro : undefined;
}

function BlocoImagem({
  url,
  nome,
  ocupado,
  erro,
  demo,
  tiposImagem,
  tetoMb,
  pendente,
  aoEscolher,
  aoRemover,
}: {
  url: string | null;
  nome: string;
  ocupado: boolean;
  erro: string | null;
  demo: boolean;
  tiposImagem: readonly string[];
  tetoMb: number;
  pendente: boolean;
  aoEscolher: (arquivo: File | null) => void;
  aoRemover: () => void;
}) {
  const idCampo = useId();
  const entrada = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={idCampo}>Imagem</Label>

      <div className="flex items-start gap-4 rounded-md border border-border p-3">
        <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md bg-bg-subtle">
          {url ? (
            // <img> e nao next/image: a rota exige a sessao do dono, e o
            // otimizador de imagem busca a URL do servidor, sem o cookie.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={nome ? `Imagem de ${nome}` : "Imagem do produto"}
              className="size-full object-cover"
            />
          ) : (
            <ImageUp className="size-6 text-fg-subtle" aria-hidden />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <input
            ref={entrada}
            id={idCampo}
            type="file"
            accept={tiposImagem.join(",")}
            className="sr-only"
            disabled={demo || ocupado}
            onChange={(evento) => {
              aoEscolher(evento.target.files?.[0] ?? null);
              // Zera o campo: escolher o MESMO arquivo de novo depois de um erro
              // nao dispara change, e a pessoa ficaria clicando sem resposta.
              evento.target.value = "";
            }}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              variante="secondary"
              tamanho="sm"
              onClick={() => entrada.current?.click()}
              disabled={demo || ocupado}
            >
              <ImageUp className="size-4" aria-hidden />
              {url ? "Trocar imagem" : "Escolher imagem"}
            </Button>

            {url && (
              <Button
                variante="ghost"
                tamanho="sm"
                onClick={aoRemover}
                disabled={demo || ocupado}
              >
                <Trash2 className="size-4" aria-hidden />
                Remover
              </Button>
            )}
          </div>

          <p className="mt-2 text-xs text-fg-subtle">
            {ocupado
              ? "Enviando…"
              : pendente
                ? "A imagem sobe assim que o produto for cadastrado."
                : `JPEG, PNG, WebP, AVIF ou GIF, até ${tetoMb} MB.`}
          </p>

          {erro && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {erro}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ListaEditavel({
  titulo,
  singular,
  dica,
  nome,
  placeholder,
  itens,
  maximo,
  aoMudar,
}: {
  titulo: string;
  singular: string;
  dica: string;
  nome: string;
  placeholder: string;
  itens: string[];
  maximo: number;
  aoMudar: (itens: string[]) => void;
}) {
  const cheio = itens.length >= maximo;

  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium text-fg">{titulo}</legend>
      <p className="mt-1 text-xs text-fg-subtle">{dica}</p>

      <ul className="mt-2 space-y-2">
        {itens.map((item, indice) => (
          <li key={indice} className="flex items-center gap-2">
            <Input
              name={nome}
              value={item}
              aria-label={`${singular} ${indice + 1}`}
              placeholder={placeholder}
              onChange={(evento) => {
                const copia = [...itens];
                copia[indice] = evento.target.value;
                aoMudar(copia);
              }}
            />
            <button
              type="button"
              aria-label={`Remover ${singular.toLowerCase()} ${indice + 1}`}
              onClick={() => {
                const copia = itens.filter((_, i) => i !== indice);
                aoMudar(copia.length ? copia : [""]);
              }}
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-md text-fg-subtle",
                "transition-colors duration-[--dur-fast] hover:bg-surface-hover hover:text-danger",
              )}
            >
              <X className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <Button
        variante="secondary"
        tamanho="sm"
        className="mt-2"
        disabled={cheio}
        onClick={() => aoMudar([...itens, ""])}
      >
        <Plus className="size-4" aria-hidden />
        Adicionar
      </Button>

      {cheio && (
        <p className="mt-1.5 text-xs text-fg-subtle">
          Limite de <span className="num">{maximo}</span> itens — mais que isso a
          IA dilui em vez de destacar.
        </p>
      )}
    </fieldset>
  );
}
