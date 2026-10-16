import { cn } from "@/lib/utils";

const BARRAS = ["M146 216v80", "M212 168v176", "M278 136v240", "M344 192v128"];

/**
 * O logo da Shopia (as barras) no estilo do TikTok: ladrilho preto e o
 * deslocamento ciano/vermelho. A forma é nossa — a Shopia não usa o logo do
 * TikTok nem se apresenta como produto dele.
 */
export function Logo({ className, comTexto = true }: { className?: string; comTexto?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 512 512" className="size-7 shrink-0 rounded-[8px] ring-1 ring-border" aria-hidden>
        <rect width="512" height="512" rx="116" fill="#121212" />
        <g strokeWidth="34" strokeLinecap="round" fill="none">
          <g stroke="#25F4EE" transform="translate(-9 -9)">
            {BARRAS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
          <g stroke="#FE2C55" transform="translate(9 9)">
            {BARRAS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
          <g stroke="#FFFFFF">
            {BARRAS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </g>
      </svg>
      {comTexto && (
        <span className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-fg">Shopia</span>
      )}
    </span>
  );
}
