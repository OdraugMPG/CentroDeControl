// Clasificación ABC / XYZ por CD.
// ABC: Pareto sobre la columna VENTAS de la Base (venta de los últimos 2 meses), en unidades o en valor (ventas x costo).
// XYZ: coeficiente de variación de la venta mensual, con la historia cargada aparte (meses sin venta cuentan como 0).
import XLSX from 'xlsx';
import { normTxt, txt, up, num, aIso, cmp } from './util.js';
import { ALIAS, buscarCol } from './base.js';

const AL_MES = 'MES|PERIODO|FECHA|MES VENTA|PERIODO VENTA|ANO MES|AÑO MES|ANIO MES|MONTH|PERIOD|DATE';
const AL_UNID = 'UNIDADES|VENTAS|VENTA|VTA|VTAS|UNIDADES VENDIDAS|VENTA UNIDADES|UNID VENDIDAS|CANTIDAD|QTY|SALES|DEMANDA';

const NOMBRES_MES = [['ENE', 'JAN'], ['FEB'], ['MAR'], ['ABR', 'APR'], ['MAY'], ['JUN'], ['JUL'], ['AGO', 'AUG'], ['SEP', 'SET'], ['OCT'], ['NOV'], ['DIC', 'DEC']];

/** Mes 'YYYY-MM' desde fecha, serial de Excel, 'YYYY-MM', 'YYYYMM', 'MM-YYYY' o 'MM/YYYY'. */
export function mesDe(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v >= 190001 && v <= 210012 && v % 100 >= 1 && v % 100 <= 12) return `${Math.floor(v / 100)}-${String(v % 100).padStart(2, '0')}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.]?(\d{1,2})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1].padStart(2, '0')}`;
  // "ene-2026", "Enero 2026", "jan-26"
  m = normTxt(s).match(/^([A-Z]+)(\d{2}|\d{4})$/);
  if (m) {
    const i = NOMBRES_MES.findIndex((n) => n.some((p) => m[1].startsWith(p)));
    if (i >= 0) return `${m[2].length === 2 ? '20' + m[2] : m[2]}-${String(i + 1).padStart(2, '0')}`;
  }
  const iso = aIso(v);
  return iso ? iso.slice(0, 7) : null;
}

/**
 * Lee la historia de ventas mensuales. Acepta dos formatos:
 * - largo: columnas SKU, CD (opcional), MES y UNIDADES;
 * - ancho: columnas SKU, CD (opcional) y una columna por mes.
 * Devuelve { filas: [{cd, sku, mes, unidades}], meses, formato }. Sin CD, la historia vale para todos los CD.
 */
export function leerHistorico(buffer, nombreArchivo = '') {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false, dense: true });
  const hoja = wb.SheetNames[0];
  const matriz = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: true, defval: '', blankrows: false });
  let fila = -1;
  for (let i = 0; i < Math.min(10, matriz.length); i++) {
    if (buscarCol(matriz[i].map(txt), ALIAS.sku) >= 0) { fila = i; break; }
  }
  if (fila < 0) throw new Error(`No encontré la columna SKU en las primeras 10 filas de la hoja "${hoja}" de ${nombreArchivo || 'el archivo'}.`);
  const hdrRaw = matriz[fila];
  const hdr = hdrRaw.map(txt);
  const cSku = buscarCol(hdr, ALIAS.sku);
  const cCd = buscarCol(hdr, ALIAS.cd);
  const cMes = buscarCol(hdr, AL_MES);
  const cUni = buscarCol(hdr, AL_UNID);
  const suma = new Map();
  const add = (cd, sku, mes, u) => {
    if (!sku || !mes) return;
    const k = cd + '|' + sku + '|' + mes;
    suma.set(k, (suma.get(k) || 0) + u);
  };
  let formato;
  if (cMes >= 0 && cUni >= 0) {
    formato = 'largo';
    for (const r of matriz.slice(fila + 1)) add(cCd >= 0 ? up(r[cCd]) : '', txt(r[cSku]), mesDe(r[cMes]), num(r[cUni]));
  } else {
    const colsMes = hdrRaw.map((h, j) => (j === cSku || j === cCd ? null : mesDe(h))).map((m, j) => (m ? [j, m] : null)).filter(Boolean);
    if (!colsMes.length) {
      throw new Error(`No encontré columnas MES y UNIDADES, ni columnas con meses (ej. 2026-05). Encabezados leídos: ${hdr.filter(Boolean).join(' | ').slice(0, 600)}`);
    }
    formato = 'ancho';
    for (const r of matriz.slice(fila + 1)) {
      const cd = cCd >= 0 ? up(r[cCd]) : '', sku = txt(r[cSku]);
      for (const [j, mes] of colsMes) add(cd, sku, mes, num(r[j]));
    }
  }
  const filas = [...suma].map(([k, unidades]) => { const [cd, sku, mes] = k.split('|'); return { cd, sku, mes, unidades }; });
  if (!filas.length) throw new Error('El archivo de historia no tiene filas de datos.');
  return { filas, meses: [...new Set(filas.map((f) => f.mes))].sort(), formato };
}

/** Lista de los n meses 'YYYY-MM' que terminan en `hasta`. */
export function mesesHasta(hasta, n) {
  let [y, m] = hasta.split('-').map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    if (--m === 0) { m = 12; y--; }
  }
  return out;
}

export const TODOS = 'TODOS';
export const claseAbc = (pctPrevio, metrica, u) => (metrica <= 0 ? 'C' : pctPrevio < u.a ? 'A' : pctPrevio < u.b ? 'B' : 'C');
export const claseXyz = (cv, u) => (cv === null ? 'Z' : cv <= u.x ? 'X' : cv <= u.y ? 'Y' : 'Z');
// rotación = ventas / stock (macro M13): X desde u.r, Y con venta, Z sin venta o sin stock
export const claseRot = (rot, u) => (!(rot > 0) ? 'Z' : rot >= u.r ? 'X' : 'Y');

