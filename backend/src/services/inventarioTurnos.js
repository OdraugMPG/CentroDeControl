// Inventario de Control de Existencia (CE) con la misma lógica de la asignación diaria por turno:
// - CD de la operación: Loc de CE es el código del centro (100); el CD real (CD1, SHELVING 3…) y el piso salen de la Base
//   por ubicación, o por la zona-pasillo / zona si la ubicación no tiene stock.
// - Plan del día: los grupos (zona-pasillo) cuya fecha de operación es ese día, con HH = ubicaciones x seg/ubicación +
//   líneas x seg/SKU + unidades x seg/unidad + seg/pasillo (parámetros de Gestión diaria), repartidos en los turnos del día
//   con el mismo reparto del plan diario, balanceado: cada turno recibe una parte pareja de las HH del día (total / turnos),
//   sin pasar la capacidad del turno (recursos de inventario del CD x horas por turno).
// - Responsables por turno: supervisor Paris y jefe de turno de la empresa externa según su turno (rotación) y CD.
// - Avance: las ubicaciones contadas en el resultado de la toma completan las tareas de inventario publicadas.
import { q } from '../db.js';
import { q as qg } from '../gestion/db.js';
import { leerParametros } from '../gestion/services/parametros.js';
import { filasDeCarga } from '../gestion/services/stock.js';
import { programar, turnosDelDia } from '../gestion/engine/plan.js';
import { cmp } from '../gestion/engine/util.js';
import { personasEnFecha } from './personal.js';

export const SIN_CD = 'SIN CD';
const EPS = 1e-6;
const up = (v) => String(v ?? '').trim().toUpperCase();

/** Completa cd_op y piso de la programación (entre desde y hasta, o toda si no se indican) con la última Base */
export async function resolverCds({ desde, hasta, todo = false } = {}) {
  const { rows: [c] } = await qg("SELECT id FROM cargas WHERE tipo = 'INICIO' ORDER BY fecha DESC, id DESC LIMIT 1");
  if (!c) return { base: false };
  const rango = desde && hasta ? 'AND p.fecha_op BETWEEN $2 AND $3' : '';
  const solo = todo ? '' : 'AND p.cd_op IS NULL';
  const args = desde && hasta ? [c.id, desde, hasta] : [c.id];
  // 1) por ubicación
  const a = await q(`UPDATE inv_programa p SET cd_op = b.cd, piso = b.piso
    FROM (SELECT DISTINCT ON (upper(ubicacion)) upper(ubicacion) AS u, cd, piso FROM gestion.stock WHERE carga_id = $1) b
    WHERE b.u = p.ubicacion ${solo} ${rango}`, args);
  // 2) por zona-pasillo y 3) por zona (las ubicaciones sin stock no están en la Base)
  const b = await q(`UPDATE inv_programa p SET cd_op = z.cd, piso = coalesce(p.piso, z.piso)
    FROM (SELECT DISTINCT ON (upper(zona_pasillo)) upper(zona_pasillo) AS zp, cd, piso FROM gestion.stock WHERE carga_id = $1 GROUP BY 1, cd, piso ORDER BY 1, count(*) DESC) z
    WHERE z.zp = p.pasillo AND p.cd_op IS NULL ${rango}`, args);
  const d = await q(`UPDATE inv_programa p SET cd_op = z.cd
    FROM (SELECT DISTINCT ON (left(upper(zona_pasillo), 3)) left(upper(zona_pasillo), 3) AS zona, cd FROM gestion.stock WHERE carga_id = $1 GROUP BY 1, cd ORDER BY 1, count(*) DESC) z
    WHERE z.zona = p.zona AND p.cd_op IS NULL ${rango}`, args);
  return { base: true, porUbicacion: a.rowCount, porPasillo: b.rowCount, porZona: d.rowCount };
}

// líneas (SKU) y unidades por ubicación de un CD en la Base
const cargaPorUbic = (filas, cd) => {
  const m = new Map();
  for (const r of filas) {
    if (r.cd !== cd || !r.sku || !(r.qty > 0)) continue;
    const u = up(r.ubic);
    let x = m.get(u); if (!x) { x = { skus: new Set(), uni: 0 }; m.set(u, x); }
    x.skus.add(r.sku); x.uni += r.qty;
  }
  return m;
};

