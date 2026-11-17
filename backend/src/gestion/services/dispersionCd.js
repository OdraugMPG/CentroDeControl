// Dispersión de stock entre CD (Optimización ABC, junto a la consolidación de SKU entre CD): los SKU con stock en 2 o más CD
// de la Base vigente, cómo se reparte su stock en cada CD y qué participación tiene cada CD en su venta (archivo de picking
// por CD, el mismo de Participación por CD). Así se ve si el stock está donde se vende: un CD con stock y sin venta de ese
// SKU es stock inmovilizado que se puede consolidar en el CD que lo vende.
import { q } from '../db.js';
import { skuKey } from './participacionCd.js';
import { up, txt, normTxt, cmp } from '../engine/util.js';
import { leerParametros } from './parametros.js';
import { libro } from './tareas.js';

const LIM = 400;
const TTL = 10 * 60 * 1000;
let cacheV = { k: '', t: 0, rows: null, dias: 0 };
let cacheS = { id: null, rows: null };

async function cargaVigente() {
  const { rows } = await q("SELECT id, fecha::text AS fecha, archivo FROM cargas WHERE tipo = 'INICIO' ORDER BY fecha DESC, id DESC LIMIT 1");
  return rows[0] || null;
}

async function stockDe(id) {
  if (cacheS.id === id) return cacheS.rows;
  const { rows } = await q(`SELECT upper(trim(cd)) AS cd, sku, sum(qty)::float8 AS u, count(DISTINCT ubicacion)::int AS ub,
      max(descripcion) AS descripcion, max(coalesce(nullif(trim(depto), ''), '(SIN DEPTO)')) AS depto
    FROM stock WHERE carga_id = $1 AND qty > 0 AND sku IS NOT NULL GROUP BY 1, 2`, [id]);
  cacheS = { id, rows };
  return rows;
}

async function ventaDe(p) {
  const k = JSON.stringify([p.desde || '', p.hasta || '', p.tipo || '']);
  if (cacheV.k === k && Date.now() - cacheV.t < TTL) return cacheV;
  const cond = [], val = [];
  if (p.tipo) { val.push(p.tipo); cond.push(`tipo = $${val.length}`); }
  if (p.desde) { val.push(p.desde); cond.push(`fecha >= $${val.length}`); }
  if (p.hasta) { val.push(p.hasta); cond.push(`fecha <= $${val.length}`); }
  const wh = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const [{ rows }, { rows: d }] = await Promise.all([
    q(`SELECT upper(trim(cd)) AS cd, sku, sum(unidades)::float8 AS u FROM venta_cd ${wh} GROUP BY 1, 2`, val),
    q(`SELECT count(DISTINCT fecha)::int AS dias, min(fecha)::text AS desde, max(fecha)::text AS hasta FROM venta_cd ${wh}`, val),
  ]);
  cacheV = { k, t: Date.now(), rows, dias: d[0].dias, desde: d[0].desde, hasta: d[0].hasta };
  return cacheV;
}

/** Limpia la venta en memoria (al cargar un archivo de picking nuevo). */
export const olvidarVentaDispersion = () => { cacheV = { k: '', t: 0, rows: null, dias: 0 }; };