/**
 * Clasifica los SKU de la Base por CD, o consolidados por SKU (cd = 'TODOS').
 * - criterio: 'unidades' (ventas) o 'valor' (ventas x costo);
 * - metodo: 'rotacion' (ventas / stock de la Base) o 'historia' (coeficiente de variación mensual);
 * - hist: Map 'cd|sku' -> Map(mes -> unidades), con cd '' para la historia sin CD (consolidado: '' = suma de los CD);
 * - meses: lista de meses de la ventana XYZ (vacía = sin historia);
 * - u: umbrales { a, b } en % acumulado, { x, y } en coeficiente de variación y { r } de rotación.
 * Devuelve las filas ordenadas por CD y métrica descendente.
 */
export function clasificar(filasBase, { criterio = 'unidades', metodo = 'rotacion', hist = new Map(), meses = [], u, consolidado = false }) {
  const idx = new Map();
  for (const r of filasBase) {
    if (!r.sku || !r.cd) continue;
    const cd = consolidado ? TODOS : r.cd;
    const k = cd + '|' + r.sku;
    let x = idx.get(k);
    if (!x) { x = { cd, sku: r.sku, desc: r.desc, depto: r.depto || '(sin depto)', stock: 0, ventas: 0, costo: 0, stockCd: {} }; idx.set(k, x); }
    const q = r.qty > 0 ? r.qty : 0;
    x.stock += q;
    if (q) x.stockCd[r.cd] = (x.stockCd[r.cd] || 0) + q;
    // VENTAS y COSTO vienen repetidos en cada ubicación del SKU
    if (r.ventas > x.ventas) x.ventas = r.ventas;
    if (r.costo > x.costo) x.costo = r.costo;
  }
  const porCd = new Map();
  for (const x of idx.values()) {
    x.metrica = criterio === 'valor' ? x.ventas * x.costo : x.ventas;
    if (!porCd.has(x.cd)) porCd.set(x.cd, []);
    porCd.get(x.cd).push(x);
  }
  const out = [];
  for (const cd of [...porCd.keys()].sort(cmp)) {
    const lista = porCd.get(cd).sort((a, b) => b.metrica - a.metrica || cmp(a.sku, b.sku));
    const total = lista.reduce((s, x) => s + x.metrica, 0);
    let acum = 0, pos = 0;
    for (const x of lista) {
      const previo = total > 0 ? (100 * acum) / total : 100;
      acum += x.metrica;
      x.posicion = ++pos;
      x.pctMetrica = total > 0 ? (100 * x.metrica) / total : 0;
      x.pctAcum = total > 0 ? (100 * acum) / total : 0;
      // el SKU que cruza el umbral queda en la clase superior
      x.abc = claseAbc(previo, x.metrica, u);
      x.rot = x.stock > 0 ? Math.round((x.ventas / x.stock) * 1000) / 1000 : null;
      x.cv = null; x.mesesVenta = null; x.promMes = null;
      const serie = meses.length ? hist.get(cd + '|' + x.sku) || hist.get('|' + x.sku) : null;
      if (serie) {
        const v = meses.map((m) => serie.get(m) || 0);
        const prom = v.reduce((s, n) => s + n, 0) / v.length;
        const desv = Math.sqrt(v.reduce((s, n) => s + (n - prom) ** 2, 0) / v.length);
        x.cv = prom > 0 ? Math.round((desv / prom) * 1000) / 1000 : null;
        x.mesesVenta = v.filter((n) => n > 0).length;
        x.promMes = prom;
      }
      if (metodo === 'historia') x.xyz = serie ? claseXyz(x.cv, u) : null;
      else x.xyz = claseRot(x.rot, u);
      x.matriz = x.abc + (x.xyz || '-');
      out.push(x);
    }
  }
  return out;
}

/** Resumen por celda de la matriz (A/B/C x X/Y/Z, más A-/B-/C- sin historia), por clase ABC y por CD. */
export function resumir(filas) {
  const nuevo = () => ({ skus: 0, metrica: 0, stock: 0 });
  const celdas = {};
  for (const a of ['A', 'B', 'C']) for (const z of ['X', 'Y', 'Z', '-']) celdas[a + z] = nuevo();
  const abc = { A: nuevo(), B: nuevo(), C: nuevo() };
  const total = nuevo();
  // por CD: SKU con stock y unidades de cada celda en cada CD (sirve en la vista consolidada)
  const porCd = {};
  for (const x of filas) {
    for (const c of [celdas[x.matriz], abc[x.abc], total]) { c.skus++; c.metrica += x.metrica; c.stock += x.stock; }
    for (const [cd, q] of Object.entries(x.stockCd)) {
      porCd[cd] ??= {};
      const c = (porCd[cd][x.matriz] ??= { skus: 0, stock: 0 });
      c.skus++; c.stock += q;
    }
  }
  return { celdas, abc, total, porCd };
}

/** Curva de Pareto en `n` puntos: % de SKU (ordenados por venta) contra % de venta acumulada. */
export function curvaPareto(filas, n = 200) {
  const total = filas.reduce((s, x) => s + x.metrica, 0);
  if (!filas.length || !(total > 0)) return [];
  const pts = [[0, 0]];
  const paso = Math.max(1, filas.length / n);
  let acum = 0, sig = paso;
  filas.forEach((x, i) => {
    acum += x.metrica;
    if (i + 1 >= sig || i === filas.length - 1) { pts.push([(i + 1) / filas.length, acum / total]); sig += paso; }
  });
  return pts;
}
