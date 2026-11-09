// Personal por turno (Administración, Configuración): empresas externas, supervisores Paris, jefes de turno y supervisores
// de empresas externas, con rotación semanal de turno por grupo.
// Los supervisores Paris rotan con la regla de su grupo; los jefes de turno y supervisores de empresa externa, con la de su
// empresa (turnos que opera, cuáles rotan y cada cuántas semanas). Quien está en un turno fuera del ciclo queda fijo.
// El turno de cada persona se calcula desde su turno base (el de la semana de inicio) avanzando una posición del ciclo
// cada N semanas, con el cambio los lunes. aplicarRotacion() lo deja en personas.turno_id (lo que leen Continuidad e
// Inventario) y completa los supervisores por turno de cada CD en Gestión diaria.
import { q, tx } from '../db.js';
import { q as qg } from '../gestion/db.js';
import { cat } from '../lib/catalogos.js';
import { addDias, fechaOperativa } from '../lib/turnos.js';

export const GRUPOS = { SUP_PARIS: 'Supervisores Paris', JEFE_EMPRESA: 'Jefes de turno de empresa externa', SUP_EMPRESA: 'Supervisores de empresa externa' };
export const ROL_GRUPO = { Supervisor: 'SUP_PARIS', 'Jefe de Turno Empresa': 'JEFE_EMPRESA', 'Supervisor Empresa': 'SUP_EMPRESA' };
const ROLES = Object.keys(ROL_GRUPO);
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const txt = (v, n = 120) => String(v ?? '').trim().slice(0, n);

const lunes = (iso) => { const d = new Date(`${iso}T12:00:00`).getDay(); return addDias(iso, -((d + 6) % 7)); };
const semanasEntre = (a, b) => Math.round((new Date(`${lunes(b)}T12:00:00`) - new Date(`${lunes(a)}T12:00:00`)) / (7 * 86400000));
const mod = (a, n) => ((a % n) + n) % n;
// posiciones que avanza el ciclo en la semana de "fecha" respecto de la semana de inicio
const pasos = (rot, fecha) => Math.floor(semanasEntre(rot.inicio, fecha) / rot.semanas);
const hoy = async () => fechaOperativa(Date.now(), await cat());

// Rotación "noche mensual": cada equipo hace N semanas de noche, sale a PM y alterna AM / PM hasta volver a la noche
// (entra a la noche desde PM). Patrón de 3N semanas: noche x N, PM AM PM AM…, y el mismo bloque invertido (AM PM AM PM…),
// con los 3 equipos desfasados N semanas: cada semana hay un equipo en cada turno. T = turnos por orden (AM, PM, Noche).
function patronNoche(rot) {
  const [am, pm, noche] = rot.T, n = rot.noche_semanas || 4;
  const alt = (a, b) => Array.from({ length: n }, (_, i) => (i % 2 ? b : a));
  const bloque = alt(pm, am);
  return [...Array(n).fill(noche), ...bloque, ...bloque.map((t) => (t === am ? pm : am))];
}
const esNoche = (rot) => rot?.activo && rot.tipo === 'noche_mensual';
export function turnoEquipo(rot, equipo, fecha) {
  const pat = patronNoche(rot), n = rot.noche_semanas || 4;
  return pat[mod(semanasEntre(rot.inicio, fecha) + (equipo - 1) * n, pat.length)];
}
// equipo (1, 2 o 3) que tiene "turno" en la semana de "fecha"
const equipoDe = (turno, rot, fecha) => [1, 2, 3].find((e) => turnoEquipo(rot, e, fecha) === turno) || null;

/** Turno de una persona en la semana de "fecha" */
export function turnoEn(p, rot, fecha) {
  if (p.rota && esNoche(rot) && p.equipo) return turnoEquipo(rot, p.equipo, fecha);
  if (!p.turno_base || !p.rota || !rot?.activo || rot.tipo === 'noche_mensual') return p.turno_base || p.turno_id || null;
  const i = rot.ciclo.indexOf(p.turno_base);
  return i < 0 ? p.turno_base : rot.ciclo[mod(i + pasos(rot, fecha), rot.ciclo.length)];
}
// Turno base para que en la semana de "fecha" le toque "turno"
function baseDe(turno, rota, rot, fecha) {
  if (!turno || !rota || !rot?.activo) return turno || null;
  const i = rot.ciclo.indexOf(turno);
  return i < 0 ? turno : rot.ciclo[mod(i - pasos(rot, fecha), rot.ciclo.length)];
}

