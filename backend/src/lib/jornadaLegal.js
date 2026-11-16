// Validación legal de la rotación de turnos (Código del Trabajo de Chile). Simula cada posición de una regla de rotación
// (equipo de la noche mensual, turno base de un ciclo o turno fijo) durante un año, con los turnos y el calendario de la
// operación (qué turnos operan cada día), y revisa:
// - horas efectivas por semana (turno - colación) contra la jornada ordinaria (42 h) y las horas extra semanales (máx. 12)
// - horas extra por día (máx. 2; la jornada ordinaria diaria es la semanal repartida en los días trabajados)
// - días trabajados por semana (máx. 6) y horas por día (máx. 10 ordinarias + extra)
// - descanso entre el fin de un turno y el inicio del siguiente (mínimo configurable)
// - domingos: máximo de domingos seguidos trabajados y mínimo de domingos libres por mes calendario
// Los límites son parámetros (Configuración) para ajustarlos con el asesor laboral.
import { addDias, diaSemana } from './turnos.js';

const H = 3600000;
export const LEGAL_DEF = {
  legalJornadaSemanal: 42, legalColacionMin: 30, legalMaxExtraSemana: 12, legalMaxExtraDia: 2, legalMaxHorasDia: 10,
  legalMaxDiasSemana: 6, legalDescansoMinH: 12, legalMaxDomingosSeguidos: 3, legalMinDomingosLibresMes: 2
};
export function legalParams(p = {}) {
  const L = {};
  for (const [k, v] of Object.entries(LEGAL_DEF)) { const n = Number(String(p[k] ?? '').replace(',', '.')); L[k] = p[k] !== undefined && p[k] !== '' && Number.isFinite(n) ? n : v; }
  return L;
}

const lunesDe = (iso) => addDias(iso, -((diaSemana(iso) + 6) % 7));
const dm = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
const DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const r1 = (x) => Math.round(x * 10) / 10;
const ms = (iso, h) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, h).getTime(); };

/** Turnos trabajados por una posición: turnoSemana(lunes) da el turno de esa semana; trabaja los días en que ese turno opera. */
function instancias(turnoSemana, desde, semanas, c) {
  const out = [];
  for (let w = 0; w < semanas; w++) {
    const lun = addDias(desde, 7 * w);
    const t = turnoSemana(lun);
    const tt = t && c.turno[t];
    if (!tt) continue;
    for (let k = 0; k < 7; k++) {
      const f = addDias(lun, k);
      if (!(c.calendario[diaSemana(f)] || []).includes(t)) continue;
      out.push({ fecha: f, lunes: lun, turno: t, start: ms(f, tt.hora_inicio), end: ms(f, tt.hora_inicio + tt.duracion_h), dur: tt.duracion_h });
    }
  }
  return out;
}

function medirPosicion(inst, L, desde, semanas) {
  const col = L.legalColacionMin / 60;
  // por semana
  const sem = new Map();
  for (const i of inst) {
    const s = sem.get(i.lunes) || { lunes: i.lunes, horas: 0, dias: new Set(), maxDia: 0, turnos: new Set() };
    const ef = Math.max(0, i.dur - col);
    s.horas += ef; s.dias.add(i.fecha); s.maxDia = Math.max(s.maxDia, ef); s.turnos.add(i.turno);
    sem.set(i.lunes, s);
  }
  const semanasL = [...sem.values()].map((s) => {
    const dias = s.dias.size, extra = Math.max(0, s.horas - L.legalJornadaSemanal);
    const ordDia = dias ? L.legalJornadaSemanal / dias : 0;
    return { lunes: s.lunes, horas: s.horas, dias, extra, extraDia: Math.max(0, s.maxDia - ordDia), maxDia: s.maxDia, turnos: [...s.turnos].join('/') };
  });
  // descanso entre jornadas
  const ord = [...inst].sort((a, b) => a.start - b.start);
  let descanso = null;
  for (let k = 1; k < ord.length; k++) {
    const g = (ord[k].start - ord[k - 1].end) / H;
    if (!descanso || g < descanso.h) descanso = { h: g, de: ord[k - 1], a: ord[k] };
  }
  // domingos trabajados (cualquier turno que toque el domingo, incluida una noche del sábado)
  const domingos = [];
  const primerDom = addDias(desde, 6);
  for (let w = 0; w < semanas; w++) {
    const dom = addDias(primerDom, 7 * w), a = ms(dom, 0), b = ms(addDias(dom, 1), 0);
    domingos.push({ fecha: dom, trabaja: inst.some((i) => i.start < b && i.end > a) });
  }
  let seg = 0, maxSeg = 0, finSeg = null;
  for (const d of domingos) { seg = d.trabaja ? seg + 1 : 0; if (seg > maxSeg) { maxSeg = seg; finSeg = d.fecha; } }
  const porMes = new Map();
  for (const d of domingos) { const m = d.fecha.slice(0, 7); const x = porMes.get(m) || { mes: m, total: 0, libres: 0 }; x.total++; if (!d.trabaja) x.libres++; porMes.set(m, x); }
  // solo meses completos dentro del período simulado
  const meses = [...porMes.values()].filter((m) => m.mes > desde.slice(0, 7) && m.mes < addDias(desde, 7 * semanas).slice(0, 7));
  const minMes = meses.length ? meses.reduce((a, m) => (m.libres < a.libres ? m : a)) : null;
  return { semanas: semanasL, descanso, maxSeg, finSeg, minMes, domTrabajados: domingos.filter((d) => d.trabaja).length };
}

