// Tema de la interfaz: 'auto' (según el sistema), 'claro' u 'oscuro'. Se guarda por navegador y se aplica con
// data-theme en <html>, que es lo que leen los colores de styles.css y gestion.css.
const CLAVE = 'temaCentroControl';
export const TEMAS = [['auto', 'Automático'], ['claro', 'Claro'], ['oscuro', 'Oscuro']];

export function leerTema() {
  try { const t = localStorage.getItem(CLAVE); return TEMAS.some(([k]) => k === t) ? t : 'auto'; } catch { return 'auto'; }
}

export function aplicarTema(t) {
  const html = document.documentElement;
  if (t === 'claro') html.dataset.theme = 'light';
  else if (t === 'oscuro') html.dataset.theme = 'dark';
  else delete html.dataset.theme;
  try { localStorage.setItem(CLAVE, t); } catch { /* sin almacenamiento: vale solo para esta sesión */ }
  window.dispatchEvent(new Event('tema'));
}

/** true si la interfaz se ve en oscuro (por elección o por el sistema). */
export function esOscuro() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
