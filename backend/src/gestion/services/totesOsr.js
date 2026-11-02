// Optimización de totes de OSR. Con la distribución del OSR cargada en Datos (Article number, Stock, Stock locations, FULL,
// HALF, QUARTER) se usan los compartimentos reales de cada SKU (half = 1/2 tote, quarter = 1/4); sin ella, cada ubicación
// de OSR de la Base es un tote entero de un SKU.
// Por SKU: totes que usa hoy, unidades, llenado y cuántos totes necesitaría reempacado en quarter / half (capacidad estimada
// por depto) y, si se pide, con un tope de días de venta en OSR (el excedente vuelve a otro CD). Los half y quarter de
// distintos SKU comparten tote, así que lo liberado se mide en el total: totes de hoy - totes reempacados. Los totes que se liberan se
// ofrecen a los SKU de afuera del Potencial fuera de OSR (AX, AY, BX, BY por defecto), en su orden de prioridad.
// Cada SKU de OSR muestra su temporada y si su depto es del evento elegido (factor sobre GENERAL o sobre el mínimo) o de la
// proyección cargada (Pro_Evt): así se ve si los que están fuera de AX / AY / BX / BY son los que hay que tener para el evento.
// Con el tope de días, los SKU del evento (o de las temporadas protegidas) pueden quedar sin reducir.
import XLSX from 'xlsx';
import { q, tx } from '../db.js';
import { baseSku, DIAS_VENTAS, leerProyeccion, digitos } from './abastecimientoOsr.js';
import { factoresEvento } from './eventosOsr.js';
import { nomTemporada } from '../engine/slowMoving.js';
import { buscarCol } from '../engine/base.js';
import { skuKey } from './participacionCd.js';
import { filasDeCarga } from './stock.js';
import { calcularPotencial, capacidadTotes, empaque, TOTES, CLASES } from './potencialOsr.js';
import { up, txt, num, cmp, fmtFecha, hoyIso, normTxt } from '../engine/util.js';
import { libro } from './tareas.js';

const LIMITE = 500;
const n0 = (v) => Math.max(0, Number(v) || 0);
const lista = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map(up).filter(Boolean);
const CLAVE = 'osrTotesCarga';
const CUATRO = ['AX', 'AY', 'BX', 'BY'];
const TAM = { ENTERO: 1, HALF: 0.5, QUARTER: 0.25 }; // fracción de tote de cada compartimento
const errDist = (m) => Object.assign(new Error(m), { status: 400 });
const p90 = (l) => { const s = [...l].sort((a, b) => a - b); return s.length ? Math.max(4, Math.round(s[Math.floor(0.9 * (s.length - 1))])) : null; };

