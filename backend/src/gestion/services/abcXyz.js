import { q, tx } from '../db.js';
import { leerParametros } from './parametros.js';
import { filasDeCarga, ultimaCargaInicio } from './stock.js';
import { leerHistorico, mesesHasta, clasificar, resumir, curvaPareto, TODOS } from '../engine/abcXyz.js';
import { cmp } from '../engine/util.js';

const cache = new Map();
let versionHist = 0;

const umbrales = (p) => ({ a: p.abcA, b: p.abcB, x: p.xyzX, y: p.xyzY, r: p.xyzRotX });

async function infoHistoria() {
  const { rows } = await q("SELECT min(mes) AS desde, max(mes) AS hasta, count(DISTINCT mes)::int AS meses, count(DISTINCT sku)::int AS skus, bool_or(cd = '') AS sin_cd FROM ventas_hist");
  return rows[0].hasta ? rows[0] : null;
}

/** Historia de la ventana XYZ: los últimos `n` meses hasta el último mes cargado. En `total`, la suma de los CD por SKU. */
async function historia(n) {
  const info = await infoHistoria();
  if (!info) return { info: null, meses: [], hist: new Map(), total: new Map() };
  const meses = mesesHasta(info.hasta, n);
  const { rows } = await q('SELECT cd, sku, mes, unidades FROM ventas_hist WHERE mes >= $1 AND mes <= $2', [meses[0], meses[meses.length - 1]]);
  const hist = new Map(), total = new Map();
  const sumar = (m, k, mes, u) => { if (!m.has(k)) m.set(k, new Map()); m.get(k).set(mes, (m.get(k).get(mes) || 0) + u); };
  for (const r of rows) {
    sumar(hist, r.cd + '|' + r.sku, r.mes, r.unidades);
    sumar(total, '|' + r.sku, r.mes, r.unidades);
  }
  return { info, meses, hist, total };
}

/** Clasificación por CD y consolidada (TODOS), con caché por carga, criterio, método y umbrales. */
async function calcular(criterio, metodoPedido) {
  const carga = await ultimaCargaInicio();
  if (!carga) throw Object.assign(new Error('Carga primero una Base de stock en Asignación del día.'), { status: 400 });
  const p = await leerParametros();
  const u = umbrales(p);
  const n = Math.max(3, Math.round(p.xyzMeses) || 6);
  const h = await historia(n);
  // sin historia cargada, XYZ siempre por rotación
  const metodo = metodoPedido === 'historia' && h.info ? 'historia' : 'rotacion';
  const key = [carga.id, criterio, metodo, JSON.stringify(u), n, versionHist].join('|');
  if (!cache.has(key)) {
    const filasBase = await filasDeCarga(carga.id);
    const opt = { criterio, metodo, meses: h.meses, u };
    const filas = [...clasificar(filasBase, { ...opt, hist: h.total, consolidado: true }), ...clasificar(filasBase, { ...opt, hist: h.hist })];
    const grupos = new Map();
    for (const x of filas) { if (!grupos.has(x.cd)) grupos.set(x.cd, []); grupos.get(x.cd).push(x); }
    cache.clear();
    cache.set(key, {
      carga, metodo, grupos, historia: h.info ? { ...h.info, ventana: h.meses } : null, umbrales: u,
      hayVentas: filasBase.some((r) => r.ventas !== null && r.ventas !== undefined),
      hayCosto: filasBase.some((r) => r.costo > 0),
    });
  }
  return cache.get(key);
}

/** Clasificación vigente para otros módulos: el criterio y método de la última guardada, o unidades + rotación. */
export async function clasificacionActual() {
  const { rows } = await q('SELECT criterio, xyz_metodo FROM abc_xyz LIMIT 1');
  return calcular(rows[0]?.criterio === 'valor' ? 'valor' : 'unidades', rows[0]?.xyz_metodo || 'rotacion');
}

