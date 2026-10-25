// Configuración: metas por etapa y turno, calendario de turnos, causas y parámetros.
import { Router } from 'express';
import { q, tx } from '../db.js';
import { cat, invalidar } from '../lib/catalogos.js';
import { PARAMETROS } from '../seed.js';
import { ah, bad, texto, turno } from './util.js';

const r = Router();

r.get('/', ah(async (req, res) => {
  invalidar();
  const c = await cat();
  res.json({ turnos: c.turnos, calendario: c.calendario, etapas: c.etapas, metas: c.metas,
    causas: c.causas, parametros: c.p, parametrosBase: PARAMETROS });
}));

r.put('/metas', ah(async (req, res) => {
  const c = await cat();
  await tx(async cl => {
    for (const [area, porTurno] of Object.entries(req.body || {})) {
      if (!c.etapa[area]) throw bad(`Etapa desconocida: ${area}`);
      for (const [t, v] of Object.entries(porTurno)) {
        await turno(t);
        await cl.query(`INSERT INTO metas_etapa VALUES ($1,$2,$3) ON CONFLICT (area, turno_id) DO UPDATE SET unidades_hora = $3`,
          [area, t, Math.max(0, Math.round(+v || 0))]);
      }
    }
  });
  invalidar(); res.json({ ok: true });
}));

r.put('/etapas/:area', ah(async (req, res) => {
  const fases = ['Picking', 'Consolidación', 'Empaque', 'Despacho'];
  if (req.body.fase && !fases.includes(req.body.fase)) throw bad('Fase inválida.');
  const { rowCount } = await q(`UPDATE etapas SET nombre = COALESCE($2, nombre), fase = COALESCE($3, fase), orden = COALESCE($4, orden) WHERE area = $1`,
    [req.params.area, texto(req.body.nombre, 80), req.body.fase || null, req.body.orden == null ? null : +req.body.orden]);
  if (!rowCount) throw bad('Etapa no encontrada.', 404);
  invalidar(); res.json({ ok: true });
}));

// {dia_semana: {turno: true|false}}
r.put('/calendario', ah(async (req, res) => {
  await tx(async cl => {
    for (const [d, ts] of Object.entries(req.body || {})) {
      const dia = +d; if (!(dia >= 0 && dia <= 6)) throw bad('Día inválido.');
      for (const [t, activo] of Object.entries(ts)) {
        await turno(t);
        await cl.query(`INSERT INTO turno_calendario VALUES ($1,$2,$3) ON CONFLICT (dia_semana, turno_id) DO UPDATE SET activo = $3`, [dia, t, !!activo]);
      }
    }
  });
  invalidar(); res.json({ ok: true });
}));

r.post('/causas', ah(async (req, res) => {
  const nombre = texto(req.body.nombre, 120); if (!nombre) throw bad('Ingresa el nombre de la causa.');
  try { await q('INSERT INTO causas (nombre, orden) VALUES ($1, (SELECT COALESCE(MAX(orden),0)+1 FROM causas))', [nombre]); }
  catch (e) { if (e.code === '23505') throw bad('Esa causa ya existe.', 409); throw e; }
  invalidar(); res.status(201).json({ ok: true });
}));
r.patch('/causas/:id', ah(async (req, res) => {
  await q('UPDATE causas SET activo = COALESCE($2, activo), nombre = COALESCE($3, nombre) WHERE id = $1',
    [+req.params.id, req.body.activo == null ? null : !!req.body.activo, texto(req.body.nombre, 120)]);
  invalidar(); res.json({ ok: true });
}));

r.put('/parametros', ah(async (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!(k in PARAMETROS)) throw bad(`Parámetro desconocido: ${k}`);
    const n = Number(v); if (!Number.isFinite(n) || n < 0) throw bad(`Valor inválido para ${k}`);
    await q('INSERT INTO parametros VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor = $2', [k, JSON.stringify(n)]);
  }
  invalidar(); res.json({ ok: true });
}));

export default r;
