// Reglas de Continuidad Operacional: estado de tareas, traspaso automático e indicadores.
import { q, tx } from '../db.js';
import { cat } from '../lib/catalogos.js';
import { instancia, siguienteTurno, fechaOperativa, addDias } from '../lib/turnos.js';

export const CARGOS_ASISTENCIA = [
  { cargo: 'Jefe de Operaciones', areas: null },
  { cargo: 'Jefe de Turno', areas: null },
  { cargo: 'Supervisor', areas: ['OSR-Empaque', 'OSR-Putwall', 'SH1', 'SH2', 'SH3'] },
  { cargo: 'Administrativo', areas: ['OSR-Empaque', 'OSR-Putwall', 'SH1', 'SH2'] },
  { cargo: 'Operario Multifuncional', areas: ['OSR-Empaque', 'OSR-Putwall', 'SH1', 'SH2', 'SH3'] }
];
export const filasAsistencia = () => CARGOS_ASISTENCIA.flatMap(c => c.areas
  ? c.areas.map(a => ({ fila: `${c.cargo}::${a}`, cargo: c.cargo, funcion: a }))
  : [{ fila: c.cargo, cargo: c.cargo, funcion: null }]);

export const CATEGORIAS = {
  'Inventario': '#5b8def', 'Stock Unitario': '#b98af0', 'Consolidación': '#38c9c9', 'Recall': '#e0729c',
  'Extracción Tote Vacíos': '#6fa8dc', 'Almacenamiento': '#c9a15a', 'Control PKT': '#7c93c9',
  'Flujo de Traspaso': '#4fb0c6', 'Flujo Click y DD': '#d98e5b', 'Otros Compromisos': '#9aa1ad', 'Otra': '#9aa1ad'
};

// Estado visible de una tarea
export function estadoTarea(t, c, ahora = Date.now()) {
  if (t.estado !== 'abierta') return t.estado;
  if (t.plazo && new Date(t.plazo).getTime() < ahora) return 'vencida';
  const i = instancia(t.fecha, t.turno_id, c);
  return ahora >= i.end ? 'vencida' : 'abierta';
}

async function jefeDeTurno(turno, client) {
  const r = await client.query(`SELECT id FROM personas WHERE rol = 'Jefe de Turno' AND turno_id = $1 AND activo LIMIT 1`, [turno]);
  return r.rows[0]?.id || null;
}

async function traspasar(t, client, c) {
  const sig = siguienteTurno(t.fecha, t.turno_id, c);
  if (!sig) return null;
  await client.query(`UPDATE tareas SET estado = 'traspasada' WHERE id = $1`, [t.id]);
  const jefe = await jefeDeTurno(sig.turno, client);
  const { rows: [n] } = await client.query(`INSERT INTO tareas (titulo, categoria, responsable, fecha, turno_id, cd, estado, origen,
      asignado_por, asignado_a, prioridad, heredada_de, veces_transferida, plazo)
    VALUES ($1,$2,$3,$4,$5,$6,'abierta',$7,$8,$9,'alta',$10,$11,NULL) RETURNING *`,
    [t.titulo, t.categoria, t.responsable, sig.fecha, sig.turno, t.cd, t.origen, t.asignado_por, jefe, t.id, t.veces_transferida + 1]);
  return n;
}

// Traspasa al turno siguiente las tareas abiertas cuando:
//  (a) el turno entregó y el siguiente confirmó la recepción, o
//  (b) el turno siguiente también terminó (nadie confirmó la entrega).
export async function autoTraspaso() {
  const c = await cat();
  const ahora = Date.now();
  return tx(async client => {
    let total = 0;
    for (let vuelta = 0; vuelta < 40; vuelta++) {
      const { rows } = await client.query(`SELECT t.*, EXISTS (SELECT 1 FROM handovers h WHERE h.fecha = t.fecha AND h.turno_id = t.turno_id
          AND h.estado = 'confirmado') AS confirmado
        FROM tareas t WHERE t.estado = 'abierta' AND t.fecha <= $1`, [fechaOperativa(ahora, c)]);
      let movidas = 0;
      for (const t of rows) {
        const sig = siguienteTurno(t.fecha, t.turno_id, c);
        if (!sig) continue;
        if ((t.confirmado && ahora >= sig.start) || ahora >= sig.end) { await traspasar(t, client, c); movidas++; }
      }
      total += movidas;
      if (!movidas) break;
    }
    return total;
  });
}

