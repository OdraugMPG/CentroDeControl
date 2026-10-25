// Stock unitario (port de mod9_StockUnitario): SKU con 1 unidad en 1 sola ubicación del CD se llevan a
// las ubicaciones reservadas de Blq_Stk_unit del mismo grupo de piso. Secuencia de extracción en S.
import { txt, up, cmp, claveOrden } from './util.js';

export const SIN_UBICACION = 'SIN UBICACION';

export function grupoPiso(piso) {
  let p = up(piso).replace(/\./g, '').replace(/\s+/g, ' ');
  if (['SEG SENSIBLE', 'SEGSENSIBLE', 'SENSIBLE', 'SEGURIDAD'].includes(p)) p = 'SEG SENSIBLE';
  return p;
}

/**
 * @param o.filas       Base completa
 * @param o.cd          CD a procesar
 * @param o.reservadas  [{ubicacion, grupo, max}]
 * @param o.excluidos   Set de CD que no se procesan (OSR)
 * @param o.maxDef      capacidad por defecto de una reservada
 */
export function stockUnitario({ filas, cd, reservadas, excluidos, maxDef = 20 }) {
  const dRes = new Map(reservadas.map((r) => [up(r.ubicacion), r]));
  if (!dRes.size) return { lineas: [], aviso: 'No hay ubicaciones reservadas cargadas (Blq_Stk_unit).' };
  const qty = new Map(), ubs = new Map(), fila = new Map(), ubN = new Map(), ubCD = new Map(), ubPiso = new Map(), ocu = new Map();
  const set = new Set();
  for (const r of filas) {
    if (!r.cd || !r.sku || !r.ubic || !(r.qty > 0)) continue;
    if (!ubCD.has(r.ubic)) ubCD.set(r.ubic, r.cd);
    if (!ubPiso.has(r.ubic)) ubPiso.set(r.ubic, r.piso);
    if (!set.has('O|' + r.ubic + '|' + r.sku)) { set.add('O|' + r.ubic + '|' + r.sku); ocu.set(r.ubic, (ocu.get(r.ubic) || 0) + 1); }
    if (excluidos.has(r.cd)) continue;
    const k = r.cd + '|' + r.sku;
    qty.set(k, (qty.get(k) || 0) + r.qty);
    if (!set.has('U|' + k + '|' + r.ubic)) {
      set.add('U|' + k + '|' + r.ubic);
      ubs.set(k, (ubs.get(k) || 0) + 1);
      ubN.set(r.cd + '|' + r.ubic, (ubN.get(r.cd + '|' + r.ubic) || 0) + 1);
    }
    if (!fila.has(k)) fila.set(k, r);
  }
  const cand = [];
  let yaEnReservadas = 0;
  for (const [k, q] of qty) {
    if (q !== 1 || ubs.get(k) !== 1) continue;
    const r = fila.get(k);
    if (r.cd !== cd) continue;
    if (dRes.has(r.ubic)) yaEnReservadas++; else cand.push(r);
  }
  // reservadas ordenadas por grupo > ubicación
  const R = [...dRes.values()].map((x) => {
    let piso = txt(x.grupo);
    if (!piso && ubPiso.has(up(x.ubicacion))) piso = ubPiso.get(up(x.ubicacion));
    return { ub: up(x.ubicacion), grp: piso ? grupoPiso(piso) : '*', cd: ubCD.get(up(x.ubicacion)) || '', max: x.max > 0 ? x.max : maxDef, ocu: ocu.get(up(x.ubicacion)) || 0, asig: 0 };
  }).sort((a, b) => cmp(a.grp + '|' + a.ub, b.grp + '|' + b.ub));
  const buscar = (grp) => R.find((x) => x.grp === grp && (x.cd === '' || x.cd === cd) && x.ocu + x.asig < x.max);
  // secuencia en S: pasillo en sentido alterno dentro de cada zona_pasillo
  const pasillo = (r) => r.pas || r.zp;
  const pk = cand.map((r) => [claveOrden(r.cd), claveOrden(r.piso), claveOrden(r.zp), claveOrden(pasillo(r))].join('|'));
  const orden1 = pk.slice().sort(cmp);
  const rank = new Map();
  let prevPZ = null, rk = 0;
  for (const k of orden1) {
    if (rank.has(k)) continue;
    const pz = k.slice(0, k.lastIndexOf('|') + 1);
    if (pz !== prevPZ) { rk = 0; prevPZ = pz; }
    rank.set(k, ++rk);
  }
  const claves = cand.map((r, i) => {
    const k = pk[i], n = rank.get(k);
    return k.slice(0, k.lastIndexOf('|') + 1) + String(n).padStart(4, '0') + '|' + claveOrden(r.bah, n % 2 === 0) + '|' + claveOrden(r.niv) + '|' + r.ubic;
  });
  const idx = cand.map((_, i) => i).sort((a, b) => cmp(claves[a], claves[b]));
  const lineas = [];
  let prevPiso = null, sec = 0;
  idx.forEach((i, n) => {
    const r = cand[i];
    if (r.cd + '|' + up(r.piso) !== prevPiso) { sec = 0; prevPiso = r.cd + '|' + up(r.piso); }
    sec++;
    const grp = grupoPiso(r.piso);
    const dst = buscar(grp) || buscar('*');
    const l = {
      folio: 'U-' + String(n + 1).padStart(5, '0'), sec, sku: r.sku, cd: r.cd, desc: r.desc, depto: r.depto, piso: r.piso, zp: r.zp, pas: pasillo(r),
      ori: r.ubic, q: 1, libera: (ubN.get(r.cd + '|' + r.ubic) || 0) === 1,
    };
    if (dst) { dst.asig++; l.dest = dst.ub; l.grupo = dst.grp === '*' ? '(sin piso)' : dst.grp; l.ocupacion = `${dst.ocu + dst.asig} de ${dst.max}`; }
    else { l.dest = SIN_UBICACION; l.grupo = grp; l.obs = `Sin cupo en reservadas del grupo ${grp}: no mover; ampliar Blq_Stk_unit`; }
    lineas.push(l);
  });
  return { lineas, yaEnReservadas, cuposLibres: R.reduce((s, x) => s + Math.max(0, x.max - x.ocu), 0) };
}

