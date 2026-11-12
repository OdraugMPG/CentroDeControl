// Movimientos de SKU (Gestión de inventario): cambios de ubicación detectados comparando la Base de stock de cada día
// (carga de INICIO) con la del día anterior. Resolución diaria: si un SKU se movió dos veces en el día, se ve dónde quedó.
// Por SKU y día, las ubicaciones donde aparece (E) y de las que sale (S) se clasifican con su stock total (todos los CD):
//   traslado: sale de una ubicación y entra a otra (se emparejan por cantidad), o aparece / sale sin que cambie su stock
//             total (se reparte en una ubicación nueva o se consolida en una que ya tenía)
//   almacenamiento: aparece en una ubicación nueva y su stock total sube (mercadería nueva o reposición)
//   vaciada: sale de la ubicación y su stock total baja (venta o picking)
// Cada par de cargas consecutivas se calcula una vez y queda guardado (gestion.stock_mov).
import { q, tx } from '../gestion/db.js';
import { soloFecha, txt } from '../import/excel.js';
import { addDias } from '../lib/turnos.js';
import { clasificacionActual } from '../gestion/services/abcXyz.js';
import { q as qp } from '../db.js';
import { cat } from '../lib/catalogos.js';

const LOTE = 5000;
const TOP_SKU = 1000;
const up = (v) => (txt(v) || '').toUpperCase();
const entre = (a, b) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 864e5);

/** Clasificación ABC / XYZ vigente (la guardada en ABC / XYZ o unidades + rotación): clase por 'CD|SKU' y consolidada ('TODOS|SKU') */
async function clasesAbc() {
  try {
    const c = await clasificacionActual();
    const m = new Map(), surtido = new Map();
    for (const [cd, filas] of c.grupos) for (const x of filas) m.set(`${cd}|${x.sku}`, x.matriz);
    for (const x of c.grupos.get('TODOS') || []) surtido.set(x.matriz, (surtido.get(x.matriz) || 0) + 1);
    return { m, metodo: c.metodo, surtido };
  } catch { return null; }
}

// Tiempo de un cambio de ubicación. Base medida: mediana del tiempo entre almacenamientos consecutivos del mismo usuario
// (ALM_USER, últimos 30 días, intervalos de 5 s a 30 min). Un cambio dentro del CD = sacar + almacenar = 2 ciclos;
// entre CD se suma el traslado. Ambos se pueden fijar en Datos (movMinDentro > 0 reemplaza lo medido).
let ciclo = null;
async function tiempos() {
  if (!ciclo || Date.now() - ciclo.t > 3600e3) {
    const { rows: [r] } = await qp(`WITH t AS (SELECT f_mod - lag(f_mod) OVER (PARTITION BY usuario ORDER BY f_mod) AS d FROM recepcion_almacenado
        WHERE usuario IS NOT NULL AND f_mod > (SELECT max(f_mod) FROM recepcion_almacenado) - interval '30 days')
      SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM d) / 60)::float AS p50
      FROM t WHERE d BETWEEN interval '5 seconds' AND interval '30 minutes'`).catch(() => ({ rows: [{}] }));
    ciclo = { t: Date.now(), n: r.n || 0, p50: r.p50 || null };
  }
  const p = (await cat()).p || {};
  const fijo = Number(p.movMinDentro) > 0 ? Number(p.movMinDentro) : null;
  const dentro = fijo ?? (ciclo.p50 ? 2 * ciclo.p50 : 2);
  const extra = Number.isFinite(Number(p.movMinExtraEntreCd)) ? Number(p.movMinExtraEntreCd) : 5;
  return { ciclo: ciclo.p50, n: ciclo.n, medido: !fijo && !!ciclo.p50, dentro, extraEntreCd: extra, entreCd: dentro + extra };
}

/** Fotos de stock disponibles: la última carga de INICIO de cada día */
async function fotos() {
  const { rows } = await q(`SELECT DISTINCT ON (fecha) id, fecha::text FROM cargas WHERE tipo = 'INICIO' ORDER BY fecha, id DESC`);
  return rows;
}