const leerRotacion = async () => {
  const T = (await q('SELECT id FROM turnos ORDER BY orden')).rows.map((x) => x.id);
  return {
    ...Object.fromEntries((await q('SELECT grupo, activo, tipo, noche_semanas, ciclo, semanas, inicio::text FROM rotacion')).rows.map((r) => [r.grupo, { ...r, T }])),
    emp: Object.fromEntries((await q('SELECT empresa_id, turnos, activo, tipo, noche_semanas, ciclo, semanas, inicio::text FROM rotacion_empresa')).rows.map((r) => [r.empresa_id, { ...r, T }]))
  };
};
// turno base y equipo para que en la semana de "fecha" a la persona le toque "turno"
const ubicar = (turno, rota, rot, fecha) => (rota && esNoche(rot) ? { base: turno, equipo: equipoDe(turno, rot, fecha) } : { base: baseDe(turno, rota, rot, fecha), equipo: null });
// regla de rotación de una persona: la de su empresa (externas) o la de su grupo (supervisores Paris)
const rotDe = (p, rot) => (p.rol !== 'Supervisor' && rot.emp[p.empresa_id]) || rot[ROL_GRUPO[p.rol]];
const leerPersonas = async () => (await q(`SELECT p.id, p.nombre, p.rol, p.turno_id, p.turno_base, p.rota, p.equipo, p.cd, p.empresa_id, e.nombre AS empresa
  FROM personas p LEFT JOIN empresas e ON e.id = p.empresa_id WHERE p.activo AND p.rol = ANY($1) ORDER BY p.rol, p.nombre`, [ROLES])).rows;

/** Personas (supervisores Paris y de empresas externas) con su turno en la semana de "fecha", según la rotación */
export async function personasEnFecha(fecha) {
  const rot = await leerRotacion();
  return (await leerPersonas()).map((p) => ({ ...p, turno: turnoEn(p, rotDe(p, rot), fecha) }));
}

/** Deja el turno de esta semana en personas.turno_id y los supervisores Paris por turno en cada CD de Gestión diaria */
export async function aplicarRotacion() {
  const f = await hoy(), rot = await leerRotacion(), ps = await leerPersonas();
  const turnos = (await q('SELECT id, orden FROM turnos ORDER BY orden')).rows;
  let cambios = 0;
  for (const p of ps) {
    const t = turnoEn(p, rotDe(p, rot), f);
    if (t && t !== p.turno_id) {
      // el supervisor Paris reporta al jefe de turno Paris de su turno (Continuidad)
      await q(`UPDATE personas SET turno_id = $2, reporta_a = CASE WHEN rol = 'Supervisor'
          THEN (SELECT id FROM personas j WHERE j.rol = 'Jefe de Turno' AND j.turno_id = $2 AND j.activo LIMIT 1) ELSE reporta_a END WHERE id = $1`, [p.id, t]);
      p.turno_id = t; cambios++;
    }
  }
  // Gestión diaria: supervisores por turno (T1, T2, T3 en el orden de los turnos) de los CD que tienen supervisores Paris con CD
  const porCd = new Map();
  for (const p of ps.filter((x) => x.rol === 'Supervisor' && x.cd)) {
    if (!porCd.has(p.cd)) porCd.set(p.cd, {});
    const m = porCd.get(p.cd); (m[p.turno_id] = m[p.turno_id] || []).push(p.nombre);
  }
  for (const [cd, m] of porCd) {
    const v = [0, 1, 2].map((i) => (m[turnos[i]?.id] || []).join(' / '));
    await qg('UPDATE cd_config SET sup_t1 = $2, sup_t2 = $3, sup_t3 = $4 WHERE upper(cd) = upper($1) AND (sup_t1, sup_t2, sup_t3) IS DISTINCT FROM ($2, $3, $4)', [cd, ...v]);
  }
  return { cambios };
}

/** Todo lo de la configuración: empresas, personas, rotaciones, turnos, CD y el calendario de las próximas semanas */
export async function personal(semanas = 8) {
  await aplicarRotacion();
  const f = await hoy(), rot = await leerRotacion(), ps = await leerPersonas();
  const [empresas, turnos, cdsG, cdsI] = await Promise.all([
    q('SELECT id, nombre, activo FROM empresas ORDER BY nombre'),
    q('SELECT id, nombre, orden FROM turnos ORDER BY orden'),
    qg('SELECT cd FROM cd_config ORDER BY cd').catch(() => ({ rows: [] })),
    q('SELECT DISTINCT cd FROM inv_layout ORDER BY cd').catch(() => ({ rows: [] }))
  ]);
  const inicio = lunes(f);
  const sem = Array.from({ length: semanas }, (_, i) => addDias(inicio, 7 * i));
  return {
    hoy: f, semanas: sem, grupos: GRUPOS, rolGrupo: ROL_GRUPO, rotacion: rot, rotEmpresa: rot.emp, empresas: empresas.rows, turnos: turnos.rows,
    cds: [...new Set([...cdsG.rows, ...cdsI.rows].map((x) => x.cd))].sort(),
    personas: ps.map((p) => ({ ...p, calendario: sem.map((s) => turnoEn(p, rotDe(p, rot), s)) }))
  };
}