// ---------------------------------------------------------------------------------------------
// Distribución de totes del OSR (carga en Datos): reemplaza la anterior
// ---------------------------------------------------------------------------------------------
export async function cargarDistribucionOsr(buffer, archivo) {
  const wb = XLSX.read(buffer, { type: 'buffer', dense: true });
  let m = null, f = -1, c = null, hoja = '';
  for (const n of wb.SheetNames) {
    m = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
    for (let i = 0; i < Math.min(15, m.length); i++) {
      const col = { sku: buscarCol(m[i], 'ARTICLE NUMBER|ARTICLE NUMBE|ARTICLE|ARTICULO|NUMERO ARTICULO|SKU'), nom: buscarCol(m[i], 'ARTICLE NAME|NOMBRE ARTICULO|DESCRIPCION|NOMBRE'),
        stock: buscarCol(m[i], 'STOCK|UNIDADES|QTY'), ub: buscarCol(m[i], 'STOCK LOCATIONS|UBICACIONES|LOCATIONS'),
        full: buscarCol(m[i], 'FULL|ENTERO'), half: buscarCol(m[i], 'HALF|MEDIO'), quarter: buscarCol(m[i], 'QUARTER|CUARTO') };
      if (col.sku >= 0 && col.stock >= 0 && (col.full >= 0 || col.half >= 0 || col.quarter >= 0)) { f = i; c = col; break; }
    }
    if (f >= 0) { hoja = n; break; }
  }
  if (f < 0) throw errDist('No reconocí los encabezados: el archivo debe traer Article number, Stock y las columnas FULL, HALF y QUARTER (Article name y Stock locations son opcionales).');
  const filas = new Map();
  let noCuadra = 0;
  for (const r of m.slice(f + 1)) {
    const sku = skuKey(r[c.sku]);
    if (!sku) continue;
    const full = c.full >= 0 ? Math.round(num(r[c.full])) : 0, half = c.half >= 0 ? Math.round(num(r[c.half])) : 0, quarter = c.quarter >= 0 ? Math.round(num(r[c.quarter])) : 0;
    const ub = c.ub >= 0 ? Math.round(num(r[c.ub])) : full + half + quarter;
    if (ub !== full + half + quarter) noCuadra++;
    const x = filas.get(sku) || { sku, nombre: c.nom >= 0 ? txt(r[c.nom]) : '', stock: 0, ub: 0, full: 0, half: 0, quarter: 0 };
    x.stock += num(r[c.stock]); x.ub += ub; x.full += full; x.half += half; x.quarter += quarter;
    filas.set(sku, x);
  }
  if (!filas.size) throw errDist('El archivo no trae filas con Article number.');
  const l = [...filas.values()];
  await tx(async (cn) => {
    await cn.query('DELETE FROM osr_totes');
    for (let i = 0; i < l.length; i += 5000) {
      const b = l.slice(i, i + 5000);
      await cn.query(`INSERT INTO osr_totes (sku, nombre, stock, ubicaciones, full_t, half_t, quarter_t)
        SELECT * FROM unnest($1::text[], $2::text[], $3::numeric[], $4::int[], $5::int[], $6::int[], $7::int[])`,
      [b.map((x) => x.sku), b.map((x) => x.nombre), b.map((x) => x.stock), b.map((x) => x.ub), b.map((x) => x.full), b.map((x) => x.half), b.map((x) => x.quarter)]);
    }
    await cn.query('INSERT INTO parametros (clave, valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor',
      [CLAVE, JSON.stringify({ archivo, hoja, cargado: hoyIso(), skus: l.length })]);
  });
  const s = (k) => l.reduce((a, x) => a + x[k], 0);
  return { archivo, hoja, skus: l.length, stock: s('stock'), ubicaciones: s('ub'), full: s('full'), half: s('half'), quarter: s('quarter'),
    totes: s('full') + s('half') / 2 + s('quarter') / 4, noCuadra };
}

export async function borrarDistribucionOsr() {
  await q('DELETE FROM osr_totes');
  await q('DELETE FROM parametros WHERE clave = $1', [CLAVE]);
  return { ok: true };
}

/** Distribución cargada: por SKU (clave normalizada) y datos de la carga; null si no hay. */
async function distribucion() {
  const { rows } = await q('SELECT valor FROM parametros WHERE clave = $1', [CLAVE]);
  if (!rows.length) return null;
  const meta = typeof rows[0].valor === 'string' ? JSON.parse(rows[0].valor) : rows[0].valor;
  const { rows: l } = await q('SELECT sku, nombre, stock::float8 AS stock, ubicaciones, full_t, half_t, quarter_t FROM osr_totes');
  return { meta, porSku: new Map(l.map((x) => [x.sku, x])) };
}

