import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-5 text-center">
      <Logo />
      <div>
        <p className="num font-[family-name:var(--font-mono)] text-sm text-fg-subtle">
          404
        </p>
        <h1 className="mt-2 text-3xl font-bold">Esta página não existe</h1>
        <p className="mt-2 text-fg-muted">
          O link pode ter mudado de lugar, ou a tela ainda não foi construída.
        </p>
      </div>
      <Link
        href="/inicio"
        className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-fg hover:bg-primary-hover"
      >
        Voltar para o início
      </Link>
    </div>
  );
}
