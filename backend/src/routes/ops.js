// Centro de control: foto en vivo, control por hora, cierres y cargas de extracciones.
import { Router } from 'express';
import multer from 'multer';
import { q } from '../db.js';
import { cat } from '../lib/catalogos.js';
import { fechaOperativa, turnoActual, ultimoTurno, turnosRecientes, turnosDelDia, instancia } from '../lib/turnos.js';
import { snapshot } from '../services/snapshot.js';
import { controlPorHora, porOperacion } from '../services/control.js';
import * as cierre from '../services/cierre.js';
import { filasAsistencia, CATEGORIAS } from '../services/continuidad.js';
import { importarPedidos } from '../import/pedidos.js';
import { importarRecepcion } from '../import/recepcion.js';
import { importarAlmacenamiento } from '../import/almacenamiento.js';
import { importarOlas } from '../import/olas.js';
import { plantilla } from '../import/plantillas.js';
import { ah, bad, fecha, turno, texto, usuarioDe } from './util.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

// Catálogos y contexto de turnos para el frontend
r.get('/meta', ah(async (req, res) => {
  const c = await cat(), ahora = Date.now();
  const recientes = turnosRecientes(ahora, c, 9).map(i => ({ fecha: i.fecha, turno: i.turno, start: i.start, end: i.end }));
  const act = turnoActual(ahora, c), ult = ultimoTurno(ahora, c);
  res.json({
    ahora, fechaOperativa: fechaOperativa(ahora, c),
    turnoActual: act && { fecha: act.fecha, turno: act.turno, start: act.start, end: act.end },
    ultimoTurno: ult && { fecha: ult.fecha, turno: ult.turno, start: ult.start, end: ult.end },
    recientes, turnos: c.turnos, calendario: c.calendario, etapas: c.etapas, metas: c.metas,
    causas: c.causas.filter(x => x.activo), parametros: c.p, filasAsistencia: filasAsistencia(), categorias: CATEGORIAS
  });
}));

r.get('/ops/snapshot', ah(async (req, res) => { res.set('Cache-Control', 'no-store').json(await snapshot()); }));

r.get('/control', ah(async (req, res) => {
  const f = fecha(req.query.fecha), t = await turno(req.query.turno, { dia: true });
  res.json(await controlPorHora(f, t));
}));
r.get('/control/operaciones', ah(async (req, res) => {
  const f = fecha(req.query.fecha), t = await turno(req.query.turno, { dia: true });
  const area = texto(req.query.area, 80); if (!area) throw bad('Falta area');
  res.json(await porOperacion(f, t, area, req.query.hora ? Number(req.query.hora) : null));
}));

// Turnos de un día con su programación (para selectores de fecha)
r.get('/turnos/dia', ah(async (req, res) => {
  const c = await cat(), f = fecha(req.query.fecha);
  res.json(turnosDelDia(f, c).map(t => { const i = instancia(f, t, c); return { fecha: f, turno: t, start: i.start, end: i.end }; }));
}));

// ---------- Cierre de turno ----------
r.get('/cierres', ah(async (req, res) => { res.json(await cierre.comparativoDia(fecha(req.query.fecha))); }));
r.get('/cierres/recientes', ah(async (req, res) => { res.json(await cierre.recientes(Math.min(21, +req.query.n || 7))); }));
r.get('/cierres/:fecha/:turno', ah(async (req, res) => {
  res.json(await cierre.informe(fecha(req.params.fecha), await turno(req.params.turno)));
}));
r.put('/cierres/:fecha/:turno/causas', ah(async (req, res) => {
  const f = fecha(req.params.fecha), t = await turno(req.params.turno);
  if (!Array.isArray(req.body)) throw bad('Se espera una lista de causas.');
  await cierre.guardarCausas(f, t, req.body.map(d => ({ area: texto(d.area, 80), hora: d.hora, causa_id: d.causa_id ? +d.causa_id : null,
    minutos: d.minutos, comentario: texto(d.comentario, 500), brecha: d.brecha })));
  res.json(await cierre.informe(f, t));
}));
r.put('/cierres/:fecha/:turno/jefe', ah(async (req, res) => {
  const f = fecha(req.params.fecha), t = await turno(req.params.turno);
  await cierre.guardarJefe(f, t, texto(req.body.jefe, 120));
  res.json(await cierre.informe(f, t));
}));
r.post('/cierres/:fecha/:turno/cerrar', ah(async (req, res) => {
  res.json(await cierre.cerrar(fecha(req.params.fecha), await turno(req.params.turno), { usuario: usuarioDe(req) }));
}));
r.post('/cierres/:fecha/:turno/reabrir', ah(async (req, res) => {
  res.json(await cierre.reabrir(fecha(req.params.fecha), await turno(req.params.turno)));
}));
// Pareto histórico de causas (para análisis por turno y jefe)
r.get('/cierres/pareto', ah(async (req, res) => {
  const desde = fecha(req.query.desde, 'desde'), hasta = fecha(req.query.hasta, 'hasta');
  const { rows } = await q(`SELECT d.turno_id AS turno, COALESCE(c.nombre, 'Sin causa') AS causa, COALESCE(ct.jefe, '') AS jefe,
      SUM(d.brecha) AS brecha, SUM(d.minutos) AS minutos, COUNT(*) AS desvios
    FROM desvio_causas d LEFT JOIN causas c ON c.id = d.causa_id
    LEFT JOIN cierres_turno ct ON ct.fecha = d.fecha AND ct.turno_id = d.turno_id
    WHERE d.fecha BETWEEN $1 AND $2 GROUP BY 1, 2, 3 ORDER BY 4 DESC`, [desde, hasta]);
  res.json(rows);
}));

// ---------- Cargas de extracciones ----------
const IMPORT = { pedidos: importarPedidos, recepcion: importarRecepcion, almacenamiento: importarAlmacenamiento, olas: importarOlas };
r.get('/cargas', ah(async (req, res) => {
  const { rows } = await q('SELECT * FROM cargas ORDER BY id DESC LIMIT 60');
  res.json(rows);
}));
r.get('/cargas/plantilla/:tipo', ah(async (req, res) => {
  const buf = await plantilla(req.params.tipo);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .set('Content-Disposition', `attachment; filename="plantilla-${req.params.tipo}.xlsx"`).send(Buffer.from(buf));
}));
r.post('/cargas/:tipo', upload.single('archivo'), ah(async (req, res) => {
  const fn = IMPORT[req.params.tipo];
  if (!fn) throw bad('Tipo de carga desconocido.', 404);
  if (!req.file) throw bad('Adjunta el archivo en el campo "archivo".');
  const nombre = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  res.status(201).json(await fn(req.file.buffer, nombre, { usuario: usuarioDe(req) }));
}));
r.delete('/cargas/:id', ah(async (req, res) => {
  const carga = (await q('SELECT * FROM cargas WHERE id = $1', [+req.params.id])).rows[0];
  if (!carga) throw bad('Carga no encontrada.', 404);
  if (carga.tipo === 'pedidos') {
    const ult = (await q(`SELECT id FROM cargas WHERE tipo = 'pedidos' ORDER BY corte DESC LIMIT 1`)).rows[0];
    if (ult.id !== carga.id) throw bad('Solo se puede eliminar la última extracción de pedidos: las siguientes se calcularon comparando contra esta.', 409);
  }
  await q('DELETE FROM cargas WHERE id = $1', [carga.id]);
  res.json({ ok: true });
}));

export default r;