async function calcular(params = {}) {
  const { carga, osr, skus } = await baseSku();
  const modo = params.tote in TOTES ? params.tote : 'AUTO';
  const capFija = n0(params.capTote);
  const maxDias = n0(params.maxDias), minOsr = n0(params.minOsr), minTotes = n0(params.minTotes);
  const clases = lista(params.clases).filter((c) => CLASES.includes(c));
  const aptitud = params.aptitud === 'Y' || params.aptitud === 'NOY' ? params.aptitud : '';
  const info = new Map(skus.map((x) => [skuKey(x.sku), x]));
  const dist = await distribucion();
  const filas = await filasDeCarga(carga.id);
  // temporada del SKU (primera no vacía de la Base), evento del simulador y deptos de la proyección cargada (Pro_Evt)
  const tempDe = new Map();
  for (const f of filas) { const k = skuKey(f.sku); if (f.temp && !tempDe.has(k)) tempDe.set(k, nomTemporada(f.temp)); }
  const temporadasSel = (Array.isArray(params.temporadas) ? params.temporadas : String(params.temporadas || '').split('|')).filter(Boolean);
  // evento 'NINGUNO': ni evento del simulador ni proyección Pro_Evt
  const sinEvt = params.evento === 'NINGUNO';
  const evt = await factoresEvento(sinEvt ? '' : params.evento || '');
  const conEvt = !!evt.evento, evtMin = n0(params.evtMin);
  const potenciado = (f) => conEvt && (evtMin > 0 ? f >= evtMin : f > evt.general);
  const proy = sinEvt ? null : await leerProyeccion();
  const proyCod = new Set((proy?.filas || []).map((x) => digitos(x.cod)).filter(Boolean));
  const proyNom = new Set((proy?.filas || []).map((x) => normTxt(x.nom)).filter(Boolean));
  const enProy = (depto) => !!proy && (proyCod.has(digitos(depto)) || proyNom.has(normTxt(String(depto).replace(/^\d+\s*/, ''))));
  const proteger = params.proteger === true || params.proteger === 'true' || params.proteger === '1';
  const tempProteger = (Array.isArray(params.tempProteger) ? params.tempProteger : String(params.tempProteger || '').split('|')).filter(Boolean);

  // ocupación actual por SKU: con la distribución cargada, compartimentos reales (totes = FULL + HALF/2 + QUARTER/4);
  // sin ella, cada ubicación de OSR de la Base es un tote entero
  const ocup = [];
  let caps;
  if (dist) {
    for (const d of dist.porSku.values()) {
      const totesHoy = d.full_t + d.half_t / 2 + d.quarter_t / 4;
      if (!(totesHoy > 0) && !(d.stock > 0)) continue;
      ocup.push({ sku: d.sku, b: info.get(d.sku), nombre: d.nombre, unid: d.stock, totesHoy, hoy: { ENTERO: d.full_t, HALF: d.half_t, QUARTER: d.quarter_t }, ubic: d.ubicaciones, porTote: totesHoy ? d.stock / totesHoy : 0 });
    }
    // capacidad de un tote entero por depto: percentil 90 de las unidades por tote equivalente de sus SKU
    const porDep = new Map(), todosPt = [];
    for (const o of ocup) {
      if (!(o.porTote > 0)) continue;
      todosPt.push(o.porTote);
      const dep = o.b?.depto || '(sin Base)';
      if (!porDep.has(dep)) porDep.set(dep, []);
      porDep.get(dep).push(o.porTote);
    }
    caps = { global: p90(todosPt) || 40, porDepto: new Map([...porDep].filter(([, l]) => l.length >= 10).map(([d, l]) => [d, p90(l)])) };
  } else {
    caps = await capacidadTotes(carga, osr, skus);
    const porSku = new Map();
    for (const f of filas) {
      if (up(f.cd) !== osr || !f.sku || !(f.qty > 0)) continue;
      let x = porSku.get(f.sku);
      if (!x) porSku.set(f.sku, x = new Map());
      x.set(f.ubic, (x.get(f.ubic) || 0) + f.qty);
    }
    for (const [sku, ubs] of porSku) {
      const unid = [...ubs.values()].reduce((s, u) => s + u, 0);
      ocup.push({ sku, b: info.get(skuKey(sku)), nombre: '', unid, totesHoy: ubs.size, hoy: { ENTERO: ubs.size, HALF: 0, QUARTER: 0 }, ubic: ubs.size, porTote: Math.max(...ubs.values()) });
    }
  }
  const todos = [];
  for (const o of ocup) {
    const b = o.b;
    const depto = b?.depto || '(sin Base)';
    // si el SKU ya guarda hoy más por tote que la capacidad estimada, manda lo observado
    const cap = capFija || Math.max(caps.porDepto.get(depto) || caps.global, Math.ceil(o.porTote));
    const ventaDia = b ? b.vta / DIAS_VENTAS : 0;
    const temporada = tempDe.get(skuKey(o.sku)) || '(sin temporada)';
    const { categoria, factor } = conEvt ? evt.deDepto(depto) : { categoria: '', factor: 1 };
    const delEvento = potenciado(factor), proyectado = enProy(depto);
    // "del evento": con un evento elegido manda su factor; sin evento, estar en la proyección cargada (Pro_Evt)
    const esEvento = conEvt ? delEvento : proyectado;
    // los SKU del evento o de las temporadas protegidas no se reducen con el tope de días
    const protegido = (proteger && esEvento) || tempProteger.includes(temporada);
    const queda = maxDias > 0 && !protegido ? Math.min(o.unid, Math.max(minOsr, Math.ceil(ventaDia * maxDias))) : o.unid;
    const e = empaque(queda, cap, modo);
    todos.push({ sku: o.sku, desc: b?.desc || o.nombre, depto, temporada, categoria, factor, delEvento, proyectado, esEvento, protegido, fuera4: !CUATRO.includes(b?.matriz || ''),
      matriz: b?.matriz || '', abc: b?.abc || '', log: !b ? 'SIN BASE' : b.log === 'Y' ? 'Y' : b.log || 'SIN DATO',
      totesHoy: o.totesHoy, hoy: o.hoy, ubic: o.ubic, unid: o.unid, llenado: o.totesHoy ? o.unid / (o.totesHoy * cap) : 0, cap, ventaDia,
      cobOsr: ventaDia > 0 ? o.unid / ventaDia : null, queda, devolver: o.unid - queda, totesOpt: e.totes, almac: e.almac, comps: e.comps, libera: Math.max(0, o.totesHoy - e.totes) });
  }
  // matriz del OSR actual (antes de filtrar clases)
  const matriz = Object.fromEntries(CLASES.map((c) => [c, { skus: 0, totes: 0, libera: 0 }]));
  for (const x of todos) { const m = matriz[x.matriz]; if (m) { m.skus++; m.totes += x.totesHoy; m.libera += x.libera; } }

  const temporadas = {};
  for (const x of todos) temporadas[x.temporada] = (temporadas[x.temporada] || 0) + 1;
  const filtroEvt = params.filtroEvento; // '' | 'EVENTO' (del evento o Pro_Evt) | 'NO'
  const sel = todos.filter((x) => (!clases.length || clases.includes(x.matriz)) && x.totesHoy > minTotes
    && (!temporadasSel.length || temporadasSel.includes(x.temporada))
    && (!filtroEvt || (filtroEvt === 'EVENTO' ? x.esEvento : !x.esEvento))
    && (!aptitud || (aptitud === 'Y' ? x.log === 'Y' : x.log !== 'Y')))
    .sort((a, b) => b.libera - a.libera || b.totesHoy - a.totesHoy || cmp(a.sku, b.sku));
  const sum = (l, k) => l.reduce((s, x) => s + x[k], 0);
  const mix = { ENTERO: 0, HALF: 0, QUARTER: 0 };
  for (const x of sel) for (const k of Object.keys(mix)) mix[k] += x.comps[k];
  const totesHoyOsr = Math.ceil(sum(todos, 'totesHoy'));
  const hoyTipos = { ENTERO: 0, HALF: 0, QUARTER: 0 };
  for (const x of sel) for (const k of Object.keys(hoyTipos)) hoyTipos[k] += x.hoy[k];
  const tot = { skus: sel.length, totesHoy: Math.ceil(sum(sel, 'totesHoy')), hoyTipos, ubic: sum(sel, 'ubic'), unid: sum(sel, 'unid'), unidOsr: sum(todos, 'unid'), queda: sum(sel, 'queda'), devolver: sum(sel, 'devolver'),
    totesOpt: Math.ceil(sum(sel, 'totesOpt')), libera: Math.max(0, Math.floor(sum(sel, 'totesHoy')) - Math.ceil(sum(sel, 'totesOpt'))), mix, totesOsr: totesHoyOsr, skusOsr: todos.length,
    medianaUnid: Math.round(mediana(ocup.map((o) => o.porTote))), conLibera: sel.filter((x) => x.libera > 0).length, sinBase: todos.filter((x) => x.log === 'SIN BASE').length };
  tot.llenado = tot.totesHoy ? sel.reduce((s, x) => s + x.unid / x.cap, 0) / tot.totesHoy : 0;
  // utilización por tipo de tote: las unidades del SKU se reparten entre sus compartimentos según su tamaño (full 1, half ½,
  // quarter ¼), así cada compartimento queda con el llenado del SKU; rangos de utilización en cantidad de compartimentos
  tot.porTipo = porTipos(sel);
  // SKU fuera de AX / AY / BX / BY: cuántos son del evento o de la proyección, y cuántos totes ocupan
  const f4 = sel.filter((x) => x.fuera4), f4e = f4.filter((x) => x.esEvento);
  tot.fuera4 = { skus: f4.length, totes: Math.ceil(sum(f4, 'totesHoy')), unid: sum(f4, 'unid'), evento: f4e.length, totesEvento: Math.ceil(sum(f4e, 'totesHoy')),
    delEvento: f4.filter((x) => x.delEvento).length, proyectados: f4.filter((x) => x.proyectado).length, sinVenta: f4.filter((x) => !(x.ventaDia > 0)).length };
  tot.protegidos = sel.filter((x) => x.protegido).length;

  const depM = new Map();
  for (const x of sel) {
    const d = depM.get(x.depto) || { depto: x.depto, skus: 0, totesHoy: 0, unid: 0, devolver: 0, totesOpt: 0, libera: 0, l: [] };
    d.l.push(x); d.skus++; d.totesHoy += x.totesHoy; d.unid += x.unid; d.devolver += x.devolver; d.totesOpt += x.totesOpt; d.libera += x.libera;
    depM.set(x.depto, d);
  }
  const deptos = [...depM.values()].map(({ l, ...d }) => ({ ...d, llenado: d.totesHoy ? l.reduce((s, x) => s + x.unid / x.cap, 0) / d.totesHoy : 0, porTipo: porTipos(l) }))
    .sort((a, b) => b.libera - a.libera || cmp(a.depto, b.depto));

  // uso de los totes liberados: SKU de afuera (Potencial fuera de OSR) en su orden de prioridad, mismo tipo de almacenamiento
  const pot = await calcularPotencial({ ...(params.pot || {}), tote: modo, capTote: capFija || '' });
  let usados = 0;
  const entran = [];
  for (const x of pot.elegidos) {
    if (usados + x.totes > tot.libera + 1e-9) continue;
    usados += x.totes; entran.push(x);
  }
  const porClase = Object.fromEntries(CLASES.map((c) => [c, 0]));
  for (const x of entran) porClase[x.matriz]++;
  const uso = { candidatos: pot.elegidos.length, totesCandidatos: pot.tot.totes, entran: entran.length, totesUsados: Math.ceil(usados),
    unid: sum(entran, 'ingresar'), ventaDia: sum(entran, 'ventaDia'), porClase, clases: pot.conf.clases, sobran: tot.libera - Math.ceil(usados),
    faltan: Math.max(0, pot.tot.totes - tot.libera) };

  return { carga, osr, fuente: dist ? { tipo: 'DISTRIBUCION', ...dist.meta } : { tipo: 'BASE' },
    conf: { tote: modo, capFija, capGlobal: caps.global, maxDias, minOsr, minTotes, clases, aptitud, temporadas: temporadasSel, evtMin, proteger, tempProteger, filtroEvt: filtroEvt || '' },
    eventos: evt.eventos, evento: evt.evento, evtGeneral: evt.general, proy: proy ? { evento: proy.evento, archivo: proy.archivo, deptos: proy.filas.length } : null,
    temporadas: Object.entries(temporadas).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ temporada: t, skus: n })), matriz, tot, deptos, sel, uso, entran };
}

