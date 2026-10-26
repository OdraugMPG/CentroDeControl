// Optimización con ABC/XYZ: cruza la clasificación consolidada (por SKU) con la Base del día para recomendar
// consolidación, reasignación hacia el CD prioritario (el más cercano a OSR y empaque), stock unitario e inventario cíclico.
import { q, tx } from '../db.js';
import { leerParametros } from './parametros.js';
import { filasDeCarga, ultimaCargaInicio } from './stock.js';
import { clasificacionActual } from './abcXyz.js';
import { TODOS } from '../engine/abcXyz.js';
import { up, cmp } from '../engine/util.js';
import { esAptoOsr } from '../engine/base.js';
import { libro } from './tareas.js';

// SKU de alta rotación que conviene tener en el CD prioritario
export const CLASES_TRAER = ['AX', 'AY', 'BX'];
// SKU sin venta (o sin stock) que liberan espacio en el CD prioritario
export const CLASES_LIBERAR = ['CZ'];

const nuevo = () => ({ A: 0, B: 0, C: 0 });

async function datos() {
  const carga = await ultimaCargaInicio();
  if (!carga) throw Object.assign(new Error('Carga primero una Base de stock en Asignación del día.'), { status: 400 });
  const p = await leerParametros();
  const d = await clasificacionActual();
  const clase = new Map(d.grupos.get(TODOS).map((x) => [x.sku, x]));
  const filas = (await filasDeCarga(carga.id)).filter((r) => r.cd && r.sku && r.ubic && r.qty > 0);
  return { carga, p, d, clase, filas };
}

/** SKU x CD con sus ubicaciones; y cuántos SKU distintos hay en cada ubicación. */
function indexar(filas, clase) {
  const sk = new Map(), skuEnUb = new Map();
  for (const r of filas) {
    const k = r.cd + '|' + r.sku;
    let x = sk.get(k);
    if (!x) {
      const c = clase.get(r.sku);
      x = { cd: r.cd, sku: r.sku, desc: r.desc, depto: r.depto, matriz: c?.matriz || 'CZ', abc: c?.abc || 'C', ventas: c?.ventas || 0, uni: 0, ubic: new Map() };
      sk.set(k, x);
    }
    x.uni += r.qty;
    if (!x.ubic.has(r.ubic)) x.ubic.set(r.ubic, { ubic: r.ubic, piso: r.piso, zp: r.zp, qty: 0 });
    x.ubic.get(r.ubic).qty += r.qty;
    const ku = r.cd + '|' + r.ubic;
    if (!skuEnUb.has(ku)) skuEnUb.set(ku, new Set());
    skuEnUb.get(ku).add(r.sku);
  }
  return { sk, skuEnUb };
}

