/**
 * Sobe o worker da fila junto com o servidor.
 *
 * `register()` roda uma vez por instancia e o servidor so fica pronto depois
 * que ela termina — por isso o worker e disparado sem `await`: ele e um laco
 * perpetuo, esperar por ele seria nunca responder requisicao nenhuma.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { iniciarWorker } = await import("@/lib/worker");
  void iniciarWorker();
}
