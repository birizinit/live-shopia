/**
 * Content-Security-Policy, montada a cada requisição pelo proxy.
 *
 * Script só roda com o nonce daquela resposta: um XSS que um dia escape do
 * escape do React não executa, porque não tem como adivinhar o nonce. O Next
 * carimba o nonce sozinho nos scripts dele; os dois inline nossos (tema e
 * faixa de serviço) leem de `x-nonce`.
 *
 * `style-src` fica com 'unsafe-inline' por um motivo concreto: o React escreve
 * `style=` em atributo (largura de barra de progresso, por exemplo), e atributo
 * não aceita nonce. Estilo injetado não executa código; script injetado sim.
 */
export function politicaDeConteudo(nonce: string, desenvolvimento: boolean): string {
  return [
    "default-src 'self'",
    // Em dev o React usa eval para reconstruir a pilha de erro do servidor.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${desenvolvimento ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
    // 'strict-dynamic' ignora 'self' em script-src; sem isto o sw.js do push
    // deixaria de registrar.
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(desenvolvimento ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function gerarNonce(): string {
  return btoa(crypto.randomUUID());
}
