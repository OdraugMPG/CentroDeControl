// Calendario de planificación de inventario: la programación de Control de Existencia por día y zona-pasillo, con ajustes
// en la web (reprogramar o quitar ubicaciones, y deshacer). Cada ajuste queda en inv_ajuste y se vuelve a aplicar cuando
// se sube de nuevo el Excel de CE (ver aplicarAjustes, que llama la carga).
import { q, tx } from '../db.js';
import { soloFecha, txt } from '../import/excel.js';
import { fechaOperacion, paramsInv } from './inventarioCe.js';
import { SIN_CD } from './inventarioTurnos.js';

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const CAMPO = { ce: 'fecha_ce', op: 'fecha_op' };
// primera toma de la ubicación en el resultado (CD de almacenamiento), como en Inventario CD: cuenta desde N días antes
// de la fecha de operación y hasta 30 días después (después de la operación, con demora)
const TOMA = (cds, dias) => `LEFT JOIN LATERAL (SELECT min(r.fecha) AS ft FROM inv_resultado r
    WHERE r.cd = ANY(${cds}::text[]) AND r.ubicacion = p.ubicacion AND r.fecha BETWEEN p.fecha_op - ${dias}::int AND p.fecha_op + 30) t ON NOT p.excluida`;

/** Grupos (día, CD, zona-pasillo) entre desde y hasta, por fecha de CE o de operación */
export async function calendario({ desde, hasta, cd, ver = 'ce' } = {}) {
  desde = soloFecha(desde); hasta = soloFecha(hasta);
  if (!desde || !hasta) throw bad('Indica el rango de fechas.');
  const f = CAMPO[ver] || 'fecha_ce';
  const cdF = txt(cd) ? txt(cd).toUpperCase() : null;
  const param = await paramsInv();
  const [g, cds, aj] = await Promise.all([
    q(`SELECT ${f}::text AS fecha, coalesce(cd_op, '${SIN_CD}') AS cd, zona, pasillo, max(piso) AS piso,
         count(t.ft)::int AS tomadas, count(*) FILTER (WHERE t.ft > fecha_op)::int AS tarde, max(t.ft)::text AS ult_toma,
         count(*) FILTER (WHERE NOT excluida)::int AS ubicaciones, count(*) FILTER (WHERE excluida)::int AS quitadas,
         count(*) FILTER (WHERE fecha_reprog IS NOT NULL AND NOT excluida)::int AS reprog, count(*) FILTER (WHERE ajustada)::int AS ajustadas,
         min(fecha_ce)::text AS fecha_ce, min(fecha_op)::text AS fecha_op, min(fecha_prog)::text AS prog_min, max(fecha_prog)::text AS prog_max
       FROM inv_programa p ${TOMA('$4', '$5')}
       WHERE ${f} BETWEEN $1 AND $2 AND ($3::text IS NULL OR coalesce(cd_op, '${SIN_CD}') = $3)
       GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 4`, [desde, hasta, cdF, param.cds, param.diasPrevios]),
    q(`SELECT DISTINCT coalesce(cd_op, '${SIN_CD}') AS cd FROM inv_programa WHERE ${f} BETWEEN $1::date - 60 AND $2::date + 60 ORDER BY 1`, [desde, hasta]),
    q(`SELECT a.accion, a.fecha_nueva::text, a.usuario, a.creado_en, a.fecha_prog::text, count(*)::int AS ubicaciones, min(p.pasillo) AS pasillo, min(coalesce(p.cd_op, '${SIN_CD}')) AS cd
       FROM inv_ajuste a LEFT JOIN inv_programa p ON p.cd = a.cd AND p.ubicacion = a.ubicacion AND p.fecha_prog = a.fecha_prog
       GROUP BY a.accion, a.fecha_nueva, a.usuario, a.creado_en, a.fecha_prog ORDER BY a.creado_en DESC LIMIT 30`)
  ]);
  return { desde, hasta, ver: f === 'fecha_op' ? 'op' : 'ce', cds: cds.rows.map((x) => x.cd), grupos: g.rows, ajustes: aj.rows, param };
}

/** Ubicaciones de un grupo del calendario */
export async function ubicacionesGrupo({ ver = 'ce', fecha, cd, pasillo }) {
  const f = CAMPO[ver] || 'fecha_ce';
  const { cds, diasPrevios } = await paramsInv();
  const { rows } = await q(`SELECT id, ubicacion, zona, pasillo, seccion, vuelta, lado, seteo, fecha_prog::text, fecha_reprog::text, fecha_ce::text, fecha_op::text,
      fecha_toma::text, excluida, ajustada, t.ft::text AS inventariada FROM inv_programa p ${TOMA('$4', '$5')}
    WHERE ${f} = $1 AND coalesce(cd_op, '${SIN_CD}') = $2 AND pasillo = $3 ORDER BY ubicacion`, [soloFecha(fecha), cd, pasillo, cds, diasPrevios]);
  return rows;
}

// ids de las filas afectadas: una lista explícita o un grupo completo del calendario
async function ids(b) {
  if (Array.isArray(b.ids) && b.ids.length) return b.ids.map(Number).filter(Number.isInteger).slice(0, 50000);
  const g = b.grupo || {};
  const f = CAMPO[g.ver] || 'fecha_ce';
  if (!soloFecha(g.fecha) || !g.cd || !g.pasillo) throw bad('Indica el grupo o las ubicaciones.');
  const { rows } = await q(`SELECT id FROM inv_programa WHERE ${f} = $1 AND coalesce(cd_op, '${SIN_CD}') = $2 AND pasillo = $3`, [soloFecha(g.fecha), g.cd, g.pasillo]);
  return rows.map((r) => r.id);
}

