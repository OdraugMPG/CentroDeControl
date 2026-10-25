// Plan diario por turno (port de mod7_Planificacion, modo PLAN DIARIO).
// Unidad de trabajo = Piso / Zona_Pasillo. Recorrido piso -> zona_pasillo, capacidad por turno =
// recursos x horas efectivas. Con "Ambas" la consolidación avanza desde el inicio del recorrido y el
// inventario desde el final; cada zona se inventaría en el turno siguiente a terminar su consolidación.
import { up, cmp, diaSemana, sumarDias } from './util.js';

const PL_MAXT = 3000;
const EPS = 0.000001;

export function turnosDelDia(iso, p) {
  const d = diaSemana(iso);
  return d <= 5 ? p.turnosLV : d === 6 ? p.turnosSab : p.turnosDom;
}

/** Movimientos de consolidación de la Fase 1 por SKU (misma regla que las tareas). */
export function movimientosPorSku(filasCd, nSkuUbic) {
  const porSku = new Map();
  for (const r of filasCd) {
    if (!porSku.has(r.sku)) porSku.set(r.sku, new Map());
    const m = porSku.get(r.sku);
    const e = m.get(r.ubic);
    if (e) e.qty += r.qty; else m.set(r.ubic, { ubic: r.ubic, qty: r.qty, fila: r });
  }
  const res = [];
  for (const [sku, m] of porSku) {
    if (m.size < 2) continue;
    const u = [...m.values()].sort((a, b) => b.qty - a.qty);
    const n = u.length;
    const zn = u.map((x) => x.ubic.slice(0, 3));
    const mono = u.map((x) => (nSkuUbic.get(x.ubic) || 0) <= 1);
    const cur = u.map((x) => x.qty);
    const est = new Array(n).fill(0);
    const recib = new Array(n).fill(0);
    const cap = u[0].qty;
    const movs = [];
    for (let a = n - 1; a >= 0; a--) {
      if (!mono[a] || est[a] !== 0) continue;
      const q = u[a].qty;
      let best = -1;
      for (let p = 0; p < n; p++) {
        if (p !== a && mono[p] && est[p] !== 1 && zn[p] === zn[a] && cap - cur[p] >= q - 1e-7) {
          if (best < 0 || cap - cur[p] < cap - cur[best]) best = p;
        }
      }
      if (best >= 0) {
        est[a] = 1; est[best] = 2; cur[best] += q; recib[best] += q;
        movs.push({ o: a, d: best, q });
      }
    }
    if (movs.length) res.push({ sku, u, zn, cur, est, recib, cap, movs });
  }
  return res;
}

function programar(tarea, ord, hh, iniT, capT, hT, rec, finT, lin, nT) {
  const nG = hh.length;
  const rest = hh.slice();
  let quedan = rest.reduce((a, b) => a + b, 0);
  if (quedan <= EPS || capT <= 0) return 0;
  let tCur = 1, capRest = capT, uAct = -1, ultimo = 0;
  while (quedan > EPS && tCur <= nT) {
    if (uAct >= 0 && rest[uAct] <= EPS) uAct = -1;
    if (uAct < 0) {
      for (let j = 0; j < nG; j++) {
        const k = ord[j];
        if (rest[k] > EPS && iniT[k] <= tCur) { uAct = k; break; }
      }
    }
    if (uAct < 0) { tCur++; capRest = capT; continue; }
    let toma = Math.min(rest[uAct], capRest);
    const s = capT - capRest, e = s + toma;
    const o1 = Math.floor(s / hT + EPS) + 1;
    let o2 = -Math.floor(-(e / hT - EPS));
    if (o2 < o1) o2 = o1;
    if (o2 > rec) o2 = rec;
    lin.push({ tarea, t: tCur, z: uAct, hh: toma, pct: toma / hh[uAct], ops: `OP ${o1}${o2 > o1 ? '-' + o2 : ''}`, nOps: Math.max(1, o2 - o1 + 1) });
    rest[uAct] -= toma; quedan -= toma; capRest -= toma; ultimo = tCur;
    if (rest[uAct] <= EPS) finT[uAct] = tCur;
    if (capRest <= EPS) { tCur++; capRest = capT; }
  }
  return ultimo;
}

/**
 * @param o.filas       filas de la Base (todas)
 * @param o.cd          CD a planificar
 * @param o.reservadas  Set de ubicaciones de Blq_Stk_unit
 * @param o.excluido    true si el CD está en la lista de CD que no se consolidan (OSR)
 * @param o.hechas      Set "PISO|ZONA" ya inventariadas en el ciclo
 * @param o.modo        1 inventario, 2 consolidación, 3 ambas
 */
