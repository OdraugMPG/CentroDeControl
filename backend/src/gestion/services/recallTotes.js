// Ocupación de los totes del OSR por segmento y recall para optimizar su uso (Abastecimiento OSR → Optimización de totes).
// Con la extracción de KiSoft (una fila por compartimento: PRODUCT_CODE, LOAD_UNIT, SLOT_INT, STOCK_LOCATION_TYPE,
// QUANTITY_TOTAL_INT y la capacidad del SKU en cada tipo CAPACITY_111 / 121 / 141) se guarda una foto por día.
// Tipos de tote: 111 = Full (1 compartimento), 121 = Half (2 compartimentos de ½ tote), 141 = Quarter (4 de ¼ de tote).
// Uso del compartimento = unidades ÷ capacidad del SKU en ese tipo; uso del tote = suma de sus compartimentos ponderados
// por su tamaño (igual que USO_UBIC, USO_REL y TRAMO_USO_TOTE del archivo).
// Recall: por SKU, el reempaque que usa menos tote (full + half + quarter que alcanzan para sus unidades con el llenado
// máximo elegido); si ahorra al menos el mínimo pedido, sus totes se llaman a la puerta para consolidar o cambiar de tipo.
import XLSX from 'xlsx';
import { q, tx } from '../db.js';
import { buscarCol } from '../engine/base.js';
import { skuKey } from './participacionCd.js';
import { txt, num, hoyIso, isoDesdeSerial, fmtFecha, normTxt } from '../engine/util.js';
import { libro } from './tareas.js';
import { capacidadOsr } from './totesOsr.js';

export const TIPOS = { 111: { nom: 'Full', frac: 1, slots: 1 }, 121: { nom: 'Half', frac: 0.5, slots: 2 }, 141: { nom: 'Quarter', frac: 0.25, slots: 4 } };
const ORDEN = ['111', '121', '141'];
// tramos de uso del tote (límite superior incluido), los mismos de TRAMO_USO_TOTE
export const TRAMOS = [['0-25', 'Hasta 25%', 0.25], ['25-50', '25% a 50%', 0.5], ['50-75', '50% a 75%', 0.75], ['75-100', '75% a 100%', 1], ['100+', 'Más de 100%', Infinity]];
const tramoDe = (u) => TRAMOS.find((t) => u <= t[2] + 1e-9)[0];
const err = (m) => Object.assign(new Error(m), { status: 400 });
const LIM = 400;
const EPS = 1e-9;
const ACCIONES = {
  CONSOLIDAR: 'Consolidar', REEMPACAR: 'Cambiar de tipo', REVISAR: 'Revisar capacidad', SIN_MENOR: 'Sin capacidad half / quarter', OK: 'Bien empacado', SIN_CAP: 'Sin capacidad',
};

// ---------------------------------------------------------------------------------------------
// Carga del archivo (una foto por día)
// ---------------------------------------------------------------------------------------------
const COLS = {
  sku: 'PRODUCT_CODE|PRODUCTCODE|SKU', nom: 'PRODUCT_NAME|DESCRIPCION', peso: 'WEIGHT_INT|WEIGHT', largo: 'LENGTH_INT|LENGTH', ancho: 'WIDTH_INT|WIDTH',
  alto: 'HEIGHT_INT|HEIGHT', c111: 'CAPACITY_111', c121: 'CAPACITY_121', c141: 'CAPACITY_141', lu: 'LOAD_UNIT|LOADUNIT', slot: 'SLOT_INT|SLOT',
  tipo: 'STOCK_LOCATION_TYPE', estado: 'STOCK_LOCATION_STATUS', qty: 'QUANTITY_TOTAL_INT|QUANTITY_TOTAL', libre: 'QUANTITY_UNRESERVED_INT|QUANTITY_UNRESERVED',
  sy: 'STORAGE_YEAR', sm: 'STORAGE_MONTH', sd: 'STORAGE_DAY', act: 'INFORMACION_ACTUALIZADA', file: 'FILE_DATE',
};
const OBLIG = ['sku', 'lu', 'tipo', 'qty', 'c111'];
const tipoDe = (v) => { const g = txt(v).match(/\d+/); return g && TIPOS[g[0]] ? g[0] : txt(v).toUpperCase(); };
const fechaTxt = (s) => {
  const t = txt(s);
  let g = t.match(/(20\d{2})[_\-./]?(\d{2})[_\-./]?(\d{2})/);
  if (g) return `${g[1]}-${g[2]}-${g[3]}`;
  g = t.match(/(\d{2})[_\-./](\d{2})[_\-./](20\d{2})/);
  return g ? `${g[3]}-${g[2]}-${g[1]}` : null;
};
const valida = (iso) => (iso && !Number.isNaN(Date.parse(iso + 'T00:00:00Z')) ? iso : null);