/** Grupos de CE de un día y CD, con sus HH, repartidos en los turnos del día (mismo reparto que el plan diario) */
export async function planInventarioCe({ fecha, cd, filas, p, recInv, nTur }) {
  const { rows } = await q(`SELECT pasillo AS zp, max(zona) AS zona, max(piso) AS piso, array_agg(ubicacion) AS ubics
    FROM inv_programa WHERE fecha_op = $1 AND NOT excluida AND coalesce(cd_op, '${SIN_CD}') = $2 GROUP BY pasillo`, [fecha, cd]);
  if (!rows.length) return null;
  const hT = p.horasTurno > 0 ? p.horasTurno : 8;
  const rec = Math.max(1, Math.min(recInv || 1, p.invMax > 0 ? p.invMax : 6));
  const pu = cargaPorUbic(filas || [], cd);
  const grupos = rows.map((r) => {
    let lin = 0, uni = 0;
    for (const u of r.ubics) { const x = pu.get(u); if (x) { lin += x.skus.size; uni += x.uni; } }
    const ub = r.ubics.length;
    return { zp: r.zp, zona: r.zona, piso: r.piso || '', ub, lin, uni, hh: (ub * p.invSegUb + lin * p.invSegSku + uni * p.invSegUn + p.invSegPas) / 3600 };
  }).sort((a, b) => cmp(`${a.piso}|${a.zp}`, `${b.piso}|${b.zp}`));
  const ord = grupos.map((_, k) => k);
  const lin = [], fin = new Array(grupos.length).fill(0);
  // meta por turno: el total parejo entre los turnos del día (con un margen mínimo para no dejar restos por redondeo), tope la capacidad
  const totHH = grupos.reduce((a, g) => a + g.hh, 0);
  const meta = nTur > 0 ? Math.min(rec * hT, (totHH / nTur) * 1.001 + EPS) : 0;
  if (nTur > 0) programar('INVENTARIO', ord, grupos.map((g) => g.hh), new Array(grupos.length).fill(1), meta, hT, rec, fin, lin, nTur);
  const asignado = new Array(grupos.length).fill(0);
  const lineas = lin.map((l, i) => {
    const g = grupos[l.z]; asignado[l.z] += l.hh;
    return { fecha, turno: l.t, tarea: 'INVENTARIO', piso: g.piso, zp: g.zp, hh: l.hh, pct: l.pct, ops: l.ops, nOps: l.nOps,
      ubicaciones: Math.round(g.ub * l.pct), movimientos: null, orden: l.t * 1e6 + 5e5 + i, zonaPctTotal: null, ce: true };
  });
  const pendientes = grupos.map((g, k) => ({ ...g, hhPend: g.hh - asignado[k] })).filter((g) => g.hhPend > EPS)
    .map((g) => ({ zp: g.zp, piso: g.piso, ub: Math.round(g.ub * g.hhPend / g.hh), hh: g.hhPend }));
  const tot = (k) => grupos.reduce((a, g) => a + g[k], 0);
  return { grupos, lineas, pendientes, recInv: rec, hT, nTur, capacidad: rec * hT * nTur, metaTurno: meta,
    resumen: { grupos: grupos.length, ubicaciones: tot('ub'), lineas: tot('lin'), unidades: tot('uni'), hh: tot('hh'), hhPend: pendientes.reduce((a, g) => a + g.hh, 0) } };
}

/** Supervisor Paris y jefe de turno de la empresa externa de cada turno (1, 2, 3) de un CD en una fecha */
export async function responsablesTurno(fecha, cd, cfg) {
  const turnos = (await q('SELECT id FROM turnos ORDER BY orden')).rows.map((t) => t.id);
  const ps = await personasEnFecha(fecha);
  const de = (rol, t) => ps.filter((x) => x.rol === rol && x.turno === t).sort((a, b) => (up(b.cd) === cd) - (up(a.cd) === cd))
    .filter((x) => !x.cd || up(x.cd) === cd);
  return Object.fromEntries([1, 2, 3].map((tt) => {
    const t = turnos[tt - 1];
    const sups = de('Supervisor', t), jefes = de('Jefe de Turno Empresa', t);
    return [tt, { turno: t, supervisor: sups.map((x) => x.nombre).join(' / ') || (cfg?.[`sup_t${tt}`] || '').trim() || '',
      jefe: jefes[0]?.nombre || '', empresa: jefes[0]?.empresa || '', supEmpresa: de('Supervisor Empresa', t).map((x) => x.nombre).join(' / ') }];
  }));
}

