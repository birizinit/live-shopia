-- =============================================================================
-- O tour conta o caminho curto.
--
-- 'caminho' descrevia seis telas numa ordem que a pessoa precisava decorar e
-- mandava para /produtos. Agora existe o assistente "Criar live", que faz
-- produto, roteiro, voz e áudio em três passos — o tour aponta para ele.
--
-- 'ajuda' prometia "o suporte fica no Perfil", e não existe suporte no Perfil.
-- Promessa que a tela não cumpre é pior do que nenhuma: tirada.
-- =============================================================================

update public.onboarding_passos
   set titulo = 'O caminho: o que vender → roteiro e voz → áudio → extensão → no ar',
       corpo = 'No assistente Criar live você diz o que vai vender — nome, preço e um pouco sobre o produto — e a IA escreve o roteiro de vendas. Você lê, escolhe a voz da apresentadora, vê quanto vai custar e gera o áudio. Pronto: ele entra sozinho no que a extensão toca. Depois é instalar a extensão no Chrome, uma vez só, e entrar no ar pelo LIVE Studio. Vale caprichar na descrição do produto: sem detalhe o roteiro sai genérico, e nenhuma voz salva um roteiro genérico.',
       rota_alvo = '/criar'
 where chave = 'caminho';

update public.onboarding_passos
   set corpo = 'As Aulas trazem o passo a passo em vídeo, inclusive a instalação da extensão, que é onde mais gente trava. A página Extensão também tem o roteiro de "Entrar no ar, na prática". E este tour não é de uma vez só: ele fica salvo na sua CONTA, não no navegador — dá para sair no meio e continuar depois, de qualquer aparelho, pelo cartão no Início.'
 where chave = 'ajuda';
