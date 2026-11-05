// Carga de lo pendiente por almacenar: foto del WMS con una fila por iLPN (ZONA, UBICACION, ILPN_ID, ITEM_ID, DESCRIPCION, QTY,
// ORIGEN, FECHA_MOD, FECHA_CREAC, AÑO, MES, DIA, EMPRESA_USUARIO, LEVEL, DESC_DEPTO, TEMPORADA, CD_DESDE, CD, COSTO_LPN, VOLUME…).
// Obligatorias ILPN_ID y QTY. Cada carga reemplaza la foto anterior; las columnas que no se analizan se guardan en "otros".
import { tx } from '../db.js';
import { leerTablas, txt, num, fechaHora, soloFecha } from './excel.js';

export const REQ_PENDIENTE = ['ILPN_ID', 'QTY'];

// [columna de la tabla, encabezado normalizado, conversión]
const MAPA = [
  ['ilpn', 'ILPN_ID'], ['sku', 'ITEM_ID'], ['descripcion', 'DESCRIPCION'], ['qty', 'QTY', 'int'], ['zona', 'ZONA'], ['ubicacion', 'UBICACION'],
  ['origen', 'ORIGEN'], ['fecha_mod', 'FECHA_MOD', 'ts'], ['fecha_creac', 'FECHA_CREAC', 'ts'], ['anio', 'ANO', 'per'], ['mes', 'MES', 'per'],
  ['dia', 'DIA', 'per'], ['empresa_usuario', 'EMPRESA_USUARIO'], ['level', 'LEVEL'], ['depto', 'DEPTO'], ['desc_depto', 'DESC_DEPTO'],
  ['desc_subdepto', 'DESC_SUBDEPTO'], ['desc_familia', 'DESC_FAMILIA'], ['temporada', 'TEMPORADA'], ['cd_desde', 'CD_DESDE'], ['cd', 'CD'],
  ['status', 'STATUS'], ['process', 'PROCESS'], ['asn', 'ASN_ID'], ['hay_en_osr', 'HAY_EN_OSR'], ['responsable', 'RESPONSABLE'],
  ['supervisor', 'SUPERVISOR'], ['costo_unit', 'COSTO_UNIT', 'num'], ['costo_lpn', 'COSTO_LPN', 'num'], ['volumen', 'VOLUME', 'num']
];
const USADAS = new Set(MAPA.map(m => m[1]));
const PG = { int: 'int', ts: 'timestamptz', num: 'numeric' };
const LOTE = 4000;

// AÑO, MES y DIA tal como vienen; si llegan como fecha se dejan como AAAA-MM-DD
const periodo = v => v instanceof Date ? soloFecha(v) : typeof v === 'number' ? String(v) : txt(v);
const conv = { int: v => Math.round(num(v)), ts: v => fechaHora(v), num: v => (v === null || v === undefined || v === '' ? null : num(v)), per: periodo };

export async function importarPendiente(buffer, archivo, { usuario = null } = {}) {
  const tablas = await leerTablas(buffer, archivo, REQ_PENDIENTE);
  if (!tablas.length) throw Object.assign(new Error('No encontré las columnas ILPN_ID y QTY. Usa la extracción de pendientes por almacenar o el modelo.'), { status: 400 });
  return guardarPendiente(tablas[0].filas, archivo, usuario);
}

export async function guardarPendiente(crudas, archivo, usuario = null) {
  const filas = crudas.map(r => {
    const o = {};
    for (const [col, h, t] of MAPA) o[col] = t ? conv[t](r[h]) : txt(r[h]);
    o.otros = Object.fromEntries(Object.entries(r).filter(([k, v]) => !USADAS.has(k) && v !== null && v !== ''));
    return o;
  }).filter(f => f.ilpn || f.sku);
  if (!filas.length) throw Object.assign(new Error('El archivo no tiene filas con ILPN_ID.'), { status: 400 });

  const cols = [...MAPA.map(m => m[0]), 'otros'];
  const tipos = [...MAPA.map(m => PG[m[2]] || 'text'), 'jsonb'];
  const unidades = filas.reduce((s, f) => s + f.qty, 0);
  return tx(async c => {
    const reemplazadas = (await c.query('DELETE FROM alm_pendiente')).rowCount;
    const { rows: [carga] } = await c.query(
      `INSERT INTO cargas (tipo, archivo, filas, corte, cargado_por, resumen) VALUES ('pendiente',$1,$2,now(),$3,$4) RETURNING *`,
      [archivo, filas.length, usuario, { unidades, ilpns: new Set(filas.map(f => f.ilpn).filter(Boolean)).size,
        skus: new Set(filas.map(f => f.sku).filter(Boolean)).size, reemplazadas }]);
    const sql = `INSERT INTO alm_pendiente (carga_id, ${cols.join(', ')}) SELECT $1, * FROM unnest(${cols.map((k, i) => `$${i + 2}::${tipos[i]}[]`).join(', ')})`;
    for (let i = 0; i < filas.length; i += LOTE) {
      const lote = filas.slice(i, i + LOTE);
      await c.query(sql, [carga.id, ...cols.map(k => lote.map(f => k === 'otros' ? JSON.stringify(f.otros) : f[k]))]);
    }
    return carga;
  });
}