export async function indicadores(dias = 30) {
  const c = await cat();
  const ahora = Date.now();
  const desde = addDias(fechaOperativa(ahora, c), -dias);
  const [hos, tareas, personas] = await Promise.all([
    q('SELECT * FROM handovers WHERE fecha >= $1', [desde]),
    q('SELECT * FROM tareas WHERE fecha >= $1', [desde]),
    q('SELECT * FROM personas WHERE activo ORDER BY rol, nombre')
  ]);
  const H = hos.rows, T = tareas.rows.map(t => ({ ...t, st: estadoTarea(t, c, ahora) }));
  const conf = H.filter(h => h.estado === 'confirmado');
  const mins = h => (new Date(h.confirmado_en) - new Date(h.entregado_en)) / 60000;
  const aTiempo = conf.filter(h => mins(h) <= (c.p.minConfirmacion ?? 30));
  const pct = (a, b) => b ? Math.round(a / b * 100) : null;
  // Para cumplimiento solo cuentan tareas de turnos ya terminados
  const terminadas = T.filter(t => ahora >= instancia(t.fecha, t.turno_id, c).end);
  const cumplidas = terminadas.filter(t => t.st === 'cerrada').length;
  const resumenDe = arr => {
    const fin = arr.filter(t => ahora >= instancia(t.fecha, t.turno_id, c).end);
    return { total: arr.length, cerradas: arr.filter(t => t.st === 'cerrada').length,
      traspasadas: arr.filter(t => t.st === 'traspasada').length, vencidas: arr.filter(t => t.st === 'vencida').length,
      pct: pct(fin.filter(t => t.st === 'cerrada').length, fin.length) };
  };
  const pctConf = pct(conf.length, H.length), pctAT = pct(aTiempo.length, conf.length), pctT = pct(cumplidas, terminadas.length);
  const indice = H.length ? Math.round(0.5 * (pctConf ?? 0) + 0.3 * (pctAT ?? 0) + 0.2 * (pctT ?? 100)) : null;
  return {
    dias, entregas: H.length, pctConfirmadas: pctConf, pctATiempo: pctAT,
    minPromedio: conf.length ? Math.round(conf.reduce((s, h) => s + mins(h), 0) / conf.length) : null,
    tareas: T.length, pctTareas: pctT, traspasadas: T.filter(t => t.st === 'traspasada').length,
    vencidas: T.filter(t => t.st === 'vencida').length, reincidentes: T.filter(t => t.veces_transferida >= 2).length, indice,
    porTurno: c.turnos.map(tu => ({ turno: tu.id, ...resumenDe(T.filter(t => t.turno_id === tu.id)) })),
    porPersona: personas.rows.filter(p => p.rol !== 'Jefe de Operaciones')
      .map(p => ({ id: p.id, nombre: p.nombre, rol: p.rol, turno: p.turno_id, ...resumenDe(T.filter(t => t.asignado_a === p.id)) }))
      .filter(p => p.total),
    porCategoria: Object.entries(T.reduce((m, t) => { (m[t.categoria] = m[t.categoria] || []).push(t); return m; }, {}))
      .map(([categoria, arr]) => ({ categoria, ...resumenDe(arr) })).sort((a, b) => b.total - a.total)
  };
}

// Dotación requerida y presente de un turno
export async function dotacionTurno(fecha, turno) {
  const [req, as] = await Promise.all([
    q('SELECT fila, cantidad FROM dotacion_requerida WHERE turno_id = $1', [turno]),
    q('SELECT * FROM asistencia WHERE fecha = $1 AND turno_id = $2', [fecha, turno])
  ]);
  const r = Object.fromEntries(req.rows.map(x => [x.fila, x.cantidad]));
  const reg = as.rows[0] || null;
  const requerida = Object.values(r).reduce((s, v) => s + v, 0);
  const presentes = reg ? Object.values(reg.valores).reduce((s, v) => s + (+v || 0), 0) : null;
  return { requerida, presentes, registro: reg, pct: reg && requerida ? Math.min(1, presentes / requerida) : null };
}