async function calcular(params = {}) {
  const carga = await cargaVigente();
  if (!carga) return { sinBase: true };
  const pa = await leerParametros();
  const osr = up(pa.cdOsr);
  const [st, v] = await Promise.all([stockDe(carga.id), ventaDe(params)]);
  const m = new Map();
  for (const r of st) {
    const k = skuKey(r.sku);
    let x = m.get(k);
    if (!x) m.set(k, x = { sku: k, desc: txt(r.descripcion), depto: r.depto, s: {}, ub: {}, v: {}, sTot: 0, vTot: 0, ubTot: 0 });
    x.s[r.cd] = (x.s[r.cd] || 0) + r.u; x.ub[r.cd] = (x.ub[r.cd] || 0) + r.ub;
    x.sTot += r.u; x.ubTot += r.ub;
  }
  const hayVenta = (v.rows || []).length > 0;
  for (const r of v.rows || []) {
    const x = m.get(skuKey(r.sku));
    if (!x) continue; // vendido pero sin stock hoy: no participa de la dispersión
    x.v[r.cd] = (x.v[r.cd] || 0) + r.u; x.vTot += r.u;
  }
  const todos = [...m.values()];
  const cdsStock = new Set(), cdsVenta = new Set();
  for (const x of todos) {
    x.cds = Object.keys(x.s).sort();
    x.n = x.cds.length;
    for (const c of x.cds) cdsStock.add(c);
    for (const c of Object.keys(x.v)) cdsVenta.add(c);
  }
  const disp = todos.filter((x) => x.n >= 2);
  for (const x of disp) {
    // stock en CD donde el SKU no tuvo venta en el período (habiendo vendido en otro CD o en ninguno)
    x.sinVentaU = 0; x.sinVentaCds = [];
    for (const c of x.cds) if (!(x.v[c] > 0)) { x.sinVentaU += x.s[c]; x.sinVentaCds.push(c); }
    let cp = '', vp = 0;
    for (const [c, u] of Object.entries(x.v)) if (u > vp) { cp = c; vp = u; }
    x.cdVenta = cp; x.pctVentaPrincipal = x.vTot ? vp / x.vTot : 0;
    let cs = '', sp = 0;
    for (const c of x.cds) if (x.s[c] > sp) { cs = c; sp = x.s[c]; }
    x.cdStock = cs; x.pctStockPrincipal = x.sTot ? sp / x.sTot : 0;
    // calce stock vs venta: 1 = el stock está repartido igual que la venta; 0 = nada del stock está donde se vende
    let calce = 0;
    if (x.vTot) for (const c of new Set([...x.cds, ...Object.keys(x.v)])) calce += Math.min((x.s[c] || 0) / x.sTot, (x.v[c] || 0) / x.vTot);
    x.calce = x.vTot ? calce : null;
    x.ventaDia = v.dias ? x.vTot / v.dias : 0;
    x.cobertura = x.ventaDia > 0 ? x.sTot / x.ventaDia : null;
    x.combo = x.cds.join(' + ');
  }
  // CD en el orden de su stock disperso (el OSR primero)
  const sCd = new Map();
  for (const x of disp) for (const c of x.cds) sCd.set(c, (sCd.get(c) || 0) + x.s[c]);
  const cds = [...new Set([...cdsStock, ...cdsVenta])].sort((a, b) => (a === osr ? -1 : b === osr ? 1 : (sCd.get(b) || 0) - (sCd.get(a) || 0) || cmp(a, b)));
  return { carga, osr, v, hayVenta, todos, disp, cds };
}

function filtrar(disp, p) {
  const depto = txt(p.depto), cd = up(p.cd), n = Number(p.n) || 0, buscar = normTxt(p.buscar || '');
  return disp.filter((x) => (!depto || x.depto === depto) && (!cd || x.s[cd] > 0) && (!n || (n >= 4 ? x.n >= 4 : x.n === n))
    && (!p.sinVenta || x.sinVentaU > 0) && (!buscar || normTxt(x.sku).includes(buscar) || normTxt(x.desc).includes(buscar)));
}

const ORDENES = { sinVentaU: (x) => x.sinVentaU, sTot: (x) => x.sTot, vTot: (x) => x.vTot, n: (x) => x.n, calce: (x) => (x.calce === null ? 2 : -x.calce), ubTot: (x) => x.ubTot };

export async function dispersionCds(params = {}) {
  const c = await calcular(params);
  if (c.sinBase) return c;
  const { carga, osr, v, hayVenta, todos, disp, cds } = c;
  const sel = filtrar(disp, params);
  // resumen general (sobre todos los SKU dispersos, sin filtros)
  const tot = { skus: todos.length, unCd: todos.length - disp.length, disp: disp.length, sDisp: 0, sTot: 0, ubDisp: 0, vDisp: 0, vTot: 0, sinVentaU: 0, sinVentaSkus: 0 };
  for (const x of todos) { tot.sTot += x.sTot; tot.vTot += x.vTot; }
  for (const x of disp) { tot.sDisp += x.sTot; tot.ubDisp += x.ubTot; tot.vDisp += x.vTot; tot.sinVentaU += x.sinVentaU; if (x.sinVentaU > 0) tot.sinVentaSkus++; }
  const porN = [2, 3, 4].map((n) => {
    const l = disp.filter((x) => (n === 4 ? x.n >= 4 : x.n === n));
    return { n, skus: l.length, s: l.reduce((a, x) => a + x.sTot, 0), ub: l.reduce((a, x) => a + x.ubTot, 0), v: l.reduce((a, x) => a + x.vTot, 0) };
  });
  // por CD, sobre los SKU filtrados
  const porCd = cds.map((cd) => {
    const r = { cd, skus: 0, s: 0, ub: 0, v: 0, sinVentaSkus: 0, sinVentaU: 0, principalVenta: 0 };
    for (const x of sel) {
      if (x.s[cd] > 0) { r.skus++; r.s += x.s[cd]; r.ub += x.ub[cd]; if (!(x.v[cd] > 0)) { r.sinVentaSkus++; r.sinVentaU += x.s[cd]; } }
      r.v += x.v[cd] || 0;
      if (x.cdVenta === cd) r.principalVenta++;
    }
    return r;
  }).filter((r) => r.skus || r.v);
  const sSel = sel.reduce((a, x) => a + x.sTot, 0), vSel = sel.reduce((a, x) => a + x.vTot, 0);
  for (const r of porCd) { r.pctS = sSel ? r.s / sSel : 0; r.pctV = vSel ? r.v / vSel : 0; }
  // combinaciones de CD
  const cm = new Map();
  for (const x of sel) {
    const r = cm.get(x.combo) || { combo: x.combo, skus: 0, s: 0, v: 0, sinVentaU: 0 };
    r.skus++; r.s += x.sTot; r.v += x.vTot; r.sinVentaU += x.sinVentaU; cm.set(x.combo, r);
  }
  const combos = [...cm.values()].sort((a, b) => b.skus - a.skus).slice(0, 15);
  const ord = ORDENES[params.orden] ? params.orden : 'sinVentaU';
  const f = ORDENES[ord];
  const lista = [...sel].sort((a, b) => f(b) - f(a) || b.sTot - a.sTot || cmp(a.sku, b.sku));
  const deptos = [...new Set(disp.map((x) => x.depto))].sort();
  return {
    carga, osr, venta: { hay: hayVenta, dias: v.dias, desde: v.desde, hasta: v.hasta }, cds: porCd.map((r) => r.cd), tot, porN, porCd, combos, deptos,
    filtrados: sel.length, sSel, vSel, orden: ord, limite: LIM,
    lista: lista.slice(0, LIM).map((x) => ({ sku: x.sku, desc: x.desc, depto: x.depto, n: x.n, sTot: x.sTot, vTot: x.vTot, ubTot: x.ubTot, s: x.s, v: x.v,
      cdVenta: x.cdVenta, pctVentaPrincipal: x.pctVentaPrincipal, sinVentaU: x.sinVentaU, sinVentaCds: x.sinVentaCds, calce: x.calce, ventaDia: x.ventaDia, cobertura: x.cobertura })),
  };
}