/** Compara dos fotos y guarda sus eventos clasificados */
async function calcularPar(a, b) {
  const { rows: ev } = await q(`WITH a AS (SELECT cd, sku, ubicacion, sum(qty)::float AS q FROM stock WHERE carga_id = $1 AND qty > 0 AND sku <> '' AND ubicacion <> '' GROUP BY 1, 2, 3),
      b AS (SELECT cd, sku, ubicacion, sum(qty)::float AS q FROM stock WHERE carga_id = $2 AND qty > 0 AND sku <> '' AND ubicacion <> '' GROUP BY 1, 2, 3)
    SELECT coalesce(a.cd, b.cd) AS cd, coalesce(a.sku, b.sku) AS sku, coalesce(a.ubicacion, b.ubicacion) AS ubicacion, a.q AS qa, b.q AS qb
    FROM a FULL JOIN b ON a.cd IS NOT DISTINCT FROM b.cd AND a.sku = b.sku AND a.ubicacion = b.ubicacion
    WHERE a.sku IS NULL OR b.sku IS NULL`, [a.id, b.id]);
  const skus = [...new Set(ev.map((x) => x.sku))];
  const tot = new Map();
  if (skus.length) {
    const { rows } = await q(`SELECT sku, coalesce(sum(qty) FILTER (WHERE carga_id = $1), 0)::float AS a, coalesce(sum(qty) FILTER (WHERE carga_id = $2), 0)::float AS b,
        max(descripcion) AS descripcion, max(depto) AS depto
      FROM stock WHERE carga_id IN ($1, $2) AND qty > 0 AND sku = ANY($3::text[]) GROUP BY sku`, [a.id, b.id, skus]);
    for (const r of rows) tot.set(r.sku, r);
  }
  const porSku = new Map();
  for (const x of ev) {
    if (!porSku.has(x.sku)) porSku.set(x.sku, { E: [], S: [] });
    const g = porSku.get(x.sku);
    if (x.qb !== null) g.E.push({ cd: x.cd, ubicacion: x.ubicacion, qty: x.qb }); else g.S.push({ cd: x.cd, ubicacion: x.ubicacion, qty: x.qa });
  }
  const filas = [];
  for (const [sku, g] of porSku) {
    const t = tot.get(sku) || { a: 0, b: 0 };
    const cdsE = new Set(g.E.map((e) => e.cd)), cdsS = new Set(g.S.map((s) => s.cd));
    g.E.sort((x, y) => y.qty - x.qty); g.S.sort((x, y) => y.qty - x.qty);
    const pares = Math.min(g.E.length, g.S.length);
    // lo que sube o baja el stock total del SKU explica las entradas y salidas que no se emparejan
    let sube = Math.max(0, t.b - t.a), baja = Math.max(0, t.a - t.b);
    g.E.forEach((e, i) => {
      let clase = 'traslado';
      if (i >= pares && sube >= e.qty / 2) { clase = 'almacenamiento'; sube -= e.qty; }
      filas.push({ sku, ...e, tipo: 'E', clase, entre_cd: clase === 'traslado' && cdsS.size > 0 && !cdsS.has(e.cd), descripcion: t.descripcion, depto: t.depto });
    });
    g.S.forEach((s, i) => {
      let clase = 'traslado';
      if (i >= pares && baja >= s.qty / 2) { clase = 'vaciada'; baja -= s.qty; }
      filas.push({ sku, ...s, tipo: 'S', clase, entre_cd: clase === 'traslado' && cdsE.size > 0 && !cdsE.has(s.cd), descripcion: t.descripcion, depto: t.depto });
    });
  }
  await tx(async (c) => {
    await c.query('DELETE FROM stock_mov_par WHERE carga_ant = $1 AND carga_id = $2', [a.id, b.id]);
    await c.query('INSERT INTO stock_mov_par (carga_ant, carga_id, fecha_ant, fecha, eventos) VALUES ($1, $2, $3, $4, $5)', [a.id, b.id, a.fecha, b.fecha, filas.length]);
    const COLS = ['cd', 'sku', 'ubicacion', 'tipo', 'qty', 'clase', 'entre_cd', 'descripcion', 'depto'];
    const TIPO = { qty: 'numeric', entre_cd: 'boolean' };
    for (let i = 0; i < filas.length; i += LOTE) {
      const lote = filas.slice(i, i + LOTE);
      await c.query(`INSERT INTO stock_mov (carga_ant, carga_id, fecha, ${COLS.join(', ')})
        SELECT $${COLS.length + 1}, $${COLS.length + 2}, $${COLS.length + 3}, * FROM unnest(${COLS.map((k, j) => `$${j + 1}::${TIPO[k] || 'text'}[]`).join(', ')})`,
      [...COLS.map((k) => lote.map((f) => f[k])), a.id, b.id, b.fecha]);
    }
  });
  return filas.length;
}

