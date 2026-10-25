// Formatos y utilidades compartidas
const nf = new Intl.NumberFormat('es-CL');
export const N = v => v === null || v === undefined || Number.isNaN(v) ? '—' : nf.format(Math.round(v));
export const pctf = v => v === null || v === undefined || Number.isNaN(v) ? '—' : `${Math.round(v * 100)}%`;
export const hh = t => String(new Date(t).getHours()).padStart(2, '0') + ':00';
export const hhmm = t => t ? new Date(t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '—';
export const fechaHora = t => t ? new Date(t).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '—';
export const dmy = f => f ? f.split('-').reverse().join('-') : '';
export const dm = f => f ? f.slice(8, 10) + '-' + f.slice(5, 7) : '';
export const fmtAge = m => m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
export const minsDesde = (t, ref) => t ? Math.max(0, Math.round((ref - t) / 60000)) : 0;
export const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
export const uniq = (a, k) => new Set(a.map(r => r[k]).filter(Boolean)).size;
export const pctClass = (p, umbral = 0.85) => p === null || p === undefined ? '' : p >= 1 ? 'ok' : p >= umbral ? 'mid' : 'bad';
export const pctColor = (p, umbral = 0.85) => p === null || p === undefined ? '' : p < umbral ? 'warn' : p >= 1 ? 'ok' : '';
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const diaNombre = f => DIAS[new Date(f + 'T12:00:00').getDay()];

export const FASES = { 'Picking': '--blue', 'Consolidación': '--violet', 'Empaque': '--teal', 'Despacho': '--slate' };
export const FASES_ORDEN = Object.keys(FASES);

export const REGIONES = {
  '15': 'Arica y Parinacota', '01': 'Tarapacá', '02': 'Antofagasta', '03': 'Atacama', '04': 'Coquimbo', '05': 'Valparaíso',
  '13': 'Metropolitana', '06': "O'Higgins", '07': 'Maule', '16': 'Ñuble', '08': 'Biobío', '09': 'La Araucanía',
  '14': 'Los Ríos', '10': 'Los Lagos', '11': 'Aysén', '12': 'Magallanes'
};
export const REG_ORDEN = Object.keys(REGIONES);

export const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