// utilización por tipo de tote: las unidades del SKU se reparten entre sus compartimentos según su tamaño (full 1, half ½,
// quarter ¼), así cada compartimento queda con el llenado del SKU; rangos de utilización en cantidad de compartimentos
function porTipos(l) {
  return Object.entries(TAM).map(([k, tam]) => {
    const p = { tipo: k, comps: 0, totes: 0, unid: 0, capac: 0, skus: 0, soloTipo: 0, rangos: [0, 0, 0, 0], opt: 0 };
    for (const x of l) {
      p.opt += x.comps[k];
      const n = x.hoy[k];
      if (!n || !x.totesHoy) continue;
      p.comps += n; p.totes += n * tam; p.unid += x.unid * (n * tam) / x.totesHoy; p.capac += n * tam * x.cap; p.skus++;
      if (Object.keys(TAM).every((o) => o === k || !x.hoy[o])) p.soloTipo++;
      p.rangos[x.llenado < 0.25 ? 0 : x.llenado < 0.5 ? 1 : x.llenado < 0.8 ? 2 : 3] += n;
    }
    p.utilizacion = p.capac ? p.unid / p.capac : 0;
    p.unid = Math.round(p.unid);
    return p;
  });
}

const mediana = (l) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

/** Vista: matriz del OSR, totales, por depto, SKU (filtro por depto, orden y top) y los SKU de afuera que entran. */
export async function totesOsr(params = {}) {
  const { sel, entran, ...r } = await calcular(params);
  const b = up(params.buscar);
  const l = sel.filter((x) => (!params.depto || x.depto === params.depto) && (!b || up(x.sku).includes(b) || up(x.desc).includes(b)));
  if (params.orden) {
    const k = params.orden, s = params.dir === 'asc' ? 1 : -1;
    l.sort((a, b) => {
      const va = a[k], vb = b[k];
      if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
      if (vb === null || vb === undefined) return -1;
      return s * (typeof va === 'number' && typeof vb === 'number' ? va - vb : cmp(String(va), String(vb)));
    });
  }
  const top = Math.min(LIMITE, Number(params.top) || LIMITE);
  return { ...r, depto: params.depto || '', filtrados: l.length, detalle: l.slice(0, top).map(({ comps, ...x }) => x),
    entran: entran.slice(0, LIMITE).map(({ origen, toma, comps, ...x }) => x) };
}