export async function optimizacion() {
  const { carga, p, d, filas, clase } = await datos();
  const { sk, skuEnUb } = indexar(filas, clase);
  const cdPri = up(p.cdPrioritario);
  const cds = [...new Set(filas.map((r) => r.cd))].sort(cmp);
  const porCd = new Map(cds.map((cd) => [cd, { cd, skus: 0, uni: 0, ubic: 0, ubicAbc: nuevo(), uniAbc: nuevo(), cz: { skus: 0, uni: 0, ubic: 0 },
    cons: { A: { skus: 0, libera: 0 }, B: { skus: 0, libera: 0 }, C: { skus: 0, libera: 0 } }, su: nuevo() }]));
  // clase de una ubicación = la mejor clase de los SKU que guarda
  const claseUb = new Map();
  for (const x of sk.values()) {
    const c = porCd.get(x.cd);
    c.skus++; c.uni += x.uni; c.uniAbc[x.abc] += x.uni;
    if (x.matriz === 'CZ') { c.cz.skus++; c.cz.uni += x.uni; }
    for (const u of x.ubic.keys()) {
      const ku = x.cd + '|' + u;
      if (!claseUb.has(ku) || x.abc < claseUb.get(ku)) claseUb.set(ku, x.abc);
    }
    // consolidación: un SKU en n ubicaciones del CD libera hasta n - 1
    if (x.ubic.size > 1) { c.cons[x.abc].skus++; c.cons[x.abc].libera += x.ubic.size - 1; }
    // stock unitario: 1 unidad en 1 ubicación (OSR no se procesa)
    if (x.uni === 1 && x.ubic.size === 1 && !p.excluidos.has(x.cd)) c.su[x.abc]++;
  }
  for (const [ku, a] of claseUb) {
    const c = porCd.get(ku.split('|')[0]);
    c.ubic++; c.ubicAbc[a]++;
    if ([...skuEnUb.get(ku)].every((s) => (clase.get(s)?.matriz || 'CZ') === 'CZ')) c.cz.ubic++;
  }

  // --- reasignación hacia el CD prioritario
  const traer = [], liberar = [];
  for (const x of sk.values()) {
    if (x.cd !== cdPri && !p.excluidos.has(x.cd) && CLASES_TRAER.includes(x.matriz)) {
      traer.push({ cd: x.cd, sku: x.sku, desc: x.desc, depto: x.depto, matriz: x.matriz, ventas: x.ventas, uni: x.uni, nUb: x.ubic.size,
        enPri: sk.get(cdPri + '|' + x.sku)?.uni || 0, ubic: [...x.ubic.keys()].slice(0, 4) });
    }
    if (x.cd === cdPri && CLASES_LIBERAR.includes(x.matriz)) {
      const libera = [...x.ubic.keys()].filter((u) => skuEnUb.get(cdPri + '|' + u).size === 1).length;
      liberar.push({ cd: x.cd, sku: x.sku, desc: x.desc, depto: x.depto, matriz: x.matriz, uni: x.uni, nUb: x.ubic.size, libera, ubic: [...x.ubic.keys()].slice(0, 4) });
    }
  }
  traer.sort((a, b) => b.ventas - a.ventas || cmp(a.sku, b.sku));
  liberar.sort((a, b) => b.libera - a.libera || b.uni - a.uni);
  const sum = (l, k) => l.reduce((s, x) => s + x[k], 0);

  // --- inventario cíclico por clase: cada ubicación se cuenta cada N días según su clase
  const dias = { A: p.invDiasA, B: p.invDiasB, C: p.invDiasC };
  const inventario = [...porCd.values()].map((c) => ({ cd: c.cd, ubicAbc: c.ubicAbc, porDia: ['A', 'B', 'C'].reduce((s, a) => s + c.ubicAbc[a] / Math.max(1, dias[a]), 0) }));

  const { rows: cola } = await q("SELECT tipo, cd, count(*)::int AS n FROM sm_cola WHERE estado = 'EN COLA' GROUP BY tipo, cd ORDER BY tipo, cd");
  return {
    carga, metodo: d.metodo, cdPri, existePri: porCd.has(cdPri), excluidos: [...p.excluidos], dias,
    clasesTraer: CLASES_TRAER, clasesLiberar: CLASES_LIBERAR,
    cds: [...porCd.values()], inventario, cola,
    reasignacion: {
      traer: { skus: new Set(traer.map((x) => x.sku)).size, ubic: sum(traer, 'nUb'), uni: sum(traer, 'uni'), detalle: traer.slice(0, 300) },
      liberar: { skus: liberar.length, ubic: sum(liberar, 'nUb'), libera: sum(liberar, 'libera'), uni: sum(liberar, 'uni'), detalle: liberar.slice(0, 300) },
    },
  };
}

/**
 * Deja en cola las tareas de reasignación del CD prioritario (entran a la próxima asignación diaria):
 * - 'traer': una tarea REU por ubicación de los SKU AX/AY/BX que están en otros CD, con destino el CD prioritario;
 * - 'liberar': una tarea SM por ubicación de los SKU CZ del CD prioritario, hacia la zona de slow moving.
 */
