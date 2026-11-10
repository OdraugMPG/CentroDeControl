// Potencial de ingreso a OSR: SKU con stock fuera de OSR (en los demás CD) que por su clase ABC/XYZ conviene llevar al OSR.
// Simulación de escenarios: clases de la matriz, aptitud (Logística OSR), si ya tienen stock en OSR, CD de origen,
// stock fuera mínimo, venta mínima, solo deptos OSR y días de cobertura (tope de lo que se ingresa = venta diaria x días).
// Siempre queda un stock de seguridad fuera de OSR (días de venta, con un mínimo de unidades): solo se ingresa lo disponible
// sobre ese stock, tomado de las ubicaciones con más unidades. Un máximo de SKU deja solo los de mayor prioridad (clase A, más venta).
// El stock de los CD buffer (RCI, parámetro cdsBuffer) no se considera salvo que se elija ese CD como origen: es reserva de reabastecimiento.
// Con un evento del simulador, cada SKU toma el factor de su depto: los de mayor factor van primero (o solo los de factor > 1)
// y la cobertura a ingresar usa la venta del evento (venta diaria x factor).
// Almacenamiento en OSR: cada ubicación de OSR es un tote; se puede dividir en half (2) o quarter (4) compartimentos de un SKU.
// La capacidad de un tote entero sale del percentil 90 de las unidades por tote del depto en OSR (o la que indique el usuario).
// También mide los SKU que hoy están en OSR sin Logística OSR = Y: cuánto ocupan, cuánto venden y, si se simula
// retirarlos, el balance con lo que ingresa (venta, unidades y ubicaciones de OSR).
import { baseSku, deptosPrioritarios, DIAS_VENTAS } from './abastecimientoOsr.js';
import { filasDeCarga } from './stock.js';
import { factoresEvento } from './eventosOsr.js';
import { up, cmp, fmtFecha } from '../engine/util.js';
import { libro } from './tareas.js';

export const CLASES = ['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ'];
export const APTITUD = { Y: 'Solo aptos (Logística OSR = Y)', REV: 'Aptos y en REVISION', TODOS: 'Todos (incluye N y sin dato)' };
export const EN_OSR = { SIN: 'Solo SKU sin stock en OSR', TODOS: 'Incluir SKU que ya tienen stock en OSR' };
export const MODO_NOY = { VER: 'Solo ver', RETIRAR: 'Simular retiro de OSR' };
export const TOTES = { AUTO: 'Automático (totes enteros llenos + half / quarter para el resto)', QUARTER: 'Quarter (4 por tote)', HALF: 'Half (2 por tote)', ENTERO: 'Tote entero' };
const DIV = { QUARTER: 4, HALF: 2, ENTERO: 1 };

/**
 * Compartimentos para guardar "unid" unidades en totes de capacidad "cap": en AUTO, totes enteros llenos y el resto en
 * cuartos (1 = quarter, 2 = half, 3 = half + quarter, 4 o más = otro entero); en los demás modos, todo en ese compartimento.
 */
export function empaque(unid, cap, modo = 'AUTO') {
  let comps;
  if (modo === 'AUTO' || !DIV[modo]) {
    const llenos = Math.floor(unid / cap), resto = unid - llenos * cap;
    const cuartos = resto ? Math.ceil(resto / Math.max(1, Math.floor(cap / 4))) : 0;
    comps = { ENTERO: llenos + (cuartos >= 4 ? 1 : 0), HALF: cuartos === 2 || cuartos === 3 ? 1 : 0, QUARTER: cuartos === 1 || cuartos === 3 ? 1 : 0 };
  } else comps = { ENTERO: 0, HALF: 0, QUARTER: 0, [modo]: Math.ceil(unid / Math.max(1, Math.floor(cap / DIV[modo]))) };
  return { comps, totes: comps.ENTERO + comps.HALF / 2 + comps.QUARTER / 4,
    almac: Object.entries(comps).filter(([, n]) => n).map(([k, n]) => `${n} ${k === 'ENTERO' ? (n === 1 ? 'entero' : 'enteros') : k.toLowerCase()}`).join(' + ') };
}
export const MODO_EVT = { PRIORIZAR: 'Priorizar los deptos del evento', SOLO: 'Solo deptos potenciados (factor sobre GENERAL o sobre el mínimo)' };
const LIMITE = 500;