/**
 * Valida una regla de rotación. "posiciones" = [{ nombre, turnoSemana(lunes) }]. Devuelve las reglas con ok / valor / detalle
 * (con el peor caso y su semana) y si la regla cumple todas.
 */
export function validarPosiciones(posiciones, c, L, hoy, semanas = 53) {
  const desde = lunesDe(hoy);
  const med = posiciones.map((p) => ({ nombre: p.nombre, ...medirPosicion(instancias(p.turnoSemana, desde, semanas, c), L, desde, semanas) }));
  const todas = med.flatMap((m) => m.semanas.map((s) => ({ ...s, pos: m.nombre })));
  if (!todas.length) return { ok: true, reglas: [], sinTurnos: true };
  const peor = (l, k) => l.reduce((a, x) => (x[k] > a[k] ? x : a));
  const hMin = Math.min(...todas.map((s) => s.horas)), wH = peor(todas, 'horas'), wE = peor(todas, 'extra'), wD = peor(todas, 'dias'), wX = peor(todas, 'extraDia'), wM = peor(todas, 'maxDia');
  const conExtra = todas.filter((s) => s.extra > 0).length;
  const reglas = [];
  const add = (clave, nombre, ok, valor, detalle, aviso = false) => reglas.push({ clave, nombre, ok, aviso, valor, detalle });
  add('extraSemana', 'Horas extra por semana', wE.extra <= L.legalMaxExtraSemana + 1e-9,
    wE.extra > 0 ? `hasta ${r1(wE.extra)} h (máx. ${L.legalMaxExtraSemana})` : 'sin horas extra',
    `Horas efectivas por semana: ${r1(hMin)} a ${r1(wH.horas)} h (turno menos ${L.legalColacionMin} min de colación) contra la jornada de ${L.legalJornadaSemanal} h. Peor semana: ${wE.pos}, ${wE.turnos} del ${dm(wE.lunes)} (${wE.dias} días).`);
  if (wE.extra > 0 && wE.extra <= L.legalMaxExtraSemana + 1e-9) {
    add('extraPermanente', 'Horas extra recurrentes', true, `${Math.round((100 * conExtra) / todas.length)}% de las semanas`,
      'Las horas extra solo se pactan por escrito para necesidades temporales (máx. 3 meses, renovable): si la rotación las tiene todas las semanas, revisar la duración de los turnos o los días.', true);
  }
  add('extraDia', 'Horas extra por día', wX.extraDia <= L.legalMaxExtraDia + 1e-9, wX.extraDia > 0 ? `hasta ${r1(wX.extraDia)} h (máx. ${L.legalMaxExtraDia})` : 'sin horas extra diarias',
    `La jornada diaria ordinaria es la semanal repartida en los días trabajados (${L.legalJornadaSemanal} h ÷ días). Peor caso: ${wX.pos}, ${wX.turnos} del ${dm(wX.lunes)}.`);
  add('horasDia', 'Horas por día', wM.maxDia <= L.legalMaxHorasDia + L.legalMaxExtraDia + 1e-9, `${r1(wM.maxDia)} h efectivas`, `Máximo ${L.legalMaxHorasDia} h ordinarias + ${L.legalMaxExtraDia} h extra al día.`);
  add('dias', 'Días por semana', wD.dias <= L.legalMaxDiasSemana, `hasta ${wD.dias} días (máx. ${L.legalMaxDiasSemana})`, `Peor semana: ${wD.pos}, ${wD.turnos} del ${dm(wD.lunes)}.`);
  const ds = med.filter((m) => m.descanso).map((m) => ({ ...m.descanso, pos: m.nombre }));
  if (ds.length) {
    const d = ds.reduce((a, x) => (x.h < a.h ? x : a));
    add('descanso', 'Descanso entre jornadas', d.h >= L.legalDescansoMinH - 1e-9, `mínimo ${r1(d.h)} h (mín. ${L.legalDescansoMinH})`,
      `Menor descanso: ${d.pos}, del ${d.de.turno} del ${DIA[diaSemana(d.de.fecha)]} ${dm(d.de.fecha)} al ${d.a.turno} del ${DIA[diaSemana(d.a.fecha)]} ${dm(d.a.fecha)}.`);
  }
  const s = med.reduce((a, m) => (m.maxSeg > a.maxSeg ? m : a));
  add('domSeguidos', 'Domingos seguidos trabajados', s.maxSeg <= L.legalMaxDomingosSeguidos, s.maxSeg ? `hasta ${s.maxSeg} (máx. ${L.legalMaxDomingosSeguidos})` : 'no trabaja domingos',
    s.maxSeg ? `${s.nombre}: ${s.maxSeg} domingos seguidos hasta el ${dm(s.finSeg)}-${s.finSeg.slice(0, 4)}.` : 'Ningún turno de la rotación toca el domingo.');
  const ms0 = med.filter((m) => m.minMes).reduce((a, m) => (!a || m.minMes.libres < a.minMes.libres ? m : a), null);
  if (ms0) add('domMes', 'Domingos libres al mes', ms0.minMes.libres >= L.legalMinDomingosLibresMes, `mínimo ${ms0.minMes.libres} de ${ms0.minMes.total} (mín. ${L.legalMinDomingosLibresMes})`,
    `Peor mes: ${ms0.nombre}, ${ms0.minMes.mes.slice(5, 7)}-${ms0.minMes.mes.slice(0, 4)}. Por cada domingo trabajado corresponde un día de descanso compensatorio (art. 38).`);
  return { ok: reglas.every((x) => x.ok), reglas };
}
