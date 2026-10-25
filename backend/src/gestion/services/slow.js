import { q, tx } from '../db.js';
import { leerParametros } from './parametros.js';
import { filasDeCarga, ultimaCargaInicio } from './stock.js';
import { detalleSlowMoving, simular, opcionesFiltros } from '../engine/slowMoving.js';

const cache = new Map();

async function detalle() {
  const carga = await ultimaCargaInicio();
  if (!carga) throw Object.assign(new Error('Carga primero una Base de stock.'), { status: 400 });
  const p = await leerParametros();
  const key = carga.id + '|' + p.tramos;
  if (!cache.has(key)) {
    cache.clear();
    cache.set(key, { carga, ...detalleSlowMoving(await filasDeCarga(carga.id), { corte: carga.fecha, tramos: p.tramosArr }) });
  }
  return { ...cache.get(key), p };
}

export async function opciones() {
  const d = await detalle();
  return { carga: d.carga, ...opcionesFiltros(d.detalle), tramos: d.p.tramosArr, hayVentas: d.hayVentas, hayCosto: d.hayCosto, destino: d.p.smDestino };
}

export async function simularSlow(filtros, limite = 500) {
  const d = await detalle();
  const r = simular(d.detalle, filtros);
  const { rows: cola } = await q("SELECT cd, count(*)::int AS n FROM sm_cola WHERE estado = 'EN COLA' AND tipo = 'SM' GROUP BY cd ORDER BY cd");
  return { carga: d.carga, total: r.total, porCD: r.porCD, filas: r.seleccion.length, detalle: r.seleccion.slice(0, limite).map(({ filas, ...x }) => x), cola };
}

/** Deja en cola una tarea por ubicación de cada SKU seleccionado; entran a la próxima asignación diaria. */
export async function generarColaSlow(filtros, destino) {
  const d = await detalle();
  const r = simular(d.detalle, filtros);
  const dst = (destino || d.p.smDestino || 'ZONA SLOW MOVING').trim();
  let n = 0;
  await tx(async (c) => {
    for (const x of r.seleccion) {
      for (const f of x.filas) {
        const ya = await c.query("SELECT 1 FROM sm_cola WHERE cd=$1 AND sku=$2 AND ubicacion=$3 AND estado='EN COLA'", [x.cd, x.sku, f.ubic]);
        if (ya.rowCount) continue;
        await c.query('INSERT INTO sm_cola (cd, sku, descripcion, depto, temporada, mes, piso, zona, ubicacion, unidades, destino) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [x.cd, x.sku, x.desc, x.depto, x.temporada, x.mes, f.piso, f.zp, f.ubic, f.qty, dst]);
        n++;
      }
    }
  });
  return { tareas: n, skus: r.seleccion.length };
}

export async function colaSlow() {
  const { rows } = await q("SELECT * FROM sm_cola WHERE estado = 'EN COLA' AND tipo = 'SM' ORDER BY cd, id");
  return rows;
}
export async function vaciarColaSlow(cd, tipo = 'SM') {
  const r = await q("DELETE FROM sm_cola WHERE estado = 'EN COLA' AND tipo = $1" + (cd ? ' AND cd = $2' : ''), cd ? [tipo, cd] : [tipo]);
  return { eliminadas: r.rowCount };
}
