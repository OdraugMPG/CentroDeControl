// Continuidad Operacional: equipo, compromisos, entregas de turno, dotación, asistencia e inventario.
import { Router } from 'express';
import multer from 'multer';
import { q, tx } from '../db.js';
import { cat } from '../lib/catalogos.js';
import { addDias, fechaOperativa, instancia } from '../lib/turnos.js';
import { estadoTarea, autoTraspaso, indicadores, dotacionTurno } from '../services/continuidad.js';
import { leerLibro } from '../import/excel.js';
import { importarInventario, analisisInventario, asignar } from '../services/inventarioCe.js';
import { simularDia } from '../services/inventarioTurnos.js';
import { dashboardInventario } from '../services/inventarioDashboard.js';
import { validacionToma } from '../services/inventarioValidacion.js';
import { comparacionCe, precisionProgramacion } from '../services/inventarioComparacion.js';
import { movimientosSku, historiaSku } from '../services/movimientosSku.js';
import { calendario, ubicacionesGrupo, reprogramar, quitar, restaurar } from '../services/inventarioCalendario.js';
import { ah, bad, fecha, turno, texto, usuarioDe } from './util.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });   // la programación de CE y el resultado de la toma pueden ser grandes

const conEstado = async rows => { const c = await cat(), now = Date.now(); return rows.map(t => ({ ...t, st: estadoTarea(t, c, now) })); };
const SELECT_TAREAS = `SELECT t.*, p.nombre AS asignado_nombre, p.rol AS asignado_rol, o.turno_id AS heredada_de_turno, o.fecha AS heredada_de_fecha
  FROM tareas t LEFT JOIN personas p ON p.id = t.asignado_a LEFT JOIN tareas o ON o.id = t.heredada_de`;
const jefeDe = async (turnoId, client = { query: q }) =>
  (await client.query(`SELECT id FROM personas WHERE rol = 'Jefe de Turno' AND turno_id = $1 AND activo LIMIT 1`, [turnoId])).rows[0]?.id || null;

// ---------- Equipo ----------
r.get('/personas', ah(async (req, res) => {
  res.json((await q(`SELECT p.*, e.nombre AS empresa FROM personas p LEFT JOIN empresas e ON e.id = p.empresa_id
    WHERE p.activo ORDER BY p.turno_id NULLS FIRST, p.rol, p.nombre`)).rows);
}));
r.post('/personas', ah(async (req, res) => {
  const nombre = texto(req.body.nombre, 120), rol = req.body.rol;
  if (!nombre) throw bad('Ingresa el nombre.');
  if (!['Jefe de Operaciones', 'Jefe de Turno', 'Supervisor'].includes(rol)) throw bad('Rol inválido.');
  const t = rol === 'Jefe de Operaciones' ? null : await turno(req.body.turno_id);
  let reporta = null;
  if (rol === 'Supervisor') {
    reporta = req.body.reporta_a ? +req.body.reporta_a : await jefeDe(t);
    if (!reporta) throw bad(`Registra primero al Jefe de Turno del turno ${t}: el supervisor debe reportar a él.`);
  }
  try {
    const { rows: [p] } = await q('INSERT INTO personas (nombre, rol, turno_id, reporta_a) VALUES ($1,$2,$3,$4) RETURNING *', [nombre, rol, t, reporta]);
    res.status(201).json(p);
  } catch (e) {
    if (e.code === '23505') throw bad(`Ya existe un Jefe de Turno activo en el turno ${t}. Dalo de baja primero para reemplazarlo.`, 409);
    throw e;
  }
}));
r.delete('/personas/:id', ah(async (req, res) => {
  await tx(async c => {
    const { rows: [p] } = await c.query('UPDATE personas SET activo = false WHERE id = $1 RETURNING *', [+req.params.id]);
    if (!p) throw bad('Persona no encontrada.', 404);
    // Las tareas abiertas delegadas a esa persona vuelven al jefe de su turno
    await c.query(`UPDATE tareas t SET asignado_a = (SELECT id FROM personas j WHERE j.rol = 'Jefe de Turno' AND j.turno_id = t.turno_id AND j.activo LIMIT 1)
      WHERE t.asignado_a = $1 AND t.estado = 'abierta'`, [p.id]);
    await c.query('UPDATE personas SET reporta_a = NULL WHERE reporta_a = $1', [p.id]);
  });
  res.json({ ok: true });
}));

