// Sugerido de reabastecimiento en totes para el OSR: el traslado "antes del evento" del Reabasto por proyección pasado a
// totes, en orden de prioridad, sin pasar el margen hasta el target de ocupación (Capacidad del OSR, en Optimización de totes).
// Por SKU, lo que se sube llena primero el espacio libre de los totes que ya tiene en OSR (capacidad del tote − unidades) y el
// resto va a totes nuevos: enteros llenos + half / quarter (como en Optimización de totes). Los half y quarter de distintos
// SKU comparten tote, así que las posiciones nuevas son la suma de las fracciones de tote. Un SKU que ya no cabe entero
// recibe lo que cabe en lo que queda del margen; los siguientes que no necesitan totes nuevos (caben en su espacio libre)
// siguen entrando.
import { q } from '../db.js';
import { baseSku, reabastoYTraslado } from './abastecimientoOsr.js';
import { capacidadOsr } from './totesOsr.js';
import { empaque, TOTES } from './potencialOsr.js';
import { skuKey } from './participacionCd.js';

const LIMITE = 500;
const p90 = (l) => { const s = [...l].sort((a, b) => a - b); return s.length ? Math.max(4, Math.round(s[Math.floor(0.9 * (s.length - 1))])) : null; };
const ESTADO = { COMPLETO: 'Completo', PARCIAL: 'Parcial', SIN: 'Sin espacio' };
const esAntes = (l) => String(l.ola).startsWith('1');

/** params: los del Reabasto por proyección + target (85 = 85%), tote (AUTO, ENTERO, HALF, QUARTER) y holgura (false: no usar el espacio libre de los totes) */
export async function sugeridoTotes(params = {}) {
  const [{ r, ab }, cap, base, dist] = await Promise.all([
    reabastoYTraslado(params), capacidadOsr({ target: params.target }), baseSku(),
    q('SELECT sku, stock::float8 AS stock, (full_t + half_t / 2.0 + quarter_t / 4.0)::float8 AS totes FROM osr_totes').then((x) => x.rows).catch(() => [])
  ]);
  if (!ab) return { sinProyeccion: true };
  if (!cap.cargada) return { sinCapacidad: true };
  const modo = params.tote in TOTES ? params.tote : 'AUTO';
  const usarHolgura = !(params.holgura === false || params.holgura === 'false' || params.holgura === '0');
  const margen = Math.max(0, cap.tot.hastaTarget);

  // capacidad de un tote entero por depto: percentil 90 de las unidades por tote de sus SKU en OSR (distribución cargada)
  const deptoDe = new Map(base.skus.map((x) => [skuKey(x.sku), x.depto]));
  const porSku = new Map(dist.filter((d) => d.totes > 0).map((d) => [d.sku, d]));
  const porDep = new Map(), todos = [];
  for (const d of porSku.values()) {
    if (!(d.stock > 0)) continue;
    const pt = d.stock / d.totes, dep = deptoDe.get(d.sku) || '(sin Base)';
    todos.push(pt);
    if (!porDep.has(dep)) porDep.set(dep, []);
    porDep.get(dep).push(pt);
  }
  const capGlobal = p90(todos) || 40;
  const capDep = new Map([...porDep].filter(([, l]) => l.length >= 10).map(([d, l]) => [d, p90(l)]));

  // unidades a subir antes del evento por SKU, desde la lista de traslado
  const antesDe = new Map();
  for (const l of ab.picking) if (esAntes(l)) antesDe.set(l.sku, (antesDe.get(l.sku) || 0) + l.unidades);

  let usado = 0;
  const filas = [];
  for (const rq of ab.req) {
    const sub = antesDe.get(rq.x.sku) || 0;
    if (!(sub > 0)) continue;
    const d = porSku.get(skuKey(rq.x.sku));
    const totesHoy = d?.totes || 0, stockOsr = d ? d.stock : rq.x.osr;
    const c = Math.max(capDep.get(rq.x.depto) || capGlobal, totesHoy ? Math.ceil(stockOsr / totesHoy) : 0);
    const holgura = usarHolgura && totesHoy ? Math.max(0, Math.floor(totesHoy * c - stockOsr)) : 0;
    const enHolgura = Math.min(sub, holgura);
    const nuevas = sub - enHolgura;
    const nec = empaque(nuevas, c, modo);
    let sug = sub, e = nec;
    if (usado + nec.totes > margen + 1e-9) {
      // no cabe entero: lo que cabe en lo que queda del margen
      const resta = Math.max(0, margen - usado);
      let u = Math.min(nuevas, Math.floor(resta * c));
      e = empaque(u, c, modo);
      while (u > 0 && e.totes > resta + 1e-9) { u = Math.max(0, u - Math.max(1, Math.floor(c / 4))); e = empaque(u, c, modo); }
      sug = enHolgura + u;
    }
    usado += e.totes;
    filas.push({ prioridad: rq.prioridad, sku: rq.x.sku, desc: rq.x.desc, depto: rq.x.depto, matriz: rq.x.matriz, osr: rq.x.osr, totesHoy, cap: c, holgura,
      subir: sub, totesNec: nec.totes, almacNec: nec.almac, sug, enHolgura: Math.min(sug, enHolgura), totesSug: e.totes, almac: e.almac, acumulado: usado,
      queda: sub - sug, estado: sug >= sub ? ESTADO.COMPLETO : sug > 0 ? ESTADO.PARCIAL : ESTADO.SIN });
  }

  // lista de traslado del sugerido: las líneas "antes" de cada SKU hasta su sugerido (primero la ubicación con más unidades)
  const sugDe = new Map(filas.map((x) => [x.sku, x.sug]));
  const picking = [];
  for (const l of ab.picking.filter(esAntes).sort((a, b) => b.stockAntes - a.stockAntes)) {
    const resta = sugDe.get(l.sku) || 0;
    if (resta <= 0) continue;
    const u = Math.min(resta, l.unidades);
    sugDe.set(l.sku, resta - u);
    picking.push({ ...l, unidades: u, saldo: l.stockAntes - u });
  }
  picking.sort((a, b) => String(a.cd).localeCompare(String(b.cd)) || String(a.ubic).localeCompare(String(b.ubic)));
  picking.forEach((l, i) => { l.nro = i + 1; });

  const s = (l, k) => l.reduce((t, x) => t + x[k], 0);
  const cuenta = (e) => filas.filter((x) => x.estado === e).length;
  const totesSug = Math.ceil(usado - 1e-9);
  const tot = {
    margen, target: cap.target, positions: cap.tot.positions, occupied: cap.tot.occupied, ocupHoy: cap.tot.ocup,
    skus: filas.length, subir: s(filas, 'subir'), totesNec: Math.ceil(s(filas, 'totesNec') - 1e-9), sug: s(filas, 'sug'), totesSug,
    enHolgura: s(filas, 'enHolgura'), queda: s(filas, 'queda'), completos: cuenta(ESTADO.COMPLETO), parciales: cuenta(ESTADO.PARCIAL), sinEspacio: cuenta(ESTADO.SIN),
    sobranPos: Math.max(0, margen - totesSug), ocupDespues: cap.tot.positions ? (cap.tot.occupied + totesSug) / cap.tot.positions : 0,
    lineas: picking.length, durante: ab.tot.durante
  };
  return { osr: r.osr, evento: r.proy?.evento, conf: { tote: modo, holgura: usarHolgura, capGlobal }, tot,
    total: filas.length, filas: filas.slice(0, LIMITE), lineasTotal: picking.length, picking: picking.slice(0, LIMITE) };
}