const n0 = (v) => Math.max(0, Number(v) || 0);
const lista = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map(up).filter(Boolean);
const aptitudDe = (log) => (log === 'Y' ? 'Y' : log === 'REVISION' ? 'REVISION' : log || 'SIN DATO');

export async function calcularPotencial(params = {}) {
  const { carga, p, osr, hayCol, skus } = await baseSku();
  const clases = lista(params.clases).filter((c) => CLASES.includes(c));
  const sel = new Set(clases.length ? clases : ['AX', 'AY', 'BX', 'BY']);
  const apt = params.aptitud in APTITUD ? params.aptitud : 'Y';
  const enOsr = params.enOsr in EN_OSR ? params.enOsr : 'SIN';
  const cdsSel = lista(params.cds);
  const minFuera = n0(params.minFuera), minVenta = n0(params.minVenta), dias = n0(params.dias);
  const ssDias = params.ssDias === undefined || params.ssDias === '' ? 7 : n0(params.ssDias), ssMin = n0(params.ssMin), maxSkus = Math.floor(n0(params.maxSkus));
  const soloOsr = params.soloDeptosOsr === true || params.soloDeptosOsr === 'true' || params.soloDeptosOsr === '1';
  const listaOsr = deptosPrioritarios(p.deptosOsr);
  const okApt = (a) => apt === 'TODOS' || a === 'Y' || (apt === 'REV' && a === 'REVISION');
  const cdsTodos = new Set();
  const bufferTodos = String(p.cdsBuffer || '').split('|').map(up).filter(Boolean);
  // un CD buffer entra solo si se elige explícitamente en CD de origen
  const buffer = new Set(bufferTodos.filter((cd) => !cdsSel.includes(cd)));
  const evt = await factoresEvento(params.evento || '');
  const conEvt = !!evt.evento;
  const modoEvt = params.evtModo in MODO_EVT ? params.evtModo : 'PRIORIZAR';
  const evtMin = n0(params.evtMin);
  const potenciado = (f) => (evtMin > 0 ? f >= evtMin : f > evt.general);

  // universo: SKU con stock fuera de OSR en los CD elegidos, que pasan aptitud, OSR, deptos y mínimos (sin filtrar clase)
  const universo = [], sinDisp = [];
  for (const x of skus) {
    const origen = x.origen.filter((o) => !buffer.has(up(o.cd)) && (!cdsSel.length || cdsSel.includes(up(o.cd))));
    for (const o of x.origen) cdsTodos.add(up(o.cd));
    const fuera = origen.reduce((s, o) => s + o.qty, 0);
    if (!(fuera > 0)) continue;
    const aptitud = aptitudDe(x.log);
    if (!okApt(aptitud)) continue;
    if (enOsr === 'SIN' && x.osr > 0) continue;
    if (soloOsr && !listaOsr.has(x.cod)) continue;
    const ventaDia = x.vta / DIAS_VENTAS;
    if (fuera <= minFuera || ventaDia < minVenta) continue;
    const { categoria, factor } = conEvt ? evt.deDepto(x.depto) : { categoria: '', factor: 1 };
    if (conEvt && modoEvt === 'SOLO' && !potenciado(factor)) continue;
    const ventaEvt = ventaDia * factor;
    // stock de seguridad que queda fuera de OSR; se ingresa solo lo disponible sobre él
    const ss = Math.max(ssMin, Math.ceil(ventaDia * ssDias));
    const disponible = Math.max(0, fuera - ss);
    if (!disponible) { sinDisp.push({ matriz: x.matriz, fuera }); continue; }
    const ingresar = dias > 0 ? Math.min(disponible, Math.ceil(ventaEvt * dias)) : disponible;
    const porCd = {}, ingCd = {}, toma = [];
    for (const o of origen) porCd[up(o.cd)] = (porCd[up(o.cd)] || 0) + o.qty;
    let resta = ingresar;
    for (const o of [...origen].sort((a, c) => c.qty - a.qty || cmp(a.ubic, c.ubic))) {
      if (resta <= 0) break;
      const t = Math.min(o.qty, resta);
      toma.push({ cd: up(o.cd), ubic: o.ubic, stock: o.qty, qty: t });
      ingCd[up(o.cd)] = (ingCd[up(o.cd)] || 0) + t;
      resta -= t;
    }
    universo.push({ sku: x.sku, desc: x.desc, depto: x.depto, cod: x.cod, matriz: x.matriz, abc: x.abc, xyz: x.xyz, aptitud, osr: x.osr, fuera, porCd, ingCd,
      ss, disponible, nUb: toma.length, toma, ventaDia, categoria, factor, ventaEvt, ingresar, queda: fuera - ingresar, cob: ventaEvt > 0 ? ingresar / ventaEvt : null, total: x.qty });
  }
  // matriz 3x3 del universo (para ver dónde está el potencial antes de elegir clases)
  const matriz = Object.fromEntries(CLASES.map((c) => [c, { skus: 0, fuera: 0, ingresar: 0 }]));
  for (const x of universo) { const m = matriz[x.matriz]; if (m) { m.skus++; m.fuera += x.fuera; m.ingresar += x.ingresar; } }

  // prioridad: clase A primero y más venta; con máximo de SKU se quedan los primeros
  // con evento: primero los deptos con mayor factor del evento; dentro, clase y venta del evento
  const candidatos = universo.filter((x) => sel.has(x.matriz))
    .sort((a, b) => (conEvt ? b.factor - a.factor : 0) || cmp(a.abc, b.abc) || b.ventaEvt - a.ventaEvt || b.fuera - a.fuera || cmp(a.sku, b.sku));
  const elegidos = maxSkus > 0 ? candidatos.slice(0, maxSkus) : candidatos;
  const porSS = sinDisp.filter((x) => sel.has(x.matriz));
  const cds = [...cdsTodos].filter((cd) => cd !== up(osr)).sort(cmp);

  const ventaTot = skus.reduce((s, x) => s + x.vta, 0) / DIAS_VENTAS;
  const noY = await sinYEnOsr({ carga, osr, skus, params, ventaTot, listaOsr, soloOsr });

  // almacenamiento en totes de OSR: compartimentos por SKU y totes equivalentes (vs todo en totes enteros)
  const modoTote = params.tote in TOTES ? params.tote : 'AUTO';
  const capTote = n0(params.capTote);
  const caps = await capacidadTotes(carga, osr, skus);
  const mix = { ENTERO: 0, HALF: 0, QUARTER: 0 };
  for (const x of elegidos) {
    x.cap = capTote || caps.porDepto.get(x.depto) || caps.global;
    x.totesEntero = Math.ceil(x.ingresar / x.cap);
    Object.assign(x, empaque(x.ingresar, x.cap, modoTote));
    for (const k of Object.keys(mix)) mix[k] += x.comps[k];
  }
  const sum = (l, k) => l.reduce((s, x) => s + x[k], 0);
  const tot = { skus: elegidos.length, candidatos: candidatos.length, fuera: sum(elegidos, 'fuera'), ss: sum(elegidos, 'ss'), ingresar: sum(elegidos, 'ingresar'),
    queda: sum(elegidos, 'queda'), ubic: sum(elegidos, 'nUb'), ventaDia: sum(elegidos, 'ventaDia'), ventaEvt: sum(elegidos, 'ventaEvt'),
    potenciados: conEvt ? elegidos.filter((x) => potenciado(x.factor)).length : 0, porSS: porSS.length, porSSu: porSS.reduce((s, x) => s + x.fuera, 0),
    fueraTope: maxSkus > 0 ? candidatos.length - elegidos.length : 0, ingresarTope: maxSkus > 0 ? sum(candidatos.slice(maxSkus), 'ingresar') : 0,
    totes: Math.ceil(sum(elegidos, 'totes')), totesEntero: sum(elegidos, 'totesEntero'), mix };
  tot.ahorroTotes = tot.totesEntero - tot.totes;
  tot.pctVenta = ventaTot ? tot.ventaDia / ventaTot : 0;
  tot.cob = tot.ventaEvt ? tot.ingresar / tot.ventaEvt : null;

  const porCdM = new Map();
  for (const x of elegidos) for (const [cd, u] of Object.entries(x.ingCd)) {
    const c = porCdM.get(cd) || { cd, skus: 0, unidades: 0, ubic: 0 };
    c.skus++; c.unidades += u; c.ubic += x.toma.filter((o) => o.cd === cd).length;
    porCdM.set(cd, c);
  }
  const depM = new Map();
  for (const x of elegidos) {
    let d = depM.get(x.depto);
    if (!d) depM.set(x.depto, d = { depto: x.depto, cod: x.cod, enLista: listaOsr.has(x.cod), categoria: x.categoria, factor: x.factor, skus: 0, fuera: 0, ss: 0, ingresar: 0, ubic: 0, ventaDia: 0, totes: 0, totesEntero: 0, porCd: {}, clases: {} });
    d.skus++; d.fuera += x.fuera; d.ss += x.ss; d.ingresar += x.ingresar; d.ubic += x.nUb; d.ventaDia += x.ventaDia; d.totes += x.totes; d.totesEntero += x.totesEntero;
    for (const [cd, u] of Object.entries(x.porCd)) d.porCd[cd] = (d.porCd[cd] || 0) + u;
    d.clases[x.matriz] = (d.clases[x.matriz] || 0) + 1;
  }
  const deptos = [...depM.values()].sort((a, b) => (conEvt ? b.factor - a.factor : 0) || b.ingresar - a.ingresar || cmp(a.depto, b.depto));

  // balance del escenario con los SKU sin Y que salen de OSR (venta y ocupación)
  const nuevos = elegidos.filter((x) => !(x.osr > 0)).length;
  const ventaOsr = skus.reduce((s, x) => s + (x.osr > 0 ? x.vta : 0), 0) / DIAS_VENTAS;
  const sale = noY.modo === 'RETIRAR' ? noY.tot : { skus: 0, osr: 0, ubic: 0, libera: 0, ventaDia: 0 };
  const balance = {
    ventaEntra: tot.ventaDia, ventaSale: sale.ventaDia, ventaNeta: tot.ventaDia - sale.ventaDia,
    unidEntra: tot.ingresar, unidSale: sale.osr, unidNeta: tot.ingresar - sale.osr,
    ubicLibera: sale.libera, skusNuevos: nuevos, totesNecesarios: tot.totes, ubicNeta: sale.libera - tot.totes,
    partAntes: ventaTot ? ventaOsr / ventaTot : 0, partDespues: ventaTot ? (ventaOsr + tot.ventaDia - sale.ventaDia) / ventaTot : 0,
  };
  return {
    carga, osr, hayCol, cds, noY, balance, buffer: [...buffer], cdsBuffer: bufferTodos, eventos: evt.eventos, evento: evt.evento, evtGeneral: evt.general, conf: { clases: [...sel], aptitud: apt, enOsr, cdsSel, minFuera, minVenta, dias, soloOsr, ssDias, ssMin, maxSkus, evtModo: modoEvt, evtMin, tote: modoTote, capTote, capGlobal: caps.global },
    universo: { skus: universo.length, fuera: sum(universo, 'fuera') }, matriz, tot, porCd: [...porCdM.values()].sort((a, b) => b.unidades - a.unidades),
    deptos, elegidos,
  };
}

