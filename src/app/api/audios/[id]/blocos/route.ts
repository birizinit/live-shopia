import { NextResponse } from "next/server";
import { estadoAoVivo } from "@/lib/dados/audios";
import { obterUsuario } from "@/lib/sessao";

export const dynamic = "force-dynamic";

/**
 * Estado ao vivo de uma geração: quantos blocos ficaram prontos e quais já
 * podem tocar.
 *
 * É o que o estúdio consulta enquanto o job de tts trabalha. Responde 401 em
 * JSON em vez de redirecionar: quem chama é um `fetch`, e um redirecionamento
 * para /login chegaria ao cliente como HTML onde ele espera dados.
 *
 * `estadoAoVivo` recebe o perfil da sessão e o usa no `where` — id adivinhado
 * na URL não serve o áudio de outra pessoa.
 */
export async function GET(_pedido: Request, contexto: { params: Promise<{ id: string }> }) {
  const usuario = await obterUsuario();
  if (!usuario) {
    return NextResponse.json({ erro: "sessão expirada" }, { status: 401 });
  }

  const { id } = await contexto.params;
  const vivo = await estadoAoVivo(usuario.id, id);

  if (!vivo) {
    return NextResponse.json({ erro: "áudio não encontrado" }, { status: 404 });
  }

  return NextResponse.json(vivo, { headers: { "cache-control": "no-store" } });
}
