// Picking desde el OSR vs fuera del OSR (archivo de pedidos/despachos): unidades y líneas por día y por CD, por
// Logística OSR, y los operarios-turno que pide cada lado (picking manual ÷ u./HH manual; OSR ÷ u./HH de las estaciones).
// Usa los mismos filtros que Participación por CD (tipo de picking, fechas, CD que entran, temporada, solo deptos OSR),
// y el de Logística OSR (Y / sin Y / todos); la apertura por Logística OSR muestra siempre los tres grupos, marcando los excluidos.
import { q } from '../db.js';
import { calcularParticipacion, NOM_LOG } from './participacionCd.js';
import { up } from '../engine/util.js';
import { leerParametros } from './parametros.js';

const num0 = (v, d) => (v === undefined || v === null || v === '' || !(Number(v) >= 0) ? d : Number(v));
const LADO0 = () => ({ u: 0, l: 0, skus: 0, set: new Set() });

/** Días con venta del período (tipo de picking, fechas y CD que entran), sin filtrar SKU: es el divisor de todos los u./día,
 *  así el comparativo y la sugerencia miden igual aunque un grupo de SKU no venda todos los días. */
export async function diasPeriodo(d, params = {}) {
  const cond = [], val = [];
  if (d.tipo !== 'TODOS') { val.push(d.tipo); cond.push(`tipo = $${val.length}`); }
  if (params.desde) { val.push(params.desde); cond.push(`fecha >= $${val.length}`); }
  if (params.hasta) { val.push(params.hasta); cond.push(`fecha <= $${val.length}`); }
  if (d.excluir.length) { val.push(d.excluir); cond.push(`NOT (cd = ANY($${val.length}::text[]))`); }
  const { rows } = await q(`SELECT count(DISTINCT fecha)::int AS n FROM venta_cd ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}`, val);
  return Math.max(1, rows[0].n);
}

