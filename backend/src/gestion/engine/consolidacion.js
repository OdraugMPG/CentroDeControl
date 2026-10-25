// Tareas de consolidación del turno (port de mod2_Tareas, Fase 1 desde el plan) y reparto (mod3_Reparto).
import { up, cmp } from './util.js';
import { movimientosPorSku } from './plan.js';

/**
 * Fase 1 ejecutable: solo se mueven ubicaciones mono-SKU completas a otra ubicación mono-SKU del mismo
 * SKU en la misma zona (prefijo de 3 letras) con espacio libre (capacidad de referencia = la ubicación con
 * más unidades). Solo entran los movimientos cuyo ORIGEN está en una zona del turno.
 */
export function tareasConsolidacion({ filas, cd, reservadas, zonasTurno }) {
  const filasCd = filas.filter((r) => r.cd === cd && r.sku && r.qty > 0 && !reservadas.has(r.ubic));
  const nSkuUbic = new Map();
  const visto = new Set();
  for (const r of filasCd) {
    const k = r.ubic + '|' + r.sku;
    if (!visto.has(k)) { visto.add(k); nSkuUbic.set(r.ubic, (nSkuUbic.get(r.ubic) || 0) + 1); }
  }
  const grupos = [];
  for (const g of movimientosPorSku(filasCd, nSkuUbic)) {
    const keep = [];
    for (const mv of g.movs) {
      const f = g.u[mv.o].fila;
      if (zonasTurno.has(up(f.piso) + '|' + up(f.zp))) keep.push(mv);
      else { g.est[mv.o] = 0; g.cur[mv.d] -= mv.q; g.recib[mv.d] -= mv.q; }
    }
    if (!keep.length) continue;
    g.u.forEach((_, p) => { if (g.est[p] === 2 && g.recib[p] <= 1e-7) g.est[p] = 0; });
    const f0 = g.u[0].fila;
    const lineas = [];
    g.u.forEach((x, p) => {
      if (g.est[p] !== 2) return;
      lineas.push({ accion: 'MANTENER', ori: x.ubic, qtyOri: x.qty, dest: x.ubic, q: g.recib[p], qFinal: g.cur[p], piso: x.fila.piso, zp: x.fila.zp, zona: g.zn[p],
        detalle: `DESTINO (zona ${g.zn[p]}): ${x.qty} un. + recibe ${g.recib[p]} = ${g.cur[p]} un. (cap. ref. ${g.cap})` });
    });
    for (const mv of keep) {
      const o = g.u[mv.o], d = g.u[mv.d];
      lineas.push({ accion: 'MOVER', ori: o.ubic, qtyOri: o.qty, dest: d.ubic, q: mv.q, qFinal: 0, piso: o.fila.piso, zp: o.fila.zp, zona: g.zn[mv.o],
        detalle: `MOVER ${mv.q} un. (todo) desde ${o.ubic} a ${d.ubic} | misma zona ${g.zn[mv.o]} | libera la ubicación` });
    }
    grupos.push({ sku: g.sku, desc: f0.desc, marca: f0.marca, depto: f0.depto, cap: g.cap, nUbic: g.u.length, libera: keep.length, lineas });
  }
  grupos.sort((a, b) => b.libera - a.libera || cmp(a.sku, b.sku));
  grupos.forEach((g, i) => { g.folio = 'T-' + String(i + 1).padStart(5, '0'); g.prioridad = i + 1; g.sub = '1/1'; });
  return grupos;
}

/**
 * Reparto por zona de origen en tramos continuos de recorrido (mod3). Cada bloque (tarea|sub|zona) va
 * entero a un operario; con porPiso cada operario trabaja un solo piso. Devuelve un Map bloque -> operario.
 */
