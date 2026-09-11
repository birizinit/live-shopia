import { THEME_COLOR, THEME_STORAGE_KEY } from "./constants";

/**
 * Aplica o tema antes da primeira pintura — sem isso o app pisca branco
 * antes de virar escuro. Roda no <head>, síncrono, de propósito.
 *
 * "system" (padrão) não escreve data-theme: quem decide é a media query
 * do tokens.css. Só escolha explícita vira atributo.
 */
export function ThemeScript() {
  const js = `(function(){try{
var k=${JSON.stringify(THEME_STORAGE_KEY)},t=localStorage.getItem(k),d=document.documentElement;
if(t==="dark"||t==="light"){d.dataset.theme=t}
var dark=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var m=document.querySelector('meta[name="theme-color"]');
if(m){m.setAttribute("content",dark?${JSON.stringify(THEME_COLOR.dark)}:${JSON.stringify(THEME_COLOR.light)})}
}catch(e){}})();`;

  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
