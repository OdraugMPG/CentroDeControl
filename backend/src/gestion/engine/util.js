// Utilidades compartidas por el motor (equivalentes a modComun del libro Excel).

/** NormTxt del libro: mayúsculas, sin tildes y solo letras y dígitos. */
export function normTxt(s) {
  return String(s ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

export const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
export const up = (v) => txt(v).toUpperCase();

export function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/\s/g, '');
  // "1.234,5" (formato chileno) o "1234.5"
  if (/^-?[\d.]+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Comparación binaria de textos, como el operador < de VBA. */
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** SU_Clave: números con ceros a la izquierda para ordenar como número (o invertidos). */
export function claveOrden(s, desc = false) {
  const t = up(s);
  if (t !== '' && /^-?\d+([.,]\d+)?$/.test(t)) {
    const n = num(t);
    const v = desc ? 99999999 - n : n;
    return v.toFixed(2).padStart(11, '0');
  }
  return t;
}

// ---- fechas como texto ISO (YYYY-MM-DD), sin zonas horarias ----
export function isoDesdeSerial(serial) {
  const ms = Math.round((serial - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Acepta serial de Excel, Date, "dd-mm-aaaa", "dd/mm/aaaa", "aaaa-mm-dd". Devuelve ISO o null. */
export function aIso(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number') return v > 20000 && v < 80000 ? isoDesdeSerial(v) : null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  if (/^\d+(\.\d+)?$/.test(s)) return aIso(Number(s));
  return null;
}

export const diaNum = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);
export const isoDeDia = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export const sumarDias = (iso, d) => isoDeDia(diaNum(iso) + d);
/** 1 = lunes ... 7 = domingo (Weekday(d, vbMonday)) */
export function diaSemana(iso) {
  const w = new Date(iso + 'T00:00:00Z').getUTCDay();
  return w === 0 ? 7 : w;
}
export const NOMBRE_DIA = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export function hoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const fmtFecha = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');
