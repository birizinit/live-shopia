// Página que pede a permissão de áudio que o painel lateral não consegue pedir.
//
// O painel lateral do Chrome não mostra o balão de permissão: lá, o pedido de
// microfone falha em silêncio, e o Chrome continua escondendo o nome das
// saídas de áudio. Numa aba normal o balão aparece. Como a permissão é da
// ORIGEM da extensão, o que for liberado aqui passa a valer no painel também.

const botao = document.getElementById("btn-liberar");
const resultado = document.getElementById("resultado");

function mostrar(tom, texto) {
  resultado.className = `aviso ${tom}`;
  resultado.textContent = texto;
  resultado.hidden = false;
}

async function liberar() {
  botao.disabled = true;
  try {
    const trilha = await navigator.mediaDevices.getUserMedia({ audio: true });
    trilha.getTracks().forEach((t) => t.stop());

    mostrar("ok", "Pronto! Pode voltar para o painel da Shopia — esta aba fecha sozinha.");
    await chrome.runtime.sendMessage({ tipo: "rotulos_liberados" }).catch(() => {});
    setTimeout(() => window.close(), 1800);
  } catch (erro) {
    botao.disabled = false;
    const negou = erro?.name === "NotAllowedError";
    mostrar(
      "perigo",
      negou
        ? "O acesso foi bloqueado. Clique no ícone à esquerda do endereço desta aba, " +
            "abra Configurações do site, troque Microfone para Permitir e clique em " +
            "Liberar acesso de novo."
        : "Não deu para liberar agora. Confira se há algum dispositivo de áudio ligado e tente de novo.",
    );
  }
}

botao.addEventListener("click", () => void liberar());

// Tenta já na abertura: quem clicou em "Liberar" no painel espera o balão.
void liberar();
