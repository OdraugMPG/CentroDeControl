// Evolución histórica del OSR (Sloting): SKU, unidades y ubicaciones con stock en el CD del OSR en cada Base de stock
// cargada (una foto por día), su peso sobre el stock de todos los CD, los SKU que entran y salen del OSR entre una Base y
// la anterior, y la comparación entre dos Bases por depto y por SKU.
// Cada Base se resume una sola vez (osr_hist_dep / osr_hist_sku, migración 026): las Bases no cambian una vez cargadas.
import { q } from '../db.js';
import { up } from '../engine/util.js';
import { leerParametros } from './parametros.js';

const APTO = ['Y', 'YES', 'S', 'SI', '1', 'TRUE', 'X'];
const LIM = 300;
const DEP = "coalesce(nullif(trim(depto), ''), '(SIN DEPTO)')";

async function cargas() {
  const { rows } = await q("SELECT id, fecha::text AS fecha, archivo FROM cargas WHERE tipo = 'INICIO' ORDER BY fecha, id");
  // si hay más de una carga el mismo día, cuenta la última
  const m = new Map();
  for (const c of rows) m.set(c.fecha, c);
  return [...m.values()];
}

/** Resume las Bases que aún no tienen resumen. */
async function asegurar(ids, osr) {
  const { rows } = await q('SELECT DISTINCT carga_id FROM osr_hist_dep WHERE carga_id = ANY($1)', [ids]);
  const hechas = new Set(rows.map((r) => r.carga_id));
  for (const id of ids.filter((x) => !hechas.has(x))) {
    await q(`INSERT INTO osr_hist_sku (carga_id, sku, depto, u)
      SELECT $1, sku, max(${DEP}), sum(qty) FROM stock WHERE carga_id = $1 AND upper(cd) = $2 AND qty > 0 AND sku IS NOT NULL GROUP BY sku
      ON CONFLICT DO NOTHING`, [id, osr]);
    await q(`INSERT INTO osr_hist_dep (carga_id, depto, skus_osr, u_osr, ubic_osr, skus, u, skus_y, skus_osr_y)
      SELECT $1, ${DEP},
        count(DISTINCT sku) FILTER (WHERE upper(cd) = $2), coalesce(sum(qty) FILTER (WHERE upper(cd) = $2), 0),
        count(DISTINCT ubicacion) FILTER (WHERE upper(cd) = $2), count(DISTINCT sku), coalesce(sum(qty), 0),
        count(DISTINCT sku) FILTER (WHERE upper(trim(log_osr)) = ANY($3)),
        count(DISTINCT sku) FILTER (WHERE upper(cd) = $2 AND upper(trim(log_osr)) = ANY($3))
      FROM stock WHERE carga_id = $1 AND qty > 0 GROUP BY 2
      ON CONFLICT DO NOTHING`, [id, osr, APTO]);
  }
}

