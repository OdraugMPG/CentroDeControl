// Informe de cierre de turno: une la producción por hora (WMS) con los compromisos,
// la dotación y la entrega de turno (Continuidad Operacional).
import { q, tx } from '../db.js';
import { cat } from '../lib/catalogos.js';
import { instancia, turnosRecientes, turnosDelDia, H } from '../lib/turnos.js';
import { controlPorHora, referencia } from './control.js';
import { estadoTarea, dotacionTurno } from './continuidad.js';

const hh = t => String(new Date(t).getHours()).padStart(2, '0') + ':00';
const pctf = v => Math.round(v * 100) + '%';
const n0 = v => Math.round(v).toLocaleString('es-CL');

export async function informe(fecha, turno, refInfo) {
  const c = await cat();
  const inst = instancia(fecha, turno, c);
  const R = refInfo || await referencia();
  const ahora = R.ahora;
  const [ctrl, tareasR, hoR, cierreR, causasR, dot, jefeR] = await Promise.all([
    controlPorHora(fecha, turno, R),
    q(`SELECT t.*, p.nombre AS asignado_nombre, o.fecha AS origen_fecha, o.turno_id AS origen_turno
       FROM tareas t LEFT JOIN personas p ON p.id = t.asignado_a LEFT JOIN tareas o ON o.id = t.heredada_de
       WHERE t.fecha = $1 AND t.turno_id = $2 ORDER BY t.categoria, t.id`, [fecha, turno]),
    q('SELECT * FROM handovers WHERE fecha = $1 AND turno_id = $2 ORDER BY entregado_en DESC LIMIT 1', [fecha, turno]),
    q('SELECT * FROM cierres_turno WHERE fecha = $1 AND turno_id = $2', [fecha, turno]),
    q('SELECT d.*, c.nombre AS causa FROM desvio_causas d LEFT JOIN causas c ON c.id = d.causa_id WHERE d.fecha = $1 AND d.turno_id = $2', [fecha, turno]),
    dotacionTurno(fecha, turno),
    q(`SELECT nombre FROM personas WHERE rol = 'Jefe de Turno' AND turno_id = $1 AND activo LIMIT 1`, [turno])
  ]);
  const cierre = cierreR.rows[0] || null;
  const handover = hoR.rows[0] || null;
  const tareas = tareasR.rows.map(t => ({ ...t, st: estadoTarea(t, c, ahora) }));
  const tareasOk = tareas.filter(t => t.st === 'cerrada').length;
  const causas = Object.fromEntries(causasR.rows.map(r => [`${r.area}|${new Date(r.hora).getTime()}`, r]));

  const devs = [];
  ctrl.rows.forEach(r => r.cells.forEach(x => {
    if (x.estado === 'done' && x.meta > 0 && x.pct !== null && x.pct < ctrl.umbral) {
      const k = `${r.area}|${x.t}`, cz = causas[k];
      devs.push({ key: k, area: r.area, nombre: r.nombre, t: x.t, u: x.u, meta: x.meta, pct: x.pct, brecha: Math.round(x.meta - x.u),
        causa_id: cz?.causa_id || null, causa: cz?.causa || null, minutos: cz?.minutos ?? null, comentario: cz?.comentario || '' });
    }
  }));
  const sinCausa = devs.filter(d => !d.causa_id);
  const pareto = Object.entries(devs.reduce((m, d) => { const k = d.causa || 'Sin causa registrada'; m[k] = (m[k] || 0) + d.brecha; return m; }, {}))
    .map(([causa, brecha]) => ({ causa, brecha }))
    .sort((a, b) => (a.causa === 'Sin causa registrada') - (b.causa === 'Sin causa registrada') || b.brecha - a.brecha);
  const minutos = devs.reduce((s, d) => s + (d.minutos || 0), 0);

  const estado = !inst.programado ? 'No programado' : cierre?.cerrado_en ? 'Cerrado'
    : ahora < inst.start ? 'Por comenzar' : ahora < inst.end ? 'En curso' : 'Por cerrar';
  const jefe = cierre?.jefe || handover?.jefe || jefeR.rows[0]?.nombre || '';

  // ---------- Evidencia automática ----------
  const ev = [];
  const porHora = inst.horas.filter(h => h < ctrl.cur).map(h => {
    const u = ctrl.rows.reduce((s, r) => s + r.cells.find(x => x.t === h).u, 0);
    const m = ctrl.rows.reduce((s, r) => s + r.cells.find(x => x.t === h).meta, 0);
    return { h, pct: m ? u / m : 1 };
  });
  if (porHora.length) {
    const w = porHora.slice().sort((a, b) => a.pct - b.pct)[0];
    ev.push({ warn: w.pct < ctrl.umbral, titulo: 'Hora más baja', texto: `${hh(w.h)} a ${hh(w.h + H)}, con ${pctf(w.pct)} de la meta en todas las etapas.` });
  }
  const gap = ctrl.rows.map(r => ({ r, b: r.mAc - r.u })).sort((a, b) => b.b - a.b)[0];
  if (gap && gap.b > 0) ev.push({ warn: true, titulo: 'Mayor brecha', texto: `${gap.r.nombre}, faltaron ${n0(gap.b)} unidades.` });
  if (dot.registro) ev.push({ warn: dot.pct < 0.9, titulo: 'Dotación', texto: `${dot.presentes} de ${dot.requerida} personas requeridas (${pctf(dot.pct)}).` });
  else if (ahora >= inst.start) ev.push({ warn: true, titulo: 'Dotación', texto: 'El jefe de turno no confirmó la asistencia.' });
  const prod = await q(`SELECT
      SUM(qty) FILTER (WHERE fecha_hora >= $1 AND fecha_hora < $2)::float /
        NULLIF(COUNT(DISTINCT (date_trunc('hour', fecha_hora), usuario)) FILTER (WHERE fecha_hora >= $1 AND fecha_hora < $2 AND usuario IS NOT NULL), 0) AS actual,
      SUM(qty) FILTER (WHERE fecha_hora >= $3 AND fecha_hora < $1)::float /
        NULLIF(COUNT(DISTINCT (date_trunc('hour', fecha_hora), usuario)) FILTER (WHERE fecha_hora >= $3 AND fecha_hora < $1 AND usuario IS NOT NULL), 0) AS previa
    FROM movimientos_etapa WHERE fecha_hora >= $3 AND fecha_hora < $2`,
    [new Date(inst.start), new Date(Math.min(inst.end, R.ref)), new Date(inst.start - 7 * 24 * H)]);
  const { actual, previa } = prod.rows[0];
  if (actual && previa) ev.push({ warn: actual < previa * 0.92, titulo: 'Productividad',
    texto: `${n0(actual)} unidades por persona-hora, contra ${n0(previa)} de promedio en los 7 días anteriores.` });
  const tras = tareas.filter(t => t.st === 'traspasada' || t.st === 'vencida').length;
  if (tras) ev.push({ warn: true, titulo: 'Compromisos', texto: `${tras} ${tras === 1 ? 'tarea quedó' : 'tareas quedaron'} sin cerrar en el turno.` });
  const patio = await q(`SELECT COUNT(*) AS n FROM recepcion_citas WHERE llegada >= $1 AND llegada < $2 AND inicio IS NOT NULL
      AND inicio - llegada > make_interval(mins => $3)`, [new Date(inst.start), new Date(inst.end), c.p.minPatio ?? 45]);
  if (patio.rows[0].n) ev.push({ warn: true, titulo: 'Recepción', texto: `${patio.rows[0].n} camiones esperaron más de ${c.p.minPatio ?? 45} minutos en patio.` });
  if (devs.length && !sinCausa.length && pareto[0]) {
    const tot = pareto.reduce((s, p) => s + p.brecha, 0);
    ev.push({ warn: false, titulo: 'Causa principal registrada', texto: `${pareto[0].causa}, ${pctf(pareto[0].brecha / Math.max(1, tot))} de la brecha.` });
  }

  return {
    inst, estado, jefe, cierre, handover, tareas, tareasOk, dotacion: dot,
    control: { rows: ctrl.rows, u: ctrl.u, mAc: ctrl.mAc, pct: ctrl.pct, cur: ctrl.cur, transcurridas: ctrl.transcurridas, umbral: ctrl.umbral, ref: ctrl.ref, corte: ctrl.corte },
    devs, sinCausa: sinCausa.length, pareto, minutos, evidencia: ev,
    cerrable: inst.programado && ahora >= inst.end - (c.p.minAntesCierre ?? 30) * 60000
  };
}

