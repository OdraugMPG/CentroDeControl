// Lectura de la Base de stock (equivale a LeerBase del libro): misma estructura de columnas.
import XLSX from 'xlsx';
import { normTxt, txt, up, num, aIso, diaNum } from './util.js';

// Alias de encabezados: los mismos del libro (constantes AL_ de modComun).
export const ALIAS = {
  sku: 'SKU|COD SKU|CODIGO SKU|SKU ID',
  cd: 'CD|CENTRO DISTRIBUCION|CENTRO DE DISTRIBUCION|BODEGA|WHSE',
  desc: 'DESCRIPCION|DESCRIPCION SKU|DESC SKU|DESC',
  marca: 'MARCA|BRAND',
  depto: 'DESC DEPTO|DESCRIPCION DEPTO|DESC DEPARTAMENTO|DESCRIPCION DEPARTAMENTO',
  piso: 'PISO|ZONA|NIVEL PISO',
  zp: 'ZONA PASILLO|PASILLO|ZPASILLO|AISLE',
  bah: 'BAHIA|BAY',
  niv: 'NIVEL|LEVEL|LVL',
  ubic: 'UBICACION|UBICACION ACTUAL|LOCATION|LOCACION|UBIC',
  qty: 'QTY|CANTIDAD|UNIDADES|STOCK UBICACION',
  falm: 'FECHA ULT ALMACENAMIENTO|FECHA ULTIMO ALMACENAMIENTO|FECHA ULTIMA ALMACENAMIENTO|FEC ULT ALMACENAMIENTO|FECHA ULT ALM|FECHA ALMACENAMIENTO|ULT ALMACENAMIENTO|ULTIMO ALMACENAMIENTO',
  dias: 'DIAS SIN MOVIMIENTO|DIAS SIN MOV|DIAS SIN MOVTO|DIAS ULT MOV|DIAS ULTIMO MOVIMIENTO|DIAS INACTIVO|DIAS INACTIVIDAD|DIAS SIN VENTA|DIAS SIN SALIDA|AGING|AGING DIAS|DIAS AGING|ANTIGUEDAD|ANTIGUEDAD DIAS|DIAS ANTIGUEDAD|DIAS EN STOCK|DIAS STOCK|DIAS',
  fmov: 'FECHA ULT MOV|FECHA ULTIMO MOVIMIENTO|FECHA ULT MOVIMIENTO|FEC ULT MOV|ULT MOV|ULTIMO MOVIMIENTO|FECHA ULT VENTA|FECHA ULTIMA VENTA|ULTIMA VENTA|ULT VENTA|FECHA ULT SALIDA|FECHA ULTIMA SALIDA|ULTIMA SALIDA|FECHA ULT PICK|FECHA ULTIMO PICKING|ULTIMO PICKING|LAST MOVE|LAST MOVE DATE|LAST ACTIVITY|LAST ACTIVITY DATE|LAST PICK DATE|FECHA ULT ACTIVIDAD|FECHA MOV',
  frec: 'FECHA RECEPCION|FECHA INGRESO|FECHA ENTRADA|FECHA RECIBO|FEC RECEPCION|FEC INGRESO|FECHA ALTA|FECHA CREACION|CREATE DATE|CREATION DATE|RECEIPT DATE|FECHA LPN|FECHA PALLET|FECHA ULT RECEPCION',
  ventas: 'VENTAS|VENTA|VTA|VTAS|UNIDADES VENDIDAS|VENTA UNIDADES|UNID VENDIDAS|SALES|DEMANDA',
  temp: 'TEMPORADA|TEMP|SEASON|COD TEMPORADA|TEMPORADA COMERCIAL|TEMPORADA PRODUCTO|DESC TEMPORADA',
  costo: 'COSTO|COSTO UNITARIO|COSTO UNIT|COSTO PROMEDIO|CPP|PRECIO COSTO|VALOR UNITARIO|UNIT COST|COST',
  logOsr: 'LOGISTICA OSR|LOG OSR|LOGISTICAOSR|APTO OSR|OSR APTO|FLAG OSR|OSR FLAG|OSR LOGISTICA',
};
/** Valor de la columna Logística OSR que marca al SKU como apto para OSR. */
export const esAptoOsr = (v) => ['Y', 'YES', 'S', 'SI', '1', 'TRUE', 'X'].includes(normTxt(v));

const OBLIGATORIAS = { cd: 'CD', ubic: 'Ubicación', qty: 'Qty', piso: 'Piso', zp: 'Pasillo / Zona pasillo', depto: 'Desc. Depto' };

export function buscarCol(hdr, alias) {
  for (const a of alias.split('|')) {
    const obj = normTxt(a);
    const j = hdr.findIndex((h) => normTxt(h) === obj);
    if (j >= 0) return j;
  }
  return -1;
}

/**
 * Lee un archivo .xlsx/.xls/.csv con la Base de stock.
 * Devuelve { filas, columnas, encabezados, hoja, avisos } o lanza un Error con el detalle.
 */