/** Capacidad estimada de un tote entero de OSR por depto: percentil 90 de las unidades por tote (ubicaciones de un SKU). */
export async function capacidadTotes(carga, osr, skus) {
  const deptoDe = new Map(skus.map((x) => [x.sku, x.depto]));
  const porUb = new Map();
  for (const f of await filasDeCarga(carga.id)) {
    if (up(f.cd) !== osr || !f.sku || !(f.qty > 0)) continue;
    const u = porUb.get(f.ubic) || { skus: new Set(), qty: 0 };
    u.skus.add(f.sku); u.qty += f.qty;
    porUb.set(f.ubic, u);
  }
  const p90 = (l) => { const s = [...l].sort((a, c) => a - c); return s.length ? Math.max(4, Math.round(s[Math.floor(0.9 * (s.length - 1))])) : null; };
  const porDep = new Map(), todos = [];
  for (const u of porUb.values()) {
    if (u.skus.size !== 1) continue;
    const d = deptoDe.get([...u.skus][0]);
    todos.push(u.qty);
    if (!porDep.has(d)) porDep.set(d, []);
    porDep.get(d).push(u.qty);
  }
  const global = p90(todos) || 40;
  return { global, porDepto: new Map([...porDep].filter(([, l]) => l.length >= 10).map(([d, l]) => [d, p90(l)])) };
}

