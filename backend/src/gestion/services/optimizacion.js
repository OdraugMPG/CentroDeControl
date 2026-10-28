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
import { tareasConsolidacion } from '../engine/consolidacion.js';
import { pickingPorSku, skuKey } from './participacionCd.js';

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
// Consolidación entre CD: SKU con stock repartido en varios CD de picking y simulación para dejarlos en uno solo.
// Regla OSR: el stock que está en OSR se mantiene, pero el SKU debe tener stock de seguridad fuera de OSR
// (N días de venta) en un único CD de respaldo; si no lo tiene, se propone extraer la diferencia desde OSR.
// CD buffer (RCI): reserva de reabastecimiento. No es destino, su stock no se mueve (cuenta como respaldo fuera
// de OSR) y los SKU que solo tienen stock ahí reciben N días de venta en un CD de picking, para no pickear del buffer.
// CD de etiqueta: los SKU con picking de ETIQUETA (y los de tarea que salen en pedidos mixtos) se consolidan en él,
// para que un pedido con tarea y etiqueta salga de un solo CD. El tipo de picking sale del archivo de Participación por CD.
// ---------------------------------------------------------------------------------------------
export const CRITERIOS_CONS = { unidades: 'CD con más unidades (menos movimiento)', prioritario: 'Alta rotación al CD prioritario; el resto al CD con más unidades' };
const MAX_EXTRAER_OSR = 0.5;
export const ESTADOS_RUTA = { CONSOLIDAR: 'Consolidar en destino', NUEVO: 'Nuevo en destino' };
export const ESTADOS_CONS = { CONSOLIDAR: 'Consolidar', ETQ: 'Llevar al CD de etiqueta', BUFFER: 'Abastecer picking desde buffer', CONS_OSR: 'Consolidar fuera de OSR',
  SIN_SS: 'Sin stock de seguridad fuera de OSR', SS_BAJO: 'Stock de seguridad insuficiente' };
export const TIPOS_PICK = { TAREA: 'Tarea', ETIQUETA: 'Etiqueta', MIXTO: 'Tarea y etiqueta', SIN: 'Sin picking' };
const listaCds = (s) => String(s || '').split('|').map(up).filter(Boolean);