export async function pickingOsr(params = {}) {
  const d = await calcularParticipacion({ ...params, cd: '', logOsr: '', depto: '', estado: '' });
  if (d.sinDatos) return { sinDatos: true, info: d.info };
  const p = await leerParametros();
  const osr = up(p.cdOsr);
  const pickUnHH = num0(params.pickUnHH, p.pickUnHH) || 60;
  const osrUnHH = num0(params.osrUnHH, p.osrUnHH);
  const horas = Math.max(1, Number(p.horasTurno) || 8);
  const opMan = (uDia) => uDia / pickUnHH / horas;
  const opOsr = (uDia) => (osrUnHH > 0 ? uDia / osrUnHH / horas : 0);

  // mismo filtro de la venta que la participación; los SKU que quedan (temporada, deptos OSR) salen de d.skus
  const cond = [], val = [];
  if (d.tipo !== 'TODOS') { val.push(d.tipo); cond.push(`tipo = $${val.length}`); }
  if (params.desde) { val.push(params.desde); cond.push(`fecha >= $${val.length}`); }
  if (params.hasta) { val.push(params.hasta); cond.push(`fecha <= $${val.length}`); }
  if (d.excluir.length) { val.push(d.excluir); cond.push(`NOT (cd = ANY($${val.length}::text[]))`); }
  // Logística OSR: 'Y' solo aptos, 'NOY' sin Y (incluye los que no están en la Base), vacío = todos; sin Base no se filtra
  const logOsr = ['Y', 'NOY'].includes(up(params.logOsr)) ? up(params.logOsr) : '';
  const filtraLog = !!logOsr && d.hayBase;
  const pasaLog = (c) => !filtraLog || (logOsr === 'Y' ? c === 'Y' : c !== 'Y');
  const logDe = new Map(d.skus.map((x) => [x.sku, x.logC]));
  const filtraSku = d.temporada.sel.length > 0 || !!params.soloOsr;
  const valS = [...val], condS = [...cond];
  if (filtraSku) { valS.push(d.skus.map((x) => x.sku)); condS.push(`sku = ANY($${valS.length}::text[])`); }
  // por día solo los SKU que pasan el filtro de Logística OSR
  const valD = [...val], condD = [...cond];
  if (filtraSku || filtraLog) { valD.push(d.skus.filter((x) => pasaLog(x.logC)).map((x) => x.sku)); condD.push(`sku = ANY($${valD.length}::text[])`); }
  const wh = (c) => (c.length ? 'WHERE ' + c.join(' AND ') : '');
  const [{ rows: sk }, { rows: dia }, dias] = await Promise.all([
    q(`SELECT cd, sku, sum(unidades)::float8 AS u, sum(lineas)::int AS l FROM venta_cd ${wh(condS)} GROUP BY cd, sku`, valS),
    q(`SELECT fecha::text AS fecha, cd = $${valD.length + 1} AS osr, sum(unidades)::float8 AS u, sum(lineas)::int AS l
         FROM venta_cd ${wh(condD)} GROUP BY 1, 2 ORDER BY 1`, [...valD, osr]),
    diasPeriodo(d, params),
  ]);

  // por CD y por Logística OSR (OSR vs fuera)
  const cdM = new Map();
  const logM = new Map(['Y', 'NO', 'SIN'].map((k) => [k, { log: k, nom: NOM_LOG[k], osr: LADO0(), fuera: LADO0(), skusSet: new Set() }]));
  const tot = { osr: LADO0(), fuera: LADO0() };
  for (const r of sk) {
    const lado = r.cd === osr ? 'osr' : 'fuera';
    const lg = logDe.get(r.sku) || 'SIN';
    const g = logM.get(lg);
    g[lado].u += r.u; g[lado].l += r.l; g[lado].set.add(r.sku); g.skusSet.add(r.sku);
    if (!pasaLog(lg)) continue;
    let c = cdM.get(r.cd);
    if (!c) cdM.set(r.cd, c = { cd: r.cd, osr: lado === 'osr', u: 0, l: 0, skus: 0 });
    c.u += r.u; c.l += r.l; c.skus++;
    tot[lado].u += r.u; tot[lado].l += r.l; tot[lado].set.add(r.sku);
  }
  const UT = [...logM.values()].reduce((a, g) => a + g.osr.u + g.fuera.u, 0);
  const U = tot.osr.u + tot.fuera.u, L = tot.osr.l + tot.fuera.l;
  const lado = ({ set, ...x }, osrLado) => ({ ...x, skus: set ? set.size : x.skus, uDia: x.u / dias, lDia: x.l / dias, operarios: osrLado ? opOsr(x.u / dias) : opMan(x.u / dias) });
  const porCd = [...cdM.values()].sort((a, b) => b.u - a.u).map((c) => ({ ...lado(c, c.osr), pct: U ? c.u / U : 0, pctL: L ? c.l / L : 0 }));
  const porLog = [...logM.values()].filter((g) => g.skusSet.size).map(({ skusSet, ...g }) => {
    const gu = g.osr.u + g.fuera.u;
    return { ...g, skus: skusSet.size, osr: lado(g.osr, true), fuera: lado(g.fuera, false), pct: gu ? g.osr.u / gu : 0, pctTotal: UT ? gu / UT : 0, incluida: pasaLog(g.log) };
  });

  // por día
  const dM = new Map();
  for (const r of dia) {
    const k = r.fecha || '';
    let x = dM.get(k);
    if (!x) dM.set(k, x = { fecha: r.fecha, osrU: 0, osrL: 0, fueraU: 0, fueraL: 0 });
    if (r.osr) { x.osrU += r.u; x.osrL += r.l; } else { x.fueraU += r.u; x.fueraL += r.l; }
  }
  const porDia = [...dM.values()].filter((x) => x.fecha).map((x) => ({ ...x, pct: x.osrU + x.fueraU ? x.osrU / (x.osrU + x.fueraU) : 0,
    opMan: opMan(x.fueraU), opOsr: opOsr(x.osrU) }));

  const skusT = new Set([...tot.osr.set, ...tot.fuera.set]).size;
  const ladoT = { osr: lado(tot.osr, true), fuera: lado(tot.fuera, false) };
  return {
    info: d.info, tipo: d.tipo, tipos: d.tipos, excluir: d.excluir, temporada: d.temporada, logOsr, filtraLog, hayBase: d.hayBase, cdOsr: osr, dias,
    conf: { pickUnHH, osrUnHH, horas },
    total: { u: U, l: L, skus: skusT, uDia: U / dias, lDia: L / dias, pct: U ? tot.osr.u / U : 0, pctL: L ? tot.osr.l / L : 0,
      operarios: ladoT.osr.operarios + ladoT.fuera.operarios },
    osr: ladoT.osr, fuera: ladoT.fuera, porCd, porLog, porDia,
  };
}