/**
 * SKU con stock en OSR y Logística OSR distinta de Y (N, REVISION, sin dato…): unidades y ubicaciones que ocupan en OSR,
 * cuántas ubicaciones quedarían vacías al retirarlos (no comparten la ubicación con otro SKU) y su venta diaria.
 */
async function sinYEnOsr({ carga, osr, skus, params, ventaTot, listaOsr, soloOsr }) {
  const ubOsr = new Map(), skusEnUb = new Map();
  for (const f of await filasDeCarga(carga.id)) {
    if (up(f.cd) !== osr || !f.sku || !(f.qty > 0)) continue;
    if (!ubOsr.has(f.sku)) ubOsr.set(f.sku, new Set());
    ubOsr.get(f.sku).add(f.ubic);
    if (!skusEnUb.has(f.ubic)) skusEnUb.set(f.ubic, new Set());
    skusEnUb.get(f.ubic).add(f.sku);
  }
  const todos = skus.filter((x) => x.osr > 0 && x.log !== 'Y' && (!soloOsr || listaOsr.has(x.cod))).map((x) => {
    const ub = [...(ubOsr.get(x.sku) || [])];
    return { sku: x.sku, desc: x.desc, depto: x.depto, matriz: x.matriz, abc: x.abc, aptitud: aptitudDe(x.log), osr: x.osr, fuera: x.fuera,
      ubic: ub.length, libera: ub.filter((u) => skusEnUb.get(u).size === 1).length, ventaDia: x.vta / DIAS_VENTAS };
  });
  const porEstado = {};
  for (const x of todos) porEstado[x.aptitud] = (porEstado[x.aptitud] || 0) + 1;
  const estados = lista(params.noYEstados);
  const clases = lista(params.noYClases).filter((c) => CLASES.includes(c));
  const sel = todos.filter((x) => (!estados.length || estados.includes(x.aptitud)) && (!clases.length || clases.includes(x.matriz)))
    .sort((a, b) => cmp(b.abc, a.abc) || a.ventaDia - b.ventaDia || b.osr - a.osr || cmp(a.sku, b.sku));
  const sum = (k) => sel.reduce((s, x) => s + x[k], 0);
  const matriz = Object.fromEntries(CLASES.map((c) => [c, 0]));
  for (const x of todos) if (matriz[x.matriz] !== undefined && (!estados.length || estados.includes(x.aptitud))) matriz[x.matriz]++;
  return {
    modo: params.noYModo in MODO_NOY ? params.noYModo : 'VER', estados, clases, porEstado, matriz, lista: sel,
    tot: { skus: sel.length, osr: sum('osr'), ubic: sum('ubic'), libera: sum('libera'), ventaDia: sum('ventaDia'), pctVenta: ventaTot ? sum('ventaDia') / ventaTot : 0 },
  };
}

