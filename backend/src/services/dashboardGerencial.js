// Dashboard gerencial: los indicadores principales de todos los módulos en una sola vista, para un rango de fechas
// y comparados con el período anterior de igual largo.
// - Producción: cumplimiento contra la meta por hora de cada etapa (como Control por hora) y productividad por persona-hora.
// - Desvíos: brecha en unidades y minutos detenidos por causa (Cierre de turno).
// - Almacenado: unidades y LPN almacenados por día y CD; lo pendiente por almacenar de la última carga.
// - Inventario: ERI / ERU de la toma de la operación y precisión de la programación de CE.
// - Stock y movimientos internos: fotos diarias de la Base de stock (Gestión diaria).
import { q } from '../db.js';
import { q as qg } from '../gestion/db.js';
import { cat } from '../lib/catalogos.js';
import { addDias, fechaOperativa } from '../lib/turnos.js';
import { soloFecha } from '../import/excel.js';
import { controlPorHora, referencia } from './control.js';
import { paramsInv, finales } from './inventarioCe.js';
import { precisionProgramacion } from './inventarioComparacion.js';
import { prepararPares } from './movimientosSku.js';

const div = (a, b) => (b > 0 ? a / b : null);
const dias = (a, b) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 864e5) + 1;

// Producción por día operativo (todas las etapas): unidades, meta acumulada y personas-hora
async function produccion(desde, hasta, c, R) {
  const { rows } = await q(`SELECT DISTINCT date_trunc('hour', fecha_hora) AS h FROM movimientos_etapa
    WHERE fecha_hora >= $1::date - 1 AND fecha_hora < $2::date + 2`, [desde, hasta]);
  const fechas = [...new Set(rows.map((r) => fechaOperativa(new Date(r.h).getTime(), c)))].filter((f) => f >= desde && f <= hasta).sort();
  const porDia = [], fases = new Map(), etapas = new Map();
  let u = 0, meta = 0, ph = 0;
  for (const f of fechas) {
    const x = await controlPorHora(f, 'dia', R);
    if (!x.inst) continue;
    porDia.push({ fecha: f, u: x.u, meta: x.mAc, pct: x.pct });
    u += x.u; meta += x.mAc;
    for (const r of x.rows) {
      ph += r.personasHora || 0;
      const a = fases.get(r.fase) || { fase: r.fase, u: 0, meta: 0 };
      a.u += r.u; a.meta += r.mAc; fases.set(r.fase, a);
      const e = etapas.get(r.area) || { area: r.area, nombre: r.nombre, fase: r.fase, u: 0, meta: 0 };
      e.u += r.u; e.meta += r.mAc; etapas.set(r.area, e);
    }
  }
  const pct = (x) => ({ ...x, pct: div(x.u, x.meta) });
  return { dias: porDia.length, u, meta, pct: div(u, meta), personasHora: ph, prod: div(u, ph), porDia,
    fases: [...fases.values()].map(pct), etapas: [...etapas.values()].map(pct) };
}

// Desvíos registrados en el cierre de turno, por causa y por etapa
async function desvios(desde, hasta) {
  const [causas, areas, cierres] = await Promise.all([
    q(`SELECT COALESCE(c.nombre, 'Sin causa registrada') AS causa, COALESCE(SUM(d.brecha), 0)::float AS brecha,
         COALESCE(SUM(d.minutos), 0)::float AS minutos, COUNT(*)::int AS desvios
       FROM desvio_causas d LEFT JOIN causas c ON c.id = d.causa_id WHERE d.fecha BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC`, [desde, hasta]),
    q(`SELECT d.area, COALESCE(e.nombre, d.area) AS nombre, COALESCE(SUM(d.brecha), 0)::float AS brecha, COALESCE(SUM(d.minutos), 0)::float AS minutos,
         COUNT(*)::int AS desvios
       FROM desvio_causas d LEFT JOIN etapas e ON e.area = d.area WHERE d.fecha BETWEEN $1 AND $2 GROUP BY 1, 2 ORDER BY 3 DESC`, [desde, hasta]),
    q(`SELECT COUNT(*) FILTER (WHERE cerrado_en IS NOT NULL)::int AS cerrados FROM cierres_turno WHERE fecha BETWEEN $1 AND $2`, [desde, hasta])
  ]);
  const t = causas.rows.reduce((s, x) => ({ brecha: s.brecha + x.brecha, minutos: s.minutos + x.minutos, desvios: s.desvios + x.desvios }), { brecha: 0, minutos: 0, desvios: 0 });
  return { ...t, turnosCerrados: cierres.rows[0].cerrados, causas: causas.rows, areas: areas.rows };
}