// Resumen liviano para listas y comparativos
export async function resumen(fecha, turno, R) {
  const i = await informe(fecha, turno, R);
  const principal = i.pareto.find(p => p.causa !== 'Sin causa registrada');
  return { fecha, turno, inicio: i.inst.start, fin: i.inst.end, estado: i.estado, jefe: i.jefe, pct: i.control.pct,
    unidades: i.control.u, meta: i.control.mAc, tareas: i.tareas.length, tareasOk: i.tareasOk,
    dotacionPct: i.dotacion.pct, desvios: i.devs.length, sinCausa: i.sinCausa, causaPrincipal: principal?.causa || null };
}

export async function comparativoDia(fecha) {
  const c = await cat(), R = await referencia();
  return Promise.all(turnosDelDia(fecha, c).map(t => {
    const i = instancia(fecha, t, c);
    return i.start > R.ahora ? { fecha, turno: t, estado: 'Por comenzar', inicio: i.start, fin: i.end } : resumen(fecha, t, R);
  }));
}

export async function recientes(n = 7) {
  const c = await cat(), R = await referencia();
  return Promise.all(turnosRecientes(R.ahora, c, n).map(i => resumen(i.fecha, i.turno, R)));
}

export async function guardarCausas(fecha, turno, lista) {
  const cz = (await q('SELECT cerrado_en FROM cierres_turno WHERE fecha = $1 AND turno_id = $2', [fecha, turno])).rows[0];
  if (cz?.cerrado_en) throw Object.assign(new Error('El turno está cerrado. Reábrelo para modificar causas.'), { status: 409 });
  await tx(async cl => {
    for (const d of lista) {
      const hora = new Date(+d.hora);
      if (!d.causa_id && !d.minutos && !d.comentario) {
        await cl.query('DELETE FROM desvio_causas WHERE fecha=$1 AND turno_id=$2 AND area=$3 AND hora=$4', [fecha, turno, d.area, hora]);
        continue;
      }
      await cl.query(`INSERT INTO desvio_causas (fecha, turno_id, area, hora, causa_id, minutos, comentario, brecha)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (fecha, turno_id, area, hora) DO UPDATE SET causa_id=$5, minutos=$6, comentario=$7, brecha=$8, registrado_en=now()`,
        [fecha, turno, d.area, hora, d.causa_id || null, d.minutos === '' || d.minutos == null ? null : Math.max(0, Math.min(60, +d.minutos)),
          d.comentario || null, d.brecha ?? null]);
    }
  });
}