export async function generarReasignacion(tipo, limite = 200) {
  const { p, filas, clase } = await datos();
  const { sk } = indexar(filas, clase);
  const cdPri = up(p.cdPrioritario);
  const lista = [...sk.values()].filter((x) => (tipo === 'traer'
    ? x.cd !== cdPri && !p.excluidos.has(x.cd) && CLASES_TRAER.includes(x.matriz)
    : x.cd === cdPri && CLASES_LIBERAR.includes(x.matriz)));
  lista.sort((a, b) => (tipo === 'traer' ? b.ventas - a.ventas : b.uni - a.uni) || cmp(a.sku, b.sku));
  const sel = lista.slice(0, Math.max(1, Number(limite) || 200));
  const destino = tipo === 'traer' ? `${cdPri} · ZONA ALTA ROTACIÓN` : (p.smDestino || 'ZONA SLOW MOVING');
  let n = 0;
  await tx(async (c) => {
    for (const x of sel) {
      for (const u of x.ubic.values()) {
        const ya = await c.query("SELECT 1 FROM sm_cola WHERE cd=$1 AND sku=$2 AND ubicacion=$3 AND estado='EN COLA'", [x.cd, x.sku, u.ubic]);
        if (ya.rowCount) continue;
        await c.query('INSERT INTO sm_cola (cd, sku, descripcion, depto, temporada, mes, piso, zona, ubicacion, unidades, destino, tipo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [x.cd, x.sku, x.desc, x.depto || '', x.matriz, '', u.piso, u.zp, u.ubic, u.qty, destino, tipo === 'traer' ? 'REU' : 'SM']);
        n++;
      }
    }
  });
  return { tareas: n, skus: sel.length, destino };
}

// ---------------------------------------------------------------------------------------------
// Ingreso de alta rotación a OSR: SKU aptos (Logística OSR = Y) que ya están en OSR y que conviene
// reforzar para cubrir N días de venta desde OSR, tomando stock de los otros CD.
// ---------------------------------------------------------------------------------------------
const DIAS_VENTAS = 60; // la columna VENTAS es la venta de los últimos 2 meses

async function calcularOsr({ dias = 7, clases = ['AX', 'AY'], incluirSinOsr = false } = {}) {
  const { carga, p, filas, clase } = await datos();
  const osr = up(p.cdOsr), cdPri = up(p.cdPrioritario);
  const D = Math.max(1, Number(dias) || 7);
  const cls = (Array.isArray(clases) ? clases : String(clases || '').split(',')).map(up).filter(Boolean);
  const hayCol = filas.some((r) => r.logOsr !== null && r.logOsr !== undefined);
  const sk = new Map();
  for (const r of filas) {
    let x = sk.get(r.sku);
    if (!x) {
      const c = clase.get(r.sku);
      x = { sku: r.sku, desc: r.desc, depto: r.depto, matriz: c?.matriz || 'CZ', abc: c?.abc || 'C', ventas: c?.ventas || 0, apto: false, flag: '', osr: 0, ubOsr: new Set(), otros: 0, origen: [] };
      sk.set(r.sku, x);
    }
    if (esAptoOsr(r.logOsr)) x.apto = true;
    else if (!x.flag && r.logOsr) x.flag = up(r.logOsr);
    if (r.cd === osr) { x.osr += r.qty; x.ubOsr.add(r.ubic); }
    else { x.otros += r.qty; x.origen.push({ cd: r.cd, ubic: r.ubic, piso: r.piso, zp: r.zp, qty: r.qty }); }
  }
  const tot = { osr: 0, osrA: 0, ventaA: 0, atendA: 0, aptos: 0, aptosEnOsr: 0 };
  const sug = [];
  for (const x of sk.values()) {
    x.ventaDia = x.ventas / DIAS_VENTAS;
    tot.osr += x.osr;
    if (x.abc === 'A') { tot.osrA += x.osr; tot.ventaA += x.ventaDia; tot.atendA += Math.min(x.ventaDia, x.osr / D); }
    // sin la columna Logística OSR en la Base, todos los SKU cuentan como aptos
    if (x.apto || !hayCol) { tot.aptos++; if (x.osr > 0) tot.aptosEnOsr++; }
    if ((hayCol && !x.apto) || !cls.includes(x.matriz) || !(x.ventaDia > 0) || (!x.osr && !incluirSinOsr)) continue;
    const falta = Math.ceil(x.ventaDia * D - x.osr);
    const unidades = Math.min(Math.max(0, falta), x.otros);
    if (!unidades) continue;
    // se toma primero de los CD que no son el prioritario (CD2 queda para el picking cercano a empaque)
    x.origen.sort((a, b) => (a.cd === cdPri) - (b.cd === cdPri) || b.qty - a.qty || cmp(a.ubic, b.ubic));
    const tomar = [];
    let resta = unidades;
    for (const o of x.origen) {
      if (resta <= 0) break;
      const t = Math.min(o.qty, resta);
      tomar.push({ ...o, qty: t });
      resta -= t;
    }
    sug.push({ sku: x.sku, desc: x.desc, depto: x.depto, matriz: x.matriz, abc: x.abc, ventaDia: x.ventaDia, osr: x.osr, otros: x.otros,
      cobAntes: x.osr / x.ventaDia, unidades, cobDespues: (x.osr + unidades) / x.ventaDia, tomar });
  }
  sug.sort((a, b) => b.ventaDia - a.ventaDia || cmp(a.sku, b.sku));
  // SKU que hoy están en OSR sin Logística OSR = Y (REVISION, N u otro valor), por estado y clase
  const noAptos = {};
  if (hayCol) {
    for (const x of sk.values()) {
      if (x.apto || !x.osr) continue;
      const e = x.flag || '(VACÍO)';
      const g = (noAptos[e] ??= { estado: e, skus: 0, uni: 0, ubic: 0, ventaDia: 0, abc: { A: { skus: 0, uni: 0, ubic: 0 }, B: { skus: 0, uni: 0, ubic: 0 }, C: { skus: 0, uni: 0, ubic: 0 } }, lista: [] });
      for (const c of [g, g.abc[x.abc]]) { c.skus++; c.uni += x.osr; c.ubic += x.ubOsr.size; }
      g.ventaDia += x.ventaDia;
      g.lista.push({ sku: x.sku, desc: x.desc, depto: x.depto, matriz: x.matriz, ventaDia: x.ventaDia, osr: x.osr, ubOsr: x.ubOsr.size, cob: x.ventaDia > 0 ? x.osr / x.ventaDia : null, otros: x.otros });
    }
    for (const g of Object.values(noAptos)) {
      g.lista.sort((a, b) => b.ventaDia - a.ventaDia || b.osr - a.osr || cmp(a.sku, b.sku));
      g.lista = g.lista.slice(0, 500);
    }
  }
  return { carga, p, osr, cdPri, D, cls, hayCol, tot, sug, noAptos };
}

/** Simulación: qué ingresar a OSR y cómo cambia la participación de la clase A y la venta atendible desde OSR. */
export async function simularOsr(params = {}) {
  const { carga, p, osr, cdPri, D, cls, hayCol, tot, sug, noAptos } = await calcularOsr(params);
  const limite = Math.max(1, Number(params.skus) || sug.length);
  const sel = sug.slice(0, limite);
  const uni = sel.reduce((s, x) => s + x.unidades, 0);
  const uniA = sel.filter((x) => x.abc === 'A').reduce((s, x) => s + x.unidades, 0);
  const atendDesp = tot.atendA + sel.filter((x) => x.abc === 'A').reduce((s, x) => s + (Math.min(x.ventaDia, (x.osr + x.unidades) / D) - Math.min(x.ventaDia, x.osr / D)), 0);
  const delta = atendDesp - tot.atendA;
  const hh = delta / Math.max(1, p.pickUnHH);
  return {
    carga, osr, cdPri, dias: D, clases: cls, hayCol, aptos: tot.aptos, aptosEnOsr: tot.aptosEnOsr, existeOsr: tot.osr > 0,
    candidatos: sug.length, skus: sel.length, unidades: uni, ubicaciones: sel.reduce((s, x) => s + x.tomar.length, 0),
    pctA: { antes: tot.osr ? tot.osrA / tot.osr : 0, despues: tot.osr + uni ? (tot.osrA + uniA) / (tot.osr + uni) : 0 },
    atendidaA: { antes: tot.atendA, despues: atendDesp, ventaA: tot.ventaA },
    // unidades por día que dejan de pickearse a mano → horas-hombre y operarios por día (estimación)
    ahorro: { unidadesDia: delta, hhDia: hh, operarios: hh / Math.max(1, p.horasTurno), pickUnHH: p.pickUnHH },
    porCd: Object.entries(sel.flatMap((x) => x.tomar).reduce((a, t) => ({ ...a, [t.cd]: (a[t.cd] || 0) + t.qty }), {})).map(([cd, unidades]) => ({ cd, unidades })).sort((a, b) => b.unidades - a.unidades),
    detalle: sel.slice(0, 500).map(({ tomar, ...x }) => ({ ...x, nUb: tomar.length, desde: tomar.map((t) => ({ cd: t.cd, ubic: t.ubic, qty: t.qty })) })),
    // REVISION primero, después N y otros valores
    noAptos: Object.values(noAptos).sort((a, b) => (b.estado === 'REVISION') - (a.estado === 'REVISION') || cmp(a.estado, b.estado)),
  };
}

/** Deja en cola las tareas de ingreso a OSR (una por ubicación de origen, con las unidades sugeridas). */
export async function generarIngresoOsr(params = {}) {
  const { osr, sug } = await calcularOsr(params);
  const sel = sug.slice(0, Math.max(1, Number(params.skus) || sug.length));
  const destino = `${osr} · INGRESO ALTA ROTACIÓN`;
  let n = 0;
  await tx(async (c) => {
    for (const x of sel) {
      for (const t of x.tomar) {
        const ya = await c.query("SELECT 1 FROM sm_cola WHERE cd=$1 AND sku=$2 AND ubicacion=$3 AND estado='EN COLA'", [t.cd, x.sku, t.ubic]);
        if (ya.rowCount) continue;
        await c.query('INSERT INTO sm_cola (cd, sku, descripcion, depto, temporada, mes, piso, zona, ubicacion, unidades, destino, tipo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [t.cd, x.sku, x.desc, x.depto || '', x.matriz, '', t.piso, t.zp, t.ubic, t.qty, destino, 'REU']);
        n++;
      }
    }
  });
  return { tareas: n, skus: sel.length, destino };
}

// ---------------------------------------------------------------------------------------------
// Consolidación entre CD: SKU con stock repartido en varios CD y simulación para dejarlos en uno solo.
// Regla OSR: el stock que está en OSR se mantiene, pero el SKU debe tener stock de seguridad fuera de OSR
// (N días de venta) en un único CD de respaldo; si no lo tiene, se propone extraer la diferencia desde OSR.
// ---------------------------------------------------------------------------------------------
export const CRITERIOS_CONS = { unidades: 'CD con más unidades (menos movimiento)', prioritario: 'Alta rotación al CD prioritario; el resto al CD con más unidades' };
const MAX_EXTRAER_OSR = 0.5;
export const ESTADOS_CONS = { CONSOLIDAR: 'Consolidar', CONS_OSR: 'Consolidar fuera de OSR', SIN_SS: 'Sin stock de seguridad fuera de OSR', SS_BAJO: 'Stock de seguridad insuficiente' };

async function calcularConsolidacionCds({ criterio = 'unidades', diasSS = 7 } = {}) {
  const { carga, p, filas, clase } = await datos();
  const osr = up(p.cdOsr), cdPri = up(p.cdPrioritario);
  const D = Math.max(0, Number(diasSS) || 0);
  const crit = criterio in CRITERIOS_CONS ? criterio : 'unidades';
  const cds = [...new Set(filas.map((r) => r.cd))].sort(cmp);
  const sk = new Map(), skuEnUb = new Map();
  for (const r of filas) {
    let x = sk.get(r.sku);
    if (!x) {
      const c = clase.get(r.sku);
      x = { sku: r.sku, desc: r.desc, depto: r.depto, matriz: c?.matriz || 'CZ', abc: c?.abc || 'C', ventaDia: (c?.ventas || 0) / DIAS_VENTAS, porCd: new Map() };
      sk.set(r.sku, x);
    }
    let e = x.porCd.get(r.cd);
    if (!e) x.porCd.set(r.cd, (e = { cd: r.cd, uni: 0, ubic: new Map() }));
    e.uni += r.qty;
    if (!e.ubic.has(r.ubic)) e.ubic.set(r.ubic, { ubic: r.ubic, piso: r.piso, zp: r.zp, qty: 0 });
    e.ubic.get(r.ubic).qty += r.qty;
    const ku = r.cd + '|' + r.ubic;
    if (!skuEnUb.has(ku)) skuEnUb.set(ku, new Set());
    skuEnUb.get(ku).add(r.sku);
  }

  const lista = [], movs = [];
  const tot = { skus: sk.size, unCd: 0, dispersos: 0, enOsr: 0 };
  for (const x of sk.values()) {
    const enOsr = x.porCd.get(osr)?.uni || 0;
    const fuera = [...x.porCd.values()].filter((e) => e.cd !== osr);
    if (x.porCd.size === 1) tot.unCd++; else tot.dispersos++;
    if (enOsr) tot.enOsr++;
    const ss = Math.ceil(x.ventaDia * D);
    const fueraUni = fuera.reduce((s, e) => s + e.uni, 0);
    const faltaSS = enOsr ? Math.max(0, ss - fueraUni) : 0;
    if (fuera.length < 2 && !faltaSS) continue;

    // CD destino (siempre fuera de OSR): el de más unidades, o el prioritario para la alta rotación
    fuera.sort((a, b) => b.uni - a.uni || b.ubic.size - a.ubic.size || (b.cd === cdPri) - (a.cd === cdPri) || cmp(a.cd, b.cd));
    let destino = fuera[0]?.cd || cdPri;
    if (crit === 'prioritario' && CLASES_TRAER.includes(x.matriz) && cds.includes(cdPri)) destino = cdPri;
    const r = { sku: x.sku, desc: x.desc, depto: x.depto, matriz: x.matriz, abc: x.abc, ventaDia: x.ventaDia,
      unidades: Object.fromEntries([...x.porCd.values()].map((e) => [e.cd, e.uni])), nCds: x.porCd.size,
      total: [...x.porCd.values()].reduce((s, e) => s + e.uni, 0), nUb: [...x.porCd.values()].reduce((s, e) => s + e.ubic.size, 0),
      osr: enOsr, destino, uniMover: 0, ubMover: 0, ubLibera: 0, ss: enOsr ? ss : null, extraerOsr: 0 };

    for (const e of fuera) {
      if (e.cd === destino) continue;
      for (const u of e.ubic.values()) {
        const libera = skuEnUb.get(e.cd + '|' + u.ubic).size === 1;
        movs.push({ sku: x.sku, desc: x.desc, matriz: x.matriz, cdOrigen: e.cd, ubic: u.ubic, piso: u.piso, zp: u.zp, qty: u.qty, cdDestino: destino, motivo: 'Consolidación', libera });
        r.uniMover += u.qty; r.ubMover++;
        if (libera) r.ubLibera++;
      }
    }
    // stock de seguridad fuera de OSR: lo que falta se extrae desde las ubicaciones de OSR con más unidades,
    // como máximo la mitad del stock de OSR para no vaciar el automático
    let resta = Math.min(faltaSS, Math.floor(enOsr * MAX_EXTRAER_OSR));
    for (const u of resta ? [...x.porCd.get(osr).ubic.values()].sort((a, b) => b.qty - a.qty || cmp(a.ubic, b.ubic)) : []) {
      if (resta <= 0) break;
      const t = Math.min(u.qty, resta);
      movs.push({ sku: x.sku, desc: x.desc, matriz: x.matriz, cdOrigen: osr, ubic: u.ubic, piso: u.piso, zp: u.zp, qty: t, cdDestino: destino, motivo: 'Stock de seguridad fuera de OSR', libera: false });
      r.extraerOsr += t; r.ubMover++;
      resta -= t;
    }
    r.ssDespues = enOsr ? fueraUni + r.extraerOsr : null;
    r.osrDespues = enOsr - r.extraerOsr;
    r.cubreSS = enOsr ? r.ssDespues >= ss : null;
    r.estado = !enOsr ? ESTADOS_CONS.CONSOLIDAR : !fueraUni ? ESTADOS_CONS.SIN_SS : faltaSS ? ESTADOS_CONS.SS_BAJO : ESTADOS_CONS.CONS_OSR;
    r.cdsDespues = [destino, ...(r.osrDespues > 0 ? [osr] : [])];
    lista.push(r);
  }
  // primero lo que más vende (clase A), después lo que más ubicaciones libera
  lista.sort((a, b) => cmp(a.abc, b.abc) || b.ventaDia - a.ventaDia || b.ubLibera - a.ubLibera || cmp(a.sku, b.sku));
  const orden = new Map(lista.map((r, i) => [r.sku, i]));
  movs.sort((a, b) => orden.get(a.sku) - orden.get(b.sku));

  // balance por CD: SKU antes / después, unidades que salen / entran y ubicaciones que se liberan
  const bal = new Map(cds.map((cd) => [cd, { cd, skusAntes: 0, skusDespues: 0, sale: 0, entra: 0, ubLibera: 0 }]));
  const despues = new Map([...sk.values()].map((x) => [x.sku, [...x.porCd.keys()]]));
  for (const x of sk.values()) for (const cd of x.porCd.keys()) bal.get(cd).skusAntes++;
  for (const r of lista) despues.set(r.sku, r.cdsDespues);
  for (const l of despues.values()) for (const cd of l) if (bal.has(cd)) bal.get(cd).skusDespues++;
  for (const m of movs) {
    const o = bal.get(m.cdOrigen);
    o.sale += m.qty;
    if (m.libera) o.ubLibera++;
    if (bal.has(m.cdDestino)) bal.get(m.cdDestino).entra += m.qty;
  }

  const porEstado = Object.values(ESTADOS_CONS).map((estado) => {
    const l = lista.filter((r) => r.estado === estado);
    return { estado, skus: l.length, uni: l.reduce((s, r) => s + r.uniMover + r.extraerOsr, 0) };
  });
  const sum = (k) => lista.reduce((s, r) => s + r[k], 0);
  return {
    carga, osr, cdPri, cds, criterio: crit, criterios: CRITERIOS_CONS, diasSS: D, tot, porEstado, lista, movs,
    resumen: { skus: lista.length, uniMover: sum('uniMover'), extraerOsr: sum('extraerOsr'), ubMover: sum('ubMover'), ubLibera: sum('ubLibera'),
      noCubreSS: lista.filter((r) => r.cubreSS === false).length },
    balance: [...bal.values()],
  };
}

/** Simulación para la vista: totales, balance por CD y los primeros 500 SKU (filtrables por estado y clase). */
export async function consolidacionCds(params = {}) {
  const { lista, movs, ...r } = await calcularConsolidacionCds(params);
  const est = params.estado || '', abc = up(params.abc);
  const sel = lista.filter((x) => (!est || x.estado === est) && (!abc || x.abc === abc));
  return { ...r, filtrados: sel.length, detalle: sel.slice(0, 500), movimientos: movs.length };
}

/** Reporte .xlsx con todos los SKU con acción, los movimientos sugeridos y el balance por CD. */
export async function archivoConsolidacionCds(params = {}) {
  const d = await calcularConsolidacionCds(params);
  const fecha = d.carga.fecha instanceof Date ? d.carga.fecha.toISOString().slice(0, 10) : String(d.carga.fecha).slice(0, 10);
  const resumen = [
    ['Consolidación de SKU entre CD (simulación)'],
    ['Base de stock', fecha],
    ['Criterio del CD destino', d.criterios[d.criterio]],
    ['CD del OSR', d.osr],
    ['Stock de seguridad fuera de OSR', `${d.diasSS} días de venta (venta diaria = ventas 2 meses / ${DIAS_VENTAS}); de OSR se extrae como máximo el ${MAX_EXTRAER_OSR * 100}% de su stock`],
    [],
    ['SKU con stock', d.tot.skus], ['SKU en un solo CD', d.tot.unCd], ['SKU en 2 o más CD', d.tot.dispersos], ['SKU con stock en OSR', d.tot.enOsr],
    [],
    ['SKU con acción', d.resumen.skus], ['Unidades a mover (consolidación)', d.resumen.uniMover], ['Unidades a extraer de OSR (stock de seguridad)', d.resumen.extraerOsr],
    ['Ubicaciones de origen (tareas)', d.resumen.ubMover], ['Ubicaciones que quedan libres', d.resumen.ubLibera],
    ['SKU de OSR que no alcanzan el stock de seguridad fuera', d.resumen.noCubreSS],
    [],
    ['Estado', 'SKU', 'Unidades a mover'], ...d.porEstado.map((e) => [e.estado, e.skus, e.uni]),
  ];
  const porSku = [['SKU', 'Descripción', 'Depto', 'Clase', 'Venta/día', 'N° CD', ...d.cds.map((cd) => `Unid. ${cd}`), 'Total unidades', 'Ubicaciones',
    'CD destino', 'Unid. a mover', 'Ubic. a mover', 'Ubic. que se liberan', `Stock seg. requerido (${d.diasSS} d)`, 'Unid. a extraer de OSR',
    'Stock fuera de OSR después', 'Stock OSR después', 'Cubre stock seg.', 'CD después', 'Estado'],
  ...d.lista.map((r) => [r.sku, r.desc, r.depto, r.matriz, Math.round(r.ventaDia * 100) / 100, r.nCds, ...d.cds.map((cd) => r.unidades[cd] || 0), r.total, r.nUb,
    r.destino, r.uniMover, r.ubMover, r.ubLibera, r.ss ?? '', r.extraerOsr, r.ssDespues ?? '', r.osr ? r.osrDespues : '',
    r.cubreSS === null ? '' : r.cubreSS ? 'Sí' : 'No', r.cdsDespues.join(' + '), r.estado])];
  const movs = [['SKU', 'Descripción', 'Clase', 'CD origen', 'Piso', 'Zona pasillo', 'Ubicación origen', 'Unidades', 'CD destino', 'Motivo', 'Libera ubicación'],
    ...d.movs.map((m) => [m.sku, m.desc, m.matriz, m.cdOrigen, m.piso, m.zp, m.ubic, m.qty, m.cdDestino, m.motivo, m.libera ? 'Sí' : 'No'])];
  const bal = [['CD', 'SKU antes', 'SKU después', 'Unidades que salen', 'Unidades que entran', 'Ubicaciones que se liberan'],
    ...d.balance.map((b) => [b.cd, b.skusAntes, b.skusDespues, b.sale, b.entra, b.ubLibera])];
  return {
    buffer: libro([['Resumen', resumen, [46, 60, 16]],
      ['Por SKU', porSku, [16, 36, 18, 7, 10, 6, ...d.cds.map(() => 11), 12, 11, 10, 12, 11, 14, 16, 16, 16, 14, 12, 14, 34]],
      ['Movimientos', movs, [16, 36, 7, 10, 8, 12, 18, 10, 10, 30, 10]], ['Balance por CD', bal, [10, 11, 12, 18, 18, 24]]]),
    nombre: `Consolidacion_CD_${fecha}.xlsx`,
  };
}
