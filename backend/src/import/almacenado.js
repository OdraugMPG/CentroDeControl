// Carga de lo almacenado en recepción: la extracción ALM_USER del WMS (una fila por LPN ubicado).
// Columnas: ORG_ID, QUANTITY, F_MOD, DIA, HORA, TURNO, CRITERIA_ID, ITEM_ID, DESCRIPCION, DEPTO, OLD_STATUS, TARGET_LOCATION_ID,
// FACILITY_ID, USUARIO, DESDE, NEW_STATUS, LOCATION, FLUJO, MINUTO, TRANSACTION_ID, ASN_ID, CONTAINER_ID, MES, NHORA, CD,
// OPERACION y JORNADA. Obligatorias QUANTITY, ITEM_ID y F_MOD o DIA; el resto puede faltar (la versión LITE trae 16).
// Al cargar se reemplazan los días (DIA) que trae el archivo, de modo que volver a subir un día lo actualiza.
import { tx } from '../db.js';
import { leerTablas, txt, num, fechaHora, soloFecha } from './excel.js';

const COLS = ['dia', 'f_mod', 'hora', 'turno', 'qty', 'sku', 'descripcion', 'depto', 'cd', 'operacion', 'usuario', 'lpn', 'asn', 'ubicacion',
  'location', 'desde', 'flujo', 'jornada', 'old_status', 'new_status', 'org_id', 'facility_id', 'criteria_id', 'transaction_id', 'minuto', 'mes'];
const TIPOS = { dia: 'date', f_mod: 'timestamptz', hora: 'int', qty: 'int' };
const LOTE = 5000;

// Hora del día: NHORA si viene, si no la de F_MOD o la de la columna HORA (HH:MM:SS)
function horaDe(r, f) {
  const n = r.NHORA;
  if (n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n))) return Math.min(23, Math.max(0, Math.floor(Number(n))));
  if (f) return f.getHours();
  const h = r.HORA instanceof Date ? r.HORA.getHours() : String(r.HORA ?? '').match(/^(\d{1,2}):/)?.[1];
  return h === undefined || h === null ? null : Number(h);
}

export const REQ_ALMACENADO = ['QUANTITY', 'ITEM_ID'];

export async function importarAlmacenado(buffer, archivo, { usuario = null } = {}) {
  const tablas = await leerTablas(buffer, archivo, REQ_ALMACENADO);
  if (!tablas.length) throw Object.assign(new Error('No encontré las columnas QUANTITY e ITEM_ID. Usa la extracción de almacenados (ALM_USER) o el modelo.'), { status: 400 });
  return guardarAlmacenado(tablas[0].filas, archivo, usuario);
}

export async function guardarAlmacenado(crudas, archivo, usuario = null) {
  const filas = crudas.map(r => {
    const f = fechaHora(r.F_MOD);
    const dia = soloFecha(r.DIA) || soloFecha(f);
    return {
      dia, f_mod: f, hora: horaDe(r, f), turno: txt(r.TURNO)?.toUpperCase() || null, qty: Math.round(num(r.QUANTITY)),
      sku: txt(r.ITEM_ID), descripcion: txt(r.DESCRIPCION), depto: txt(r.DEPTO), cd: txt(r.CD), operacion: txt(r.OPERACION),
      usuario: txt(r.USUARIO), lpn: txt(r.CONTAINER_ID), asn: txt(r.ASN_ID), ubicacion: txt(r.TARGET_LOCATION_ID), location: txt(r.LOCATION),
      desde: txt(r.DESDE), flujo: txt(r.FLUJO), jornada: txt(r.JORNADA), old_status: txt(r.OLD_STATUS), new_status: txt(r.NEW_STATUS),
      org_id: txt(r.ORG_ID), facility_id: txt(r.FACILITY_ID), criteria_id: txt(r.CRITERIA_ID), transaction_id: txt(r.TRANSACTION_ID),
      minuto: txt(r.MINUTO), mes: txt(r.MES)
    };
  }).filter(f => f.dia && f.sku);
  if (!filas.length) throw Object.assign(new Error('El archivo no tiene filas con ITEM_ID y fecha (F_MOD o DIA).'), { status: 400 });

  const dias = [...new Set(filas.map(f => f.dia))].sort();
  const unidades = filas.reduce((s, f) => s + f.qty, 0);
  const ultima = filas.reduce((m, f) => Math.max(m, f.f_mod?.getTime() || 0), 0);
  return tx(async c => {
    const reemplazadas = (await c.query('DELETE FROM recepcion_almacenado WHERE dia = ANY($1::date[])', [dias])).rowCount;
    const { rows: [carga] } = await c.query(
      `INSERT INTO cargas (tipo, archivo, filas, corte, cargado_por, resumen) VALUES ('almacenado',$1,$2,$3,$4,$5) RETURNING *`,
      [archivo, filas.length, ultima ? new Date(ultima) : new Date(), usuario,
        { unidades, lpns: new Set(filas.map(f => f.lpn).filter(Boolean)).size, dias: dias.length, desde: dias[0], hasta: dias[dias.length - 1], reemplazadas }]);
    const sql = `INSERT INTO recepcion_almacenado (carga_id, ${COLS.join(', ')})
      SELECT $1, * FROM unnest(${COLS.map((k, i) => `$${i + 2}::${TIPOS[k] || 'text'}[]`).join(', ')})`;
    for (let i = 0; i < filas.length; i += LOTE) {
      const lote = filas.slice(i, i + LOTE);
      await c.query(sql, [carga.id, ...COLS.map(k => lote.map(f => f[k]))]);
    }
    return carga;
  });
}