export async function guardarJefe(fecha, turno, jefe) {
  await q(`INSERT INTO cierres_turno (fecha, turno_id, jefe) VALUES ($1,$2,$3)
    ON CONFLICT (fecha, turno_id) DO UPDATE SET jefe = $3 WHERE cierres_turno.cerrado_en IS NULL`, [fecha, turno, jefe || null]);
}

export async function cerrar(fecha, turno, { usuario } = {}) {
  const i = await informe(fecha, turno);
  const err = m => Object.assign(new Error(m), { status: 422 });
  if (i.cierre?.cerrado_en) throw err('El turno ya está cerrado.');
  if (!i.inst.programado) throw err('Ese turno no está programado en el calendario.');
  if (!i.cerrable) throw err(`El turno termina a las ${hh(i.inst.end)}; se puede cerrar desde ${(await cat()).p.minAntesCierre ?? 30} minutos antes.`);
  if (!i.jefe) throw err('Falta indicar el jefe de turno.');
  if (i.sinCausa) throw err(`Faltan ${i.sinCausa} causas por registrar en Desvíos y causas.`);
  const resumenJ = { pct: i.control.pct, unidades: i.control.u, meta: i.control.mAc, tareas: i.tareas.length, tareasOk: i.tareasOk,
    dotacion: { requerida: i.dotacion.requerida, presentes: i.dotacion.presentes }, desvios: i.devs.length, minutos: i.minutos,
    pareto: i.pareto, etapas: i.control.rows.map(r => ({ area: r.area, u: r.u, meta: r.mAc, pct: r.pct })) };
  await q(`INSERT INTO cierres_turno (fecha, turno_id, jefe, resumen, cerrado_en, cerrado_por) VALUES ($1,$2,$3,$4,now(),$5)
    ON CONFLICT (fecha, turno_id) DO UPDATE SET jefe=$3, resumen=$4, cerrado_en=now(), cerrado_por=$5`,
    [fecha, turno, i.jefe, resumenJ, usuario || i.jefe]);
  return informe(fecha, turno);
}

export async function reabrir(fecha, turno) {
  await q('UPDATE cierres_turno SET cerrado_en = NULL, cerrado_por = NULL WHERE fecha = $1 AND turno_id = $2', [fecha, turno]);
  return informe(fecha, turno);
}

// Turnos terminados en las últimas 24 horas que siguen sin cerrar
export async function pendientesDeCierre() {
  const c = await cat(), R = await referencia();
  const lista = turnosRecientes(R.ahora, c, 4).filter(i => R.ahora >= i.end && R.ahora - i.end < 24 * H);
  const out = [];
  for (const i of lista) {
    const r = await resumen(i.fecha, i.turno, R);
    if (r.estado !== 'Cerrado') out.push(r);
  }
  return out;
}
