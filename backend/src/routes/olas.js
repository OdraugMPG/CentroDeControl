// Simulador de olas: tabla dinámica sobre la última extracción cargada (filtros, filas, columnas y valor).
import { Router } from 'express';
import { q } from '../db.js';
import { ah, bad } from './util.js';

const r = Router();
export const BLANCO = '(en blanco)';

// Campos disponibles. lista: se ofrece como segmentador (pocos valores distintos).
const CAMPOS = [
  ['fecha_salida', 'Fecha salida', true], ['fecha_eta_cliente', 'Fecha ETA cliente', true], ['tipo_orden', 'Tipo orden', true],
  ['especial', 'Especial', true], ['tipo_ola', 'Tipo ola', true], ['cd', 'CD', true], ['tipo_picking', 'Tipo picking', true],
  ['region', 'Región', true], ['estado', 'Estado', true], ['desc_estado', 'Desc. estado', true], ['facility', 'Facility', true],
  ['operacion', 'Operación', true], ['zona', 'Zona', true], ['pasillo', 'Pasillo', true], ['dpto', 'Departamento', true],
  ['city', 'Ciudad', true], ['dest', 'Destino', true], ['jaula', 'Jaula', true], ['marca_osr', 'Marca OSR', true],
  ['logistica_osr', 'Logística OSR', true], ['clasif_cd', 'Clasif. CD', true], ['clasif_picking', 'Clasif. picking', true],
  ['fecha_venta', 'Fecha venta', true], ['dia', 'Día', true], ['mes', 'Mes', true], ['anio', 'Año', true],
  ['od', 'OD', false], ['solicitud', 'Solicitud', false], ['sku', 'SKU', false], ['descripcion', 'Descripción', false],
  ['rut', 'RUT', false], ['destinatario', 'Destinatario', false], ['rut_cliente', 'RUT cliente', false], ['location_id', 'Ubicación', false]
].map(([key, label, lista]) => ({ key, label, lista }));
const CAMPO = Object.fromEntries(CAMPOS.map(c => [c.key, c]));

const MEDIDAS = {
  qty: ['Suma de QTY', 'SUM(qty)'],
  lineas: ['Líneas', 'COUNT(*)'],
  od: ['OD distintas', 'COUNT(DISTINCT od)'],
  sku: ['SKU distintos', 'COUNT(DISTINCT sku)']
};

const expr = k => `COALESCE(${k}::text, '${BLANCO}')`;
const campo = (k, nombre) => { if (!CAMPO[k]) throw bad(`Campo desconocido en ${nombre}: ${k}`); return k; };
const ultima = async () => (await q(`SELECT * FROM cargas WHERE tipo = 'olas' ORDER BY id DESC LIMIT 1`)).rows[0];

// WHERE con la carga y los filtros {campo: [valores]}; lista vacía = todos
function donde(cargaId, filtros = {}) {
  const params = [cargaId], cond = ['carga_id = $1'];
  for (const [k, vals] of Object.entries(filtros || {})) {
    if (!Array.isArray(vals) || !vals.length) continue;
    params.push(vals.map(String));
    cond.push(`${expr(campo(k, 'filtros'))} = ANY($${params.length})`);
  }
  return { sql: cond.join(' AND '), params };
}

// Carga vigente, campos, medidas y valores de cada segmentador
r.get('/', ah(async (req, res) => {
  const carga = await ultima();
  const valores = {};
  if (carga) {
    const lista = CAMPOS.filter(c => c.lista);
    const { rows: [fila] } = await q(`SELECT ${lista.map(c => `ARRAY(SELECT DISTINCT ${expr(c.key)} FROM olas_lineas WHERE carga_id = $1 ORDER BY 1) AS ${c.key}`).join(', ')}`, [carga.id]);
    Object.assign(valores, fila);
  }
  res.json({ carga: carga || null, campos: CAMPOS, medidas: Object.entries(MEDIDAS).map(([key, [label]]) => ({ key, label })), valores });
}));

