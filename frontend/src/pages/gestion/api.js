// Cliente de la API de Gestión Diaria. Las vistas usan rutas '/api/...' (como en el proyecto original):
// aquí se envían a /api/gestion/... del backend del centro de control, con la cookie de sesión.
import { API_URL, sinSesion } from '../../lib/api.js';

export const urlApi = (u) => API_URL + '/gestion' + u.replace(/^\/api/, '');

async function pedir(metodo, url, cuerpo) {
  const opt = { method: metodo, headers: { 'X-CC': '1' }, cache: 'no-store', credentials: 'include' };
  if (cuerpo instanceof FormData) opt.body = cuerpo;
  else if (cuerpo !== undefined) { opt.body = JSON.stringify(cuerpo); opt.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(urlApi(url), opt);
  const t = await r.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch { d = { error: t }; }
  if (r.status === 401) sinSesion();
  if (!r.ok) throw Object.assign(new Error(d?.error || `Error ${r.status}`), { status: r.status, data: d });
  return d;
}
export const api = {
  get: (u) => pedir('GET', u),
  post: (u, b) => pedir('POST', u, b),
  put: (u, b) => pedir('PUT', u, b),
  patch: (u, b) => pedir('PATCH', u, b),
  del: (u) => pedir('DELETE', u),
};
export const qs = (o) => '?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null)).toString();

export const PROC = { INV: 'Inventario', CONS: 'Consolidación', SU: 'Stock unitario', SM: 'Slow moving', REU: 'Reubicación ABC' };
export const fmt = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('es-CL', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const pct = (x) => (x * 100).toFixed(1).replace('.', ',') + '%';
export const fFecha = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');
export const hora = (ts) => (ts ? new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '');
export function hoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const clase = (x, meta = 0.95) => (x >= meta ? 'good' : x >= meta - 0.1 ? 'warn' : 'bad');
export const color = (x, meta = 0.95) => `var(--${clase(x, meta)})`;