/** Excel: todos los SKU dispersos filtrados con stock y venta por CD, el resumen por CD y las combinaciones. */
export async function archivoDispersionCds(params = {}) {
  const r = await dispersionCds({ ...params });
  if (r.sinBase) throw Object.assign(new Error('No hay Base de stock cargada.'), { status: 400 });
  const c = await calcular(params);
  const sel = filtrar(c.disp, params);
  const f = ORDENES[r.orden];
  sel.sort((a, b) => f(b) - f(a) || b.sTot - a.sTot);
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : '');
  const enc = ['SKU', 'Descripción', 'Depto', 'N° CD con stock', 'Stock total', 'Ubicaciones', 'Venta período', 'Venta/día', 'Días de cobertura', 'CD que más vende', '% venta de ese CD',
    'Calce stock vs venta %', 'Stock en CD sin venta', 'CD con stock sin venta',
    ...r.cds.flatMap((cd) => [`${cd} stock`, `${cd} % stock`, `${cd} venta`, `${cd} % venta`])];
  const det = [enc, ...sel.map((x) => [x.sku, x.desc, x.depto, x.n, x.sTot, x.ubTot, x.vTot, Math.round(x.ventaDia * 10) / 10, x.cobertura === null ? '' : Math.round(x.cobertura),
    x.cdVenta, x.vTot ? pct(x.v[x.cdVenta] || 0, x.vTot) : '', x.calce === null ? '' : Math.round(x.calce * 1000) / 10, x.sinVentaU, x.sinVentaCds.join(', '),
    ...r.cds.flatMap((cd) => [x.s[cd] || 0, pct(x.s[cd] || 0, x.sTot), x.v[cd] || 0, pct(x.v[cd] || 0, x.vTot)])])];
  const cdH = [['CD', 'SKU dispersos con stock', 'Stock', '% del stock', 'Ubicaciones', 'Venta', '% de la venta', 'SKU con stock sin venta en el CD', 'Stock sin venta en el CD', 'SKU donde es el CD que más vende'],
    ...r.porCd.map((x) => [x.cd, x.skus, x.s, pct(x.s, r.sSel), x.ub, x.v, pct(x.v, r.vSel), x.sinVentaSkus, x.sinVentaU, x.principalVenta])];
  const coH = [['Combinación de CD', 'SKU', 'Stock', 'Venta', 'Stock en CD sin venta'], ...r.combos.map((x) => [x.combo, x.skus, x.s, x.v, x.sinVentaU])];
  return { buffer: libro([['SKU', det, [12, 34, 22, 8, 10, 10, 10, 9, 10, 12, 10, 10, 12, 18]], ['Por CD', cdH, [14, 12, 12, 10, 12, 12, 10, 14, 14, 14]], ['Combinaciones', coH, [34, 9, 12, 12, 14]]]),
    nombre: `Dispersion_stock_CD_${r.carga.fecha}.xlsx` };
}
