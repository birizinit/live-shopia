import { ShieldCheck, ShieldAlert } from "lucide-react";
import { ROTULO_CATEGORIA, revisarTexto } from "@/lib/termos-restritos";

/**
 * Revisão anti-restrição do texto, mostrada ANTES de a voz ser gerada.
 *
 * É o momento barato de corrigir: depois do áudio pago, trocar uma palavra
 * custa o áudio inteiro de novo. A regra é a mesma que a extensão confere
 * (src/lib/termos-restritos.ts), então o que passa aqui passa lá.
 */
export function RevisaoRestricao({ texto }: { texto: string }) {
  const alertas = revisarTexto(texto);

  if (alertas.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-md bg-success-soft px-4 py-3 text-success">
        <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">Proteção anti-restrição: tudo certo</p>
          <p className="mt-0.5">
            O texto não manda ninguém para fora do TikTok, não pede Pix e não promete
            resultado — os motivos mais comuns de o TikTok restringir uma live.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md bg-warning-soft px-4 py-3 text-warning">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">
            {alertas.length === 1
              ? "1 trecho pode fazer o TikTok restringir a live"
              : `${alertas.length} trechos podem fazer o TikTok restringir a live`}
          </p>
          <p className="mt-0.5">
            Corrija antes de gerar a voz: depois do áudio pronto, trocar uma palavra
            custa o áudio inteiro de novo.
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {alertas.map((alerta) => (
          <li
            key={`${alerta.inicio}-${alerta.trecho}`}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
          >
            <p>
              <span className="font-semibold">“{alerta.trecho}”</span>{" "}
              <span className="text-xs text-fg-subtle">· {ROTULO_CATEGORIA[alerta.categoria]}</span>
            </p>
            <p className="mt-0.5 text-fg-muted">{alerta.motivo}</p>
            <p className="mt-0.5 text-fg-muted">
              <span className="font-medium text-fg">Troque por:</span> {alerta.sugestao}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
