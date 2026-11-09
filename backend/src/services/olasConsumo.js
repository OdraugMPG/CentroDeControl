// Simulador de olas: consumo de la ola (líneas filtradas) contra el stock de la Base vigente en cada CD, por SKU, depto y
// clase ABC, y si hay que reabastecer el OSR antes del turno (SKU que se pickean en OSR con stock insuficiente allí).
import { q } from '../db.js';
import { baseSku } from '../gestion/services/abastecimientoOsr.js';

const SIN_CD = 'SIN CD';
const up = (v) => String(v ?? '').trim().toUpperCase();
const MAX_SKU = 400;
// número del depto ("601 JUVENIL MUJER" y "601" son el mismo)
const codDepto = (v) => (String(v ?? '').trim().match(/^\d+/) || [''])[0];
const MAX_LISTA = 5000;   // SKU de la ola que se envían en el detalle

/** where = { sql, params } de las líneas de la ola (con los filtros del simulador); minOsr = stock que debe quedar en OSR por SKU */
export async function consumoVsStock(where, { minOsr = 0, incluirY = false } = {}) {
  const { rows: lineas } = await q(`SELECT sku, MAX(descripcion) AS descripcion, MAX(dpto) AS dpto, COALESCE(NULLIF(TRIM(UPPER(cd)), ''), '${SIN_CD}') AS cd,
      MAX(logistica_osr) AS log, SUM(qty)::float AS qty, COUNT(*)::int AS lineas, COUNT(DISTINCT od)::int AS ods
    FROM olas_lineas WHERE ${where.sql} GROUP BY sku, 4`, where.params);
  let base;
  try { base = await baseSku(); } catch (e) { return { hayBase: false, mensaje: e.message }; }
  const osr = base.osr;
  const bs = new Map(base.skus.map((x) => [x.sku, x]));
  // un solo nombre por depto: "número descripción" según la Base; la ola solo trae el número
  const nomDepto = new Map();
  for (const x of base.skus) { const c = codDepto(x.depto); if (c && !nomDepto.has(c) && x.depto.trim() !== c) nomDepto.set(c, x.depto.trim()); }
  const depto = (v) => { const c = codDepto(v); return c ? nomDepto.get(c) || c : String(v ?? '').trim() || '(SIN DEPTO)'; };

  // SKU de la ola: demanda por CD y stock por CD según la Base
  const sk = new Map();
  for (const l of lineas) {
    let x = sk.get(l.sku);
    if (!x) {
      const b = bs.get(l.sku);
      const stock = {};
      if (b) { if (b.osr > 0) stock[osr] = b.osr; for (const o of b.origen) stock[up(o.cd)] = (stock[up(o.cd)] || 0) + o.qty; }
      x = { sku: l.sku, desc: l.descripcion || b?.desc || '', depto: depto(b?.depto || l.dpto), abc: b?.abc || 'C', matriz: b?.matriz || '',
        log: b ? b.log || '' : up(l.log), enBase: !!b, dem: {}, stock, origen: b ? b.origen.slice().sort((a, c) => c.qty - a.qty) : [], lineas: 0, ods: 0 };
      sk.set(l.sku, x);
    }
    x.dem[l.cd] = (x.dem[l.cd] || 0) + l.qty; x.lineas += l.lineas; x.ods += l.ods;
  }
  const skus = [...sk.values()];
  const cds = [...new Set(skus.flatMap((x) => [...Object.keys(x.dem), ...Object.keys(x.stock)]))]
    .filter((c) => skus.some((x) => x.dem[c])).sort((a, b) => (a === osr ? -1 : b === osr ? 1 : a === SIN_CD ? 1 : b === SIN_CD ? -1 : a.localeCompare(b)));

  // por CD: demanda, stock de esos SKU en el CD, faltante y cobertura
  const porCd = cds.map((cd) => {
    const r = { cd, demanda: 0, skus: 0, stock: 0, cubierta: 0, faltante: 0, skusFalta: 0, sinStock: 0, skusConStock: 0 };
    for (const x of skus) {
      const d = x.dem[cd] || 0; if (!d) continue;
      const s = cd === SIN_CD ? Object.values(x.stock).reduce((a, b) => a + b, 0) : x.stock[cd] || 0;
      r.demanda += d; r.skus++; r.stock += s; r.cubierta += Math.min(d, s); if (s > 0) r.skusConStock++;
      if (s < d) { r.faltante += d - s; r.skusFalta++; if (!s) r.sinStock++; }
    }
    r.cobertura = r.demanda ? r.cubierta / r.demanda : null;
    r.coberturaSku = r.skus ? (r.skus - r.skusFalta) / r.skus : null;
    return r;
  });

  // reabasto del OSR: lo que se pickea en OSR y no alcanza (más el mínimo que debe quedar) y, opcional,
  // los SKU con Logística OSR = Y que la ola pickea en otros CD
  const reab = [];
  for (const x of skus) {
    const dOsr = x.dem[osr] || 0, sOsr = x.stock[osr] || 0;
    const fuera = Object.entries(x.stock).filter(([c]) => c !== osr).reduce((a, [, v]) => a + v, 0);
    const dFuera = Object.entries(x.dem).filter(([c]) => c !== osr && c !== SIN_CD).reduce((a, [, v]) => a + v, 0);
    let motivo = null, necesita = 0;
    if (dOsr > 0 && sOsr < dOsr + minOsr) { motivo = sOsr < dOsr ? 'FALTA EN OSR' : 'BAJO EL MINIMO EN OSR'; necesita = dOsr + minOsr - sOsr; }
    else if (x.log === 'Y' && dFuera > 0) { motivo = 'Y PICKEADO FUERA DE OSR'; necesita = Math.max(0, dFuera + minOsr - Math.max(0, sOsr - dOsr)); }
    if (!motivo || necesita <= 0) continue;
    const sugerido = Math.min(necesita, fuera);
    let resto = sugerido;
    const desde = [];
    for (const o of x.origen) { if (resto <= 0) break; const t = Math.min(o.qty, resto); desde.push({ cd: o.cd, ubic: o.ubic, qty: t }); resto -= t; }
    reab.push({ sku: x.sku, desc: x.desc, depto: x.depto, abc: x.abc, matriz: x.matriz, log: x.log, motivo, demOsr: dOsr, stockOsr: sOsr, demFuera: dFuera,
      necesita, stockFuera: fuera, sugerido, noCubre: necesita - sugerido, desde });
  }
  reab.sort((a, b) => (a.motivo === 'Y PICKEADO FUERA DE OSR') - (b.motivo === 'Y PICKEADO FUERA DE OSR') || b.necesita - a.necesita);

  // categorías: depto y clase ABC con la demanda por CD y el faltante en el CD que pickea
  const categoria = (clave) => {
    const m = new Map();
    for (const x of skus) {
      const k = x[clave];
      let g = m.get(k);
      if (!g) { g = { v: k, demanda: 0, porCd: {}, skuCd: {}, faltante: 0, skus: 0, skusFalta: 0 }; m.set(k, g); }
      g.skus++;
      let falta = false;
      for (const [cd, d] of Object.entries(x.dem)) {
        g.demanda += d; g.porCd[cd] = (g.porCd[cd] || 0) + d; g.skuCd[cd] = (g.skuCd[cd] || 0) + 1;
        const s = cd === SIN_CD ? Object.values(x.stock).reduce((a, b) => a + b, 0) : x.stock[cd] || 0;
        if (s < d) { g.faltante += d - s; falta = true; }
      }
      if (falta) g.skusFalta++;
    }
    return [...m.values()].sort((a, b) => b.demanda - a.demanda);
  };

  // detalle por SKU: demanda y stock en cada CD, faltante en los CD que lo pickean
  const stockEn = (x, cd) => (cd === SIN_CD ? Object.values(x.stock).reduce((a, b) => a + b, 0) : x.stock[cd] || 0);
  const detalle = skus.map((x) => {
    const demanda = Object.values(x.dem).reduce((a, b) => a + b, 0);
    const faltante = Object.entries(x.dem).reduce((a, [cd, d]) => a + Math.max(0, d - stockEn(x, cd)), 0);
    return { sku: x.sku, desc: x.desc, depto: x.depto, abc: x.abc, matriz: x.matriz, log: x.log, enBase: x.enBase, lineas: x.lineas, ods: x.ods,
      demanda, stockTotal: Object.values(x.stock).reduce((a, b) => a + b, 0), faltante, dem: x.dem, stock: x.stock };
  }).sort((a, b) => b.demanda - a.demanda);

  const tot = porCd.reduce((t, r) => ({ demanda: t.demanda + r.demanda, faltante: t.faltante + r.faltante, cubierta: t.cubierta + r.cubierta }), { demanda: 0, faltante: 0, cubierta: 0 });
  const rOsr = reab.filter((x) => x.motivo !== 'Y PICKEADO FUERA DE OSR');
  const sum = (l, k) => l.reduce((a, x) => a + x[k], 0);
  return {
    hayBase: true, base: { archivo: base.carga.archivo, fecha: base.carga.fecha, cargado: base.carga.creado_en }, osr, minOsr, incluirY, cds,
    tot: { ...tot, skus: skus.length, sinBase: skus.filter((x) => !x.enBase).length, cobertura: tot.demanda ? tot.cubierta / tot.demanda : null },
    reabasto: {
      necesario: rOsr.length > 0, skus: rOsr.length, unidades: sum(rOsr, 'necesita'), sugerido: sum(rOsr, 'sugerido'), noCubre: sum(rOsr, 'noCubre'),
      ubicaciones: rOsr.reduce((a, x) => a + x.desde.length, 0),
      y: { skus: reab.length - rOsr.length, unidades: sum(reab.filter((x) => x.motivo === 'Y PICKEADO FUERA DE OSR'), 'sugerido') },
      total: incluirY ? reab.length : rOsr.length, lista: (incluirY ? reab : rOsr).slice(0, MAX_SKU)
    },
    porCd, porDepto: categoria('depto'), porClase: categoria('abc'),
    skus: { total: detalle.length, lista: detalle.slice(0, MAX_LISTA) }
  };
}
