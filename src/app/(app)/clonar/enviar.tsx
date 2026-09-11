"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { Dna, FileAudio, Mic, ShieldCheck, Trash2 } from "lucide-react";
import { apagarAudio, enviarAmostra, sincronizarClonagem, type EstadoEnvio } from "./actions";
import { Alerta } from "@/components/ui/alerta";
import { Badge } from "@/components/ui/badge";
import { BarraProgresso } from "@/components/ui/barra-progresso";
import { Button } from "@/components/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { FiltroSegmentado } from "@/components/ui/filtro-segmentado";
import { Campo, Input } from "@/components/ui/input";
import { Propriedade, Propriedades } from "@/components/ui/propriedades";
import { AreaTexto, Selecao } from "@/components/ui/selecao";
import { useAvisos } from "@/components/ui/avisos";
import { formatarDuracao } from "@/lib/caracteres";
import { numero } from "@/lib/utils";
import type {
  AmostraVoz,
  EstadoAmostra,
  Idioma,
  ModoClonagem,
  ModoInfo,
  VozClonada,
} from "@/lib/dados/clonagem";

/**
 * Envio da amostra e acompanhamento da clonagem.
 *
 * Formulário e lista moram no MESMO componente porque compartilham dois
 * estados: a chave de idempotência (que só troca quando um envio é aceito) e a
 * lista de amostras (que precisa mostrar o envio recém-aceito sem esperar o
 * próximo intervalo).
 */

export type PainelClonagemProps = {
  /** chaveIdempotente() gerada no render do Server Component. */
  chaveInicial: string;
  servicoLigado: boolean;
  demo: boolean;
  modos: ModoInfo[];
  idiomas: Idioma[];
  amostrasIniciais: AmostraVoz[];
  vozesIniciais: VozClonada[];
  textoConsentimento: string;
  tetoBytes: number;
  formatos: string;
  /** Cartões estáticos renderizados no servidor e encaixados na coluna lateral. */
  lateral?: React.ReactNode;
};

const ROTULO_ESTADO: Record<EstadoAmostra, { texto: string; tom: "neutro" | "info" | "sucesso" | "perigo" }> = {
  enviada: { texto: "Na fila", tom: "neutro" },
  processando: { texto: "Clonando", tom: "info" },
  clonada: { texto: "Voz pronta", tom: "sucesso" },
  recusada: { texto: "Recusada", tom: "perigo" },
};

const INTERVALO_MS = 4000;

function megabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function dataCurta(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Mede a duração no navegador.
 *
 * Serve para avisar "isso tem 6 segundos" antes de subir 8 MB — o servidor
 * mede de novo pelo cabeçalho do arquivo e é ele quem decide (ver
 * `analisarAmostra`). Contêiner que não expõe duração resolve `null` e o envio
 * segue: travar o upload por causa de um `<audio>` teimoso seria pior.
 */
function medirDuracao(arquivo: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(arquivo);
    const audio = new Audio();
    let encerrado = false;

    const encerrar = (valor: number | null) => {
      if (encerrado) return;
      encerrado = true;
      URL.revokeObjectURL(url);
      resolve(valor);
    };

    audio.preload = "metadata";
    audio.onloadedmetadata = () =>
      encerrar(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null);
    audio.onerror = () => encerrar(null);
    audio.src = url;

    // Navegador que não dispara nenhum dos dois não pode travar o formulário.
    setTimeout(() => encerrar(null), 8000);
  });
}

/**
 * Envia passando pela action, mas sem deixar erro de transporte virar tela de
 * erro.
 *
 * O caso concreto é o teto de corpo das Server Actions, que o Next fixa em
 * 1 MB por padrão: uma amostra de 6 MB é recusada pelo framework ANTES de a
 * action rodar, e sem esta captura o formulário sumiria atrás do error.tsx sem
 * dizer o que houve. Erro de controle de fluxo do Next (redirect de sessão
 * expirada, por exemplo) segue subindo — ele PRECISA chegar ao framework.
 */
async function enviarProtegido(
  anterior: EstadoEnvio,
  dados: FormData,
): Promise<EstadoEnvio> {
  try {
    return await enviarAmostra(anterior, dados);
  } catch (erro) {
    const digest = (erro as { digest?: unknown })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) throw erro;

    console.error("[clonar] o envio não chegou ao servidor:", erro);
    return {
      erro:
        "O servidor recusou o envio antes de recebê-lo por inteiro. Arquivo " +
        "acima de 1 MB só passa depois de elevar serverActions.bodySizeLimit " +
        "para 10mb no next.config.ts — o armazenamento aceita 8 MB, mas o Next " +
        "corta antes disso.",
      proximaChave: String(dados.get("chave") ?? anterior.proximaChave),
    };
  }
}

