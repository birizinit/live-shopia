import { cn } from "@/lib/utils";

export function Logo({
  className,
  comTexto = true,
}: {
  className?: string;
  comTexto?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg
        viewBox="0 0 512 512"
        className="size-7 shrink-0 rounded-[9px]"
        aria-hidden
      >
        <rect width="512" height="512" rx="116" fill="var(--primary)" />
        <g
          stroke="var(--primary-fg)"
          strokeWidth="34"
          strokeLinecap="round"
          fill="none"
        >
          <path d="M146 216v80" />
          <path d="M212 168v176" />
          <path d="M278 136v240" />
          <path d="M344 192v128" />
        </g>
      </svg>
      {comTexto && (
        <span className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-fg">
          Shopia
        </span>
      )}
    </span>
  );
}