// Tabla dinámica: {filtros, filas, columnas, medida} -> celdas con subtotales y KPI del filtro
r.post('/pivot', ah(async (req, res) => {
  const carga = await ultima();
  if (!carga) return res.json({ carga: null });
  const { filtros, filas: f, columnas: c, medida = 'qty' } = req.body || {};
  const filas = campo(f || 'fecha_salida', 'filas');
  const columnas = c ? campo(c, 'columnas') : null;
  if (!MEDIDAS[medida]) throw bad(`Medida desconocida: ${medida}`);
  const w = donde(carga.id, filtros);
  const agg = MEDIDAS[medida][1];
  const fe = expr(filas), ce = columnas && expr(columnas);
  const [celdas, kpis, disponibles] = await Promise.all([
    q(ce
      ? `SELECT ${fe} AS f, ${ce} AS c, GROUPING(${fe}) AS gf, GROUPING(${ce}) AS gc, ${agg} AS v
         FROM olas_lineas WHERE ${w.sql} GROUP BY GROUPING SETS ((${fe}, ${ce}), (${fe}), (${ce}), ())`
      : `SELECT ${fe} AS f, '' AS c, GROUPING(${fe}) AS gf, 1 AS gc, ${agg} AS v
         FROM olas_lineas WHERE ${w.sql} GROUP BY GROUPING SETS ((${fe}), ())`, w.params),
    q(`SELECT SUM(qty) AS unidades, COUNT(*) AS lineas, COUNT(DISTINCT od) AS ods, COUNT(DISTINCT sku) AS skus,
         MIN(fecha_salida) AS desde, MAX(fecha_salida) AS hasta FROM olas_lineas WHERE ${w.sql}`, w.params),
    // Valores con datos bajo los filtros actuales (para atenuar los demás en los segmentadores)
    q(`SELECT ${CAMPOS.filter(x => x.lista).map(x => `ARRAY(SELECT DISTINCT ${expr(x.key)} FROM olas_lineas WHERE ${w.sql}) AS ${x.key}`).join(', ')}`, w.params)
  ]);
  const orden = (a, b) => a.localeCompare(b, 'es', { numeric: true });
  const out = { carga, filas, columnas, medida, valores: {}, totFila: {}, totCol: {}, total: 0 };
  for (const x of celdas.rows) {
    if (x.gf && x.gc) out.total = x.v;
    else if (x.gc) out.totFila[x.f] = x.v;
    else if (x.gf) out.totCol[x.c] = x.v;
    else (out.valores[x.f] ||= {})[x.c] = x.v;
  }
  out.claveFilas = Object.keys(out.totFila).sort(orden);
  out.claveColumnas = columnas ? Object.keys(out.totCol).sort(orden) : [];
  out.kpis = kpis.rows[0];
  out.disponibles = disponibles.rows[0];
  res.json(out);
}));

// Líneas detrás de una celda (filtros + valor de fila/columna), hasta 500
r.post('/detalle', ah(async (req, res) => {
  const carga = await ultima();
  if (!carga) return res.json({ total: 0, lineas: [] });
  const w = donde(carga.id, req.body?.filtros);
  const limite = Math.min(500, Math.max(1, +req.body?.limite || 200));
  const [{ rows: [t] }, { rows }] = await Promise.all([
    q(`SELECT COUNT(*) AS total, SUM(qty) AS unidades FROM olas_lineas WHERE ${w.sql}`, w.params),
    q(`SELECT od, solicitud, sku, descripcion, qty, estado, desc_estado, tipo_orden, tipo_ola, tipo_picking, cd, region, city,
         fecha_salida::text, fecha_eta_cliente::text, zona, pasillo, location_id, destinatario
       FROM olas_lineas WHERE ${w.sql} ORDER BY fecha_salida, od, sku LIMIT ${limite}`, w.params)
  ]);
  res.json({ total: t.total, unidades: t.unidades, lineas: rows });
}));

export default r;