/** Resultado para la vista: matriz del universo, totales, por CD de origen, por depto y los SKU (filtro por depto, orden y top). */
export async function potencialOsr(params = {}) {
  const { elegidos, ...r } = await calcularPotencial(params);
  const b = up(params.buscar);
  const sel = elegidos.filter((x) => (!params.depto || x.depto === params.depto) && (!b || up(x.sku).includes(b) || up(x.desc).includes(b)));
  if (params.orden) {
    const k = params.orden, s = params.dir === 'asc' ? 1 : -1;
    const v = (x) => (k.startsWith('cd:') ? x.porCd[k.slice(3)] || 0 : x[k]);
    sel.sort((a, b) => {
      const va = v(a), vb = v(b);
      if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
      if (vb === null || vb === undefined) return -1;
      return s * (typeof va === 'number' && typeof vb === 'number' ? va - vb : cmp(String(va), String(vb)));
    });
  }
  const top = Math.min(LIMITE, Number(params.top) || LIMITE);
  const { lista: noYLista, ...noY } = r.noY;
  return { ...r, noY: { ...noY, filtrados: noYLista.length, detalle: noYLista.slice(0, top) },
    depto: params.depto || '', filtrados: sel.length, detalle: sel.slice(0, top).map(({ origen, toma, ...x }) => x) };
}