// un solo cálculo a la vez (la primera vez son varios pares)
let enCurso = null;
/** Calcula los pares de fotos consecutivas que aún no están guardados */
export async function prepararPares() {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    const f = await fotos();
    const hechos = new Set((await q('SELECT carga_ant, carga_id FROM stock_mov_par')).rows.map((r) => `${r.carga_ant}|${r.carga_id}`));
    // pares de una carga que ya no es la vigente de su día (se volvió a cargar la Base) se descartan
    const vigentes = new Set(f.slice(1).map((b, i) => `${f[i].id}|${b.id}`));
    for (const k of hechos) if (!vigentes.has(k)) { const [x, y] = k.split('|'); await q('DELETE FROM stock_mov_par WHERE carga_ant = $1 AND carga_id = $2', [+x, +y]); }
    let nuevos = 0;
    for (let i = 1; i < f.length; i++) if (!hechos.has(`${f[i - 1].id}|${f[i].id}`)) { await calcularPar(f[i - 1], f[i]); nuevos++; }
    return { fotos: f, nuevos };
  })();
  try { return await enCurso; } finally { enCurso = null; }
}

/** desde / hasta: días de la foto (por defecto, los últimos 30 días con fotos); cd, zona (3 primeras letras de la ubicación),
 *  depto y buscar (SKU o descripción) filtran los eventos. */