// ---------- Tareas y compromisos ----------
r.get('/tareas', ah(async (req, res) => {
  await autoTraspaso();
  const w = [], p = [];
  if (req.query.fecha) { p.push(fecha(req.query.fecha)); w.push(`t.fecha = $${p.length}`); }
  if (req.query.desde) { p.push(fecha(req.query.desde, 'desde')); w.push(`t.fecha >= $${p.length}`); }
  if (req.query.hasta) { p.push(fecha(req.query.hasta, 'hasta')); w.push(`t.fecha <= $${p.length}`); }
  if (req.query.turno) { p.push(await turno(req.query.turno)); w.push(`t.turno_id = $${p.length}`); }
  if (req.query.origen) { p.push(req.query.origen); w.push(`t.origen = $${p.length}`); }
  if (req.query.abiertas) w.push(`t.estado = 'abierta'`);
  if (!w.length) { p.push(addDias(fechaOperativa(Date.now(), await cat()), -14)); w.push(`t.fecha >= $1`); }
  const { rows } = await q(`${SELECT_TAREAS} WHERE ${w.join(' AND ')} ORDER BY t.fecha, t.turno_id, t.prioridad DESC, t.categoria, t.id LIMIT 2000`, p);
  res.json(await conEstado(rows));
}));

// Asignación individual, con repetición diaria o semanal y varios turnos destino
r.post('/tareas', ah(async (req, res) => {
  const b = req.body, c = await cat();
  const titulo = texto(b.titulo, 300); if (!titulo) throw bad('Ingresa el título de la actividad.');
  const turnos = Array.isArray(b.turnos) ? b.turnos : [];
  if (!turnos.length) throw bad('Selecciona al menos un turno destino.');
  for (const t of turnos) await turno(t);
  const base = fecha(b.fecha);
  const n = b.repetir === 'no' || !b.repetir ? 1 : Math.max(1, Math.min(60, +b.veces || 1));
  const paso = b.repetir === 'semanal' ? 7 : 1;
  const creadas = [], omitidas = [];
  await tx(async cl => {
    for (let i = 0; i < n; i++) {
      const f = addDias(base, i * paso);
      for (const t of turnos) {
        if (!instancia(f, t, c).programado) { omitidas.push(`${f} ${t}`); continue; }
        const { rows: [x] } = await cl.query(`INSERT INTO tareas (titulo, categoria, responsable, fecha, turno_id, cd, origen, asignado_por, asignado_a, plazo)
          VALUES ($1,$2,$3,$4,$5,$6,'operaciones',$7,$8,$9) RETURNING *`,
          [titulo, texto(b.categoria, 80) || 'Otra', texto(b.responsable, 120), f, t, texto(b.cd, 120), texto(b.asignado_por, 120) || usuarioDe(req),
            await jefeDe(t, cl), b.plazo ? new Date(b.plazo) : null]);
        creadas.push(x);
      }
    }
  });
  res.status(201).json({ creadas: creadas.length, omitidas });
}));

// Compositor: lista de compromisos por categoría para el grupo de un turno
r.post('/tareas/grupo', ah(async (req, res) => {
  const b = req.body, c = await cat();
  const f = fecha(b.fecha), t = await turno(b.turno);
  if (!instancia(f, t, c).programado) throw bad(`El turno ${t} no opera el ${f} según el calendario.`);
  const secciones = Array.isArray(b.secciones) ? b.secciones : [];
  let n = 0;
  await tx(async cl => {
    const jefe = await jefeDe(t, cl);
    for (const s of secciones) for (const it of (s.items || [])) {
      const titulo = texto(it, 300); if (!titulo) continue;
      await cl.query(`INSERT INTO tareas (titulo, categoria, fecha, turno_id, cd, origen, asignado_por, asignado_a)
        VALUES ($1,$2,$3,$4,$5,'operaciones',$6,$7)`,
        [titulo, texto(s.categoria, 80) || 'Otros Compromisos', f, t, texto((b.cds || []).join(', '), 200), texto(b.asignado_por, 120) || 'Compromisos del turno', jefe]);
      n++;
    }
  });
  if (!n) throw bad('Agrega al menos un compromiso con texto.');
  res.status(201).json({ creadas: n });
}));

