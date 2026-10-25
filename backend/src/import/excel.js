// Lectura de extracciones .xlsx o .csv con detección de la fila de encabezados.
import ExcelJS from 'exceljs';

export const normHeader = s => String(s ?? '').trim().toUpperCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

function celda(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    // Excel no guarda zona horaria: exceljs entrega la hora "de pared" en UTC
    return new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds());
  }
  if (typeof v === 'object') {
    if ('result' in v) return celda(v.result);
    if (v.richText) return v.richText.map(r => r.text).join('');
    if ('text' in v) return v.text;
    if (v.error) return null;
  }
  return v;
}

function parseCSV(text) {
  const primera = text.split(/\r?\n/, 1)[0];
  const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : ',';
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (comillas) {
      if (ch === '"' && text[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += ch;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

// Devuelve [{hoja, filas: [{ENCABEZADO_NORMALIZADO: valor}]}] para cada hoja que contenga las columnas requeridas
export async function leerTablas(buffer, nombreArchivo, requeridas) {
  const req = requeridas.map(normHeader);
  let hojas = [];
  if (/\.csv$/i.test(nombreArchivo)) {
    hojas = [{ nombre: 'csv', aoa: parseCSV(buffer.toString('utf8').replace(/^﻿/, '')) }];
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    wb.eachSheet(ws => {
      const aoa = [];
      ws.eachRow({ includeEmpty: true }, (row, n) => {
        const vals = row.values.slice(1).map(celda);
        aoa[n - 1] = vals;
      });
      hojas.push({ nombre: ws.name, aoa: Array.from(aoa, r => r || []) });
    });
  }
  const out = [];
  for (const h of hojas) {
    const idx = h.aoa.slice(0, 30).findIndex(r => { const n = r.map(normHeader); return req.every(x => n.includes(x)); });
    if (idx < 0) continue;
    const head = h.aoa[idx].map(normHeader);
    const filas = h.aoa.slice(idx + 1)
      .filter(r => r.some(v => v !== null && v !== ''))
      .map(r => Object.fromEntries(head.map((k, i) => [k, r[i] ?? null]).filter(([k]) => k)));
    out.push({ hoja: h.nombre, filas });
  }
  return out;
}

// ---------- conversión de valores ----------
export const txt = v => (v === null || v === undefined) ? null : (String(v).trim() || null);
export const num = v => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
// Fecha y hora: Date, 'YYYY-MM-DD HH:MM[:SS]', 'DD-MM-YYYY HH:MM' o 'HH:MM' (con fecha base)
export function fechaHora(v, base) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') { // serial de Excel
    const ms = Math.round((v - 25569) * 86400000);
    const u = new Date(ms);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m && base) { const [y, mo, d] = base.split('-').map(Number); return new Date(y, mo - 1, d, +m[1], +m[2], +(m[3] || 0)); }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
export function soloFecha(v) {
  const d = fechaHora(v);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