export async function movimientosSku({ desde, hasta, cd, zona, depto, buscar } = {}) {
  const [{ fotos: f, nuevos }, abc, T] = await Promise.all([prepararPares(), clasesAbc(), tiempos()]);
  const base = { fotos: f.length, primera: f[0]?.fecha || null, ultima: f[f.length - 1]?.fecha || null, calculados: nuevos };
  if (f.length < 2) return { ...base, tot: null };
  hasta = soloFecha(hasta) || base.ultima;
  desde = soloFecha(desde) || addDias(hasta, -30);
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const [cdF, zonF, depF, bus] = [up(cd) || null, up(zona) || null, txt(depto) || null, up(buscar) || null];

  const [ev, par, opc] = await Promise.all([
    q(`SELECT fecha::text, cd, sku, ubicacion, tipo, qty::float, clase, entre_cd, descripcion, depto FROM stock_mov
       WHERE fecha BETWEEN $1 AND $2 AND ($3::text IS NULL OR upper(cd) = $3) AND ($4::text IS NULL OR left(ubicacion, 3) = $4)
         AND ($5::text IS NULL OR depto = $5) AND ($6::text IS NULL OR upper(sku) LIKE '%' || $6 || '%' OR upper(descripcion) LIKE '%' || $6 || '%')`,
    [desde, hasta, cdF, zonF, depF, bus]),
    q('SELECT fecha_ant::text, fecha::text FROM stock_mov_par WHERE fecha BETWEEN $1 AND $2 ORDER BY fecha', [desde, hasta]),
    q(`SELECT array_agg(DISTINCT cd ORDER BY cd) FILTER (WHERE cd <> '') AS cds, array_agg(DISTINCT left(ubicacion, 3) ORDER BY left(ubicacion, 3)) AS zonas,
         array_agg(DISTINCT depto ORDER BY depto) FILTER (WHERE depto <> '') AS deptos FROM stock_mov WHERE fecha BETWEEN $1 AND $2`, [desde, hasta])
  ]);
  const E = ev.rows;
  const nuevo = () => ({ traslado: 0, almacenamiento: 0, vaciada: 0, entreCd: 0, skus: new Set() });
  // salidas por traslado sin entrada el mismo día (consolidación en una ubicación que ya tenía): también son cambios
  const entra = new Set(E.filter((x) => x.tipo === 'E' && x.clase === 'traslado').map((x) => `${x.fecha}|${x.sku}`));
  const esCambio = (x) => x.clase === 'traslado' && (x.tipo === 'E' || !entra.has(`${x.fecha}|${x.sku}`));

  const tot = nuevo(), porDia = new Map(), porCd = new Map(), porSku = new Map(), porUbic = new Map();
  for (const x of E) {
    for (const g of [tot, porDia.get(x.fecha) || porDia.set(x.fecha, nuevo()).get(x.fecha), porCd.get(x.cd) || porCd.set(x.cd, nuevo()).get(x.cd)]) {
      if (esCambio(x)) { g.traslado++; g.skus.add(x.sku); if (x.entre_cd) g.entreCd++; } else if (x.clase === 'almacenamiento') g.almacenamiento++; else if (x.clase === 'vaciada') g.vaciada++;
    }
    let s = porSku.get(x.sku);
    if (!s) { s = { sku: x.sku, desc: x.descripcion, depto: x.depto, cambios: 0, entreCd: 0, almacenamiento: 0, vaciada: 0, dias: new Set(), ubic: new Set(), cds: new Set(), ultimo: null, unid: 0 }; porSku.set(x.sku, s); }
    s.ubic.add(x.ubicacion); if (x.cd) s.cds.add(x.cd);
    if (esCambio(x)) { s.cambios++; s.dias.add(x.fecha); if (x.tipo === 'E') s.unid += x.qty; if (x.entre_cd) s.entreCd++; if (!s.ultimo || x.fecha > s.ultimo) s.ultimo = x.fecha; }
    else if (x.clase === 'almacenamiento') s.almacenamiento++; else if (x.clase === 'vaciada') s.vaciada++;
    let u = porUbic.get(`${x.cd}|${x.ubicacion}`);
    if (!u) { u = { cd: x.cd, ubicacion: x.ubicacion, zona: x.ubicacion.slice(0, 3), entradas: 0, salidas: 0, traslados: 0, skus: new Set() }; porUbic.set(`${x.cd}|${x.ubicacion}`, u); }
    if (x.tipo === 'E') { u.entradas++; u.skus.add(x.sku); } else u.salidas++;
    if (x.clase === 'traslado') u.traslados++;
  }
  const cerrar = (g) => ({ traslado: g.traslado, almacenamiento: g.almacenamiento, vaciada: g.vaciada, entreCd: g.entreCd, skus: g.skus.size });
  const skus = [...porSku.values()].filter((s) => s.cambios > 0)
    .map((s) => ({ sku: s.sku, desc: s.desc, depto: s.depto, abc: abc?.m.get(`TODOS|${s.sku}`) || null, cambios: s.cambios, dias: s.dias.size, entreCd: s.entreCd, almacenamiento: s.almacenamiento, vaciada: s.vaciada,
      ubicaciones: s.ubic.size, cds: [...s.cds].sort().join(' · '), ultimo: s.ultimo, unidades: s.unid }))
    .sort((a, b) => b.cambios - a.cambios || b.dias - a.dias || b.ubicaciones - a.ubicaciones || a.sku.localeCompare(b.sku));
  // movimientos por categoría ABC / XYZ (consolidada): cuántos SKU del surtido hay, cuántos se movieron, cambios y tiempo estimado
  const SIN = '—';
  const porClase = new Map();
  const celda = (k) => porClase.get(k) || porClase.set(k, { matriz: k, skusStock: abc?.surtido.get(k) || 0, skus: 0, cambios: 0, entreCd: 0, unidades: 0, multi: 0 }).get(k);
  if (abc) for (const k of abc.surtido.keys()) celda(k);
  for (const s of skus) {
    const c = celda(s.abc || SIN);
    c.skus++; c.cambios += s.cambios; c.entreCd += s.entreCd; c.unidades += s.unidades; if (s.ubicaciones > 2) c.multi++;
  }
  const minutos = (c) => (c.cambios - c.entreCd) * T.dentro + c.entreCd * T.entreCd;
  const matriz = { metodo: abc?.metodo || null, tiempos: T, celdas: [...porClase.values()].map((c) => ({ ...c, minutos: minutos(c) })) };

  // cuántos SKU cambiaron 1, 2, 3, 4 o 5+ veces
  const frec = [1, 2, 3, 4, 5].map((n) => ({ n, skus: skus.filter((s) => (n === 5 ? s.cambios >= 5 : s.cambios === n)).length }));
  // días sin foto entre dos fotos consecutivas (los cambios de esos días se ven juntos en la foto siguiente)
  const saltos = par.rows.filter((p) => entre(p.fecha_ant, p.fecha) > 1).map((p) => ({ desde: p.fecha_ant, hasta: p.fecha, dias: entre(p.fecha_ant, p.fecha) }));

  return { ...base, desde, hasta, cds: opc.rows[0].cds || [], zonas: opc.rows[0].zonas || [], deptos: opc.rows[0].deptos || [],
    pares: par.rows.length, saltos,
    tot: { ...cerrar(tot), skusCambio: skus.length, ubicaciones: porUbic.size },
    porDia: [...porDia].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, g]) => ({ fecha, ...cerrar(g) })),
    porCd: [...porCd].map(([c, g]) => ({ cd: c || '(sin CD)', ...cerrar(g) })).sort((a, b) => b.traslado - a.traslado),
    frec, totalSkus: skus.length, skus: skus.slice(0, TOP_SKU), matriz };
}

