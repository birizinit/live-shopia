import { Sidebar } from "@/components/layout/sidebar";
import { TabBar } from "@/components/layout/tab-bar";
import { Topbar } from "@/components/layout/topbar";
import { obterUsuario } from "@/lib/sessao";

/**
 * Casca do app. Não exige sessão aqui de propósito: /planos é aberto e
 * precisa renderizar para quem ainda não entrou. Quem barra o resto é o
 * proxy (src/proxy.ts); quem exige papel é a própria página.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const usuario = await obterUsuario();
  const papel = usuario?.papel ?? null;

  return (
    <div className="flex min-h-dvh">
      <Sidebar papel={papel} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar usuario={usuario} />
        <main className="flex-1 px-4 pt-6 pb-28 lg:px-8 lg:pt-8 lg:pb-12">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
        <TabBar papel={papel} />
      </div>
    </div>
  );
}