// ---------- empresas ----------
export async function guardarEmpresa(id, b) {
  const nombre = txt(b.nombre, 80).toUpperCase();
  if (!nombre) throw bad('Ingresa el nombre de la empresa.');
  try {
    if (id) return (await q('UPDATE empresas SET nombre = $2, activo = $3 WHERE id = $1 RETURNING *', [id, nombre, b.activo !== false])).rows[0];
    const e = (await q('INSERT INTO empresas (nombre) VALUES ($1) RETURNING *', [nombre])).rows[0];
    // la empresa nace con su regla de turnos y rotación (por defecto los 3 turnos, sin rotación) y se ajusta en "Rotación de turnos"
    await q('INSERT INTO rotacion_empresa (empresa_id) VALUES ($1) ON CONFLICT DO NOTHING', [e.id]);
    if (b.rotacion) await guardarRotacionEmpresa(e.id, b.rotacion);
    return e;
  } catch (e) { if (e.code === '23505') throw bad(`Ya existe la empresa ${nombre}.`, 409); throw e; }
}

// ---------- personas ----------
export async function guardarPersona(id, b) {
  const nombre = txt(b.nombre);
  if (!nombre) throw bad('Ingresa el nombre.');
  const rol = id ? (await q('SELECT rol FROM personas WHERE id = $1', [id])).rows[0]?.rol : b.rol;
  if (!ROLES.includes(rol)) throw bad('Tipo de persona inválido.');
  const turno = txt(b.turno_id, 20) || null;
  if (turno && !(await q('SELECT 1 FROM turnos WHERE id = $1', [turno])).rowCount) throw bad('Turno inválido.');
  const externa = rol !== 'Supervisor';
  const empresa = externa ? (+b.empresa_id || null) : null;
  if (externa && !empresa) throw bad('Elige la empresa externa.');
  const rota = b.rota !== false;
  const rot = await leerRotacion();
  if (externa && turno && rot.emp[empresa] && !rot.emp[empresa].turnos.includes(turno)) {
    const { rows: [e] } = await q('SELECT nombre FROM empresas WHERE id = $1', [empresa]);
    throw bad(`${e?.nombre || 'La empresa'} no opera el turno ${turno} (turnos: ${rot.emp[empresa].turnos.join(', ')}).`);
  }
  const { base, equipo } = ubicar(turno, rota, rotDe({ rol, empresa_id: empresa }, rot), await hoy());
  const cd = txt(b.cd, 60).toUpperCase() || null;
  const r = id
    ? await q('UPDATE personas SET nombre = $2, turno_id = $3, turno_base = $4, rota = $5, cd = $6, empresa_id = $7, equipo = $8 WHERE id = $1 RETURNING *', [id, nombre, turno, base, rota, cd, empresa, equipo])
    : await q('INSERT INTO personas (nombre, rol, turno_id, turno_base, rota, cd, empresa_id, equipo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [nombre, rol, turno, base, rota, cd, empresa, equipo]);
  await aplicarRotacion();
  return r.rows[0];
}

export async function bajaPersona(id) {
  await tx(async (c) => {
    const { rows: [p] } = await c.query('UPDATE personas SET activo = false WHERE id = $1 AND rol = ANY($2) RETURNING *', [id, ROLES]);
    if (!p) throw bad('Persona no encontrada.', 404);
    // las tareas abiertas delegadas a esa persona vuelven al jefe de su turno (como en Continuidad, Equipo)
    await c.query(`UPDATE tareas t SET asignado_a = (SELECT id FROM personas j WHERE j.rol = 'Jefe de Turno' AND j.turno_id = t.turno_id AND j.activo LIMIT 1)
      WHERE t.asignado_a = $1 AND t.estado = 'abierta'`, [p.id]);
  });
  await aplicarRotacion();
  return { ok: true };
}

// ---------- rotación ----------
export async function guardarRotacion(grupo, b) {
  if (!GRUPOS[grupo]) throw bad('Grupo inválido.');
  const turnos = (await q('SELECT id FROM turnos')).rows.map((x) => x.id);
  const tipo = b.tipo === 'noche_mensual' ? 'noche_mensual' : 'ciclo';
  const nocheSem = Math.min(8, Math.max(1, Math.round(+b.noche_semanas || 4)));
  let ciclo = (Array.isArray(b.ciclo) ? b.ciclo : []).filter((t, i, a) => turnos.includes(t) && a.indexOf(t) === i);
  if (tipo === 'noche_mensual') ciclo = (await q('SELECT id FROM turnos ORDER BY orden')).rows.map((x) => x.id);
  else if (ciclo.length < 2) throw bad('El ciclo de rotación necesita al menos dos turnos.');
  const semanas = Math.min(12, Math.max(1, Math.round(+b.semanas || 1)));
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(b.inicio || '') ? lunes(b.inicio) : lunes(await hoy());
  const f = await hoy();
  // se conserva el turno de esta semana de cada persona: se recalcula su turno base con la nueva configuración
  // (los de empresa externa siguen la regla de su empresa, salvo que la empresa no tenga una)
  const rot = await leerRotacion();
  const ps = (await leerPersonas()).filter((p) => ROL_GRUPO[p.rol] === grupo && (p.rol === 'Supervisor' || !rot.emp[p.empresa_id]));
  const nueva = { activo: !!b.activo, tipo, noche_semanas: nocheSem, ciclo, semanas, inicio, T: rot.SUP_PARIS?.T || ciclo };
  await tx(async (c) => {
    await c.query('UPDATE rotacion SET activo = $2, ciclo = $3, semanas = $4, inicio = $5, tipo = $6, noche_semanas = $7 WHERE grupo = $1', [grupo, nueva.activo, ciclo, semanas, inicio, tipo, nocheSem]);
    for (const p of ps) { const u = ubicar(p.turno_id, p.rota, nueva, f); await c.query('UPDATE personas SET turno_base = $2, equipo = $3 WHERE id = $1', [p.id, u.base, u.equipo]); }
  });
  await aplicarRotacion();
  return { ok: true };
}

/** Turnos que opera una empresa externa y su rotación (los turnos del ciclo rotan; el resto queda fijo) */
export async function guardarRotacionEmpresa(id, b) {
  const { rows: [e] } = await q('SELECT id FROM empresas WHERE id = $1', [id]);
  if (!e) throw bad('Empresa no encontrada.', 404);
  const todos = (await q('SELECT id FROM turnos ORDER BY orden')).rows.map((x) => x.id);
  const turnos = todos.filter((t) => (Array.isArray(b.turnos) ? b.turnos : todos).includes(t));
  if (!turnos.length) throw bad('La empresa debe operar al menos un turno.');
  const tipo = b.tipo === 'noche_mensual' ? 'noche_mensual' : 'ciclo';
  const nocheSem = Math.min(8, Math.max(1, Math.round(+b.noche_semanas || 4)));
  let ciclo = (Array.isArray(b.ciclo) ? b.ciclo : []).filter((t, i, a) => turnos.includes(t) && a.indexOf(t) === i);
  const activo = !!b.activo;
  if (tipo === 'noche_mensual') {
    if (turnos.length < todos.length) throw bad('La rotación con noche mensual necesita que la empresa opere los tres turnos.');
    ciclo = todos;
  } else if (activo && ciclo.length < 2) throw bad('Para rotar, marca al menos dos turnos del ciclo entre los que opera la empresa.');
  const semanas = Math.min(12, Math.max(1, Math.round(+b.semanas || 1)));
  const f = await hoy();
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(b.inicio || '') ? lunes(b.inicio) : lunes(f);
  const nueva = { activo, tipo, noche_semanas: nocheSem, ciclo: ciclo.length ? ciclo : turnos.slice(0, 2), semanas, inicio, T: todos };
  // se conserva el turno de esta semana de cada persona de la empresa
  const ps = (await leerPersonas()).filter((p) => p.rol !== 'Supervisor' && p.empresa_id === id);
  await tx(async (c) => {
    await c.query(`INSERT INTO rotacion_empresa (empresa_id, turnos, activo, ciclo, semanas, inicio, tipo, noche_semanas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (empresa_id) DO UPDATE SET turnos = $2, activo = $3, ciclo = $4, semanas = $5, inicio = $6, tipo = $7, noche_semanas = $8`, [id, turnos, activo, nueva.ciclo, semanas, inicio, tipo, nocheSem]);
    for (const p of ps) { const u = ubicar(p.turno_id, p.rota, nueva, f); await c.query('UPDATE personas SET turno_base = $2, equipo = $3 WHERE id = $1', [p.id, u.base, u.equipo]); }
  });
  await aplicarRotacion();
  return { ok: true };
}