export async function cargarSlotsOsr(buffer, archivo, fechaPedida) {
  const wb = XLSX.read(buffer, { type: 'buffer', dense: true });
  let m = null, f = -1, c = null, hoja = '';
  for (const n of wb.SheetNames) {
    m = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
    for (let i = 0; i < Math.min(15, m.length); i++) {
      const col = Object.fromEntries(Object.entries(COLS).map(([k, a]) => [k, buscarCol(m[i], a)]));
      if (OBLIG.every((k) => col[k] >= 0)) { f = i; c = col; break; }
    }
    if (f >= 0) { hoja = n; break; }
  }
  if (f < 0) throw err('No reconocí los encabezados: el archivo debe traer PRODUCT_CODE, LOAD_UNIT, STOCK_LOCATION_TYPE, QUANTITY_TOTAL_INT y CAPACITY_111 / 121 / 141.');
  const v = (r, k) => (c[k] >= 0 ? r[c[k]] : '');
  const filas = [];
  let fArch = null, fAct = null, otrosTipos = 0;
  for (const r of m.slice(f + 1)) {
    const sku = skuKey(v(r, 'sku')), lu = txt(v(r, 'lu'));
    if (!sku || !lu) continue;
    const tipo = tipoDe(v(r, 'tipo'));
    if (!TIPOS[tipo]) otrosTipos++;
    if (!fArch && v(r, 'file')) fArch = valida(fechaTxt(v(r, 'file')));
    if (!fAct && typeof v(r, 'act') === 'number' && v(r, 'act') > 30000) fAct = isoDesdeSerial(Math.floor(v(r, 'act')));
    const y = txt(v(r, 'sy')), mo = txt(v(r, 'sm')).padStart(2, '0'), d = txt(v(r, 'sd')).padStart(2, '0');
    filas.push({
      lu, slot: Math.round(num(v(r, 'slot'))) || 1, tipo, estado: txt(v(r, 'estado')), sku, nombre: txt(v(r, 'nom')), qty: num(v(r, 'qty')),
      libre: c.libre >= 0 ? num(v(r, 'libre')) : null, c111: Math.round(num(v(r, 'c111'))), c121: Math.round(num(v(r, 'c121'))), c141: Math.round(num(v(r, 'c141'))),
      peso: num(v(r, 'peso')) || null, largo: num(v(r, 'largo')) || null, ancho: num(v(r, 'ancho')) || null, alto: num(v(r, 'alto')) || null,
      falm: /^20\d{2}$/.test(y) ? valida(`${y}-${mo}-${d}`) : null,
    });
  }
  if (!filas.length) throw err('El archivo no trae compartimentos con PRODUCT_CODE y LOAD_UNIT.');
  const fecha = valida(fechaPedida) || fArch || fAct || valida(fechaTxt(archivo)) || hoyIso();
  const resumen = resumenDe(filas);
  await tx(async (cn) => {
    await cn.query('DELETE FROM osr_slots WHERE fecha = $1', [fecha]);
    for (let i = 0; i < filas.length; i += 5000) {
      const b = filas.slice(i, i + 5000);
      const col = (k) => b.map((x) => x[k]);
      await cn.query(`INSERT INTO osr_slots (fecha, load_unit, slot, tipo, estado, sku, nombre, qty, qty_libre, cap111, cap121, cap141, peso, largo, ancho, alto, f_almac)
        SELECT $1::date, * FROM unnest($2::text[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::numeric[], $9::numeric[], $10::int[], $11::int[], $12::int[],
          $13::numeric[], $14::numeric[], $15::numeric[], $16::numeric[], $17::date[])`,
      [fecha, col('lu'), col('slot'), col('tipo'), col('estado'), col('sku'), col('nombre'), col('qty'), col('libre'), col('c111'), col('c121'), col('c141'),
        col('peso'), col('largo'), col('ancho'), col('alto'), col('falm')]);
    }
    await cn.query(`INSERT INTO osr_slots_carga (fecha, archivo, cargado, resumen) VALUES ($1, $2, now(), $3)
      ON CONFLICT (fecha) DO UPDATE SET archivo = EXCLUDED.archivo, cargado = now(), resumen = EXCLUDED.resumen`, [fecha, archivo, JSON.stringify(resumen)]);
  });
  cache.delete(fecha);
  const t = resumen.ocup.tot;
  return { archivo, hoja, fecha, compartimentos: filas.length, totes: t.totes, skus: new Set(filas.map((x) => x.sku)).size, unidades: t.qty,
    porTipo: resumen.ocup.porTipo.map((p) => ({ tipo: p.tipo, nom: p.nom, totes: p.totes })), otrosTipos, recall: resumen.recall };
}

