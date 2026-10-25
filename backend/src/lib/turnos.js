// Lógica de turnos y día operativo.
// - El día operativo parte con el primer turno (AM 06:00).
// - El turno Noche pertenece a la fecha en que empieza (22:00 del día D a 06:00 del D+1).
// - Qué turnos operan cada día lo define turno_calendario (sábado AM y PM, domingo sin turnos).

export const H = 3600000;
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDias = (fecha, n) => { const d = new Date(fecha + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
export const diaSemana = fecha => new Date(fecha + 'T12:00:00').getDay();
export const inicioHora = t => { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime(); };

export function fechaOperativa(t, c) {
  const d = new Date(t);
  const primero = Math.min(...c.turnos.map(x => x.hora_inicio));
  if (d.getHours() < primero) d.setDate(d.getDate() - 1);
  return ymd(d);
}

export function instancia(fecha, turnoId, c) {
  const t = c.turno[turnoId];
  if (!t) throw new Error(`Turno desconocido: ${turnoId}`);
  const [y, m, d] = fecha.split('-').map(Number);
  const start = new Date(y, m - 1, d, t.hora_inicio).getTime();
  const end = new Date(y, m - 1, d, t.hora_inicio + t.duracion_h).getTime();
  const horas = Array.from({ length: t.duracion_h }, (_, i) => new Date(y, m - 1, d, t.hora_inicio + i).getTime());
  return { fecha, turno: turnoId, start, end, horas, programado: (c.calendario[diaSemana(fecha)] || []).includes(turnoId) };
}

export const turnosDelDia = (fecha, c) => c.calendario[diaSemana(fecha)] || [];

// Turno en curso en el instante t, o null si no hay turno programado
export function turnoActual(t, c) {
  const f = fechaOperativa(t, c);
  for (const id of turnosDelDia(f, c)) {
    const i = instancia(f, id, c);
    if (t >= i.start && t < i.end) return i;
  }
  return null;
}

export function siguienteTurno(fecha, turnoId, c) {
  const hoy = turnosDelDia(fecha, c);
  const idx = hoy.indexOf(turnoId);
  if (idx >= 0 && idx < hoy.length - 1) return instancia(fecha, hoy[idx + 1], c);
  for (let k = 1; k <= 14; k++) {
    const f = addDias(fecha, k), ts = turnosDelDia(f, c);
    if (ts.length) return instancia(f, ts[0], c);
  }
  return null;
}

// Últimos turnos programados que ya comenzaron, del más antiguo al más reciente
export function turnosRecientes(t, c, n = 6) {
  const out = [];
  let f = fechaOperativa(t, c);
  for (let k = 0; k < 21 && out.length < n; k++) {
    const ts = turnosDelDia(f, c).slice().reverse();
    for (const id of ts) {
      const i = instancia(f, id, c);
      if (i.start <= t) out.push(i);
      if (out.length >= n) break;
    }
    f = addDias(f, -1);
  }
  return out.reverse();
}

// Último turno programado ya iniciado (el actual, o el último si hoy no hay operación)
export const ultimoTurno = (t, c) => turnosRecientes(t, c, 1)[0] || null;

// Rango de un día operativo completo (todos sus turnos programados)
export function diaOperativo(fecha, c) {
  const ids = turnosDelDia(fecha, c);
  if (!ids.length) return null;
  const inst = ids.map(id => instancia(fecha, id, c));
  return { fecha, turno: 'dia', start: inst[0].start, end: inst.at(-1).end, horas: inst.flatMap(i => i.horas),
    turnoDeHora: Object.fromEntries(inst.flatMap(i => i.horas.map(h => [h, i.turno]))), programado: true };
}