export function repartirConsolidacion(lineasMover, nOp, pref, porPiso = true) {
  const PESO_PARADA = 5, TOL = 0.15;
  const nombres = Array.from({ length: nOp }, (_, a) => `${up(pref)} ${String(a + 1).padStart(2, '0')}`);
  const bloques = new Map();
  for (const l of lineasMover) {
    const sk = l.folio + '|' + l.sub;
    const zona = l.ori.slice(0, 3);
    const k = sk + '|' + zona;
    let b = bloques.get(k);
    if (!b) { b = { k, tar: l.folio, sub: sk, zona, piso: up(l.piso), cd: up(l.cd), minUb: l.ori, uds: 0, lin: 0, op: -1, mot: '' }; bloques.set(k, b); }
    if (l.ori < b.minUb) b.minUb = l.ori;
    b.uds += l.q; b.lin++;
  }
  const U = [...bloques.values()];
  if (!U.length) return { porBloque: new Map(), nombres, resumen: [], alertas: [] };
  U.forEach((b) => { b.carga = b.uds + PESO_PARADA * b.lin; b.orden = [b.cd, b.piso, b.zona, b.minUb, b.sub].join('|'); });
  const idx = U.slice().sort((a, b) => cmp(a.orden, b.orden));
  const gk = (b) => (porPiso ? b.piso : '*');
  const dGrp = new Map(), dZL = new Map();
  for (const b of U) {
    dGrp.set(gk(b), (dGrp.get(gk(b)) || 0) + b.carga);
    const zk = gk(b) + '|' + b.cd + '|' + b.zona;
    dZL.set(zk, (dZL.get(zk) || 0) + b.carga);
  }
  const P = [...dGrp.entries()].map(([nom, car]) => ({ nom, car, ops: 0 })).sort((a, b) => b.car - a.car);
  let libres = nOp;
  for (const g of P) if (libres > 0) { g.ops = 1; libres--; }
  while (libres > 0) {
    let mejor = null;
    for (const g of P) if (g.ops > 0 && (!mejor || g.car / g.ops > mejor.car / mejor.ops)) mejor = g;
    mejor.ops++; libres--;
  }
  const pisoOp = new Array(nOp).fill('');
  let next = 0;
  for (const g of P) { g.lista = []; for (let j = 0; j < g.ops; j++) { g.lista.push(next); if (porPiso) pisoOp[next] = g.nom; next++; } }
  for (const g of P) {
    if (!g.ops) continue;
    const m = g.ops;
    let resto = g.car, c = 1, acc = 0, prevZona = '\u0001', entera = false, zl = 0;
    let objetivo = resto / m;
    for (const b of idx) {
      if (gk(b) !== g.nom) continue;
      let cortar = false;
      if (b.cd + '|' + b.zona !== prevZona) {
        zl = dZL.get(g.nom + '|' + b.cd + '|' + b.zona) || 0;
        if (c < m && acc > 0) {
          if (acc + zl <= objetivo * (1 + TOL)) entera = true;
          else if (acc >= objetivo * (1 - TOL)) cortar = true;
          else entera = false;
        } else entera = acc + zl <= objetivo * (1 + TOL);
      } else if (c < m && !entera && acc + b.carga / 2 > objetivo) cortar = true;
      if (cortar) {
        resto -= acc; c++; acc = 0;
        objetivo = resto / (m - c + 1);
        entera = zl <= objetivo * (1 + TOL);
      }
      b.op = g.lista[c - 1];
      acc += b.carga;
      prevZona = b.cd + '|' + b.zona;
    }
  }
  const cargaOp = new Array(nOp).fill(0);
  U.forEach((b) => { if (b.op >= 0) cargaOp[b.op] += b.carga; });
  const alertas = [];
  for (const b of idx) {
    if (b.op >= 0) continue;
    let mejor = 0;
    for (let a = 1; a < nOp; a++) if (cargaOp[a] < cargaOp[mejor]) mejor = a;
    b.op = mejor; cargaOp[mejor] += b.carga;
    b.mot = `ASIGNADA FUERA DE SU PISO: no hay operario para el piso ${b.piso} (${nombres[mejor]} es del piso ${pisoOp[mejor]})`;
  }
  if (porPiso && P.length > nOp) alertas.push(`Hay ${P.length} pisos con tareas y solo ${nOp} operario(s).`);
  const resumen = nombres.map((n, a) => {
    const bs = U.filter((b) => b.op === a);
    return { operario: n, piso: pisoOp[a], bloques: bs.length, paradas: bs.reduce((s, b) => s + b.lin, 0), unidades: bs.reduce((s, b) => s + b.uds, 0), carga: cargaOp[a],
      zonas: [...new Set(bs.map((b) => b.zona))].sort().join(', ') };
  });
  resumen.filter((r) => !r.bloques).forEach((r) => alertas.push(`${r.operario} quedó sin tareas.`));
  const conCarga = resumen.filter((r) => r.carga > 0).map((r) => r.carga);
  if (conCarga.length > 1 && Math.max(...conCarga) / Math.min(...conCarga) > 1.35) alertas.push('Carga desbalanceada entre operarios (los cortes respetan las zonas).');
  const porBloque = new Map(U.map((b) => [b.k, { operario: nombres[b.op], obs: b.mot, orden: b.orden }]));
  return { porBloque, nombres, resumen, alertas };
}

export const claveBloque = (l) => l.folio + '|' + l.sub + '|' + l.ori.slice(0, 3);
