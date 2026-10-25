// Gestión Diaria CD: plan diario, asignación, tareas, conciliación con stock, cierre, slow moving, ABC/XYZ y optimización.
// Montado en /api/gestion. Las tablas están en el esquema "gestion" (ver src/gestion/db.js).
import { Router } from 'express';
import multer from 'multer';
import { q } from '../gestion/db.js';
import { leerParametros, guardarParametros, DEFAULTS } from '../gestion/services/parametros.js';
import { guardarCarga } from '../gestion/services/stock.js';
import { generarAsignacion } from '../gestion/services/asignacion.js';
import { listarTareas, actualizarTarea, cierreConStock, kpi, archivoTurno, archivoWms, importarAvances } from '../gestion/services/tareas.js';
import { opciones, simularSlow, generarColaSlow, colaSlow, vaciarColaSlow } from '../gestion/services/slow.js';
import { abcXyz, guardarAbcXyz, cargarHistoria, borrarHistoria } from '../gestion/services/abcXyz.js';
import { optimizacion, generarReasignacion, simularOsr, generarIngresoOsr } from '../gestion/services/optimizacion.js';
import { leerReservadas } from '../gestion/engine/base.js';
import { hoyIso, up } from '../gestion/engine/util.js';
import { usuarioDe } from './util.js';

const app = Router();
const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
const nombreArchivo = f => Buffer.from(f.originalname, 'latin1').toString('utf8');

const r = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.message, ...(e.conAvance ? { conAvance: e.conAvance } : {}) });
  }
};
const fechaDe = (req) => (req.query.fecha || req.body?.fecha || hoyIso()).slice(0, 10);
const enviarXlsx = (res, { buffer, nombre }) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(buffer);
};

// ---- estado general del día
app.get('/estado', r(async (req) => {
  const fecha = fechaDe(req);
  const { rows: cargas } = await q('SELECT id, fecha, tipo, turno, archivo, filas, avisos, columnas, creado_en FROM cargas WHERE fecha = $1 ORDER BY id DESC', [fecha]);
  const { rows: asig } = await q('SELECT id, fecha, carga_id, creado_en, segundos, resumen, log FROM asignaciones WHERE fecha = $1 ORDER BY id DESC LIMIT 1', [fecha]);
  const { rows: cnt } = await q("SELECT cd, proceso, count(*)::int AS n, sum(unid_asig)::float AS u FROM tareas WHERE fecha = $1 AND estado <> 'SIN DESTINO' GROUP BY cd, proceso ORDER BY cd", [fecha]);
  const { rows: cds } = await q('SELECT * FROM cd_config ORDER BY cd');
  const { rows: res } = await q('SELECT count(*)::int AS n FROM ubic_reservadas');
  const p = await leerParametros();
  return { fecha, cargas, asignacion: asig[0] || null, conteos: cnt, cds, reservadas: res[0].n, horarios: { 1: p.horarioT1, 2: p.horarioT2, 3: p.horarioT3 }, meta: p.meta };
}));

// ---- carga de la Base del inicio de la jornada
app.post('/cargas/inicio', subir.single('archivo'), r(async (req) => {
  if (!req.file) throw Object.assign(new Error('Adjunta el archivo de stock (.xlsx o .csv).'), { status: 400 });
  const fecha = fechaDe(req);
  const { carga, base } = await guardarCarga({ buffer: req.file.buffer, archivo: nombreArchivo(req.file), fecha, tipo: 'INICIO' });
  // los CD nuevos quedan configurados con valores por defecto (OSR inactivo)
  const p = await leerParametros();
  const nuevos = [];
  for (const cd of [...new Set(base.filas.map((f) => f.cd).filter(Boolean))].sort()) {
    const ins = await q('INSERT INTO cd_config (cd, activo) VALUES ($1,$2) ON CONFLICT (cd) DO NOTHING RETURNING cd', [cd, !p.excluidos.has(cd)]);
    if (ins.rowCount) nuevos.push(cd);
  }
  return { carga, avisos: base.avisos, columnas: base.columnas, cdsNuevos: nuevos };
}));

// ---- asignación diaria
app.post('/asignaciones', r(async (req) => generarAsignacion(fechaDe(req), { forzar: !!req.body?.forzar })));
app.get('/plan', r(async (req) => {
  const { rows } = await q('SELECT * FROM plan_lineas WHERE fecha = $1' + (req.query.cd ? ' AND cd = $2' : '') + ' ORDER BY cd, orden', req.query.cd ? [fechaDe(req), req.query.cd] : [fechaDe(req)]);
  return rows;
}));

// ---- tareas
app.get('/tareas', r(async (req) => listarTareas({ ...req.query, fecha: fechaDe(req) })));
app.patch('/tareas/:id', r(async (req) => actualizarTarea(Number(req.params.id), req.body, req.body.quien || usuarioDe(req) || 'Supervisor')));
app.get('/kpi', r(async (req) => kpi({ fecha: fechaDe(req), cd: req.query.cd, turno: req.query.turno })));