/** Simulación por turno de un día: lo que la asignación diaria publicaría como inventario de CE en cada CD */
export async function simularDia(fecha) {
  await resolverCds({ desde: fecha, hasta: fecha });
  const p = await leerParametros();
  const nTur = turnosDelDia(fecha, p);
  const { rows: [carga] } = await qg("SELECT id, fecha::text, archivo FROM cargas WHERE tipo = 'INICIO' ORDER BY (fecha = $1) DESC, fecha DESC, id DESC LIMIT 1", [fecha]);
  const filas = carga ? await filasDeCarga(carga.id) : [];
  const cfg = Object.fromEntries((await qg('SELECT * FROM cd_config')).rows.map((c) => [up(c.cd), c]));
  const { rows: cds } = await q(`SELECT coalesce(cd_op, '${SIN_CD}') AS cd, count(*)::int AS n FROM inv_programa WHERE fecha_op = $1 AND NOT excluida GROUP BY 1 ORDER BY 1`, [fecha]);
  const out = [];
  for (const { cd } of cds) {
    const c = cfg[cd];
    const pl = await planInventarioCe({ fecha, cd, filas, p, recInv: c?.rec_inv || 1, nTur: cd === SIN_CD ? 0 : nTur });
    if (!pl) continue;
    const resp = await responsablesTurno(fecha, cd, c);
    const turnos = Array.from({ length: nTur }, (_, i) => {
      const tt = i + 1, ls = pl.lineas.filter((l) => l.turno === tt);
      return { tt, ...resp[tt], hh: ls.reduce((a, l) => a + l.hh, 0), ubicaciones: ls.reduce((a, l) => a + l.ubicaciones, 0),
        // personas que necesita el turno
        operarios: Math.ceil(ls.reduce((a, l) => a + l.hh, 0) / pl.hT - EPS), lineas: ls.map((l) => ({ zp: l.zp, piso: l.piso, hh: l.hh, pct: l.pct, ops: l.ops, ubicaciones: l.ubicaciones })) };
    });
    out.push({ cd, activo: !!c?.activo, recInv: pl.recInv, hT: pl.hT, capacidad: pl.capacidad, resumen: pl.resumen, turnos, pendientes: pl.pendientes });
  }
  return { fecha, nTur, base: carga || null, param: { invSegUb: p.invSegUb, invSegSku: p.invSegSku, invSegUn: p.invSegUn, invSegPas: p.invSegPas, horasTurno: p.horasTurno }, cds: out };
}

/** Avance de las tareas de inventario de CE publicadas: ubicaciones del grupo contadas ese día en el resultado de la toma */
export async function avanceDesdeResultado(fechas) {
  if (!fechas?.length) return { actualizadas: 0 };
  const { rows: ts } = await qg(`SELECT id, fecha::text, cd, turno, zona, unid_asig, unid_real, estado FROM tareas
    WHERE proceso = 'INV' AND fecha = ANY($1::date[]) AND detalle LIKE '%Control de Existencia%' ORDER BY fecha, cd, zona, turno`, [fechas]);
  if (!ts.length) return { actualizadas: 0 };
  const { rows: cont } = await q(`SELECT p.fecha_op::text AS fecha, p.cd_op AS cd, p.pasillo AS zp, count(DISTINCT p.ubicacion)::int AS n
    FROM inv_programa p JOIN inv_resultado r ON r.ubicacion = p.ubicacion AND r.fecha <= p.fecha_op AND r.fecha >= p.fecha_op - 2
    WHERE p.fecha_op = ANY($1::date[]) AND NOT p.excluida GROUP BY 1, 2, 3`, [fechas]);
  const m = new Map(cont.map((x) => [`${x.fecha}|${x.cd}|${x.zp}`, x.n]));
  let n = 0;
  const resto = new Map();
  for (const t of ts) {
    const k = `${t.fecha}|${t.cd}|${up(t.zona)}`;
    if (!resto.has(k)) resto.set(k, m.get(k) || 0);
    const r = Math.min(Number(t.unid_asig) || 0, resto.get(k));
    resto.set(k, resto.get(k) - r);
    if (r <= (Number(t.unid_real) || 0)) continue;   // no se baja un avance ya registrado
    const estado = r >= (Number(t.unid_asig) || 0) ? 'EJECUTADO' : 'PARCIAL';
    await qg("UPDATE tareas SET unid_real = $2, estado = $3, fuente = 'Resultado de la toma de inventario', actualizado_en = now() WHERE id = $1", [t.id, r, estado]);
    n++;
  }
  return { actualizadas: n };
}
