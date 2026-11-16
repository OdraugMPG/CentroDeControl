// Calendario de planificación de inventario: la programación de Control de Existencia por día y zona-pasillo, con ajustes
// en la web (reprogramar o quitar ubicaciones, y deshacer). Cada ajuste queda en inv_ajuste y se vuelve a aplicar cuando
// se sube de nuevo el Excel de CE (ver aplicarAjustes, que llama la carga).
import { q, tx } from '../db.js';
import { soloFecha, txt } from '../import/excel.js';
import { fechaOperacion, paramsInv } from './inventarioCe.js';
import { cat } from '../lib/catalogos.js';
import { fechaOperativa } from '../lib/turnos.js';
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
         count(*) FILTER (WHERE archivo = '${ARCHIVO_WEB}' AND NOT excluida)::int AS web,
         min(fecha_ce)::text AS fecha_ce, min(fecha_op)::text AS fecha_op, min(fecha_prog)::text AS prog_min, max(fecha_prog)::text AS prog_max,
         max(tp.turno) AS turno, bool_or(tp.manual) AS turno_manual
       FROM inv_programa p ${TOMA('$4', '$5')}
       LEFT JOIN (SELECT fecha_op AS tf, cd AS tcd, pasillo AS tpas, turno, manual FROM inv_turno_pasillo) tp
         ON tp.tf = p.fecha_op AND tp.tcd = coalesce(p.cd_op, '${SIN_CD}') AND tp.tpas = p.pasillo AND NOT p.excluida
       WHERE ${f} BETWEEN $1 AND $2 AND ($3::text IS NULL OR coalesce(cd_op, '${SIN_CD}') = $3)
       GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 4`, [desde, hasta, cdF, param.cds, param.diasPrevios]),
    q(`SELECT DISTINCT coalesce(cd_op, '${SIN_CD}') AS cd FROM inv_programa WHERE ${f} BETWEEN $1::date - 60 AND $2::date + 60 ORDER BY 1`, [desde, hasta]),
    q(`SELECT a.accion, a.fecha_nueva::text, a.usuario, a.creado_en, a.fecha_prog::text, count(*)::int AS ubicaciones, min(p.pasillo) AS pasillo, min(coalesce(p.cd_op, '${SIN_CD}')) AS cd
       FROM inv_ajuste a LEFT JOIN inv_programa p ON p.cd = a.cd AND p.ubicacion = a.ubicacion AND p.fecha_prog = a.fecha_prog
       GROUP BY a.accion, a.fecha_nueva, a.usuario, a.creado_en, a.fecha_prog ORDER BY a.creado_en DESC LIMIT 30`)
  ]);
  const c = await cat();
  return { desde, hasta, ver: f === 'fecha_op' ? 'op' : 'ce', cds: cds.rows.map((x) => x.cd), grupos: g.rows, ajustes: aj.rows, param,
    turnos: c.turnos.map((t) => ({ id: t.id, nombre: t.nombre, hora_inicio: t.hora_inicio })) };
}

/** Ubicaciones de un grupo del calendario */
export async function ubicacionesGrupo({ ver = 'ce', fecha, cd, pasillo }) {
  const f = CAMPO[ver] || 'fecha_ce';
  const { cds, diasPrevios } = await paramsInv();
  const { rows } = await q(`SELECT id, ubicacion, zona, pasillo, seccion, vuelta, lado, seteo, fecha_prog::text, fecha_reprog::text, fecha_ce::text, fecha_op::text,
      fecha_toma::text, excluida, ajustada, archivo = '${ARCHIVO_WEB}' AS web, t.ft::text AS inventariada FROM inv_programa p ${TOMA('$4', '$5')}
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