/** Excel: resumen, SKU de OSR con su optimización, por depto y SKU de afuera que entran en los totes liberados. */
export async function archivoTotesOsr(params = {}) {
  const d = await calcular(params);
  const c = d.conf, t = d.tot, u = d.uso;
  const fecha = d.carga.fecha instanceof Date ? d.carga.fecha.toISOString().slice(0, 10) : String(d.carga.fecha).slice(0, 10);
  const r2 = (x) => Math.round(x * 100) / 100;
  const resumen = [
    [`OPTIMIZACIÓN DE TOTES DE ${d.osr} · Base del ${fmtFecha(fecha)}`], [],
    ['Almacenamiento simulado', TOTES[c.tote]], ['Capacidad tote entero', c.capFija ? `${c.capFija} u. (fija)` : `por depto (percentil 90 de OSR; general ${c.capGlobal} u.)`],
    ['Tope de stock en OSR', c.maxDias ? `${c.maxDias} días de venta (mínimo ${c.minOsr} u.); el excedente vuelve a otro CD` : 'Sin tope (se reempaca todo lo que hay)'],
    ['Clases', c.clases.length ? c.clases.join(', ') : 'Todas'], ['SKU con más de N totes', c.minTotes], ['Temporadas', c.temporadas.length ? c.temporadas.join(', ') : 'Todas'],
    ['Evento', d.evento ? `${d.evento.evento} (${fmtFecha(d.evento.inicio)} al ${fmtFecha(d.evento.fin)}) · deptos con factor ${c.evtMin ? `≥ ${c.evtMin}` : `> GENERAL (${d.evtGeneral})`}` : 'Sin evento'],
    ['Proyección del evento (Pro_Evt)', d.proy ? `${d.proy.evento} · ${d.proy.deptos} deptos` : 'Sin proyección cargada'],
    ['No se reducen con el tope', [c.proteger ? 'SKU del evento / Pro_Evt' : '', c.tempProteger.length ? `temporadas ${c.tempProteger.join(', ')}` : ''].filter(Boolean).join(' · ') || '—'], [],
    ['SKU fuera de AX / AY / BX / BY', t.fuera4.skus], ['  de ellos, del evento o de Pro_Evt', t.fuera4.evento], ['  totes que ocupan (todos / del evento)', `${t.fuera4.totes} / ${t.fuera4.totesEvento}`],
    ['  sin venta', t.fuera4.sinVenta], [],
    ['Origen de la ocupación', d.fuente.tipo === 'DISTRIBUCION' ? `Distribución de totes cargada (${d.fuente.archivo}, ${fmtFecha(d.fuente.cargado)})` : 'Base de stock: cada ubicación de OSR = 1 tote entero'],
    [`Stock en ${d.osr} (todos los SKU)`, t.unidOsr], [`Totes ocupados hoy en ${d.osr} (todos los SKU)`, t.totesOsr], ['SKU en OSR', t.skusOsr], ['Mediana de unidades por tote', t.medianaUnid],
    ['SKU de la distribución que no están en la Base', t.sinBase], [],
    ['Compartimentos hoy (SKU analizados): full / half / quarter', `${t.hoyTipos.ENTERO} / ${t.hoyTipos.HALF} / ${t.hoyTipos.QUARTER}`], ['Ubicaciones (compartimentos)', t.ubic],
    ['SKU analizados', t.skus], ['Totes que usan hoy', t.totesHoy], ['Llenado promedio', r2(t.llenado * 100) + '%'], ['Unidades', t.unid],
    ['Unidades que vuelven a otro CD', t.devolver], ['Totes optimizados', t.totesOpt], ['Totes que se liberan', t.libera],
    ['Compartimentos: enteros / half / quarter', `${t.mix.ENTERO} / ${t.mix.HALF} / ${t.mix.QUARTER}`], [],
    ['USO DE LOS TOTES LIBERADOS', `SKU de afuera ${u.clases.join(', ')}`], ['SKU candidatos', u.candidatos], ['Totes que necesitan todos', u.totesCandidatos],
    ['SKU que entran', u.entran], ['Totes usados', u.totesUsados], ['Unidades que ingresan', u.unid], ['Venta diaria que pasa a OSR', r2(u.ventaDia)],
    ['Totes que faltarían para todos los candidatos', u.faltan], ...CLASES.filter((k) => u.porClase[k]).map((k) => [`Entran ${k}`, u.porClase[k]]),
  ];
  const sku = [['Clase', 'SKU', 'Descripción', 'Depto', 'Temporada', 'Categoría evento', 'Factor evento', 'Del evento', 'En Pro_Evt', 'Protegido', 'Logística OSR', 'FULL hoy', 'HALF hoy', 'QUARTER hoy', 'Totes hoy', 'Unidades', 'Capacidad tote', 'Llenado %', 'Venta/día', 'Días de cobertura en OSR',
    'Quedan en OSR', 'Vuelven a otro CD', 'Almacenamiento optimizado', 'Totes optimizados', 'Totes que se liberan'],
  ...d.sel.map((x) => [x.matriz, x.sku, x.desc, x.depto, x.temporada, x.categoria, d.evento ? x.factor : '', x.delEvento ? 'SI' : '', x.proyectado ? 'SI' : '', x.protegido ? 'SI' : '', x.log, x.hoy.ENTERO, x.hoy.HALF, x.hoy.QUARTER, r2(x.totesHoy), x.unid, x.cap, Math.round(x.llenado * 100), r2(x.ventaDia), x.cobOsr === null ? '' : Math.round(x.cobOsr),
    x.queda, x.devolver, x.almac, r2(x.totesOpt), x.libera])];
  const dep = [['Depto', 'SKU', 'Totes hoy', 'Unidades', 'Vuelven a otro CD', 'Totes optimizados', 'Totes que se liberan'],
    ...d.deptos.map((x) => [x.depto, x.skus, x.totesHoy, x.unid, x.devolver, r2(x.totesOpt), x.libera])];
  const NOM = { ENTERO: 'Full', HALF: 'Half', QUARTER: 'Quarter' };
  const tipos = [['Tipo de tote', 'Compartimentos', 'Equivalente en totes', '% de los totes', 'SKU que lo usan', 'SKU solo en este tipo', 'Unidades (estimadas)',
    'U. por compartimento', 'Utilización %', 'Compart. < 25%', 'Compart. 25-50%', 'Compart. 50-80%', 'Compart. ≥ 80%', 'Compartimentos tras reempaque'],
  ...t.porTipo.map((p) => [NOM[p.tipo], p.comps, r2(p.totes), t.totesHoy ? r2(p.totes / t.totesHoy * 100) : 0, p.skus, p.soloTipo, p.unid,
    p.comps ? r2(p.unid / p.comps) : 0, r2(p.utilizacion * 100), ...p.rangos, p.opt])];
  const tipoDep = [['Depto', 'SKU', 'Totes hoy', 'Utilización %', ...['Full', 'Half', 'Quarter'].flatMap((n) => [`${n} compart.`, `${n} unidades`, `${n} utilización %`]),
    'Compart. < 50%', 'Compart. ≥ 80%', 'Totes optimizados'],
  ...d.deptos.map((x) => [x.depto, x.skus, r2(x.totesHoy), r2(x.llenado * 100), ...x.porTipo.flatMap((p) => [p.comps, p.unid, r2(p.utilizacion * 100)]),
    x.porTipo.reduce((s, p) => s + p.rangos[0] + p.rangos[1], 0), x.porTipo.reduce((s, p) => s + p.rangos[3], 0), r2(x.totesOpt)])];
  const ent = [['Clase', 'SKU', 'Descripción', 'Depto', 'Stock fuera', 'A ingresar', 'Almacenamiento', 'Totes', 'Venta/día'],
    ...d.entran.map((x) => [x.matriz, x.sku, x.desc, x.depto, x.fuera, x.ingresar, x.almac, r2(x.totes), r2(x.ventaDia)])];
  return {
    buffer: libro([['Resumen', resumen, [46, 40]], ['Por tipo de tote', tipos, [12, 14, 12, 10, 10, 12, 12, 12, 11, 11, 11, 11, 11, 14]], ['Tipo de tote por depto', tipoDep, [30, 8, 10, 11, 10, 10, 11, 10, 10, 11, 10, 10, 11, 12, 12, 12]], ['SKU en OSR', sku, [7, 14, 36, 26, 18, 18, 8, 8, 8, 8, 10, 8, 8, 9, 9, 10, 10, 9, 9, 12, 10, 12, 30, 11, 11]], ['Por depto', dep, [30, 8, 10, 10, 12, 12, 12]],
      ['SKU que entran', ent, [7, 14, 36, 26, 10, 10, 30, 8, 9]]]),
    nombre: `Totes_${d.osr}_${c.tote}_${fecha}.xlsx`,
  };
}