r.patch('/tareas/:id', ah(async (req, res) => {
  const id = +req.params.id, b = req.body;
  const t = (await q('SELECT * FROM tareas WHERE id = $1', [id])).rows[0];
  if (!t) throw bad('Tarea no encontrada.', 404);
  if (t.estado === 'traspasada') throw bad('Esta tarea ya se traspasó al turno siguiente; actualiza la copia de ese turno.', 409);
  if (b.estado) {
    if (!['abierta', 'cerrada'].includes(b.estado)) throw bad('Estado inválido.');
    await q(`UPDATE tareas SET estado = $2, cerrado_en = CASE WHEN $2 = 'cerrada' THEN now() END,
      cerrado_por = CASE WHEN $2 = 'cerrada' THEN $3 END WHERE id = $1`, [id, b.estado, usuarioDe(req)]);
  }
  if ('asignado_a' in b) {
    const nuevo = b.asignado_a ? +b.asignado_a : await jefeDe(t.turno_id);
    await q('UPDATE tareas SET asignado_a = $2 WHERE id = $1', [id, nuevo]);
  }
  const { rows } = await q(`${SELECT_TAREAS} WHERE t.id = $1`, [id]);
  res.json((await conEstado(rows))[0]);
}));
r.delete('/tareas/:id', ah(async (req, res) => {
  await q('DELETE FROM tareas WHERE id = $1', [+req.params.id]);
  res.json({ ok: true });
}));