/** Historia de un SKU: en qué ubicaciones estuvo cada día (cantidad) y sus cambios. */
export async function historiaSku({ sku, desde, hasta } = {}) {
  const s = txt(sku);
  if (!s) throw Object.assign(new Error('Indica el SKU.'), { status: 400 });
  const f = await fotos();
  hasta = soloFecha(hasta) || f[f.length - 1]?.fecha;
  desde = soloFecha(desde) || (hasta ? addDias(hasta, -30) : null);
  const sel = f.filter((x) => x.fecha >= desde && x.fecha <= hasta);
  if (!sel.length) return { sku: s, fechas: [], ubicaciones: [], eventos: [] };
  const [st, ev, abc] = await Promise.all([
    q(`SELECT carga_id, cd, ubicacion, sum(qty)::float AS qty, max(descripcion) AS descripcion, max(depto) AS depto
       FROM stock WHERE sku = $1 AND carga_id = ANY($2::int[]) AND qty > 0 GROUP BY 1, 2, 3`, [s, sel.map((x) => x.id)]),
    q(`SELECT fecha::text, cd, ubicacion, tipo, qty::float, clase, entre_cd FROM stock_mov WHERE sku = $1 AND fecha BETWEEN $2 AND $3 ORDER BY fecha, tipo DESC, ubicacion`, [s, desde, hasta]),
    clasesAbc()
  ]);
  const idx = new Map(sel.map((x, i) => [x.id, i]));
  const ub = new Map();
  let desc = null, depto = null;
  for (const r of st.rows) {
    desc ||= r.descripcion; depto ||= r.depto;
    const k = `${r.cd}|${r.ubicacion}`;
    if (!ub.has(k)) ub.set(k, { cd: r.cd, ubicacion: r.ubicacion, qty: sel.map(() => null) });
    ub.get(k).qty[idx.get(r.carga_id)] = r.qty;
  }
  const ubicaciones = [...ub.values()].map((u) => ({ ...u, desde: sel[u.qty.findIndex((v) => v !== null)].fecha, dias: u.qty.filter((v) => v !== null).length }))
    .sort((a, b) => a.desde.localeCompare(b.desde) || String(a.cd).localeCompare(String(b.cd)) || a.ubicacion.localeCompare(b.ubicacion));
  const total = sel.map((_, i) => ubicaciones.reduce((t, u) => t + (u.qty[i] || 0), 0));
  // trazabilidad: de un día de foto al siguiente, lo que baja en unas ubicaciones (origen) se empareja con lo que sube en
  // otras (destino): primero las cantidades iguales (también traslados parciales: 26 → 13 y aparecen 13 en otra), luego
  // las ubicaciones que quedaron vacías, de mayor a menor. Una baja parcial sin igual es venta / picking (salida) y lo
  // que sube sin origen es entrada (almacenamiento o reposición)
  const flujos = [];
  for (let i = 1; i < sel.length; i++) {
    const baja = [], sube = [];
    for (const u of ubicaciones) {
      const d = (u.qty[i] || 0) - (u.qty[i - 1] || 0);
      const x = { cd: u.cd, ubicacion: u.ubicacion, antes: u.qty[i - 1] || 0, despues: u.qty[i] || 0 };
      if (d < 0) baja.push({ ...x, q: -d }); else if (d > 0) sube.push({ ...x, q: d });
    }
    if (!baja.length && !sube.length) continue;
    const base = { desde: sel[i - 1].fecha, fecha: sel[i].fecha };
    const mover = (o, de, n) => { flujos.push({ ...base, tipo: 'traslado', origen: o, destino: de, qty: n, entreCd: o.cd !== de.cd }); o.q -= n; de.q -= n; };
    for (const o of baja) { const de = sube.find((x) => x.q > 0 && x.q === o.q); if (de) mover(o, de, o.q); }
    baja.sort((x, y) => y.q - x.q); sube.sort((x, y) => y.q - x.q);
    for (const o of baja.filter((x) => x.despues === 0)) for (const de of sube) { if (!(o.q > 0)) break; if (de.q > 0) mover(o, de, Math.min(o.q, de.q)); }
    for (const o of baja) if (o.q > 0) flujos.push({ ...base, tipo: 'salida', origen: o, destino: null, qty: o.q, entreCd: false });
    for (const de of sube) if (de.q > 0) flujos.push({ ...base, tipo: 'entrada', origen: null, destino: de, qty: de.q, entreCd: false });
  }
  const limpio = (x) => x && { cd: x.cd, ubicacion: x.ubicacion, antes: x.antes, despues: x.despues };
  return { sku: s, desc, depto, desde, hasta, fechas: sel.map((x) => x.fecha), total, ubicaciones, eventos: ev.rows,
    flujos: flujos.map((f) => ({ ...f, origen: limpio(f.origen), destino: limpio(f.destino) })),
    // clase ABC / XYZ del SKU: consolidada (todos los CD) y en cada CD donde estuvo
    abc: abc && { metodo: abc.metodo, total: abc.m.get(`TODOS|${s}`) || null,
      porCd: Object.fromEntries([...new Set(ubicaciones.map((u) => u.cd))].sort().map((c) => [c, abc.m.get(`${c}|${s}`) || null])) },
    cambios: ev.rows.filter((e) => e.clase === 'traslado' && (e.tipo === 'E' || !ev.rows.some((o) => o.fecha === e.fecha && o.tipo === 'E' && o.clase === 'traslado'))).length };
}