export function planificarDia(o) {
  const { filas, cd, reservadas, excluido, hechas, fecha, p } = o;
  const modo = o.modo || 3;
  const tIni = o.tIni || 1;
  const hT = p.horasTurno > 0 ? p.horasTurno : 8;
  const invMax = p.invMax > 0 ? p.invMax : 6;
  const recInv = Math.max(1, Math.min(o.recInv || 1, invMax));
  const recCon = Math.max(1, o.recCon || 1);
  // --- carga por piso / zona_pasillo
  const dG = new Map();
  const zonas = [];
  const vistos = new Set();
  const nSkuUbic = new Map();
  const filasCons = [];
  for (const r of filas) {
    if (!r.sku || !(r.qty > 0) || r.cd !== cd) continue;
    const piso = up(r.piso), zp = up(r.zp), ub = r.ubic;
    const g = piso + '|' + zp;
    if (!dG.has(g)) { dG.set(g, zonas.length); zonas.push({ key: g, piso, zp, ub: 0, lin: 0, uni: 0, mov: 0, umov: 0 }); }
    const z = zonas[dG.get(g)];
    z.uni += r.qty;
    if (!vistos.has('U|' + g + '|' + ub)) { vistos.add('U|' + g + '|' + ub); z.ub++; }
    if (!vistos.has('L|' + g + '|' + ub + '|' + r.sku)) { vistos.add('L|' + g + '|' + ub + '|' + r.sku); z.lin++; }
    if (!excluido && !reservadas.has(ub)) {
      if (!vistos.has('N|' + ub + '|' + r.sku)) { vistos.add('N|' + ub + '|' + r.sku); nSkuUbic.set(ub, (nSkuUbic.get(ub) || 0) + 1); }
      filasCons.push(r);
    }
  }
  if (!zonas.length) return { lineas: [], pendientes: [], zonas: [], resumen: null, nTurnosDia: turnosDelDia(fecha, p) };
  for (const g of movimientosPorSku(filasCons, nSkuUbic)) {
    for (const mv of g.movs) {
      const f = g.u[mv.o].fila;
      const z = zonas[dG.get(up(f.piso) + '|' + up(f.zp))];
      z.mov++; z.umov += mv.q;
    }
  }
  // --- HH por zona y orden de recorrido
  const nG = zonas.length;
  const hhI = [], hhC = [];
  let totI = 0, totC = 0, nDone = 0;
  zonas.forEach((z, k) => {
    hhI[k] = (z.ub * p.invSegUb + z.lin * p.invSegSku + z.uni * p.invSegUn + p.invSegPas) / 3600;
    hhC[k] = (z.mov * p.conSegMov + z.umov * p.conSegUn + (z.mov > 0 ? p.conSegPas : 0)) / 3600;
    if (modo === 2) hhI[k] = 0;
    if (modo === 1) hhC[k] = 0;
    if (modo !== 2 && hechas.has(z.key)) { hhI[k] = 0; nDone++; }
    totI += hhI[k]; totC += hhC[k];
  });
  const ord = zonas.map((_, k) => k).sort((a, b) => cmp(zonas[a].key, zonas[b].key));
  // --- calendario de turnos desde la fecha
  const tFec = [null], tNum = [null];
  let d = fecha, nT = 0, dias = 0;
  while (nT < PL_MAXT && dias < 3660) {
    const nDia = turnosDelDia(d, p);
    for (let tt = 1; tt <= nDia && nT < PL_MAXT; tt++) {
      if (d > fecha || tt >= tIni) { nT++; tFec.push(d); tNum.push(tt); }
    }
    d = sumarDias(d, 1); dias++;
  }
  // --- programación
  const lin = [];
  const finC = new Array(nG).fill(0);
  const iniI = new Array(nG).fill(1);
  if (modo !== 1) programar('CONSOLIDACION', ord, hhC, iniI, recCon * hT, hT, recCon, finC, lin, nT);
  if (modo === 3) for (let k = 0; k < nG; k++) iniI[k] = hhC[k] > 0 ? finC[k] + 1 : 1;
  const ordI = modo === 3 ? ord.slice().reverse() : ord;
  const finI = new Array(nG).fill(0);
  if (modo !== 2) programar('INVENTARIO', ordI, hhI, iniI, recInv * hT, hT, recInv, finI, lin, nT);
  // --- horizonte: solo los turnos de la fecha
  let nTW = 0;
  for (let k = 1; k <= nT; k++) { if (tFec[k] <= fecha) nTW = k; else break; }
  const lineas = [], pend = new Map();
  let hhWI = 0, hhWC = 0;
  lin.forEach((l, i) => {
    const z = zonas[l.z];
    if (l.t <= nTW) {
      if (l.tarea === 'INVENTARIO') hhWI += l.hh; else hhWC += l.hh;
      lineas.push({
        fecha: tFec[l.t], turno: tNum[l.t], tarea: l.tarea, piso: z.piso, zp: z.zp, hh: l.hh, pct: l.pct, ops: l.ops, nOps: l.nOps,
        ubicaciones: l.tarea === 'INVENTARIO' ? Math.round(z.ub * l.pct) : null,
        movimientos: l.tarea === 'CONSOLIDACION' ? Math.round(z.mov * l.pct) : null,
        orden: l.t * 1e6 + (l.tarea === 'INVENTARIO' ? 5e5 : 0) + i,
        zonaPctTotal: null,
      });
    } else {
      const k = l.tarea + '|' + l.z;
      const pv = pend.get(k);
      if (pv) pv.hh += l.hh; else pend.set(k, { tarea: l.tarea, piso: z.piso, zp: z.zp, hh: l.hh, desde: tFec[l.t], turno: tNum[l.t] });
    }
  });
  lineas.sort((a, b) => a.orden - b.orden);
  let zHoy = 0, zPend = 0, zInv = 0;
  zonas.forEach((z, k) => {
    if (hhI[k] > 0) { zInv++; if (finI[k] > 0 && finI[k] <= nTW) zHoy++; else zPend++; }
  });
  const pendientes = [...pend.values()].sort((a, b) => cmp(a.desde + a.turno + a.tarea + a.piso + a.zp, b.desde + b.turno + b.tarea + b.piso + b.zp));
  return {
    lineas, pendientes,
    zonas: zonas.map((z, k) => ({ ...z, hhI: hhI[k], hhC: hhC[k], finI: finI[k] })),
    nTurnosDia: turnosDelDia(fecha, p),
    resumen: { recInv, recCon, totI, totC, hhWI, hhWC, zonasInv: zInv, zonasHoy: zHoy, zonasPend: zPend, zonasCiclo: nDone, zonasTotal: nG },
  };
}
