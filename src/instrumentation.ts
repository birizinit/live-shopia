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

  // Banco fora do ar nao pode impedir o servidor de subir: sem admin a
  // aplicacao inteira continua funcionando, so a tela de operacao fica fechada.
  const { promoverAdminsIniciais } = await import("@/lib/admin-inicial");
  void promoverAdminsIniciais().catch((erro) =>
    console.error("[admin-inicial] falhou:", erro),
  );
}