export async function historiaOsr(params = {}) {
  const p = await leerParametros();
  const osr = up(p.cdOsr);
  const todas = await cargas();
  if (!todas.length) return { sinDatos: true };
  const depto = params.depto ? String(params.depto) : '';
  const enRango = todas.filter((c) => (!params.desde || c.fecha >= params.desde) && (!params.hasta || c.fecha <= params.hasta));
  const lista = enRango.length ? enRango : todas;
  const ids = lista.map((c) => c.id);
  // la Base anterior a cada una (aunque quede fuera del rango, para saber qué entró el primer día)
  const idxDe = new Map(todas.map((c, i) => [c.id, i]));
  const prevDe = new Map(lista.map((c) => [c.id, todas[idxDe.get(c.id) - 1]?.id]).filter(([, v]) => v));
  await asegurar([...new Set([...ids, ...prevDe.values()])], osr);

  // serie por Base
  const valS = [ids];
  const fDep = depto ? (valS.push(depto), `AND depto = $${valS.length}`) : '';
  const { rows: se } = await q(`SELECT carga_id AS id, sum(skus_osr)::int AS skus_osr, sum(u_osr)::float8 AS u_osr, sum(ubic_osr)::int AS ubic_osr,
      sum(skus)::int AS skus, sum(u)::float8 AS u, sum(skus_y)::int AS skus_y, sum(skus_osr_y)::int AS skus_osr_y
    FROM osr_hist_dep WHERE carga_id = ANY($1) ${fDep} GROUP BY carga_id`, valS);
  const serie = new Map(se.map((r) => [r.id, r]));

  // SKU que entran y salen del OSR respecto de la Base anterior
  const pares = [...prevDe.entries()];
  const valA = [pares.map((x) => x[0]), pares.map((x) => x[1])];
  if (depto) valA.push(depto);
  const fC = depto ? 'AND c.depto = $3' : '', fV = depto ? 'AND v.depto = $3' : '';
  const { rows: ab } = pares.length ? await q(`SELECT p.id,
      (SELECT count(*) FROM osr_hist_sku c WHERE c.carga_id = p.id ${fC}
         AND NOT EXISTS (SELECT 1 FROM osr_hist_sku v WHERE v.carga_id = p.prev AND v.sku = c.sku))::int AS altas,
      (SELECT count(*) FROM osr_hist_sku v WHERE v.carga_id = p.prev ${fV}
         AND NOT EXISTS (SELECT 1 FROM osr_hist_sku c WHERE c.carga_id = p.id AND c.sku = v.sku))::int AS bajas
    FROM unnest($1::int[], $2::int[]) AS p(id, prev)`, valA) : { rows: [] };
  const abM = new Map(ab.map((r) => [r.id, r]));

  const dias = lista.map((c) => {
    const s = serie.get(c.id) || { skus_osr: 0, u_osr: 0, ubic_osr: 0, skus: 0, u: 0, skus_y: 0, skus_osr_y: 0 };
    const a = abM.get(c.id);
    return { id: c.id, fecha: c.fecha, archivo: c.archivo, skusOsr: s.skus_osr, uOsr: s.u_osr, ubicOsr: s.ubic_osr, skus: s.skus, u: s.u,
      skusY: s.skus_y, skusOsrY: s.skus_osr_y, pctSku: s.skus ? s.skus_osr / s.skus : 0, pctU: s.u ? s.u_osr / s.u : 0,
      altas: a ? a.altas : null, bajas: a ? a.bajas : null };
  });

  // comparación entre dos Bases: por defecto la primera y la última del rango
  const idA = ids.includes(Number(params.a)) ? Number(params.a) : ids[0];
  const idB = ids.includes(Number(params.b)) ? Number(params.b) : ids[ids.length - 1];
  const { rows: dep } = await q(`SELECT depto, carga_id AS id, skus_osr, u_osr::float8 AS u_osr, skus, u::float8 AS u
    FROM osr_hist_dep WHERE carga_id IN ($1, $2)`, [idA, idB]);
  const dM = new Map();
  for (const r of dep) {
    let d = dM.get(r.depto);
    if (!d) dM.set(r.depto, d = { depto: r.depto, skusA: 0, skusB: 0, uA: 0, uB: 0, skusTotB: 0, uTotB: 0 });
    if (r.id === idA) { d.skusA = r.skus_osr; d.uA = r.u_osr; }
    if (r.id === idB) { d.skusB = r.skus_osr; d.uB = r.u_osr; d.skusTotB = r.skus; d.uTotB = r.u; }
  }
  const porDepto = [...dM.values()].filter((d) => d.skusA || d.skusB)
    .map((d) => ({ ...d, dSkus: d.skusB - d.skusA, dU: d.uB - d.uA, pctSkuB: d.skusTotB ? d.skusB / d.skusTotB : 0, pctUB: d.uTotB ? d.uB / d.uTotB : 0 }))
    .sort((a, b) => Math.abs(b.dU) - Math.abs(a.dU));

  // SKU: unidades en OSR en A y en B
  const valK = [idA, idB];
  const fDepK = depto ? (valK.push(depto), `AND depto = $${valK.length}`) : '';
  const { rows: sk } = await q(`SELECT sku, max(depto) AS depto, coalesce(sum(u) FILTER (WHERE carga_id = $1), 0)::float8 AS ua,
      coalesce(sum(u) FILTER (WHERE carga_id = $2), 0)::float8 AS ub
    FROM osr_hist_sku WHERE carga_id IN ($1, $2) ${fDepK} GROUP BY sku`, valK);
  const todosSku = sk.map((r) => ({ sku: r.sku, depto: r.depto, uA: r.ua, uB: r.ub, d: r.ub - r.ua }));
  const grupo = (f, orden) => { const l = todosSku.filter(f).sort(orden); return { n: l.length, u: l.reduce((a, x) => a + x.d, 0), filas: l.slice(0, LIM) }; };
  const skus = {
    entraron: grupo((x) => !x.uA && x.uB > 0, (a, b) => b.uB - a.uB),
    salieron: grupo((x) => x.uA > 0 && !x.uB, (a, b) => b.uA - a.uA),
    subieron: grupo((x) => x.uA > 0 && x.uB > x.uA, (a, b) => b.d - a.d),
    bajaron: grupo((x) => x.uB > 0 && x.uA > x.uB, (a, b) => a.d - b.d),
  };
  // descripción, Logística OSR y stock fuera del OSR en B de los SKU que se muestran (si salió del OSR, ¿sigue en otro CD?)
  const vis = [...new Set(Object.values(skus).flatMap((g) => g.filas.map((x) => x.sku)))];
  const salidos = todosSku.filter((x) => x.uA > 0 && !x.uB).map((x) => x.sku);
  const { rows: inf } = await q(`SELECT sku, max(descripcion) AS descripcion, max(log_osr) AS log,
      coalesce(sum(qty) FILTER (WHERE upper(cd) <> $3), 0)::float8 AS fuera
    FROM stock WHERE carga_id = $1 AND sku = ANY($2) AND qty > 0 GROUP BY sku`, [idB, [...new Set([...vis, ...salidos])], osr]);
  const infM = new Map(inf.map((r) => [r.sku, r]));
  const { rows: desA } = await q('SELECT sku, max(descripcion) AS descripcion FROM stock WHERE carga_id = $1 AND sku = ANY($2) GROUP BY sku',
    [idA, vis.filter((s) => !infM.has(s))]);
  const desM = new Map(desA.map((r) => [r.sku, r.descripcion]));
  for (const g of Object.values(skus)) {
    g.filas = g.filas.map((x) => { const i = infM.get(x.sku); return { ...x, desc: i?.descripcion || desM.get(x.sku) || '', log: i?.log || '', fueraB: i ? i.fuera : 0 }; });
  }
  const salieronSigue = salidos.filter((s) => infM.get(s)?.fuera > 0).length;

  const { rows: deptos } = await q('SELECT DISTINCT depto FROM osr_hist_dep WHERE carga_id = ANY($1) AND skus_osr > 0 ORDER BY 1', [ids]);
  const de = (id) => dias.find((x) => x.id === id);
  return {
    cdOsr: osr, depto, bases: todas.map((c) => ({ id: c.id, fecha: c.fecha })), dias,
    a: de(idA), b: de(idB), porDepto, skus, salieronSigue, deptos: deptos.map((r) => r.depto), limite: LIM,
  };
}