/** Excel del escenario: resumen, matriz, por depto, por SKU y ubicaciones de origen. */
export async function archivoPotencialOsr(params = {}) {
  const d = await calcularPotencial(params);
  const c = d.conf;
  const fecha = d.carga.fecha instanceof Date ? d.carga.fecha.toISOString().slice(0, 10) : String(d.carga.fecha).slice(0, 10);
  const r1 = (x) => Math.round(x * 100) / 100;
  const resumen = [
    [`POTENCIAL DE INGRESO A ${d.osr} · Base del ${fmtFecha(fecha)}`], [],
    ['Clases ABC-XYZ', c.clases.join(', ')], ['Aptitud', APTITUD[c.aptitud]], ['Stock en OSR', EN_OSR[c.enOsr]],
    ['CD de origen', c.cdsSel.length ? c.cdsSel.join(', ') : 'Todos'], ['Stock fuera de OSR mayor que', c.minFuera], ['Venta diaria mínima', c.minVenta],
    ['Días de cobertura a ingresar', c.dias || 'Todo lo disponible'], ['Solo deptos OSR', c.soloOsr ? 'SI' : 'NO'],
    ['Stock de seguridad fuera de OSR', `${c.ssDias} días de venta${c.ssMin ? `, mínimo ${c.ssMin} u.` : ''}`], ['Máximo de SKU a ingresar', c.maxSkus || 'Sin tope'], ['Stock no considerado (CD buffer)', d.buffer.join(', ') || '—'],
    ['Almacenamiento en OSR', `${TOTES[c.tote]} · capacidad tote entero: ${c.capTote ? `${c.capTote} u. (fija)` : `por depto (percentil 90 de OSR; general ${c.capGlobal} u.)`}`],
    ['Evento', d.evento ? `${d.evento.evento} (${fmtFecha(d.evento.inicio)} al ${fmtFecha(d.evento.fin)}) · ${MODO_EVT[c.evtModo]}${c.evtMin ? ` · factor mínimo ${c.evtMin}` : ` · GENERAL ${d.evtGeneral}`}` : 'Sin evento'], [],
    ['SKU', d.tot.skus], ['SKU candidatos (antes del máximo)', d.tot.candidatos], ['SKU sin disponible sobre el stock de seguridad', d.tot.porSS],
    ['Stock fuera de OSR', d.tot.fuera], ['Stock de seguridad que queda fuera', d.tot.ss], ['Unidades a ingresar', d.tot.ingresar], ['Quedan fuera de OSR', d.tot.queda], ['Ubicaciones de origen', d.tot.ubic],
    ['Totes de OSR necesarios', d.tot.totes], ['Totes si todo fuera en tote entero', d.tot.totesEntero], ['Totes que se ahorran', d.tot.ahorroTotes],
    ['Compartimentos: enteros / half / quarter', `${d.tot.mix.ENTERO} / ${d.tot.mix.HALF} / ${d.tot.mix.QUARTER}`],
    ['Venta diaria de estos SKU', r1(d.tot.ventaDia)], ['% de la venta diaria total', r1(d.tot.pctVenta * 100) + '%'], ['Días de cobertura del ingreso', d.tot.cob === null ? '' : r1(d.tot.cob)], [],
    ['CD de origen', 'SKU', 'Unidades', 'Ubicaciones'], ...d.porCd.map((x) => [x.cd, x.skus, x.unidades, x.ubic]), [],
    ['Matriz del universo (antes de elegir clases)', 'SKU', 'Stock fuera', 'A ingresar'], ...CLASES.map((k) => [k, d.matriz[k].skus, d.matriz[k].fuera, d.matriz[k].ingresar]), [],
    [`SKU EN ${d.osr} SIN LOGÍSTICA OSR = Y`, MODO_NOY[d.noY.modo]], ['Estados', d.noY.estados.length ? d.noY.estados.join(', ') : 'Todos'], ['Clases', d.noY.clases.length ? d.noY.clases.join(', ') : 'Todas'],
    ['SKU', d.noY.tot.skus], [`Unidades en ${d.osr}`, d.noY.tot.osr], [`Ubicaciones de ${d.osr}`, d.noY.tot.ubic], ['Ubicaciones que quedan libres al retirarlos', d.noY.tot.libera],
    ['Venta diaria', r1(d.noY.tot.ventaDia)], [],
    ['BALANCE DEL ESCENARIO', 'Entra', 'Sale', 'Neto'], ['Venta diaria en OSR', r1(d.balance.ventaEntra), r1(d.balance.ventaSale), r1(d.balance.ventaNeta)],
    [`Unidades en ${d.osr}`, d.balance.unidEntra, d.balance.unidSale, d.balance.unidNeta],
    ['Totes de OSR (necesarios · se liberan)', d.balance.totesNecesarios, d.balance.ubicLibera, d.balance.ubicNeta],
    [`Participación de ${d.osr} en la venta (antes → después)`, r1(d.balance.partAntes * 100) + '%', r1(d.balance.partDespues * 100) + '%'],
  ];
  const dep = [['Cod.', 'Depto', 'Lista OSR', 'Categoría evento', 'Factor evento', 'SKU', 'Venta/día', ...d.cds.map((cd) => `Fuera ${cd}`), 'Stock fuera', 'Stock seg. fuera', 'A ingresar', 'Ubicaciones', 'Totes OSR', 'Totes si entero', ...CLASES],
    ...d.deptos.map((x) => [x.cod, x.depto, x.enLista ? 'SI' : 'NO', x.categoria, d.evento ? x.factor : '', x.skus, r1(x.ventaDia), ...d.cds.map((cd) => x.porCd[cd] || 0), x.fuera, x.ss, x.ingresar, x.ubic, r1(x.totes), x.totesEntero, ...CLASES.map((k) => x.clases[k] || 0)])];
  const sku = [['Clase', 'SKU', 'Descripción', 'Depto', 'Logística OSR', `Stock ${d.osr}`, ...d.cds.map((cd) => `Fuera ${cd}`), 'Stock fuera', 'Stock seg. fuera', 'Disponible', 'A ingresar', 'Queda fuera', 'Ubicaciones a tomar', 'Venta/día', 'Factor evento', 'Venta/día evento', 'Días de cobertura (ingreso)', 'Capacidad tote (u.)', 'Almacenamiento OSR', 'Totes OSR', 'Totes si entero'],
    ...d.elegidos.map((x) => [x.matriz, x.sku, x.desc, x.depto, x.aptitud, x.osr, ...d.cds.map((cd) => x.porCd[cd] || 0), x.fuera, x.ss, x.disponible, x.ingresar, x.queda, x.nUb, r1(x.ventaDia), d.evento ? x.factor : '', r1(x.ventaEvt), x.cob === null ? '' : Math.round(x.cob), x.cap, x.almac, r1(x.totes), x.totesEntero])];
  const noy = [['Clase', 'SKU', 'Descripción', 'Depto', 'Logística OSR', `Stock ${d.osr}`, `Ubic. ${d.osr}`, 'Ubic. que se liberan', 'Stock fuera', 'Venta/día'],
    ...d.noY.lista.map((x) => [x.matriz, x.sku, x.desc, x.depto, x.aptitud, x.osr, x.ubic, x.libera, x.fuera, r1(x.ventaDia)])];
  const ub = [['Clase', 'SKU', 'Descripción', 'CD origen', 'Ubicación', 'Stock en ubicación', 'A sacar'],
    ...d.elegidos.flatMap((x) => x.toma.map((o) => [x.matriz, x.sku, x.desc, o.cd, o.ubic, o.stock, o.qty]))];
  return {
    buffer: libro([['Resumen', resumen, [40, 30, 14, 12]], ['Por depto', dep, [7, 30, 9, 8, 10]], ['Por SKU', sku, [7, 14, 36, 26, 12, 10]], ['Ubicaciones origen', ub, [7, 14, 36, 10, 18, 12, 10]], [`En ${d.osr} sin Y`, noy, [7, 14, 36, 26, 12, 10, 10, 12, 10, 10]]]),
    nombre: `Potencial_${d.osr}_${d.evento ? d.evento.clave + '_' : ''}${c.clases.join('')}_${fecha}.xlsx`,
  };
}