// Almacenado por día y CD
async function almacenado(desde, hasta) {
  const { rows } = await q(`SELECT dia::text AS fecha, COALESCE(NULLIF(cd, ''), 'Sin CD') AS cd, SUM(qty)::float AS u, COUNT(DISTINCT lpn)::int AS lpn
    FROM recepcion_almacenado WHERE dia BETWEEN $1 AND $2 GROUP BY 1, 2 ORDER BY 1, 2`, [desde, hasta]);
  const fechas = [...new Set(rows.map((r) => r.fecha))];
  return { dias: fechas.length, u: rows.reduce((s, r) => s + r.u, 0), lpn: rows.reduce((s, r) => s + r.lpn, 0), filas: rows };
}

// Lo pendiente por almacenar en la última carga
async function porAlmacenar(c) {
  const { rows } = await q(`SELECT COUNT(*)::int AS lpn, COALESCE(SUM(qty), 0)::float AS u, COALESCE(SUM(costo_lpn), 0)::float AS valor,
      COUNT(*) FILTER (WHERE fecha_creac < now() - make_interval(mins => $1))::int AS antiguos, max(c.corte) AS corte
    FROM alm_pendiente a LEFT JOIN cargas c ON c.id = a.carga_id WHERE a.carga_id = (SELECT max(carga_id) FROM alm_pendiente)`, [c.p.minUbicar ?? 90]);
  return rows[0].lpn ? rows[0] : null;
}

// ERI / ERU de la toma de la operación (última toma de cada ubicación y SKU por día) por día y CD
async function inventario(desde, hasta, CDS) {
  const { rows } = await q(`WITH ${finales('fecha BETWEEN $1 AND $2 AND cd = ANY($3::text[])')},
      l AS (SELECT fecha, cd, ubicacion, GREATEST(sistema, 0)::float AS s, GREATEST(contado, 0)::float AS c FROM fin)
    SELECT fecha::text, cd, COUNT(*)::int AS lineas, SUM(LEAST(s, c)) AS corr, SUM(s) AS sis, SUM(c - s) AS neto, SUM(abs(c - s)) AS abs,
      COUNT(DISTINCT ubicacion)::int AS ubic, COUNT(DISTINCT ubicacion) FILTER (WHERE c <> s)::int AS ubic_mal
    FROM l GROUP BY 1, 2 ORDER BY 1, 2`, [desde, hasta, CDS]);
  const suma = (arr) => {
    const t = arr.reduce((s, r) => ({ lineas: s.lineas + r.lineas, corr: s.corr + r.corr, sis: s.sis + r.sis, neto: s.neto + r.neto, abs: s.abs + r.abs,
      ubic: s.ubic + r.ubic, mal: s.mal + r.ubic_mal }), { lineas: 0, corr: 0, sis: 0, neto: 0, abs: 0, ubic: 0, mal: 0 });
    return { lineas: t.lineas, unidSis: t.sis, neto: t.neto, abs: t.abs, ubicaciones: t.ubic, ubicOk: t.ubic - t.mal, eri: div(t.corr, t.sis), eru: div(t.ubic - t.mal, t.ubic) };
  };
  const agrupar = (k) => { const m = new Map(); for (const r of rows) { const v = r[k]; if (!m.has(v)) m.set(v, []); m.get(v).push(r); } return m; };
  return { dias: new Set(rows.map((r) => r.fecha)).size, ...suma(rows),
    porDia: [...agrupar('fecha')].map(([fecha, a]) => ({ fecha, ...suma(a) })),
    porCd: [...agrupar('cd')].map(([cd, a]) => ({ cd, ...suma(a) })).sort((a, b) => a.cd.localeCompare(b.cd, undefined, { numeric: true })) };
}

// Precisión de la programación de CE (solo los totales)
async function programacion(desde, hasta) {
  try {
    const p = await precisionProgramacion({ desde, hasta, periodo: 'semana' });
    if (!p.tot || !p.tot.evaluables) return null;
    const { accOrig, accVig, cumpl, evaluables, prog, enOrig, enVig } = p.tot;
    return { accOrig, accVig, cumpl, evaluables, prog, enOrig, enVig, noTomadas: p.tot.est?.noTomada ?? 0 };
  } catch { return null; }
}

// Totales de cada foto de la Base de stock: una carga no cambia, así que se calculan una sola vez
const totFoto = new Map();
async function totalesFoto(id) {
  if (!totFoto.has(id)) {
    const pr = qg(`SELECT SUM(qty)::float AS u, SUM(qty * COALESCE(costo, 0))::float AS valor, COUNT(DISTINCT sku)::int AS skus FROM stock WHERE carga_id = $1`, [id])
      .then((r) => r.rows[0]);
    totFoto.set(id, pr);
    pr.catch(() => totFoto.delete(id));
  }
  return totFoto.get(id);
}