/** Reprograma ubicaciones a una nueva fecha de CE (la fecha de operación se recalcula) */
export async function reprogramar(b, usuario) {
  const nueva = soloFecha(b.fecha);
  if (!nueva) throw bad('Indica la nueva fecha de Control de Existencia.');
  if (new Date(`${nueva}T12:00:00`).getDay() === 0) throw bad('Control de Existencia no programa los domingos: elige otra fecha.');
  const lista = await ids(b);
  if (!lista.length) throw bad('No hay ubicaciones para reprogramar.');
  const op = fechaOperacion(nueva, (await paramsInv()).diasAntes);
  await tx(async (c) => {
    await c.query(`INSERT INTO inv_ajuste (cd, ubicacion, fecha_prog, accion, fecha_nueva, fecha_op_nueva, reprog_orig, usuario)
      SELECT cd, ubicacion, fecha_prog, 'REPROG', $2, $3, CASE WHEN ajustada THEN NULL ELSE fecha_reprog END, $4 FROM inv_programa WHERE id = ANY($1)
      ON CONFLICT (cd, ubicacion, fecha_prog) DO UPDATE SET accion = 'REPROG', fecha_nueva = EXCLUDED.fecha_nueva, fecha_op_nueva = EXCLUDED.fecha_op_nueva,
        usuario = EXCLUDED.usuario, creado_en = now()`, [lista, nueva, op, usuario]);
    await c.query('UPDATE inv_programa SET fecha_reprog = $2, fecha_ce = $2, fecha_op = $3, ajustada = true, excluida = false WHERE id = ANY($1)', [lista, nueva, op]);
  });
  return { ubicaciones: lista.length, fecha_ce: nueva, fecha_op: op };
}

/** Quita ubicaciones del calendario (no se planifican ni se miden) */
export async function quitar(b, usuario) {
  const lista = await ids(b);
  if (!lista.length) throw bad('No hay ubicaciones para quitar.');
  await tx(async (c) => {
    await c.query(`INSERT INTO inv_ajuste (cd, ubicacion, fecha_prog, accion, reprog_orig, usuario)
      SELECT cd, ubicacion, fecha_prog, 'QUITAR', CASE WHEN ajustada THEN NULL ELSE fecha_reprog END, $2 FROM inv_programa WHERE id = ANY($1)
      ON CONFLICT (cd, ubicacion, fecha_prog) DO UPDATE SET accion = 'QUITAR', usuario = EXCLUDED.usuario, creado_en = now()`, [lista, usuario]);
    await c.query('UPDATE inv_programa SET excluida = true, ajustada = true WHERE id = ANY($1)', [lista]);
  });
  return { ubicaciones: lista.length };
}

/** Deshace los ajustes de la web: vuelve a la fecha del Excel (programada o su re-programación) */
export async function restaurar(b) {
  const lista = await ids(b);
  const { rows } = await q(`SELECT p.id, coalesce(a.reprog_orig, CASE WHEN p.ajustada THEN NULL ELSE p.fecha_reprog END)::text AS reprog, p.fecha_prog::text AS prog
    FROM inv_programa p LEFT JOIN inv_ajuste a ON a.cd = p.cd AND a.ubicacion = p.ubicacion AND a.fecha_prog = p.fecha_prog
    WHERE p.id = ANY($1) AND p.ajustada`, [lista]);
  if (!rows.length) return { ubicaciones: 0 };
  const { diasAntes } = await paramsInv();
  const porCe = new Map();
  for (const r of rows) { const ce = r.reprog || r.prog; if (!porCe.has(ce)) porCe.set(ce, { reprog: r.reprog, ids: [] }); porCe.get(ce).ids.push(r.id); }
  await tx(async (c) => {
    for (const [ce, g] of porCe) {
      await c.query('UPDATE inv_programa SET fecha_reprog = $2, fecha_ce = $3, fecha_op = $4, ajustada = false, excluida = false WHERE id = ANY($1)',
        [g.ids, g.reprog, ce, fechaOperacion(ce, diasAntes)]);
    }
    await c.query(`DELETE FROM inv_ajuste a USING inv_programa p WHERE p.id = ANY($1) AND a.cd = p.cd AND a.ubicacion = p.ubicacion AND a.fecha_prog = p.fecha_prog`,
      [rows.map((r) => r.id)]);
  });
  return { ubicaciones: rows.length };
}

/** Vuelve a aplicar los ajustes de la web a las fechas programadas recién cargadas desde el Excel (dentro de la transacción de la carga) */
export async function aplicarAjustes(c, fechas) {
  const r = await c.query(`UPDATE inv_programa p SET fecha_reprog = a.fecha_nueva, fecha_ce = a.fecha_nueva, fecha_op = a.fecha_op_nueva, ajustada = true
    FROM inv_ajuste a WHERE a.accion = 'REPROG' AND p.cd = a.cd AND p.ubicacion = a.ubicacion AND p.fecha_prog = a.fecha_prog AND p.fecha_prog = ANY($1::date[])`, [fechas]);
  const s = await c.query(`UPDATE inv_programa p SET excluida = true, ajustada = true
    FROM inv_ajuste a WHERE a.accion = 'QUITAR' AND p.cd = a.cd AND p.ubicacion = a.ubicacion AND p.fecha_prog = a.fecha_prog AND p.fecha_prog = ANY($1::date[])`, [fechas]);
  return r.rowCount + s.rowCount;
}
