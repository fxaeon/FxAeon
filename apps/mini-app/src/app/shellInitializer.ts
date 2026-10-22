/**
 * Runs in <head> before the first paint and before React hydrates, so what it
 * decides is right on the first frame. The build hashes it into the
 * Content-Security-Policy (scripts/generate_csp_headers.mjs). `r` is the root
 * element; every part guards its own storage access.
 */

/** Dark from the first paint, including saved light choices and blocked storage. */
const THEME = "r.dataset.theme='dark';r.style.colorScheme='dark';try{localStorage.setItem('fxaeon_theme_id_v2','dark');}catch{}";

/** Route headings arrive lit once per session (globals.css, heading-light):
 * when the first sweep ends the root is marked, and later pages and reloads
 * in this session show plain titles from their first frame. */
export const HEADING_LIT_KEY = 'fxaeon_heading_lit';
const HEADING = `try{if(sessionStorage.getItem('${HEADING_LIT_KEY}'))r.dataset.headingLit='';}catch{}`
  + "document.addEventListener('animationend',function l(e){if(e.animationName!=='heading-light')return;r.dataset.headingLit='';document.removeEventListener('animationend',l);"
  + `try{sessionStorage.setItem('${HEADING_LIT_KEY}','1');}catch{}});`;

export const SHELL_INITIALIZER = `(()=>{const r=document.documentElement;${THEME}${HEADING}})();`;
