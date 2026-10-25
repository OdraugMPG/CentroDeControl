import { q, tx } from '../db.js';
import { leerBase } from '../engine/base.js';

const COLS = ['cd', 'sku', 'descripcion', 'marca', 'depto', 'piso', 'zona_pasillo', 'pasillo', 'bahia', 'nivel', 'ubicacion', 'qty', 'fecha_ult_alm', 'dias', 'ventas', 'temporada', 'costo', 'log_osr'];
const TIPOS = ['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'numeric', 'date', 'numeric', 'numeric', 'text', 'numeric', 'text'];
const aCol = (r) => [r.cd, r.sku, r.desc, r.marca, r.depto, r.piso, r.zp, r.pas, r.bah, r.niv, r.ubic, r.qty, r.falm, r.dias, r.ventas, r.temp, r.costo, r.logOsr];

const cache = new Map();

/** Guarda un archivo de stock (INICIO o CIERRE). Devuelve la carga creada. */
export async function guardarCarga({ buffer, archivo, fecha, tipo, turno }) {
  const base = leerBase(buffer, archivo);
  const carga = await tx(async (c) => {
    const { rows } = await c.query(
      'INSERT INTO cargas (fecha, tipo, turno, archivo, filas, columnas, avisos) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [fecha, tipo, turno || null, archivo, base.filas.length, JSON.stringify(base.columnas), JSON.stringify(base.avisos)]);
    const id = rows[0].id;
    const sql = `INSERT INTO stock (carga_id, ${COLS.join(',')}) SELECT $1, * FROM unnest(${COLS.map((_, i) => `$${i + 2}::${TIPOS[i]}[]`).join(',')})`;
    for (let i = 0; i < base.filas.length; i += 5000) {
      const lote = base.filas.slice(i, i + 5000).map(aCol);
      const arrays = COLS.map((_, j) => lote.map((f) => f[j]));
      await c.query(sql, [id, ...arrays]);
    }
    return rows[0];
  });
  cache.set(carga.id, base.filas);
  return { carga, base };
}

/** Filas de una carga en el formato del motor (con caché en memoria). */
export async function filasDeCarga(id) {
  if (cache.has(id)) return cache.get(id);
  const { rows } = await q(`SELECT ${COLS.join(',')} FROM stock WHERE carga_id = $1`, [id]);
  const filas = rows.map((r) => ({
    cd: r.cd, sku: r.sku, desc: r.descripcion, marca: r.marca, depto: r.depto, piso: r.piso, zp: r.zona_pasillo, pas: r.pasillo,
    bah: r.bahia, niv: r.nivel, ubic: r.ubicacion, qty: r.qty, falm: r.fecha_ult_alm, dias: r.dias, ventas: r.ventas, temp: r.temporada, costo: r.costo, logOsr: r.log_osr,
  }));
  if (cache.size > 4) cache.delete(cache.keys().next().value);
  cache.set(id, filas);
  return filas;
}

export async function cargaInicio(fecha) {
  const { rows } = await q("SELECT * FROM cargas WHERE tipo = 'INICIO' AND fecha = $1 ORDER BY id DESC LIMIT 1", [fecha]);
  return rows[0] || null;
}

export async function ultimaCargaInicio() {
  const { rows } = await q("SELECT * FROM cargas WHERE tipo = 'INICIO' ORDER BY fecha DESC, id DESC LIMIT 1");
  return rows[0] || null;
}