/** Quita ubicaciones del calendario (no se planifican ni se miden). Las asignadas en la web (sin Excel) se eliminan. */
export async function quitar(b, usuario) {
  const lista = await ids(b);
  if (!lista.length) throw bad('No hay ubicaciones para quitar.');
  const total = lista.length;
  await tx(async (c) => {
    const web = await c.query(`DELETE FROM inv_programa WHERE id = ANY($1) AND archivo = '${ARCHIVO_WEB}' AND fecha_prog = fecha_ce RETURNING id`, [lista]);
    if (web.rowCount) { const fuera = new Set(web.rows.map((r) => r.id)); lista.splice(0, lista.length, ...lista.filter((i) => !fuera.has(i))); }
    if (!lista.length) return;
    await c.query(`INSERT INTO inv_ajuste (cd, ubicacion, fecha_prog, accion, reprog_orig, usuario)
      SELECT cd, ubicacion, fecha_prog, 'QUITAR', CASE WHEN ajustada THEN NULL ELSE fecha_reprog END, $2 FROM inv_programa WHERE id = ANY($1)
      ON CONFLICT (cd, ubicacion, fecha_prog) DO UPDATE SET accion = 'QUITAR', usuario = EXCLUDED.usuario, creado_en = now()`, [lista, usuario]);
    await c.query('UPDATE inv_programa SET excluida = true, ajustada = true WHERE id = ANY($1)', [lista]);
  });
  return { ubicaciones: total };
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

// ---------------------------------------------------------------------------------------------
// Asignación de pasillos en la web (sin Excel): con el calendario nuevo de CE se elige el día y las zonas-pasillo, y se
// crean sus ubicaciones en la programación (archivo = 'WEB'). Las ubicaciones de cada pasillo salen de la programación
// cargada antes (CE repite las mismas en cada ciclo, con sección, vuelta y lado) y, para las que nunca se programaron,
// de la Base de stock (solo trae las ubicaciones con stock).
// ---------------------------------------------------------------------------------------------
export const ARCHIVO_WEB = 'WEB';
const UNIVERSO = `WITH h AS (SELECT DISTINCT ON (ubicacion) ubicacion, cd AS loc, coalesce(cd_op, '${SIN_CD}') AS cd, zona, pasillo, seteo, seccion, vuelta, lado, piso
      FROM inv_programa ORDER BY ubicacion, fecha_prog DESC),
    b AS (SELECT DISTINCT ON (upper(ubicacion)) upper(ubicacion) AS ubicacion, upper(cd) AS cd, left(upper(zona_pasillo), 3) AS zona, upper(zona_pasillo) AS pasillo, piso
      FROM gestion.stock WHERE carga_id = (SELECT id FROM gestion.cargas WHERE tipo = 'INICIO' ORDER BY fecha DESC, id DESC LIMIT 1) AND coalesce(zona_pasillo, '') <> ''
      ORDER BY upper(ubicacion)),
    u AS (SELECT ubicacion, loc, cd, zona, pasillo, seteo, seccion, vuelta, lado, piso, true AS hist FROM h
      UNION ALL SELECT b.ubicacion, NULL, b.cd, b.zona, b.pasillo, NULL, NULL, NULL, NULL, b.piso, false FROM b WHERE NOT EXISTS (SELECT 1 FROM h WHERE h.ubicacion = b.ubicacion))`;

/** Zonas-pasillo que se pueden asignar en un CD, con sus ubicaciones y su última y próxima fecha de CE */
export async function pasillosAsignables({ cd, fecha } = {}) {
  const { cds } = await paramsInv();
  const cdF = txt(cd) ? txt(cd).toUpperCase() : null;
  const f = soloFecha(fecha);
  const { rows } = await q(`${UNIVERSO},
    vu AS (SELECT DISTINCT ON (coalesce(cd_op, '${SIN_CD}'), pasillo) coalesce(cd_op, '${SIN_CD}') AS cd, pasillo, vuelta
           FROM inv_programa WHERE coalesce(vuelta, '') <> '' ORDER BY coalesce(cd_op, '${SIN_CD}'), pasillo, fecha_ce DESC),
    pr AS (SELECT coalesce(cd_op, '${SIN_CD}') AS cd, pasillo, max(fecha_ce) FILTER (WHERE fecha_ce < coalesce($2::date, current_date))::text AS ultima,
             min(fecha_ce) FILTER (WHERE fecha_ce >= coalesce($2::date, current_date))::text AS proxima,
             count(*) FILTER (WHERE fecha_ce = $2::date)::int AS en_fecha
           FROM inv_programa WHERE NOT excluida GROUP BY 1, 2)
    SELECT u.cd, u.zona, u.pasillo, count(*)::int AS ubicaciones, count(*) FILTER (WHERE u.hist)::int AS conocidas, pr.ultima, pr.proxima, coalesce(pr.en_fecha, 0) AS en_fecha, vu.vuelta
    FROM u LEFT JOIN pr ON pr.cd = u.cd AND pr.pasillo = u.pasillo LEFT JOIN vu ON vu.cd = u.cd AND vu.pasillo = u.pasillo
    WHERE u.cd = ANY($3::text[]) AND ($1::text IS NULL OR u.cd = $1)
    GROUP BY u.cd, u.zona, u.pasillo, pr.ultima, pr.proxima, pr.en_fecha, vu.vuelta ORDER BY u.cd, u.zona, u.pasillo`, [cdF, f, cds]);
  return { cds, pasillos: rows };
}

/**
 * Asigna zonas-pasillo a una fecha de CE. Con "mover", si el pasillo ya tiene programación pendiente (desde hoy) en otra fecha,
 * esa programación se reprograma a la nueva fecha (queda como ajuste) en vez de crear otra.
 */
export async function asignarPasillos(b, usuario) {
  const fecha = soloFecha(b.fecha);
  if (!fecha) throw bad('Indica la fecha de Control de Existencia.');
  if (new Date(`${fecha}T12:00:00`).getDay() === 0) throw bad('Control de Existencia no programa los domingos: elige otra fecha.');
  const lista = (Array.isArray(b.pasillos) ? b.pasillos : []).map((x) => ({ cd: txt(x.cd).toUpperCase(), pasillo: txt(x.pasillo).toUpperCase() })).filter((x) => x.cd && x.pasillo);
  if (!lista.length) throw bad('Elige al menos una zona-pasillo.');
  const mover = b.mover === true;
  // vuelta de Control de Existencia de esta programación (el ciclo de toma del pasillo)
  const vuelta = txt(b.vuelta);
  if (!vuelta) throw bad('Indica la vuelta de Control de Existencia.');
  const { diasAntes } = await paramsInv();
  const op = fechaOperacion(fecha, diasAntes);
  const cdsL = lista.map((x) => x.cd), pasL = lista.map((x) => x.pasillo);
  let movidas = 0;
  if (mover) {
    // programación vigente del pasillo en otra fecha desde la elegida (o desde hoy si es anterior): se mueve
    const { rows } = await q(`SELECT p.id FROM inv_programa p JOIN unnest($1::text[], $2::text[]) AS l(cd, pasillo) ON l.cd = coalesce(p.cd_op, '${SIN_CD}') AND l.pasillo = p.pasillo
      WHERE NOT p.excluida AND p.fecha_ce >= least($3::date, current_date) AND p.fecha_ce <> $3::date`, [cdsL, pasL, fecha]);
    if (rows.length) {
      movidas = (await reprogramar({ ids: rows.map((r) => r.id), fecha }, usuario)).ubicaciones;
      await q('UPDATE inv_programa SET vuelta = $2 WHERE id = ANY($1)', [rows.map((r) => r.id), vuelta]);
    }
  }
  // ubicaciones del universo que aún no están programadas en esa fecha
  const { rows: nuevas } = await q(`${UNIVERSO},
    loc AS (SELECT coalesce(cd_op, '${SIN_CD}') AS cd, mode() WITHIN GROUP (ORDER BY cd) AS loc FROM inv_programa GROUP BY 1),
    locG AS (SELECT mode() WITHIN GROUP (ORDER BY cd) AS loc FROM inv_programa)
    SELECT u.ubicacion, coalesce(u.loc, loc.loc, (SELECT loc FROM locG), u.cd) AS loc, u.cd, u.zona, u.pasillo, u.seteo, u.seccion, u.lado, u.piso
    FROM u JOIN unnest($1::text[], $2::text[]) AS l(cd, pasillo) ON l.cd = u.cd AND l.pasillo = u.pasillo
    LEFT JOIN loc ON loc.cd = u.cd
    WHERE NOT EXISTS (SELECT 1 FROM inv_programa p WHERE p.ubicacion = u.ubicacion AND p.fecha_ce = $3::date AND NOT p.excluida)`, [cdsL, pasL, fecha]);
  if (nuevas.length) {
    const col = (k) => nuevas.map((x) => x[k]);
    await q(`INSERT INTO inv_programa (cd, ubicacion, seteo, zona, pasillo, seccion, vuelta, lado, piso, cd_op, fecha_prog, fecha_ce, fecha_op, archivo, ajustada)
      SELECT a, b, c, d, e, f, g, h, i, j, $11, $11, $12, '${ARCHIVO_WEB}', true
      FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[]) AS t(a, b, c, d, e, f, g, h, i, j)`,
    [col('loc'), col('ubicacion'), col('seteo'), col('zona'), col('pasillo'), col('seccion'), nuevas.map(() => vuelta), col('lado'), col('piso'), col('cd'), fecha, op]);
  }
  // turno de cada pasillo en su fecha de operación (reparto parejo; hoy, solo los turnos que aún no empiezan)
  const rep = await repartirTurnos({ desde: op, hasta: op }, usuario).catch(() => null);
  return { fecha_ce: fecha, fecha_op: op, vuelta, turnos: rep?.dias || [], pasillos: lista.length, creadas: nuevas.length, movidas, desdeBase: nuevas.filter((x) => !x.seccion && !x.seteo).length };
}

// ---------------------------------------------------------------------------------------------
// Turno de cada zona-pasillo en su fecha de operación: reparto parejo por ubicaciones entre los turnos disponibles
// del calendario de la operación (lunes a viernes AM, PM y Noche; sábado AM y PM; domingo ninguno). El día de hoy solo cuentan los turnos que
// aún no empiezan (si el calendario se actualiza el viernes en la mañana, el viernes parte con PM y Noche). Los turnos
// elegidos a mano y los de turnos que ya empezaron se mantienen.
// ---------------------------------------------------------------------------------------------
const H = 3600000;
const inicioTurno = (fecha, t) => { const [y, m, d] = fecha.split('-').map(Number); return new Date(y, m - 1, d, t.hora_inicio).getTime(); };

/** Turnos de inventario de una fecha de operación (ids en orden) y los que ya empezaron */
function turnosInv(fecha, c, ahora) {
  const operan = c.calendario[new Date(`${fecha}T12:00:00`).getDay()] || [];
  const todos = c.turnos.filter((t) => operan.includes(t.id));
  return { disp: todos.filter((t) => inicioTurno(fecha, t) > ahora).map((t) => t.id), empezados: todos.filter((t) => inicioTurno(fecha, t) <= ahora).map((t) => t.id) };
}

export async function repartirTurnos({ desde, hasta, cd, forzar = false } = {}, usuario = null) {
  const c = await cat();
  const ahora = Date.now();
  const hoy = fechaOperativa(ahora, c);
  desde = soloFecha(desde) || hoy; hasta = soloFecha(hasta) || desde;
  if (desde < hoy) desde = hoy;
  if (hasta < desde) return { dias: [] };
  const cdF = txt(cd) ? txt(cd).toUpperCase() : null;
  const [{ rows: gs }, { rows: ex }] = await Promise.all([
    q(`SELECT fecha_op::text AS fecha, coalesce(cd_op, '${SIN_CD}') AS cd, pasillo, count(*)::int AS ub FROM inv_programa
      WHERE NOT excluida AND fecha_op BETWEEN $1 AND $2 AND ($3::text IS NULL OR coalesce(cd_op, '${SIN_CD}') = $3) GROUP BY 1, 2, 3`, [desde, hasta, cdF]),
    q(`SELECT fecha_op::text AS fecha, cd, pasillo, turno, manual FROM inv_turno_pasillo WHERE fecha_op BETWEEN $1 AND $2 AND ($3::text IS NULL OR cd = $3)`, [desde, hasta, cdF]),
  ]);
  const previo = new Map(ex.map((x) => [`${x.fecha}|${x.cd}|${x.pasillo}`, x]));
  const porDia = new Map();
  for (const g of gs) { const k = `${g.fecha}|${g.cd}`; if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(g); }
  const filas = [], dias = [];
  for (const [k, l] of porDia) {
    const [fecha, cdD] = k.split('|');
    const { disp, empezados } = turnosInv(fecha, c, ahora);
    const carga = Object.fromEntries(disp.map((t) => [t, 0]));
    const libres = [];
    for (const g of l) {
      const p = previo.get(`${fecha}|${cdD}|${g.pasillo}`);
      // se mantienen: lo de un turno que ya empezó y lo elegido a mano (salvo forzar)
      if (p && (empezados.includes(p.turno) || (p.manual && !forzar && (disp.includes(p.turno) || !disp.length)))) {
        filas.push({ fecha, cd: cdD, pasillo: g.pasillo, turno: p.turno, manual: p.manual });
        if (p.turno in carga) carga[p.turno] += g.ub;
      } else libres.push(g);
    }
    let sinTurno = 0;
    // de mayor a menor, cada pasillo al turno con menos ubicaciones (a igualdad, el más temprano)
    for (const g of libres.sort((a, b) => b.ub - a.ub || a.pasillo.localeCompare(b.pasillo))) {
      if (!disp.length) { sinTurno++; continue; }
      const t = disp.reduce((a, x) => (carga[x] < carga[a] ? x : a), disp[0]);
      carga[t] += g.ub;
      filas.push({ fecha, cd: cdD, pasillo: g.pasillo, turno: t, manual: false });
    }
    dias.push({ fecha, cd: cdD, turnos: disp, carga, sinTurno });
  }
  await tx(async (cn) => {
    await cn.query('DELETE FROM inv_turno_pasillo WHERE fecha_op BETWEEN $1 AND $2 AND ($3::text IS NULL OR cd = $3)', [desde, hasta, cdF]);
    if (filas.length) {
      await cn.query(`INSERT INTO inv_turno_pasillo (fecha_op, cd, pasillo, turno, manual, usuario)
        SELECT a, b, c, d, e, $6 FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::boolean[]) AS t(a, b, c, d, e)`,
      [filas.map((x) => x.fecha), filas.map((x) => x.cd), filas.map((x) => x.pasillo), filas.map((x) => x.turno), filas.map((x) => x.manual), usuario]);
    }
  });
  return { desde, hasta, pasillos: filas.length, dias: dias.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.cd.localeCompare(b.cd)) };
}

/** Turno elegido a mano para una zona-pasillo en su fecha de operación ('' = vuelve al reparto automático) */
export async function turnoPasillo(b, usuario) {
  const fecha = soloFecha(b.fecha_op), cdP = txt(b.cd).toUpperCase(), pasillo = txt(b.pasillo).toUpperCase(), turno = txt(b.turno);
  if (!fecha || !cdP || !pasillo) throw bad('Indica la fecha de operación, el CD y la zona-pasillo.');
  if (!turno) {
    await q('DELETE FROM inv_turno_pasillo WHERE fecha_op = $1 AND cd = $2 AND pasillo = $3', [fecha, cdP, pasillo]);
    return repartirTurnos({ desde: fecha, hasta: fecha, cd: cdP }, usuario);
  }
  const c = await cat();
  if (!c.turno[turno]) throw bad('Turno inválido.');
  await q(`INSERT INTO inv_turno_pasillo (fecha_op, cd, pasillo, turno, manual, usuario) VALUES ($1,$2,$3,$4,true,$5)
    ON CONFLICT (fecha_op, cd, pasillo) DO UPDATE SET turno = $4, manual = true, usuario = $5, creado_en = now()`, [fecha, cdP, pasillo, turno, usuario]);
  return { ok: true };
}