async function calcularConsolidacionCds({ criterio = 'unidades', diasSS = 7, desde = '', hasta = '', soloEnDestino = true, tipo = '', cdEtiqueta, mixtoPct } = {}) {
  const { carga, p, filas, clase } = await datos();
  const osr = up(p.cdOsr), cdPri = up(p.cdPrioritario);
  const D = Math.max(0, Number(diasSS) || 0);
  const crit = criterio in CRITERIOS_CONS ? criterio : 'unidades';
  const cds = [...new Set(filas.map((r) => r.cd))].sort(cmp);
  const buffer = listaCds(p.cdsBuffer).filter((cd) => cd !== osr && cds.includes(cd));
  const esBuf = (cd) => buffer.includes(cd);
  const primero = listaCds(p.cdsConsPrimero).filter((cd) => !esBuf(cd));
  const cdsPick = cds.filter((cd) => cd !== osr && !esBuf(cd));
  const etqPar = up(cdEtiqueta === undefined || cdEtiqueta === null ? p.cdEtiqueta : cdEtiqueta);
  const cdEtq = cdsPick.includes(etqPar) ? etqPar : '';
  const umbral = mixtoPct !== undefined && mixtoPct !== '' && mixtoPct !== null ? Math.max(0, Number(mixtoPct) || 0) : Number(p.consMixtoPct) || 0;
  const tipoSel = tipo in TIPOS_PICK ? tipo : '';
  // picking por SKU (archivo de Participación por CD)
  const pk = await pickingPorSku();
  // simulación de una ruta Desde → Hasta (el OSR queda fuera: tiene su propia regla de stock de seguridad)
  let ruta = null;
  if (desde || hasta) {
    const de = up(desde), a = up(hasta);
    if (!de || !a || de === a || de === osr || a === osr || !cds.includes(de) || !cds.includes(a)) {
      throw Object.assign(new Error('Elige dos CD distintos de la Base (sin OSR) para la ruta Desde → Hasta.'), { status: 400 });
    }
    ruta = { desde: de, hasta: a, soloEnDestino: soloEnDestino !== false && soloEnDestino !== 'false' };
  }
  const sk = new Map(), skuEnUb = new Map();
  for (const r of filas) {
    let x = sk.get(r.sku);
    if (!x) {
      const c = clase.get(r.sku);
      const k = pk.skus.get(skuKey(r.sku));
      const tipoPick = !k || !(k.tarea + k.etiqueta) ? 'SIN' : k.tarea && k.etiqueta ? 'MIXTO' : k.etiqueta ? 'ETIQUETA' : 'TAREA';
      x = { sku: r.sku, desc: r.desc, depto: r.depto, matriz: c?.matriz || 'CZ', abc: c?.abc || 'C', ventaDia: (c?.ventas || 0) / DIAS_VENTAS, porCd: new Map(),
        tipoPick, pctMixto: k?.pedidos ? k.mixtos / k.pedidos : 0, pickBuf: k ? buffer.reduce((s, cd) => s + (k.porCd[cd] || 0), 0) : 0,
        pickDia: k && pk.dias ? k.u / pk.dias : 0 };
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
  const porTipo = Object.fromEntries(Object.keys(TIPOS_PICK).map((t) => [t, 0]));
  for (const x of sk.values()) porTipo[x.tipoPick]++;
  const skus = [...sk.values()].filter((x) => !tipoSel || x.tipoPick === tipoSel);

  const lista = [], movs = [];
  const tot = { skus: skus.length, unCd: 0, dispersos: 0, enOsr: 0 };
  const pickBuf = { total: 0, evitable: 0 };
  for (const x of skus) {
    const enOsr = x.porCd.get(osr)?.uni || 0;
    const fuera = [...x.porCd.values()].filter((e) => e.cd !== osr);
    const pick = fuera.filter((e) => !esBuf(e.cd));
    const bufs = fuera.filter((e) => esBuf(e.cd));
    if (pick.length + (enOsr ? 1 : 0) <= 1) tot.unCd++; else tot.dispersos++;
    if (enOsr) tot.enOsr++;
    pickBuf.total += x.pickBuf;
    const base = (destino, motivoDestino) => ({ sku: x.sku, desc: x.desc, depto: x.depto, matriz: x.matriz, abc: x.abc, ventaDia: x.ventaDia,
      tipoPick: x.tipoPick, pctMixto: x.pctMixto, pickBuf: x.pickBuf,
      unidades: Object.fromEntries([...x.porCd.values()].map((e) => [e.cd, e.uni])), nCds: x.porCd.size,
      total: [...x.porCd.values()].reduce((s, e) => s + e.uni, 0), nUb: [...x.porCd.values()].reduce((s, e) => s + e.ubic.size, 0),
      osr: enOsr, destino, motivoDestino, uniMover: 0, ubMover: 0, ubLibera: 0, ss: null, extraerOsr: 0, desdeBuffer: 0, vaEtq: false });
    const mover = (r, e, destino) => {
      for (const u of e.ubic.values()) {
        const libera = skuEnUb.get(e.cd + '|' + u.ubic).size === 1;
        movs.push({ sku: x.sku, desc: x.desc, matriz: x.matriz, cdOrigen: e.cd, ubic: u.ubic, piso: u.piso, zp: u.zp, qty: u.qty, cdDestino: destino, motivo: 'Consolidación', libera });
        r.uniMover += u.qty; r.ubMover++;
        if (libera) r.ubLibera++;
      }
    };
    // retira hasta "cant" unidades de las ubicaciones de un CD, primero la de más unidades
    const extraer = (r, e, cant, destino, motivo) => {
      let resta = cant, n = 0;
      for (const u of [...e.ubic.values()].sort((a, b) => b.qty - a.qty || cmp(a.ubic, b.ubic))) {
        if (resta <= 0) break;
        const t = Math.min(u.qty, resta);
        movs.push({ sku: x.sku, desc: x.desc, matriz: x.matriz, cdOrigen: e.cd, ubic: u.ubic, piso: u.piso, zp: u.zp, qty: t, cdDestino: destino, motivo, libera: false });
        r.ubMover++; resta -= t; n += t;
      }
      return n;
    };

    // ruta elegida (Desde → Hasta): todo el stock del SKU en el CD de origen pasa al de destino; los demás CD no se tocan
    if (ruta) {
      const o = x.porCd.get(ruta.desde), dst = x.porCd.get(ruta.hasta);
      if (!o?.uni || (ruta.soloEnDestino && !dst?.uni)) continue;
      const r = base(ruta.hasta, `Ruta ${ruta.desde} → ${ruta.hasta}`);
      mover(r, o, ruta.hasta);
      Object.assign(r, { ssDespues: null, osrDespues: enOsr, cubreSS: null, estado: dst?.uni ? ESTADOS_RUTA.CONSOLIDAR : ESTADOS_RUTA.NUEVO,
        cdsDespues: [...new Set([...x.porCd.keys()].filter((cd) => cd !== ruta.desde).concat(ruta.hasta))] });
      lista.push(r);
      continue;
    }

    const ss = Math.ceil(x.ventaDia * D);
    const fueraUni = fuera.reduce((s, e) => s + e.uni, 0); // el buffer cuenta como respaldo fuera de OSR
    const bufUni = bufs.reduce((s, e) => s + e.uni, 0);
    const faltaSS = enOsr ? Math.max(0, ss - fueraUni) : 0;
    // CD destino (nunca OSR ni buffer): CD de etiqueta; si no, consolidación directa donde ya tenga stock;
    // si no, el de más unidades o el prioritario para la alta rotación
    pick.sort((a, b) => b.uni - a.uni || b.ubic.size - a.ubic.size || (b.cd === cdPri) - (a.cd === cdPri) || cmp(a.cd, b.cd));
    const sinPick = cdsPick.includes(cdPri) ? cdPri : cdsPick[0];
    let destino = pick[0]?.cd || sinPick, motivoDestino = pick.length ? 'Más unidades' : 'CD prioritario';
    if (crit === 'prioritario' && CLASES_TRAER.includes(x.matriz) && cdsPick.includes(cdPri)) { destino = cdPri; motivoDestino = 'CD prioritario'; }
    const directo = primero.find((cd) => x.porCd.get(cd)?.uni > 0);
    if (directo) { destino = directo; motivoDestino = `Prioridad ${directo}`; }
    const vaEtq = !!cdEtq && (x.tipoPick === 'ETIQUETA' || x.tipoPick === 'MIXTO' || (x.tipoPick === 'TAREA' && umbral > 0 && x.pctMixto >= umbral));
    if (vaEtq) { destino = cdEtq; motivoDestino = x.tipoPick === 'TAREA' ? `Pedidos mixtos (${Math.round(x.pctMixto * 100)}%)` : `Picking ${TIPOS_PICK[x.tipoPick].toLowerCase()}`; }
    // sin stock en CD de picking ni en OSR: se abastece el picking con N días de venta desde el buffer
    const diaAbast = Math.max(x.ventaDia, x.pickDia);
    const abastecer = !enOsr && !pick.length && bufUni > 0 && diaAbast > 0 ? Math.min(bufUni, Math.max(1, Math.ceil(diaAbast * D))) : 0;
    const aMover = pick.filter((e) => e.cd !== destino);
    if (!aMover.length && !abastecer && !faltaSS) {
      if (pick.length || enOsr) pickBuf.evitable += x.pickBuf;
      continue;
    }
    const r = { ...base(destino, motivoDestino), ss: enOsr ? ss : null, vaEtq };
    for (const e of aMover) mover(r, e, destino);
    let resta = abastecer;
    for (const e of resta ? bufs.sort((a, b) => b.uni - a.uni) : []) {
      if (resta <= 0) break;
      const n = extraer(r, e, resta, destino, 'Abastecer picking desde buffer');
      r.desdeBuffer += n; resta -= n;
    }
    // stock de seguridad fuera de OSR: lo que falta se extrae desde las ubicaciones de OSR con más unidades,
    // como máximo la mitad del stock de OSR para no vaciar el automático
    const faltaExt = Math.min(faltaSS, Math.floor(enOsr * MAX_EXTRAER_OSR));
    if (faltaExt) r.extraerOsr = extraer(r, x.porCd.get(osr), faltaExt, destino, 'Stock de seguridad fuera de OSR');
    r.ssDespues = enOsr ? fueraUni + r.extraerOsr : null;
    r.osrDespues = enOsr - r.extraerOsr;
    r.cubreSS = enOsr ? r.ssDespues >= ss : null;
    r.estado = enOsr ? (!fueraUni ? ESTADOS_CONS.SIN_SS : faltaSS ? ESTADOS_CONS.SS_BAJO : ESTADOS_CONS.CONS_OSR)
      : r.desdeBuffer ? ESTADOS_CONS.BUFFER : vaEtq ? ESTADOS_CONS.ETQ : ESTADOS_CONS.CONSOLIDAR;
    r.cdsDespues = [...new Set([destino, ...bufs.filter((e) => e.uni > 0).map((e) => e.cd), ...(r.osrDespues > 0 ? [osr] : [])])];
    pickBuf.evitable += x.pickBuf;
    lista.push(r);
  }
  // primero lo que más vende (clase A), después lo que más ubicaciones libera
  lista.sort((a, b) => cmp(a.abc, b.abc) || b.ventaDia - a.ventaDia || b.ubLibera - a.ubLibera || cmp(a.sku, b.sku));
  const orden = new Map(lista.map((r, i) => [r.sku, i]));
  movs.sort((a, b) => orden.get(a.sku) - orden.get(b.sku));

  // balance por CD: SKU antes / después, unidades que salen / entran y ubicaciones que se liberan
  const bal = new Map(cds.map((cd) => [cd, { cd, skusAntes: 0, skusDespues: 0, sale: 0, entra: 0, ubLibera: 0 }]));
  const despues = new Map(skus.map((x) => [x.sku, [...x.porCd.keys()]]));
  for (const x of skus) for (const cd of x.porCd.keys()) bal.get(cd).skusAntes++;
  for (const r of lista) despues.set(r.sku, r.cdsDespues);
  for (const l of despues.values()) for (const cd of l) if (bal.has(cd)) bal.get(cd).skusDespues++;
  for (const m of movs) {
    const o = bal.get(m.cdOrigen);
    o.sale += m.qty;
    if (m.libera) o.ubLibera++;
    if (bal.has(m.cdDestino)) bal.get(m.cdDestino).entra += m.qty;
  }

  const porEstado = Object.values(ruta ? ESTADOS_RUTA : ESTADOS_CONS).map((estado) => {
    const l = lista.filter((r) => r.estado === estado);
    return { estado, skus: l.length, uni: l.reduce((s, r) => s + r.uniMover + r.extraerOsr + r.desdeBuffer, 0) };
  });
  const sum = (k) => lista.reduce((s, r) => s + r[k], 0);
  return {
    carga, osr, cdPri, cds, cdsRuta: cds.filter((cd) => cd !== osr), ruta, primero, buffer, cdEtq, cdsEtq: cdsPick, umbral, tipo: tipoSel, tipos: TIPOS_PICK, porTipo,
    hayPicking: pk.skus.size > 0, hayPedidos: pk.hayPedidos, pickBuf, criterio: crit, criterios: CRITERIOS_CONS, diasSS: D, tot, porEstado, lista, movs,
    resumen: { skus: lista.length, uniMover: sum('uniMover'), extraerOsr: sum('extraerOsr'), desdeBuffer: sum('desdeBuffer'), ubMover: sum('ubMover'), ubLibera: sum('ubLibera'),
      noCubreSS: lista.filter((r) => r.cubreSS === false).length, quedanUno: lista.filter((r) => r.cdsDespues.length === 1).length,
      alEtq: lista.filter((r) => r.vaEtq).length, uniEtq: lista.filter((r) => r.vaEtq).reduce((s, r) => s + r.uniMover + r.desdeBuffer + r.extraerOsr, 0) },
    balance: [...bal.values()],
  };
}

/** Simulación para la vista: totales, balance por CD y los primeros 500 SKU (filtrables por estado y clase). */
export async function consolidacionCds(params = {}) {
  const { lista, movs, ...r } = await calcularConsolidacionCds(params);
  const est = params.estado || '', abc = up(params.abc), dep = params.depto || '';
  const filt = lista.filter((x) => (!est || x.estado === est) && (!abc || x.abc === abc));
  const sel = dep ? filt.filter((x) => x.depto === dep) : filt;
  if (params.orden) ordenarPor(sel, params.orden, params.dir);
  const top = Math.min(500, Number(params.top) || 500);
  return { ...r, depto: dep, filtrados: sel.length, detalle: sel.slice(0, top), movimientos: movs.length, porDepto: porDepto(filt) };
}

/** Orden de la tabla por SKU: clave de columna ("cd:CD1" = unidades en ese CD), asc o desc; los vacíos siempre al final. */
function ordenarPor(l, k, dir) {
  const s = dir === 'asc' ? 1 : -1;
  const v = (x) => (k.startsWith('cd:') ? x.unidades[k.slice(3)] || 0 : x[k]);
  l.sort((a, b) => {
    const va = v(a), vb = v(b);
    if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
    if (vb === null || vb === undefined) return -1;
    return s * (typeof va === 'number' && typeof vb === 'number' ? va - vb : cmp(String(va), String(vb)));
  });
}

/** Apertura por departamento de los SKU con acción: unidades por CD hoy, lo que se mueve y los estados. */
function porDepto(lista) {
  const m = new Map();
  for (const x of lista) {
    let d = m.get(x.depto);
    if (!d) m.set(x.depto, d = { depto: x.depto, skus: 0, unidades: {}, total: 0, uniMover: 0, desdeBuffer: 0, extraerOsr: 0, ubMover: 0, ubLibera: 0,
      alEtq: 0, pickBuf: 0, ventaDia: 0, tipos: {}, estados: {} });
    d.skus++; d.total += x.total; d.uniMover += x.uniMover; d.desdeBuffer += x.desdeBuffer; d.extraerOsr += x.extraerOsr;
    d.ubMover += x.ubMover; d.ubLibera += x.ubLibera; d.pickBuf += x.pickBuf; d.ventaDia += x.ventaDia;
    if (x.vaEtq) d.alEtq++;
    for (const [cd, u] of Object.entries(x.unidades)) d.unidades[cd] = (d.unidades[cd] || 0) + u;
    d.tipos[x.tipoPick] = (d.tipos[x.tipoPick] || 0) + 1;
    d.estados[x.estado] = (d.estados[x.estado] || 0) + 1;
  }
  return [...m.values()].sort((a, b) => b.uniMover + b.desdeBuffer + b.extraerOsr - (a.uniMover + a.desdeBuffer + a.extraerOsr) || cmp(a.depto, b.depto));
}

/** Reporte .xlsx con todos los SKU con acción, los movimientos sugeridos y el balance por CD. */
export async function archivoConsolidacionCds(params = {}) {
  const d = await calcularConsolidacionCds(params);
  const fecha = d.carga.fecha instanceof Date ? d.carga.fecha.toISOString().slice(0, 10) : String(d.carga.fecha).slice(0, 10);
  const resumen = [
    ['Consolidación de SKU entre CD (simulación)'],
    ['Base de stock', fecha],
    ...(d.ruta ? [['Ruta simulada', `${d.ruta.desde} → ${d.ruta.hasta} (${d.ruta.soloEnDestino ? 'solo SKU que ya tienen stock en el destino' : 'todos los SKU del origen'})`]] : []),
    ['Criterio del CD destino', d.ruta ? 'No aplica (ruta fija)' : d.criterios[d.criterio]],
    ['Tipo de picking', d.tipo ? d.tipos[d.tipo] : 'Todos'],
    ['CD de etiqueta', d.cdEtq ? `${d.cdEtq} (SKU con picking de etiqueta o mixto${d.umbral > 0 ? `, y de tarea con ${Math.round(d.umbral * 100)}% o más de pedidos mixtos` : ''})` : 'Sin CD de etiqueta'],
    ['CD buffer de reabastecimiento', d.buffer.length ? `${d.buffer.join(', ')} (no son destino; su stock queda como reserva y los SKU que solo están ahí reciben ${d.diasSS} días de venta en un CD de picking)` : '—'],
    ['Consolidación directa en', d.primero.length ? `${d.primero.join(', ')} (si el SKU tiene stock ahí, se consolida en ese CD antes que en cualquier otro)` : '—'],
    ['CD del OSR', d.osr],
    ['Stock de seguridad fuera de OSR', `${d.diasSS} días de venta (venta diaria = ventas 2 meses / ${DIAS_VENTAS}); de OSR se extrae como máximo el ${MAX_EXTRAER_OSR * 100}% de su stock`],
    [],
    ['SKU con stock', d.tot.skus], ['SKU en un solo CD', d.tot.unCd], ['SKU en 2 o más CD', d.tot.dispersos], ['SKU con stock en OSR', d.tot.enOsr],
    [],
    ['SKU con acción', d.resumen.skus], ['Unidades a mover (consolidación)', d.resumen.uniMover], ['Unidades a extraer de OSR (stock de seguridad)', d.resumen.extraerOsr],
    ['Ubicaciones de origen (tareas)', d.resumen.ubMover], ['Ubicaciones que quedan libres', d.resumen.ubLibera],
    ['Unidades a abastecer desde buffer', d.resumen.desdeBuffer], ['SKU que van al CD de etiqueta', d.resumen.alEtq],
    ['SKU de OSR que no alcanzan el stock de seguridad fuera', d.resumen.noCubreSS],
    ['Unidades pickeadas desde buffer (archivo de picking)', d.pickBuf.total], ['De ellas, de SKU con CD de picking después del plan', d.pickBuf.evitable],
    [],
    ['Estado', 'SKU', 'Unidades a mover'], ...d.porEstado.map((e) => [e.estado, e.skus, e.uni]),
  ];
  const porSku = [['SKU', 'Descripción', 'Depto', 'Clase', 'Tipo picking', '% pedidos mixtos', 'Pickeado desde buffer', 'Venta/día', 'N° CD', ...d.cds.map((cd) => `Unid. ${cd}`), 'Total unidades', 'Ubicaciones',
    'CD destino', 'Motivo destino', 'Unid. a mover', 'Unid. desde buffer', 'Ubic. a mover', 'Ubic. que se liberan', `Stock seg. requerido (${d.diasSS} d)`, 'Unid. a extraer de OSR',
    'Stock fuera de OSR después', 'Stock OSR después', 'Cubre stock seg.', 'CD después', 'Estado'],
  ...d.lista.map((r) => [r.sku, r.desc, r.depto, r.matriz, d.tipos[r.tipoPick], Math.round(r.pctMixto * 1000) / 1000, r.pickBuf, Math.round(r.ventaDia * 100) / 100, r.nCds, ...d.cds.map((cd) => r.unidades[cd] || 0), r.total, r.nUb,
    r.destino, r.motivoDestino, r.uniMover, r.desdeBuffer, r.ubMover, r.ubLibera, r.ss ?? '', r.extraerOsr, r.ssDespues ?? '', r.osr ? r.osrDespues : '',
    r.cubreSS === null ? '' : r.cubreSS ? 'Sí' : 'No', r.cdsDespues.join(' + '), r.estado])];
  const movs = [['SKU', 'Descripción', 'Clase', 'CD origen', 'Piso', 'Zona pasillo', 'Ubicación origen', 'Unidades', 'CD destino', 'Motivo', 'Libera ubicación'],
    ...d.movs.map((m) => [m.sku, m.desc, m.matriz, m.cdOrigen, m.piso, m.zp, m.ubic, m.qty, m.cdDestino, m.motivo, m.libera ? 'Sí' : 'No'])];
  const bal = [['CD', 'SKU antes', 'SKU después', 'Unidades que salen', 'Unidades que entran', 'Ubicaciones que se liberan'],
    ...d.balance.map((b) => [b.cd, b.skusAntes, b.skusDespues, b.sale, b.entra, b.ubLibera])];
  const estDep = Object.values(d.ruta ? ESTADOS_RUTA : ESTADOS_CONS);
  const dep = [['Depto', 'SKU con acción', 'Venta/día', ...Object.values(d.tipos).map((t) => `SKU ${t.toLowerCase()}`), 'Pickeado desde buffer', ...d.cds.map((cd) => `Unid. ${cd}`),
    'Total unidades', 'Unid. a mover', 'Unid. desde buffer', 'Unid. a extraer de OSR', 'Ubic. a mover', 'Ubic. que se liberan', 'SKU al CD de etiqueta', ...estDep],
  ...porDepto(d.lista).map((x) => [x.depto, x.skus, Math.round(x.ventaDia * 10) / 10, ...Object.keys(d.tipos).map((t) => x.tipos[t] || 0), x.pickBuf,
    ...d.cds.map((cd) => x.unidades[cd] || 0), x.total, x.uniMover, x.desdeBuffer, x.extraerOsr, x.ubMover, x.ubLibera, x.alEtq, ...estDep.map((e) => x.estados[e] || 0)])];
  return {
    buffer: libro([['Resumen', resumen, [46, 60, 16]],
      ['Por SKU', porSku, [16, 36, 18, 7, 14, 10, 12, 10, 6, ...d.cds.map(() => 11), 12, 11, 10, 16, 12, 12, 11, 14, 16, 16, 16, 14, 12, 14, 34]],
      ['Por depto', dep, [30, 10, 10]], ['Movimientos', movs, [16, 36, 7, 10, 8, 12, 18, 10, 10, 30, 10]], ['Balance por CD', bal, [10, 11, 12, 18, 18, 24]]]),
    nombre: `Consolidacion_CD_${d.tipo ? d.tipo + '_' : ''}${d.ruta ? `${d.ruta.desde}_a_${d.ruta.hasta}_`.replace(/\s+/g, '') : ''}${fecha}.xlsx`,
  };
}

// ---------------------------------------------------------------------------------------------
// Consolidación dentro del CD: SKU repartidos en varias ubicaciones del mismo CD y simulación para juntarlos.
// Usa el mismo motor que la asignación diaria (tareasConsolidacion): solo se mueven ubicaciones mono-SKU completas
// a otra ubicación mono-SKU del mismo SKU, en la misma zona y con espacio (capacidad = la ubicación con más unidades).
// ---------------------------------------------------------------------------------------------
export const ESTADOS_INT = { UNA: 'Queda en 1 ubicación', PARCIAL: 'Consolidación parcial', NO: 'No consolidable' };

async function calcularConsolidacionInterna({ cd = '', piso = '' } = {}) {
  const { carga, p, filas, clase } = await datos();
  const cdsDisp = [...new Set(filas.map((r) => r.cd))].filter((c) => !p.excluidos.has(c)).sort(cmp);
  if (!cdsDisp.length) throw Object.assign(new Error('No hay CD para consolidar (revisa "CD que no se consolidan" en Configuración).'), { status: 400 });
  const cdPri = up(p.cdPrioritario);
  const cdSel = cdsDisp.includes(up(cd)) ? up(cd) : cdsDisp.includes(cdPri) ? cdPri : cdsDisp[0];
  const { rows: resv } = await q('SELECT ubicacion FROM ubic_reservadas');
  const reservadas = new Set(resv.map((r) => up(r.ubicacion)));
  const filasCd = filas.filter((r) => r.cd === cdSel && !reservadas.has(r.ubic));
  const pisos = [...new Set(filasCd.map((r) => r.piso || '(sin piso)'))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const pisoSel = pisos.includes(piso) ? piso : '';
  const enPiso = (pi) => !pisoSel || (pi || '(sin piso)') === pisoSel;

  // SKU x ubicación del CD, y cuántos SKU distintos guarda cada ubicación
  const sk = new Map(), skuEnUb = new Map();
  for (const r of filasCd) {
    let x = sk.get(r.sku);
    if (!x) {
      const c = clase.get(r.sku);
      sk.set(r.sku, (x = { sku: r.sku, desc: r.desc, depto: r.depto, matriz: c?.matriz || 'CZ', abc: c?.abc || 'C', ventaDia: (c?.ventas || 0) / DIAS_VENTAS, ubic: new Map() }));
    }
    if (!x.ubic.has(r.ubic)) x.ubic.set(r.ubic, { ubic: r.ubic, piso: r.piso || '(sin piso)', zp: r.zp, qty: 0 });
    x.ubic.get(r.ubic).qty += r.qty;
    if (!skuEnUb.has(r.ubic)) skuEnUb.set(r.ubic, new Set());
    skuEnUb.get(r.ubic).add(r.sku);
  }
  // mismos movimientos que la asignación diaria, con el origen en las zonas del ámbito (todo el CD o el piso elegido)
  const zonas = new Set(filasCd.filter((r) => enPiso(r.piso)).map((r) => up(r.piso) + '|' + up(r.zp)));
  const grupos = new Map(tareasConsolidacion({ filas, cd: cdSel, reservadas, zonasTurno: zonas }).map((g) => [g.sku, g]));

  const lista = [], movs = [];
  const tot = { skus: sk.size, unaUb: 0, repartidos: 0 };
  for (const x of sk.values()) {
    if (x.ubic.size < 2) { tot.unaUb++; continue; }
    if (![...x.ubic.values()].some((u) => enPiso(u.piso))) continue;
    tot.repartidos++;
    const mv = (grupos.get(x.sku)?.lineas || []).filter((l) => l.accion === 'MOVER');
    const ub = [...x.ubic.values()];
    const porPiso = {};
    for (const u of ub) porPiso[u.piso] = (porPiso[u.piso] || 0) + u.qty;
    const r = { sku: x.sku, desc: x.desc, depto: x.depto, matriz: x.matriz, abc: x.abc, ventaDia: x.ventaDia, porPiso,
      total: ub.reduce((s, u) => s + u.qty, 0), nUb: ub.length, nMov: mv.length, uniMover: mv.reduce((s, l) => s + l.q, 0),
      destinos: [...new Set(mv.map((l) => l.dest))], ubDespues: ub.length - mv.length };
    for (const l of mv) movs.push({ sku: x.sku, desc: x.desc, matriz: x.matriz, piso: l.piso, zp: l.zp, ori: l.ori, dest: l.dest, qty: l.q });
    r.estado = !mv.length ? ESTADOS_INT.NO : r.ubDespues === 1 ? ESTADOS_INT.UNA : ESTADOS_INT.PARCIAL;
    // por qué no se junta del todo: ubicaciones compartidas con otros SKU, zonas distintas o falta de espacio
    if (r.ubDespues > 1) {
      const quedan = ub.filter((u) => !mv.some((l) => l.ori === u.ubic));
      r.motivo = quedan.some((u) => skuEnUb.get(u.ubic).size > 1) ? 'Ubicaciones compartidas con otros SKU'
        : new Set(quedan.map((u) => u.ubic.slice(0, 3))).size > 1 ? 'Ubicaciones en zonas distintas' : 'Sin espacio en la ubicación destino';
    } else r.motivo = '';
    lista.push(r);
  }
  lista.sort((a, b) => cmp(a.abc, b.abc) || b.nMov - a.nMov || b.ventaDia - a.ventaDia || cmp(a.sku, b.sku));
  const orden = new Map(lista.map((r, i) => [r.sku, i]));
  movs.sort((a, b) => orden.get(a.sku) - orden.get(b.sku) || cmp(a.ori, b.ori));

  // balance por piso del ámbito: SKU repartidos que tocan el piso, movimientos con origen en el piso y ubicaciones que libera
  const bal = new Map(pisos.filter(enPiso).map((pi) => [pi, { piso: pi, skus: 0, movimientos: 0, uni: 0, ubLibera: 0 }]));
  for (const r of lista) for (const pi of Object.keys(r.porPiso)) if (bal.has(pi)) bal.get(pi).skus++;
  for (const m of movs) { const b = bal.get(m.piso || '(sin piso)'); if (b) { b.movimientos++; b.uni += m.qty; b.ubLibera++; } }
  const porEstado = Object.values(ESTADOS_INT).map((estado) => {
    const l = lista.filter((r) => r.estado === estado);
    return { estado, skus: l.length, uni: l.reduce((s, r) => s + r.uniMover, 0) };
  });
  return {
    carga, cds: cdsDisp, cd: cdSel, pisos, piso: pisoSel, reservadas: reservadas.size, tot, porEstado, lista, movs,
    resumen: { skus: lista.length, uniMover: movs.reduce((s, m) => s + m.qty, 0), movimientos: movs.length, ubLibera: movs.length,
      quedanUna: lista.filter((r) => r.estado === ESTADOS_INT.UNA).length },
    balance: [...bal.values()],
  };
}

/** Simulación para la vista: totales, balance por piso y los primeros 500 SKU (filtrables por estado y clase). */
export async function consolidacionInterna(params = {}) {
  const { lista, movs, ...r } = await calcularConsolidacionInterna(params);
  const est = params.estado || '', abc = up(params.abc);
  const sel = lista.filter((x) => (!est || x.estado === est) && (!abc || x.abc === abc));
  return { ...r, filtrados: sel.length, detalle: sel.slice(0, 500) };
}

/** Reporte .xlsx de la consolidación dentro del CD: resumen, SKU, movimientos por ubicación y balance por piso. */
export async function archivoConsolidacionInterna(params = {}) {
  const d = await calcularConsolidacionInterna(params);
  const fecha = d.carga.fecha instanceof Date ? d.carga.fecha.toISOString().slice(0, 10) : String(d.carga.fecha).slice(0, 10);
  const pisos = d.pisos.filter((pi) => !d.piso || pi === d.piso);
  const resumen = [
    ['Consolidación de SKU dentro del CD (simulación)'],
    ['Base de stock', fecha], ['CD', d.cd], ['Piso', d.piso || 'Todos'],
    ['Regla', 'Se mueven ubicaciones con un solo SKU, completas, a otra ubicación del mismo SKU en la misma zona y con espacio (igual que la asignación diaria). Las ubicaciones reservadas no se consideran.'],
    [],
    ['SKU con stock en el CD', d.tot.skus], ['SKU en una sola ubicación', d.tot.unaUb], ['SKU en 2 o más ubicaciones (ámbito)', d.tot.repartidos],
    [],
    ['Unidades a mover', d.resumen.uniMover], ['Movimientos (tareas)', d.resumen.movimientos], ['Ubicaciones que quedan libres', d.resumen.ubLibera],
    ['SKU que quedan en 1 ubicación', d.resumen.quedanUna],
    [],
    ['Estado', 'SKU', 'Unidades a mover'], ...d.porEstado.map((e) => [e.estado, e.skus, e.uni]),
  ];
  const porSku = [['SKU', 'Descripción', 'Depto', 'Clase', 'Venta/día', ...pisos.map((pi) => `Unid. ${pi}`), 'Total unidades', 'Ubicaciones antes',
    'Movimientos', 'Unid. a mover', 'Ubicaciones después', 'Ubicaciones destino', 'Estado', 'Motivo'],
  ...d.lista.map((r) => [r.sku, r.desc, r.depto, r.matriz, Math.round(r.ventaDia * 100) / 100, ...pisos.map((pi) => r.porPiso[pi] || 0), r.total, r.nUb,
    r.nMov, r.uniMover, r.ubDespues, r.destinos.join(', '), r.estado, r.motivo])];
  const movs = [['SKU', 'Descripción', 'Clase', 'Piso', 'Zona pasillo', 'Ubicación origen', 'Ubicación destino', 'Unidades'],
    ...d.movs.map((m) => [m.sku, m.desc, m.matriz, m.piso, m.zp, m.ori, m.dest, m.qty])];
  const bal = [['Piso', 'SKU repartidos', 'Movimientos', 'Unidades a mover', 'Ubicaciones que se liberan'], ...d.balance.map((b) => [b.piso, b.skus, b.movimientos, b.uni, b.ubLibera])];
  return {
    buffer: libro([['Resumen', resumen, [38, 90, 16]], ['Por SKU', porSku, [16, 36, 18, 7, 10, ...pisos.map(() => 12), 12, 12, 11, 12, 12, 40, 22, 36]],
      ['Movimientos', movs, [16, 36, 7, 14, 12, 18, 18, 10]], ['Balance por piso', bal, [18, 14, 12, 16, 24]]]),
    nombre: `Consolidacion_${d.cd.replace(/\s+/g, '')}${d.piso ? '_' + d.piso.replace(/\s+/g, '') : ''}_${fecha}.xlsx`,
  };
}