export function PainelClonagem({
  chaveInicial,
  servicoLigado,
  demo,
  modos,
  idiomas,
  amostrasIniciais,
  vozesIniciais,
  textoConsentimento,
  tetoBytes,
  formatos,
  lateral,
}: PainelClonagemProps) {
  const avisos = useAvisos();
  const formulario = useRef<HTMLFormElement>(null);
  const ultimoAceite = useRef<string | null>(null);

  const [estado, acao, enviando] = useActionState<EstadoEnvio, FormData>(enviarProtegido, {
    proximaChave: chaveInicial,
  });

  const [modo, setModo] = useState<ModoClonagem>(modos[0]?.id ?? "rapido");
  const [aceite, setAceite] = useState(false);
  const [escolhido, setEscolhido] = useState<{
    nome: string;
    bytes: number;
    duracaoMs: number | null;
  } | null>(null);
  const [problema, setProblema] = useState<string | null>(null);

  const [amostras, setAmostras] = useState(amostrasIniciais);
  const [vozes, setVozes] = useState(vozesIniciais);
  const [apagando, iniciarApagar] = useTransition();

  const modoAtual = modos.find((m) => m.id === modo) ?? modos[0]!;
  const abertas = amostras.filter(
    (a) => a.estado === "enviada" || a.estado === "processando",
  ).length;

  const sincronizar = useCallback(async () => {
    try {
      const dados = await sincronizarClonagem();
      setAmostras(dados.amostras);
      setVozes(dados.vozes);
    } catch {
      // Falha de rede no intervalo não vira alarme: a próxima volta resolve.
    }
  }, []);

  // Enquanto houver amostra aberta, o estado do job vem em intervalo. Sem
  // amostra aberta nada é consultado — é a diferença entre acompanhar e
  // martelar o servidor. No demo o exemplo nunca sai de "processando", então
  // o intervalo seria uma consulta eterna para receber sempre o mesmo.
  useEffect(() => {
    if (demo || abertas === 0) return;
    const relogio = setInterval(() => void sincronizar(), INTERVALO_MS);
    return () => clearInterval(relogio);
  }, [demo, abertas, sincronizar]);

  useEffect(() => {
    if (!estado.ok || !estado.mensagem) return;
    // A chave nova é o que identifica um aceite novo: sem esta trava o efeito
    // reabriria o aviso a cada render.
    if (ultimoAceite.current === estado.proximaChave) return;
    ultimoAceite.current = estado.proximaChave;

    avisos.sucesso("Amostra enviada", estado.mensagem);
    formulario.current?.reset();
    setEscolhido(null);
    setAceite(false);
    setProblema(null);
    void sincronizar();
  }, [estado, avisos, sincronizar]);

  async function aoEscolherArquivo(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    setProblema(null);

    if (!arquivo) {
      setEscolhido(null);
      return;
    }

    if (arquivo.size > tetoBytes) {
      setEscolhido(null);
      evento.target.value = "";
      setProblema(
        `O arquivo tem ${megabytes(arquivo.size)} e o teto é ${megabytes(tetoBytes)}. ` +
          "Corte um trecho ou exporte em MP3 de 128 kbps.",
      );
      return;
    }

    const duracaoMs = await medirDuracao(arquivo);
    setEscolhido({ nome: arquivo.name, bytes: arquivo.size, duracaoMs });

    if (duracaoMs !== null && duracaoMs < modoAtual.segundosMinimos * 1000) {
      setProblema(
        `O modo ${modoAtual.rotulo.toLowerCase()} pede pelo menos ${modoAtual.segundosMinimos} ` +
          `segundos. Este arquivo tem ${Math.round(duracaoMs / 1000)}.`,
      );
    }
  }

  function trocarModo(novo: ModoClonagem) {
    setModo(novo);
    const info = modos.find((m) => m.id === novo);
    if (!info || !escolhido?.duracaoMs) {
      setProblema(null);
      return;
    }
    setProblema(
      escolhido.duracaoMs < info.segundosMinimos * 1000
        ? `O modo ${info.rotulo.toLowerCase()} pede pelo menos ${info.segundosMinimos} segundos.`
        : null,
    );
  }

  function removerAudio(amostra: AmostraVoz) {
    iniciarApagar(async () => {
      const resultado = await apagarAudio(amostra.id);
      if (resultado.ok) {
        avisos.sucesso("Áudio apagado", "O registro do consentimento continua guardado.");
        await sincronizar();
      } else {
        avisos.erro("Não deu para apagar", resultado.erro);
      }
    });
  }

  const podeEnviar = servicoLigado && !demo && !enviando && Boolean(escolhido) && aceite;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardTitulo>Nova amostra</CardTitulo>
          <CardDescricao>
            Grave em ambiente silencioso, falando naturalmente como você falaria na
            live. O arquivo fica na sua conta e vira a voz da apresentadora.
          </CardDescricao>

          <form ref={formulario} action={acao} className="mt-5 space-y-5">
            <input type="hidden" name="chave" value={estado.proximaChave} />
            <input type="hidden" name="modo" value={modo} />
            <input type="hidden" name="duracao_ms" value={escolhido?.duracaoMs ?? ""} />

            {estado.erro && <Alerta tom="erro">{estado.erro}</Alerta>}

            <Campo
              rotulo="Nome da voz"
              htmlFor="nome"
              dica="É como ela vai aparecer no catálogo em /vozes."
            >
              <Input
                id="nome"
                name="nome"
                required
                minLength={2}
                maxLength={60}
                placeholder="Minha voz — estúdio"
                defaultValue={estado.campos?.nome}
                disabled={!servicoLigado}
              />
            </Campo>

            <div className="space-y-2">
              <span className="block text-sm font-medium text-fg">Modo de clonagem</span>
              <FiltroSegmentado
                opcoes={modos.map((m) => ({ valor: m.id, rotulo: m.rotulo }))}
                valor={modo}
                aoMudar={trocarModo}
                rotulo="Modo de clonagem"
              />
              <p className="text-xs text-fg-subtle">
                {modoAtual.resumo} Mínimo de{" "}
                <span className="num">{modoAtual.segundosMinimos}s</span>, ideal a partir
                de <span className="num">{formatarDuracao(modoAtual.segundosIdeais * 1000)}</span>.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Idioma da amostra" htmlFor="idioma">
                <Selecao
                  id="idioma"
                  name="idioma"
                  defaultValue={estado.campos?.idioma ?? "pt-BR"}
                  disabled={!servicoLigado}
                  opcoes={idiomas.map((i) => ({
                    valor: i.codigo,
                    rotulo: `${i.bandeira} ${i.nome}`,
                  }))}
                />
              </Campo>

              <Campo rotulo="Gênero da voz" htmlFor="genero">
                <Selecao
                  id="genero"
                  name="genero"
                  defaultValue={estado.campos?.genero ?? "feminina"}
                  disabled={!servicoLigado}
                  opcoes={[
                    { valor: "feminina", rotulo: "Feminina" },
                    { valor: "masculina", rotulo: "Masculina" },
                    { valor: "neutra", rotulo: "Neutra" },
                  ]}
                />
              </Campo>
            </div>

            <Campo rotulo="Descrição (opcional)" htmlFor="descricao">
              <AreaTexto
                // AreaTexto guarda o texto em estado próprio, então form.reset()
                // não a limpa: a chave nova de um envio aceito remonta o campo.
                key={estado.proximaChave}
                id="descricao"
                name="descricao"
                maximo={300}
                rows={2}
                disabled={!servicoLigado}
                defaultValue={estado.campos?.descricao ?? ""}
                placeholder="Voz calma, sotaque paulista, ritmo de conversa."
                auxiliar="Ajuda a reconhecer a voz depois, no catálogo."
              />
            </Campo>

            <Campo
              rotulo="Arquivo da amostra"
              htmlFor="amostra"
              dica={`${formatos}. Até ${megabytes(tetoBytes)} por arquivo.`}
            >
              <input
                id="amostra"
                name="amostra"
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac"
                required
                disabled={!servicoLigado}
                onChange={aoEscolherArquivo}
                className="block w-full cursor-pointer rounded-md border border-border bg-surface text-sm text-fg-muted transition-[border-color] duration-[--dur-fast] hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-60 file:mr-3 file:cursor-pointer file:rounded-l-md file:border-0 file:bg-bg-subtle file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-fg"
              />
            </Campo>

            {escolhido && (
              <div className="flex items-center gap-3 rounded-md border border-border bg-bg-subtle px-3 py-2.5">
                <FileAudio className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {escolhido.nome}
                </span>
                <span className="num shrink-0 text-xs text-fg-muted">
                  {escolhido.duracaoMs !== null && `${formatarDuracao(escolhido.duracaoMs)} · `}
                  {megabytes(escolhido.bytes)}
                </span>
              </div>
            )}

            {problema && <Alerta tom="erro">{problema}</Alerta>}

            <div className="rounded-md border border-border bg-bg-subtle p-3.5">
              <p className="flex items-center gap-2 text-sm font-medium text-fg">
                <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden />
                Consentimento de uso da voz
              </p>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                {textoConsentimento}
              </p>

              <label
                htmlFor="consentimento"
                className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm font-medium text-fg"
              >
                <input
                  id="consentimento"
                  name="consentimento"
                  type="checkbox"
                  required
                  checked={aceite}
                  disabled={!servicoLigado}
                  onChange={(evento) => setAceite(evento.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-primary disabled:cursor-not-allowed"
                />
                Li e autorizo nos termos acima.
              </label>
            </div>

            <Button type="submit" tamanho="lg" disabled={!podeEnviar}>
              <Dna className="size-4" aria-hidden />
              {enviando ? "Enviando amostra…" : "Enviar e clonar"}
            </Button>
          </form>
        </Card>

        <aside className="space-y-4">
          <Card>
            <CardTitulo>Suas vozes clonadas</CardTitulo>
            {vozes.length === 0 ? (
              <CardDescricao>
                Nenhuma ainda. A primeira aparece aqui e no catálogo de /vozes assim
                que a clonagem terminar.
              </CardDescricao>
            ) : (
              <ul className="mt-3 space-y-2">
                {vozes.map((voz) => (
                  <li
                    key={voz.id}
                    className="flex items-start gap-3 rounded-md border border-border px-3 py-2.5"
                  >
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-fg"
                      aria-hidden
                    >
                      <Mic className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{voz.nome}</span>
                      <span className="mt-0.5 block text-xs text-fg-subtle">
                        {voz.idioma} · {voz.genero}
                      </span>
                    </span>
                    {voz.estado === "pronta" ? (
                      <Badge tom="sucesso">Pronta</Badge>
                    ) : voz.estado === "falhou" ? (
                      <Badge tom="perigo">Falhou</Badge>
                    ) : (
                      <Badge tom="info">Criando</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {lateral}
        </aside>
      </div>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Amostras enviadas</h2>
          {abertas > 0 && (
            <Badge tom="info">
              <span className="num">{numero(abertas)}</span> em andamento
            </Badge>
          )}
        </div>

        {amostras.length === 0 ? (
          <EstadoVazio
            icone={Dna}
            titulo="Nenhuma amostra enviada"
            texto="Envie o primeiro áudio acima. O consentimento é registrado junto com o envio e fica guardado mesmo se a voz for apagada depois."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {amostras.map((amostra) => (
              <li key={amostra.id}>
                <CartaoAmostra
                  amostra={amostra}
                  apagando={apagando}
                  aoApagar={() => removerAudio(amostra)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function CartaoAmostra({
  amostra,
  aoApagar,
  apagando,
}: {
  amostra: AmostraVoz;
  aoApagar: () => void;
  apagando: boolean;
}) {
  const rotulo = ROTULO_ESTADO[amostra.estado];
  const emAndamento = amostra.estado === "enviada" || amostra.estado === "processando";

  return (
    <Card className="flex h-full flex-col p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{amostra.nome}</p>
          <p className="num mt-0.5 text-xs text-fg-subtle">{dataCurta(amostra.criadoEm)}</p>
        </div>
        <Badge tom={rotulo.tom}>{rotulo.texto}</Badge>
      </div>

      {emAndamento && (
        <BarraProgresso
          className="mt-4"
          valor={amostra.progresso}
          rotulo={`Progresso da clonagem de ${amostra.nome}`}
          tamanho="sm"
        />
      )}

      {amostra.estado === "recusada" && amostra.erro && (
        <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {amostra.erro}
        </p>
      )}

      <Propriedades className="mt-3">
        <Propriedade rotulo="Modo" valor={amostra.modo === "treino" ? "Treino" : "Rápido"} />
        <Propriedade
          rotulo="Duração"
          numerica
          valor={amostra.duracaoMs ? formatarDuracao(amostra.duracaoMs) : "—"}
        />
        <Propriedade
          rotulo="Áudio"
          numerica
          valor={amostra.audioApagado ? "Apagado" : megabytes(amostra.bytes)}
        />
        <Propriedade
          rotulo="Consentimento"
          numerica
          valor={amostra.consentimentoEm ? dataCurta(amostra.consentimentoEm) : "—"}
        />
      </Propriedades>

      {amostra.estado === "recusada" && !amostra.audioApagado && (
        <div className="mt-4">
          <Button variante="ghost" tamanho="sm" onClick={aoApagar} disabled={apagando}>
            <Trash2 className="size-4" aria-hidden />
            Apagar o áudio
          </Button>
          <p className="mt-1.5 text-xs text-fg-subtle">
            O registro de quem autorizou, quando e de onde continua guardado.
          </p>
        </div>
      )}
    </Card>
  );
}