export function leerBase(buffer, nombreArchivo = '') {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false, dense: true });
  const hoja = wb.SheetNames.find((n) => normTxt(n) === 'BASE') || wb.SheetNames.find((n) => normTxt(n) === 'DETALLE1') || wb.SheetNames[0];
  const ws = wb.Sheets[hoja];
  const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
  let fila = -1;
  for (let i = 0; i < Math.min(10, matriz.length); i++) {
    if (buscarCol(matriz[i].map(txt), ALIAS.sku) >= 0) { fila = i; break; }
  }
  if (fila < 0) throw new Error(`No encontré la fila de encabezados (columna SKU) en las primeras 10 filas de la hoja "${hoja}" de ${nombreArchivo || 'el archivo'}.`);
  const hdr = matriz[fila].map(txt);
  const c = {};
  for (const k of Object.keys(ALIAS)) c[k] = buscarCol(hdr, ALIAS[k]);
  // pasillo físico, además de ZONA_PASILLO (stock unitario)
  c.pas = buscarCol(hdr, 'PASILLO');
  if (c.pas === c.zp) c.pas = -1;
  const faltan = Object.entries(OBLIGATORIAS).filter(([k]) => c[k] < 0).map(([, n]) => n);
  if (faltan.length) {
    throw new Error(`Faltan estas columnas en la hoja "${hoja}": ${faltan.join(', ')}. Encabezados leídos: ${hdr.filter(Boolean).join(' | ').slice(0, 600)}`);
  }
  const g = (r, k) => (c[k] >= 0 ? r[c[k]] : '');
  const filas = [];
  for (let i = fila + 1; i < matriz.length; i++) {
    const r = matriz[i];
    const sku = txt(g(r, 'sku'));
    const cd = up(g(r, 'cd'));
    if (!sku && !cd) continue;
    let falm = null;
    if (c.falm >= 0) falm = aIso(g(r, 'falm'));
    else if (c.fmov >= 0) falm = aIso(g(r, 'fmov'));
    else if (c.frec >= 0) falm = aIso(g(r, 'frec'));
    filas.push({
      cd, sku,
      desc: txt(g(r, 'desc')), marca: txt(g(r, 'marca')), depto: txt(g(r, 'depto')),
      piso: txt(g(r, 'piso')), zp: txt(g(r, 'zp')), pas: txt(c.pas >= 0 ? r[c.pas] : ''),
      bah: txt(g(r, 'bah')), niv: txt(g(r, 'niv')),
      ubic: up(g(r, 'ubic')), qty: num(g(r, 'qty')),
      falm, dias: c.dias >= 0 && c.falm < 0 ? (txt(g(r, 'dias')) === '' ? null : num(g(r, 'dias'))) : null,
      ventas: c.ventas >= 0 ? num(g(r, 'ventas')) : null,
      temp: txt(g(r, 'temp')), costo: c.costo >= 0 ? num(g(r, 'costo')) : null,
      logOsr: c.logOsr >= 0 ? up(g(r, 'logOsr')) : null,
    });
  }
  if (!filas.length) throw new Error('La base no tiene filas de datos.');
  const avisos = [];
  if (c.falm < 0 && c.fmov < 0 && c.frec < 0 && c.dias < 0) avisos.push('Sin columna FECHA_ULT_ALMACENAMIENTO: el slow moving no tendrá antigüedad.');
  if (c.ventas < 0) avisos.push('Sin columna VENTAS: el slow moving se clasifica solo por antigüedad.');
  if (c.costo < 0) avisos.push('Sin columna COSTO: el slow moving sale sin valorizar.');
  if (c.temp < 0) avisos.push('Sin columna TEMPORADA.');
  const columnas = Object.fromEntries(Object.entries(c).map(([k, j]) => [k, j >= 0 ? hdr[j] : null]));
  return { filas, columnas, hoja, avisos };
}

/** Lee la hoja Blq_Stk_unit: A = ubicación, B = piso/grupo (opcional), C = MAX (opcional). */
export function leerReservadas(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', dense: true });
  const hoja = wb.SheetNames.find((n) => normTxt(n) === 'BLQSTKUNIT') || wb.SheetNames[0];
  const m = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: true, defval: '' });
  const out = new Map();
  // en el libro las ubicaciones parten en la fila 5 de Blq_Stk_unit; en otro archivo, desde la fila 1
  const ini = normTxt(hoja) === 'BLQSTKUNIT' ? 4 : 0;
  for (const r of m.slice(ini)) {
    const u = up(r[0]);
    if (!u || /^UBIC/.test(normTxt(u)) || u.length < 3) continue; // salta encabezados y títulos
    if (!out.has(u)) out.set(u, { ubicacion: u, grupo: txt(r[1]), max: num(r[2]) > 0 ? num(r[2]) : null });
  }
  return [...out.values()];
}

export function diasDesde(iso, corteIso) {
  if (!iso) return null;
  return diaNum(corteIso) - diaNum(iso);
}