// Stock (fotos diarias de la Base) y movimientos internos (cambios de ubicación, sin ventas)
async function stockYMovimientos(desde, hasta) {
  await prepararPares().catch(() => null);
  const fotos = (await qg(`SELECT DISTINCT ON (fecha) id, fecha::text FROM cargas WHERE tipo = 'INICIO' AND fecha BETWEEN $1 AND $2 ORDER BY fecha, id DESC`, [desde, hasta])).rows;
  const serie = [];
  for (let i = 0; i < fotos.length; i += 4)   // de a 4 para no saturar la base la primera vez
    serie.push(...await Promise.all(fotos.slice(i, i + 4).map(async (f) => ({ fecha: f.fecha, ...(await totalesFoto(f.id)) }))));
  const st = { rows: serie };
  const [mv] = await Promise.all([
    qg(`SELECT fecha::text, COUNT(*) FILTER (WHERE tipo = 'E' AND clase = 'traslado')::int AS traslados,
        COUNT(*) FILTER (WHERE tipo = 'E' AND clase = 'traslado' AND entre_cd)::int AS entre_cd,
        COUNT(DISTINCT sku) FILTER (WHERE clase = 'traslado')::int AS skus
      FROM stock_mov WHERE fecha BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [desde, hasta])
  ]);
  const ult = st.rows.at(-1) || null;
  return { stock: { fotos: st.rows.length, ultimo: ult, serie: st.rows },
    mov: { dias: mv.rows.length, traslados: mv.rows.reduce((s, r) => s + r.traslados, 0), entreCd: mv.rows.reduce((s, r) => s + r.entre_cd, 0), serie: mv.rows } };
}

async function periodo(desde, hasta, c, R, CDS) {
  const [prod, dev, alm, inv, prog] = await Promise.all([
    produccion(desde, hasta, c, R), desvios(desde, hasta), almacenado(desde, hasta), inventario(desde, hasta, CDS), programacion(desde, hasta)
  ]);
  return { desde, hasta, prod, dev, alm, inv, prog };
}

// Resumen del período anterior: solo lo que se compara en las tarjetas
const resumenAnt = (p) => ({ desde: p.desde, hasta: p.hasta,
  prod: { u: p.prod.u, pct: p.prod.pct, prod: p.prod.prod, dias: p.prod.dias }, dev: { brecha: p.dev.brecha, minutos: p.dev.minutos },
  alm: { u: p.alm.u, lpn: p.alm.lpn, dias: p.alm.dias }, inv: { eri: p.inv.eri, eru: p.inv.eru, dias: p.inv.dias, abs: p.inv.abs, unidSis: p.inv.unidSis },
  prog: p.prog && { accOrig: p.prog.accOrig, accVig: p.prog.accVig, cumpl: p.prog.cumpl } });

// Respuesta reciente por rango (5 minutos): el tablero se refresca solo y varios usuarios lo miran a la vez
const cache = new Map();
const TTL = 5 * 60000;

/** desde / hasta: rango de fechas (por defecto los últimos 30 días hasta hoy); fresco = true ignora la respuesta guardada */
export async function dashboardGerencial({ desde, hasta, fresco } = {}) {
  const k = `${soloFecha(desde) || ''}|${soloFecha(hasta) || ''}`, hit = cache.get(k);
  if (!fresco && hit && Date.now() - hit.t < TTL) return hit.pr;
  const pr = calcular({ desde, hasta }).then((r) => ({ ...r, calculado: Date.now() }));
  cache.set(k, { t: Date.now(), pr });
  for (const [kk, v] of cache) if (Date.now() - v.t > TTL) cache.delete(kk);
  pr.catch(() => cache.delete(k));
  return pr;
}

async function calcular({ desde, hasta }) {
  const c = await cat(), R = await referencia();
  const hoy = fechaOperativa(Date.now(), c);
  hasta = soloFecha(hasta) || hoy;
  desde = soloFecha(desde) || addDias(hasta, -29);
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const n = dias(desde, hasta);
  const antHasta = addDias(desde, -1), antDesde = addDias(antHasta, -(n - 1));
  const { cds: CDS, eriSano, eriCritico, eruSano, eruCritico } = await paramsInv();
  const [act, ant, pend, sm] = await Promise.all([
    periodo(desde, hasta, c, R, CDS), periodo(antDesde, antHasta, c, R, CDS), porAlmacenar(c), stockYMovimientos(desde, hasta)
  ]);
  const P = c.p;
  return {
    hoy, ...act, ant: resumenAnt(ant), pend, ...sm,
    metas: { cumplimiento: P.metaCumplimiento ?? 0.95, umbral: P.umbralDesvio ?? 0.85, eri: eriSano, eriCritico, eru: eruSano, eruCritico,
      programacion: P.metaProgramacionCe ?? 0.9, recepcionHora: P.metaRecepcionHora ?? null, minUbicar: P.minUbicar ?? 90 }
  };
}