/** Reparto por piso: máximo 2 operarios por piso, tramos continuos de la secuencia; corte cerca de la mitad donde cambia la zona. */
export function repartirStockUnitario(lineas, maxOp, pref, minDos = 20) {
  const TOL = 0.15;
  maxOp = Math.min(2, Math.max(1, maxOp || 2));
  const porPiso = new Map();
  for (const l of lineas) {
    if (l.dest === SIN_UBICACION) { l.asignado = 'SUPERVISOR'; continue; }
    const k = l.cd + '|' + l.piso;
    if (!porPiso.has(k)) porPiso.set(k, []);
    porPiso.get(k).push(l);
  }
  let nGlob = 0;
  const resumen = [];
  for (const [, f] of porPiso) {
    const m = f.length;
    const nOp = m < minDos ? 1 : maxOp;
    let corte = m;
    if (nOp === 2) {
      const objetivo = Math.floor((m + 1) / 2);
      corte = objetivo;
      let mejor = m + 1;
      for (let j = 1; j <= m - 1; j++) {
        if (Math.abs(j - objetivo) <= TOL * m && txt(f[j - 1].zp) !== txt(f[j].zp) && Math.abs(j - objetivo) < mejor) { mejor = Math.abs(j - objetivo); corte = j; }
      }
    }
    for (let a = 1; a <= nOp; a++) {
      nGlob++;
      const nom = `${up(pref)} ${String(nGlob).padStart(2, '0')}`;
      const desde = a === 1 ? 0 : corte, hasta = a === 1 ? corte : m;
      for (let j = desde; j < hasta; j++) f[j].asignado = nom;
      resumen.push({ operario: nom, piso: f[0].piso, movimientos: hasta - desde });
    }
  }
  return resumen;
}