export async function borrarSlotsOsr(fecha) {
  if (fecha) { await q('DELETE FROM osr_slots WHERE fecha = $1', [fecha]); await q('DELETE FROM osr_slots_carga WHERE fecha = $1', [fecha]); } else {
    await q('DELETE FROM osr_slots'); await q('DELETE FROM osr_slots_carga');
  }
  cache.clear();
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------------------------
const capDe = (x, t) => (t === '111' ? x.c111 : t === '121' ? x.c121 : t === '141' ? x.c141 : 0);
const ordTipo = (t) => { const i = ORDEN.indexOf(t); return i < 0 ? 99 : i; };

/** Ocupación de cada tote (LOAD_UNIT) y resumen por tipo con los tramos de uso. */
function ocupacion(filas) {
  const lus = new Map();
  for (const x of filas) {
    let l = lus.get(x.lu);
    if (!l) lus.set(x.lu, l = { lu: x.lu, tipo: x.tipo, slots: 0, qty: 0, uso: 0, usoCap: 0, sinCap: false });
    const cap = capDe(x, x.tipo), fr = TIPOS[x.tipo]?.frac ?? 1;
    x.uso = cap > 0 ? x.qty / cap : null;
    l.slots++; l.qty += x.qty;
    if (cap > 0) { l.uso += x.uso * fr; l.usoCap += Math.min(1, x.uso) * fr; } else l.sinCap = true;
  }
  const nuevo = (t) => ({ tipo: t, nom: TIPOS[t]?.nom || t, totes: 0, slots: 0, slotsPosibles: 0, qty: 0, sumUso: 0, conCap: 0,
    tramos: Object.fromEntries([...TRAMOS.map((x) => [x[0], 0]), ['sin', 0]]) });
  const porTipo = new Map();
  const tot = { ...nuevo('TOTAL'), nom: 'Total' };
  for (const l of lus.values()) {
    l.tramo = l.sinCap ? 'sin' : tramoDe(l.uso);
    let p = porTipo.get(l.tipo);
    if (!p) porTipo.set(l.tipo, p = nuevo(l.tipo));
    for (const a of [p, tot]) {
      a.totes++; a.slots += l.slots; a.slotsPosibles += Math.max(TIPOS[l.tipo]?.slots || 1, l.slots); a.qty += l.qty; a.tramos[l.tramo]++;
      if (!l.sinCap) { a.sumUso += Math.min(1, l.uso); a.conCap++; }
    }
  }
  const fin = ({ sumUso, ...a }) => ({ ...a, usoProm: a.conCap ? sumUso / a.conCap : 0, slotsVacios: a.slotsPosibles - a.slots });
  return { lus, porTipo: [...porTipo.values()].sort((a, b) => ordTipo(a.tipo) - ordTipo(b.tipo)).map(fin), tot: fin(tot) };
}

/** Empaque que usa menos tote para Q unidades con las capacidades (por compartimento) de cada tipo; empate: menos compartimentos. */
function optimo(Q, C1, C2, C4) {
  if (!(Q > 0)) return { a: 0, b: 0, c: 0, eq: 0, n: 0 };
  let best = null;
  const prueba = (a, b, c) => {
    const eq = a + b / 2 + c / 4, n = a + b + c;
    if (!best || eq < best.eq - EPS || (Math.abs(eq - best.eq) < EPS && n < best.n)) best = { a, b, c, eq, n };
  };
  const maxA = C1 > 0 ? Math.ceil(Q / C1) : 0;
  for (let a = maxA > 60 ? maxA - 3 : 0; a <= maxA; a++) {
    const R = Q - a * C1;
    if (R <= 0) { prueba(a, 0, 0); continue; }
    const maxB = C2 > 0 ? Math.ceil(R / C2) : 0;
    for (let b = maxB > 60 ? maxB - 3 : 0; b <= maxB; b++) {
      const R2 = R - b * C2;
      if (R2 <= 0) { prueba(a, b, 0); break; }
      if (C4 > 0) prueba(a, b, Math.ceil(R2 / C4));
    }
  }
  return best;
}

const layTxt = (o) => [[o.a, 'Full'], [o.b, 'Half'], [o.c, 'Quarter']].filter(([n]) => n > 0).map(([n, t]) => `${n} ${t}`).join(' + ') || '—';

/** Recall por SKU: empaque de hoy, el que usa menos tote y la acción. */
function recallSkus(filas, lus, o) {
  const m = new Map();
  for (const x of filas) {
    let s = m.get(x.sku);
    if (!s) m.set(x.sku, s = { sku: x.sku, nombre: x.nombre, qty: 0, hoy: { a: 0, b: 0, c: 0 }, eqHoy: 0, c111: 0, c121: 0, c141: 0, lus: new Set(), sobre: 0, sinCapHoy: 0, usoMin: null, falm: null });
    s.qty += x.qty;
    s.hoy[x.tipo === '111' ? 'a' : x.tipo === '121' ? 'b' : 'c']++;
    s.eqHoy += TIPOS[x.tipo]?.frac ?? 1;
    s.c111 = Math.max(s.c111, x.c111); s.c121 = Math.max(s.c121, x.c121); s.c141 = Math.max(s.c141, x.c141);
    s.lus.add(x.lu);
    if (x.uso === null) s.sinCapHoy++; else if (x.uso > 1 + EPS) s.sobre++;
    const lu = lus.get(x.lu);
    if (lu && !lu.sinCap && (s.usoMin === null || lu.uso < s.usoMin)) s.usoMin = lu.uso;
    if (x.falm && (!s.falm || x.falm < s.falm)) s.falm = x.falm;
  }
  const ll = o.llenado;
  const out = [];
  for (const s of m.values()) {
    const C1 = Math.floor(s.c111 * ll), C2 = Math.floor(s.c121 * ll), C4 = Math.floor(s.c141 * ll);
    const op = C1 > 0 || C2 > 0 || C4 > 0 ? optimo(s.qty, C1, C2, C4) : null;
    let accion = 'OK', ahorro = 0;
    if (!op) accion = 'SIN_CAP';
    else {
      ahorro = s.eqHoy - op.eq;
      if (ahorro >= o.minAhorro - EPS) {
        const usaHoy = { a: s.hoy.a > 0, b: s.hoy.b > 0, c: s.hoy.c > 0 };
        accion = (!op.a || usaHoy.a) && (!op.b || usaHoy.b) && (!op.c || usaHoy.c) && op.n < s.hoy.a + s.hoy.b + s.hoy.c ? 'CONSOLIDAR' : 'REEMPACAR';
      } else if (s.sobre > 0 || s.sinCapHoy > 0) accion = 'REVISAR';
      else if (!s.c121 && !s.c141 && s.hoy.a > 0 && s.usoMin !== null && s.usoMin <= o.tope + EPS) accion = 'SIN_MENOR';
    }
    out.push({ ...s, lus: [...s.lus], op, ahorro: Math.max(0, ahorro), accion });
  }
  return out;
}

/**
 * Cómo quedarían los totes si se reempacan los SKU de `aplica`: sus compartimentos se reemplazan por el empaque propuesto
 * (llenando primero los Full, luego los Half y al final los Quarter) y los compartimentos que quedan en los totes llamados se
 * juntan con los nuevos del mismo tipo (2 por Half, 4 por Quarter). Utilización = capacidad usada ÷ capacidad de los totes
 * (un compartimento sobre el 100% cuenta como lleno).
 */
function escenario(filas, lus, skus, aplica, o) {
  const tocadas = new Set();
  for (const x of filas) if (aplica.has(x.sku)) tocadas.add(x.lu);
  const pt = Object.fromEntries(ORDEN.map((t) => [t, { tipo: t, nom: TIPOS[t].nom, totes: 0, usado: 0 }]));
  const pool = Object.fromEntries(ORDEN.map((t) => [t, { n: 0, usado: 0 }]));
  for (const l of lus.values()) if (!tocadas.has(l.lu) && pt[l.tipo]) { pt[l.tipo].totes++; pt[l.tipo].usado += l.usoCap; }
  for (const x of filas) {
    if (!tocadas.has(x.lu) || aplica.has(x.sku) || !pool[x.tipo]) continue;
    pool[x.tipo].n++; pool[x.tipo].usado += x.uso === null ? 0 : Math.min(1, x.uso) * TIPOS[x.tipo].frac;
  }
  for (const s of skus) {
    if (!aplica.has(s.sku) || !s.op) continue;
    let resto = s.qty;
    for (const [t, n, cap] of [['111', s.op.a, s.c111], ['121', s.op.b, s.c121], ['141', s.op.c, s.c141]]) {
      const ce = Math.floor(cap * o.llenado);
      for (let i = 0; i < n; i++) {
        const u = Math.min(resto, i === n - 1 && t === '141' ? resto : ce);
        resto -= u;
        pool[t].n++; pool[t].usado += cap > 0 ? Math.min(1, u / cap) * TIPOS[t].frac : 0;
      }
    }
  }
  for (const t of ORDEN) { pt[t].totes += Math.ceil(pool[t].n / TIPOS[t].slots); pt[t].usado += pool[t].usado; }
  const porTipo = ORDEN.map((t) => ({ tipo: t, nom: pt[t].nom, totes: pt[t].totes, util: pt[t].totes ? pt[t].usado / pt[t].totes : 0 }));
  const totes = porTipo.reduce((a, x) => a + x.totes, 0), usado = ORDEN.reduce((a, t) => a + pt[t].usado, 0);
  return { totes, util: totes ? usado / totes : 0, porTipo, llamar: tocadas.size, skus: aplica.size };
}

async function escenarios(filas, lus, skus, lista, o, tope) {
  const de = (f) => new Set(skus.filter(f).map((s) => s.sku));
  const def = [['hoy', 'Hoy', new Set()], ['consolidar', 'Solo consolidar', de((s) => s.accion === 'CONSOLIDAR')],
    ['reempacar', 'Solo cambiar de tipo', de((s) => s.accion === 'REEMPACAR')], ['recall', 'Recall completo', de((s) => s.accion === 'CONSOLIDAR' || s.accion === 'REEMPACAR')]];
  if (tope) def.push(['plan', `Plan del día (${tope} totes)`, new Set(lista.filter((s) => s.enPlan).map((s) => s.sku))]);
  const cap = await capacidadOsr({}).catch(() => ({ cargada: false }));
  const l = def.map(([k, nom, ap]) => ({ k, nom, ...escenario(filas, lus, skus, ap, o) }));
  const hoy = l[0];
  for (const e of l) {
    e.libera = hoy.totes - e.totes;
    if (cap.cargada) { e.ocupadas = cap.tot.occupied - e.libera; e.ocupOsr = cap.tot.positions ? e.ocupadas / cap.tot.positions : 0; }
  }
  return { lista: l, osr: cap.cargada ? { positions: cap.tot.positions, occupied: cap.tot.occupied, target: cap.target, archivo: cap.archivo } : null };
}

function resumenRecall(skus) {
  const porAccion = Object.fromEntries(Object.keys(ACCIONES).map((k) => [k, { skus: 0, totes: 0, ahorro: 0, qty: 0 }]));
  const llamar = new Set();
  for (const s of skus) {
    const a = porAccion[s.accion];
    a.skus++; a.totes += s.lus.length; a.ahorro += s.ahorro; a.qty += s.qty;
    if (s.accion === 'CONSOLIDAR' || s.accion === 'REEMPACAR') s.lus.forEach((l) => llamar.add(l));
  }
  return { porAccion, totesLlamar: llamar.size, ahorro: porAccion.CONSOLIDAR.ahorro + porAccion.REEMPACAR.ahorro, skus: porAccion.CONSOLIDAR.skus + porAccion.REEMPACAR.skus };
}

const opciones = (p = {}) => {
  let llenado = Number(p.llenado); if (!(llenado > 0)) llenado = 100; if (llenado > 1) llenado /= 100;
  let tope = Number(p.tope); if (!(tope > 0)) tope = 25; if (tope > 1) tope /= 100;
  const minAhorro = p.minAhorro === '' || p.minAhorro === undefined || p.minAhorro === null ? 0.5 : Math.max(0.25, Number(p.minAhorro) || 0.5);
  return { llenado: Math.min(1, llenado), tope, minAhorro };
};

function resumenDe(filas) {
  const oc = ocupacion(filas);
  const r = resumenRecall(recallSkus(filas, oc.lus, opciones()));
  return { ocup: { porTipo: oc.porTipo, tot: oc.tot }, recall: { ahorro: r.ahorro, skus: r.skus, totesLlamar: r.totesLlamar } };
}

// ---------------------------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------------------------
const cache = new Map(); // fecha -> filas (la foto de un día no cambia hasta que se vuelve a cargar)
async function filasDe(fecha) {
  if (cache.has(fecha)) return cache.get(fecha);
  const { rows } = await q(`SELECT load_unit AS lu, slot, tipo, estado, sku, nombre, qty::float8 AS qty, cap111 AS c111, cap121 AS c121, cap141 AS c141, f_almac::text AS falm
    FROM osr_slots WHERE fecha = $1`, [fecha]);
  if (cache.size > 3) cache.delete(cache.keys().next().value);
  cache.set(fecha, rows);
  return rows;
}

let deptoCache = { id: null, m: null };
async function deptos() {
  const { rows: c } = await q("SELECT id FROM cargas WHERE tipo = 'INICIO' ORDER BY fecha DESC, id DESC LIMIT 1");
  if (!c.length) return new Map();
  if (deptoCache.id === c[0].id) return deptoCache.m;
  const { rows } = await q("SELECT sku, max(coalesce(nullif(trim(depto), ''), '(SIN DEPTO)')) AS depto FROM stock WHERE carga_id = $1 GROUP BY sku", [c[0].id]);
  const m = new Map(rows.map((r) => [skuKey(r.sku), r.depto]));
  deptoCache = { id: c[0].id, m };
  return m;
}

async function calcular(params = {}) {
  const { rows: cargas } = await q('SELECT fecha::text AS fecha, archivo, cargado, resumen FROM osr_slots_carga ORDER BY fecha');
  if (!cargas.length) return { cargada: false };
  const fecha = cargas.some((c) => c.fecha === params.fecha) ? params.fecha : cargas[cargas.length - 1].fecha;
  const carga = cargas.find((c) => c.fecha === fecha);
  const o = opciones(params);
  const filas = (await filasDe(fecha)).map((x) => ({ ...x }));
  const dep = await deptos();
  for (const x of filas) x.depto = dep.get(x.sku) || '(SIN BASE)';
  const oc = ocupacion(filas);
  let skus = recallSkus(filas, oc.lus, o);
  const depM = new Map(filas.map((x) => [x.sku, x.depto]));
  for (const s of skus) s.depto = depM.get(s.sku);
  const todos = skus;
  // filtros del recall
  const tipo = String(params.tipo || ''), depto = String(params.depto || ''), buscar = normTxt(params.buscar || '');
  if (tipo) skus = skus.filter((s) => (tipo === '111' ? s.hoy.a : tipo === '121' ? s.hoy.b : s.hoy.c) > 0);
  if (depto) skus = skus.filter((s) => s.depto === depto);
  if (buscar) skus = skus.filter((s) => normTxt(s.sku).includes(buscar) || normTxt(s.nombre).includes(buscar));
  const resumen = resumenRecall(skus);
  const accion = String(params.accion || 'RECALL');
  const lista = skus.filter((s) => (accion === 'RECALL' ? s.accion === 'CONSOLIDAR' || s.accion === 'REEMPACAR' : accion === 'TODOS' ? true : s.accion === accion));
  // prioridad: más tote liberado por cada tote que se llama a la puerta; empate, más ahorro
  lista.sort((a, b) => (b.ahorro / b.lus.length) - (a.ahorro / a.lus.length) || b.ahorro - a.ahorro || b.eqHoy - a.eqHoy || (a.sku < b.sku ? -1 : 1));
  const tope = Number(params.maxTotes) > 0 ? Number(params.maxTotes) : 0;
  const vistos = new Set();
  let acAhorro = 0;
  for (const s of lista) {
    s.lus.forEach((l) => vistos.add(l));
    acAhorro += s.ahorro;
    s.acTotes = vistos.size; s.acAhorro = acAhorro; s.enPlan = !tope || vistos.size <= tope;
  }
  // por depto (sobre el recall sin el filtro de depto)
  const pd = new Map();
  for (const s of recallSkus(filas, oc.lus, o)) {
    if (s.accion !== 'CONSOLIDAR' && s.accion !== 'REEMPACAR') continue;
    const d = depM.get(s.sku);
    const x = pd.get(d) || { depto: d, skus: 0, totes: 0, ahorro: 0 };
    x.skus++; x.totes += s.lus.length; x.ahorro += s.ahorro; pd.set(d, x);
  }
  const esc = await escenarios(filas, oc.lus, todos, lista, o, tope);
  const evolucion = cargas.map((c) => {
    const r = typeof c.resumen === 'string' ? JSON.parse(c.resumen) : c.resumen;
    return { fecha: c.fecha, porTipo: r.ocup?.porTipo || [], tot: r.ocup?.tot || null, recall: r.recall || null };
  });
  return {
    cargada: true, fecha, fechas: cargas.map((c) => c.fecha), archivo: carga.archivo, cargado: carga.cargado, opciones: o,
    tipos: TIPOS, tramos: TRAMOS.map(([k, n]) => ({ k, n })), acciones: ACCIONES,
    ocup: { porTipo: oc.porTipo, tot: oc.tot }, resumen, accion, maxTotes: tope, lista, limite: LIM,
    porDepto: [...pd.values()].sort((a, b) => b.ahorro - a.ahorro), deptos: [...new Set(filas.map((x) => x.depto))].sort(), evolucion, esc, filas, lusM: oc.lus,
  };
}

const salidaSku = (s) => ({
  sku: s.sku, nombre: s.nombre, depto: s.depto, qty: s.qty, hoy: layTxt(s.hoy), hoyN: s.hoy, eqHoy: s.eqHoy, prop: s.op ? layTxt(s.op) : '—', eqOpt: s.op ? s.op.eq : null,
  ahorro: s.ahorro, accion: s.accion, totes: s.lus.length, lus: s.lus.slice(0, 8), cap: [s.c111, s.c121, s.c141], sobre: s.sobre, usoMin: s.usoMin,
  acTotes: s.acTotes, acAhorro: s.acAhorro, enPlan: s.enPlan, falm: s.falm,
});

export async function recallTotes(params = {}) {
  const r = await calcular(params);
  if (!r.cargada) return r;
  const { filas, lusM, lista, ...resto } = r;
  return { ...resto, n: lista.length, lista: lista.slice(0, LIM).map(salidaSku), enPlan: lista.filter((s) => s.enPlan).length };
}

/** Excel del recall: una fila por compartimento a llamar (en orden de prioridad), resumen por SKU y ocupación por tipo. */
export async function archivoRecallTotes(params = {}) {
  const r = await calcular(params);
  if (!r.cargada) throw err('No hay archivo de stock de KiSoft cargado.');
  const porSku = new Map();
  for (const x of r.filas) { const l = porSku.get(x.sku) || []; l.push(x); porSku.set(x.sku, l); }
  const pct = (v) => (v === null || v === undefined ? '' : Math.round(v * 1000) / 10);
  const det = [['Prioridad', 'En el plan', 'SKU', 'Descripción', 'Depto', 'Acción', 'Hoy', 'Propuesta', 'Totes que libera el SKU', 'LOAD_UNIT', 'SLOT', 'Tipo', 'Unidades', 'Capacidad del tipo', 'Uso compartimento %', 'Uso del tote %']];
  const res = [['Prioridad', 'SKU', 'Descripción', 'Depto', 'Acción', 'Unidades', 'Hoy', 'Totes hoy (equiv.)', 'Propuesta', 'Totes propuesta (equiv.)', 'Totes que libera', 'Totes a llamar',
    'Totes a llamar acum.', 'Liberado acum.', 'Cap. Full', 'Cap. Half', 'Cap. Quarter', 'Compart. sobre 100%', 'Fecha almac. más antigua']];
  r.lista.forEach((s, i) => {
    const ac = ACCIONES[s.accion];
    res.push([i + 1, s.sku, s.nombre, s.depto, ac, s.qty, layTxt(s.hoy), s.eqHoy, s.op ? layTxt(s.op) : '', s.op ? s.op.eq : '', s.ahorro, s.lus.length, s.acTotes, s.acAhorro,
      s.c111, s.c121, s.c141, s.sobre, s.falm ? fmtFecha(s.falm) : '']);
    if (s.accion !== 'CONSOLIDAR' && s.accion !== 'REEMPACAR') return;
    for (const x of (porSku.get(s.sku) || []).sort((a, b) => (a.lu < b.lu ? -1 : 1) || a.slot - b.slot)) {
      det.push([i + 1, s.enPlan ? 'SI' : 'NO', s.sku, s.nombre, s.depto, ac, layTxt(s.hoy), s.op ? layTxt(s.op) : '', s.ahorro, x.lu, x.slot, TIPOS[x.tipo]?.nom || x.tipo, x.qty,
        capDe(x, x.tipo), pct(x.uso), pct(r.lusM.get(x.lu)?.sinCap ? null : r.lusM.get(x.lu)?.uso)]);
    }
  });
  const oc = [['Tipo', 'Totes', 'Compartimentos', 'Compartimentos vacíos', 'Unidades', 'Uso promedio %', ...TRAMOS.map((t) => `${t[1]} (totes)`), 'Sin capacidad (totes)']];
  for (const p of [...r.ocup.porTipo, r.ocup.tot]) oc.push([p.tipo === 'TOTAL' ? 'Total' : `${p.tipo} ${p.nom}`, p.totes, p.slots, p.slotsVacios, p.qty, pct(p.usoProm), ...TRAMOS.map((t) => p.tramos[t[0]]), p.tramos.sin]);
  const hojas = [];
  if (det.length > 1) hojas.push(['Recall', det, [9, 9, 12, 34, 22, 16, 18, 18, 10, 12, 6, 9, 9, 10, 10, 10]]);
  hojas.push(['SKU', res, [9, 12, 34, 22, 22, 9, 18, 10, 18, 10, 10, 9, 10, 10, 8, 8, 8, 10, 12]], ['Ocupacion', oc, [14, 9, 12, 12, 10, 10, 11, 11, 11, 11, 11, 12]]);
  return { buffer: libro(hojas), nombre: `Recall_totes_OSR_${r.fecha}.xlsx` };
}