// ---- conciliación
app.post('/cargas/cierre', subir.single('archivo'), r(async (req) => {
  if (!req.file) throw Object.assign(new Error('Adjunta el archivo de stock del cierre.'), { status: 400 });
  return cierreConStock({ buffer: req.file.buffer, archivo: nombreArchivo(req.file), fecha: fechaDe(req), turno: req.body.turno ? Number(req.body.turno) : null });
}));
app.get('/conciliaciones', r(async (req) => (await q('SELECT c.*, k.archivo FROM conciliaciones c JOIN cargas k ON k.id = c.carga_id WHERE c.fecha = $1 ORDER BY c.id DESC', [fechaDe(req)])).rows));
app.post('/avances/importar', subir.single('archivo'), r(async (req) => {
  if (!req.file) throw Object.assign(new Error('Adjunta el archivo del turno.'), { status: 400 });
  return importarAvances(req.file.buffer);
}));

// ---- archivos
app.get('/archivos/turno', r(async (req, res) => enviarXlsx(res, await archivoTurno({ fecha: fechaDe(req), cd: req.query.cd, turno: Number(req.query.turno) }))));
app.get('/archivos/wms', r(async (req, res) => enviarXlsx(res, await archivoWms({ fecha: fechaDe(req) }))));

// ---- slow moving
app.get('/slow/opciones', r(() => opciones()));
app.post('/slow/simular', r((req) => simularSlow(req.body || {})));
app.post('/slow/generar', r((req) => generarColaSlow(req.body?.filtros || {}, req.body?.destino)));
app.get('/slow/cola', r(() => colaSlow()));
app.delete('/slow/cola', r((req) => vaciarColaSlow(req.query.cd, req.query.tipo === 'REU' ? 'REU' : 'SM')));

// ---- ABC / XYZ y optimización
app.get('/abcxyz', r((req) => abcXyz(req.query)));
app.post('/abcxyz/guardar', r((req) => guardarAbcXyz(req.body?.criterio, req.body?.metodo)));
app.post('/abcxyz/historia', subir.single('archivo'), r(async (req) => {
  if (!req.file) throw Object.assign(new Error('Adjunta el archivo de ventas mensuales.'), { status: 400 });
  return cargarHistoria(req.file.buffer, nombreArchivo(req.file));
}));
app.delete('/abcxyz/historia', r(() => borrarHistoria()));
app.get('/optimizacion', r(() => optimizacion()));
app.post('/optimizacion/osr/simular', r((req) => simularOsr(req.body || {})));
app.post('/optimizacion/osr/generar', r((req) => generarIngresoOsr(req.body || {})));
app.post('/optimizacion/reasignar', r((req) => generarReasignacion(req.body?.tipo === 'traer' ? 'traer' : 'liberar', req.body?.limite)));

// ---- configuración
app.get('/config/cds', r(async () => (await q('SELECT * FROM cd_config ORDER BY cd')).rows));
app.put('/config/cds/:cd', r(async (req) => {
  const b = req.body;
  const { rows } = await q(`INSERT INTO cd_config (cd, activo, rec_inv, op_cons, sup_t1, sup_t2, sup_t3, stock_unitario, turno_su, op_su, prefijo, turno_sm)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (cd) DO UPDATE SET activo=$2, rec_inv=$3, op_cons=$4, sup_t1=$5, sup_t2=$6, sup_t3=$7,
    stock_unitario=$8, turno_su=$9, op_su=$10, prefijo=$11, turno_sm=$12 RETURNING *`,
  [up(req.params.cd), !!b.activo, Number(b.rec_inv) || 1, Number(b.op_cons) || 1, b.sup_t1 || '', b.sup_t2 || '', b.sup_t3 || '', !!b.stock_unitario,
    Number(b.turno_su) || 1, Math.min(2, Number(b.op_su) || 2), b.prefijo || 'OP', Number(b.turno_sm) || 1]);
  return rows[0];
}));
app.get('/config/parametros', r(async () => ({ valores: await leerParametros(), definiciones: DEFAULTS })));
app.put('/config/parametros', r(async (req) => guardarParametros(req.body || {})));
app.get('/config/reservadas', r(async () => (await q('SELECT * FROM ubic_reservadas ORDER BY grupo, ubicacion')).rows));
app.post('/config/reservadas', subir.single('archivo'), r(async (req) => {
  if (!req.file) throw Object.assign(new Error('Adjunta el archivo con las ubicaciones reservadas.'), { status: 400 });
  const lista = leerReservadas(req.file.buffer);
  if (!lista.length) throw Object.assign(new Error('No encontré ubicaciones en la columna A.'), { status: 400 });
  await q('DELETE FROM ubic_reservadas');
  for (const x of lista) await q('INSERT INTO ubic_reservadas (ubicacion, grupo, max) VALUES ($1,$2,$3)', [x.ubicacion, x.grupo, x.max]);
  return { cargadas: lista.length };
}));
app.get('/config/ciclo', r(async () => (await q('SELECT cd, count(*)::int AS zonas, max(fecha) AS ultima FROM avance_inventario GROUP BY cd ORDER BY cd')).rows));
app.delete('/config/ciclo/:cd', r(async (req) => ({ eliminadas: (await q('DELETE FROM avance_inventario WHERE cd = $1', [req.params.cd])).rowCount })));

export default app;