/** Clasificación de un CD (o TODOS), con matriz, curva de Pareto, apertura por CD y detalle filtrable por celda. */
export async function abcXyz({ cd, criterio = 'unidades', metodo, celda, limite = 1000 }) {
  const d = await calcular(criterio === 'valor' ? 'valor' : 'unidades', metodo);
  const cds = [...d.grupos.keys()].filter((c) => c !== TODOS).sort(cmp);
  const cdSel = d.grupos.has(cd) ? cd : TODOS;
  const delCd = d.grupos.get(cdSel);
  const sel = celda ? delCd.filter((x) => x.matriz === celda) : delCd;
  const { rows: g } = await q('SELECT count(*)::int AS n, max(actualizado_en) AS en, max(criterio) AS criterio, max(xyz_metodo) AS metodo FROM abc_xyz');
  return {
    carga: d.carga, cds, cd: cdSel, criterio, metodo: d.metodo, historia: d.historia, umbrales: d.umbrales, hayVentas: d.hayVentas, hayCosto: d.hayCosto,
    resumen: resumir(delCd), pareto: curvaPareto(delCd), sinVenta: delCd.filter((x) => !(x.ventas > 0)).length,
    filas: sel.length, detalle: sel.slice(0, limite).map(({ stockCd, ...x }) => x), guardado: g[0].n ? g[0] : null,
  };
}

/** Guarda la clasificación de todos los CD y la consolidada (cd = 'TODOS'), reemplazando la anterior. */
export async function guardarAbcXyz(criterio = 'unidades', metodo) {
  const d = await calcular(criterio === 'valor' ? 'valor' : 'unidades', metodo);
  const filas = [...d.grupos.values()].flat();
  const cols = ['cd', 'sku', 'abc', 'xyz', 'matriz', 'metrica', 'pct_acum', 'cv', 'rotacion'];
  const tipos = ['text', 'text', 'text', 'text', 'text', 'numeric', 'numeric', 'numeric', 'numeric'];
  const n = cols.length;
  await tx(async (c) => {
    await c.query('DELETE FROM abc_xyz');
    for (let i = 0; i < filas.length; i += 5000) {
      const lote = filas.slice(i, i + 5000);
      const arrays = [lote.map((x) => x.cd), lote.map((x) => x.sku), lote.map((x) => x.abc), lote.map((x) => x.xyz), lote.map((x) => x.matriz),
        lote.map((x) => x.metrica), lote.map((x) => Math.round(x.pctAcum * 100) / 100), lote.map((x) => x.cv), lote.map((x) => x.rot)];
      await c.query(`INSERT INTO abc_xyz (${cols.join(',')}, criterio, xyz_metodo, carga_id) SELECT *, $${n + 1}::text, $${n + 2}::text, $${n + 3}::int FROM unnest(${tipos.map((t, j) => `$${j + 1}::${t}[]`).join(',')})`,
        [...arrays, criterio, d.metodo, d.carga.id]);
    }
  });
  return { skus: d.grupos.get(TODOS).length, cds: d.grupos.size - 1, metodo: d.metodo };
}

/** Carga (o completa) la historia de ventas mensuales: un mes ya cargado para el mismo CD y SKU se reemplaza. */
export async function cargarHistoria(buffer, archivo) {
  const h = leerHistorico(buffer, archivo);
  await tx(async (c) => {
    for (let i = 0; i < h.filas.length; i += 5000) {
      const lote = h.filas.slice(i, i + 5000);
      await c.query(`INSERT INTO ventas_hist (cd, sku, mes, unidades) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::numeric[])
        ON CONFLICT (cd, sku, mes) DO UPDATE SET unidades = EXCLUDED.unidades`,
      [lote.map((f) => f.cd), lote.map((f) => f.sku), lote.map((f) => f.mes), lote.map((f) => f.unidades)]);
    }
  });
  versionHist++;
  return { filas: h.filas.length, meses: h.meses, formato: h.formato, skus: new Set(h.filas.map((f) => f.sku)).size };
}

export async function borrarHistoria() {
  const r = await q('DELETE FROM ventas_hist');
  versionHist++;
  return { eliminadas: r.rowCount };
}