// ---------- Entrega de turno ----------
r.get('/handovers', ah(async (req, res) => {
  const p = [], w = [];
  if (req.query.estado) { p.push(req.query.estado); w.push(`estado = $${p.length}`); }
  if (req.query.fecha) { p.push(fecha(req.query.fecha)); w.push(`fecha = $${p.length}`); }
  const { rows } = await q(`SELECT * FROM handovers ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY entregado_en DESC LIMIT 50`, p);
  const ids = rows.map(h => h.id);
  const tareas = ids.length ? (await q(`${SELECT_TAREAS} WHERE t.handover_id = ANY($1)`, [ids])).rows : [];
  const tt = await conEstado(tareas);
  res.json(rows.map(h => ({ ...h, tareas: tt.filter(t => t.handover_id === h.id) })));
}));
r.post('/handovers', ah(async (req, res) => {
  const b = req.body;
  const f = fecha(b.fecha), t = await turno(b.turno);
  const jefe = texto(b.jefe, 120); if (!jefe) throw bad('Ingresa el nombre del jefe de turno.');
  const h = await tx(async cl => {
    const { rows: [h] } = await cl.query(`INSERT INTO handovers (fecha, turno_id, jefe, situacion, riesgos) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [f, t, jefe, texto(b.situacion, 4000), texto(b.riesgos, 4000)]);
    for (const x of (b.tareas || [])) {
      const titulo = texto(x.titulo, 300); if (!titulo) continue;
      await cl.query(`INSERT INTO tareas (titulo, categoria, responsable, fecha, turno_id, estado, origen, handover_id, asignado_a, plazo, asignado_por)
        VALUES ($1,$2,$3,$4,$5,$6,'turno',$7,$8,$9,$10)`,
        [titulo, texto(x.categoria, 80) || 'Otra', texto(x.responsable, 120), f, t, x.estado === 'cerrada' ? 'cerrada' : 'abierta', h.id,
          await jefeDe(t, cl), x.plazo ? new Date(x.plazo) : null, jefe]);
    }
    return h;
  });
  res.status(201).json(h);
}));
r.post('/handovers/:id/confirmar', ah(async (req, res) => {
  const nombre = texto(req.body.nombre, 120); if (!nombre) throw bad('Ingresa el nombre de quien recibe.');
  const { rows: [h] } = await q(`UPDATE handovers SET estado = 'confirmado', jefe_entrante = $2, confirmado_en = now()
    WHERE id = $1 AND estado = 'pendiente' RETURNING *`, [+req.params.id, nombre]);
  if (!h) throw bad('La entrega no existe o ya fue confirmada.', 409);
  const movidas = await autoTraspaso();
  res.json({ ...h, traspasadas: movidas });
}));

// ---------- Dotación y asistencia ----------
r.get('/dotacion', ah(async (req, res) => {
  const { rows } = await q('SELECT * FROM dotacion_requerida');
  const out = {}; rows.forEach(x => { (out[x.turno_id] = out[x.turno_id] || {})[x.fila] = x.cantidad; });
  res.json(out);
}));
r.put('/dotacion', ah(async (req, res) => {
  await tx(async c => {
    for (const [t, filas] of Object.entries(req.body || {})) {
      await turno(t);
      for (const [fila, cant] of Object.entries(filas))
        await c.query(`INSERT INTO dotacion_requerida VALUES ($1,$2,$3) ON CONFLICT (turno_id, fila) DO UPDATE SET cantidad = $3`,
          [t, String(fila).slice(0, 120), Math.max(0, parseInt(cant, 10) || 0)]);
    }
  });
  res.json({ ok: true });
}));
r.get('/asistencia', ah(async (req, res) => {
  const f = fecha(req.query.fecha), t = await turno(req.query.turno);
  const d = await dotacionTurno(f, t);
  const previa = d.registro ? null : (await q('SELECT * FROM asistencia WHERE turno_id = $1 AND fecha < $2 ORDER BY fecha DESC LIMIT 1', [t, f])).rows[0] || null;
  res.json({ ...d, previa });
}));
r.get('/asistencia/dia', ah(async (req, res) => {
  const f = fecha(req.query.fecha), c = await cat();
  const out = [];
  for (const t of c.calendario[new Date(f + 'T12:00:00').getDay()] || []) out.push({ turno: t, ...(await dotacionTurno(f, t)) });
  res.json(out);
}));
r.put('/asistencia', ah(async (req, res) => {
  const f = fecha(req.body.fecha), t = await turno(req.body.turno);
  const quien = texto(req.body.confirmado_por, 120); if (!quien) throw bad('Ingresa el nombre de quien confirma.');
  const valores = Object.fromEntries(Object.entries(req.body.valores || {}).map(([k, v]) => [String(k).slice(0, 120), Math.max(0, parseInt(v, 10) || 0)]));
  await q(`INSERT INTO asistencia (fecha, turno_id, valores, confirmado_por) VALUES ($1,$2,$3,$4)
    ON CONFLICT (fecha, turno_id) DO UPDATE SET valores = $3, confirmado_por = $4, confirmado_en = now()`, [f, t, valores, quien]);
  res.json(await dotacionTurno(f, t));
}));

r.get('/indicadores', ah(async (req, res) => { res.json(await indicadores(Math.min(180, +req.query.dias || 30))); }));

// ---------- Inventario CD ----------
r.get('/inventario', ah(async (req, res) => {
  const [lay, asig] = await Promise.all([
    q('SELECT * FROM inv_layout ORDER BY cd, nivel, zona, pasillo'),
    q('SELECT * FROM inv_asignaciones ORDER BY fecha_asignado DESC, id DESC LIMIT 1000')
  ]);
  res.json({ layout: lay.rows, asignaciones: asig.rows });
}));
// Programación de Control de Existencia y resultado de la toma (se reconoce solo cuál archivo es)
r.post('/inventario/importar', upload.single('archivo'), ah(async (req, res) => {
  if (!req.file) throw bad('Adjunta el archivo.');
  res.status(201).json(await importarInventario(await leerLibro(req.file.buffer, req.file.originalname), req.file.originalname, { todo: req.body?.reemplazar === 'todo' }));
}));
r.get('/inventario/analisis', ah(async (req, res) => { res.json(await analisisInventario(req.query)); }));
// dashboard: SKU y unidades, ERI / ERU histórico por CD, resultado neto y absoluto, top de SKU y matriz ABC / XYZ
r.get('/inventario/dashboard', ah(async (req, res) => { res.json(await dashboardInventario(req.query)); }));
// validación de la toma por pasada (primera, segunda y tercera)
r.get('/inventario/validacion', ah(async (req, res) => { res.json(await validacionToma(req.query)); }));
// toma oficial de CE contra la toma de la operación (días antes) por ubicación y SKU
r.get('/inventario/comparacion', ah(async (req, res) => { res.json(await comparacionCe(req.query)); }));
// precisión de la programación de CE (original y re-programada) contra la toma real de CE
// movimientos de SKU: cambios de ubicación entre fotos diarias de la Base de stock
r.get('/inventario/movimientos', ah(async (req, res) => { res.json(await movimientosSku(req.query)); }));
r.get('/inventario/movimientos/sku', ah(async (req, res) => { res.json(await historiaSku(req.query)); }));
r.get('/inventario/dashboard/programacion', ah(async (req, res) => { res.json(await precisionProgramacion(req.query)); }));
// simulación por turno de un día: lo que la asignación diaria publicará como inventario de CE
r.get('/inventario/simulacion', ah(async (req, res) => { res.json(await simularDia(fecha(req.query.fecha, 'fecha'))); }));
// Calendario de planificación: ver la programación de CE y ajustarla en la web
r.get('/inventario/calendario', ah(async (req, res) => { res.json(await calendario(req.query)); }));
r.get('/inventario/calendario/grupo', ah(async (req, res) => { res.json(await ubicacionesGrupo(req.query)); }));
r.post('/inventario/reprogramar', ah(async (req, res) => { res.json(await reprogramar(req.body || {}, usuarioDe(req))); }));
r.post('/inventario/quitar', ah(async (req, res) => { res.json(await quitar(req.body || {}, usuarioDe(req))); }));
r.post('/inventario/restaurar', ah(async (req, res) => { res.json(await restaurar(req.body || {})); }));
r.put('/inventario/asignacion', ah(async (req, res) => { res.json(await asignar(req.body || {}, usuarioDe(req))); }));

export default r;
