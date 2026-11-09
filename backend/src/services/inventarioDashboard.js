// Dashboard de inventario: resultado de la toma (última toma de cada ubicación y SKU por día) medido en SKU y en unidades.
// - ERI = unidades correctas / unidades registradas; ERU = ubicaciones correctas / ubicaciones verificadas (como Inventario CD).
// - Resultado neto = Σ (contado − sistema): lo que pierde o gana el inventario (financiero; faltantes y sobrantes se compensan).
// - Resultado absoluto = Σ |contado − sistema|: todo el error de registro (gestión logística; no se compensa).
// - Valorizado con el COSTO de la Base y cruzado con la clasificación ABC / XYZ vigente.
// - Resultado por conteo (VALIDACION: primer, segundo y tercer conteo) y por turno de ejecución.
// - Match: el mismo SKU que falta en una ubicación y sobra en otra del mismo CD; lo que se compensa es mal ubicado, no pérdida.
import { q } from '../db.js';
import { soloFecha, txt } from '../import/excel.js';
import { cat } from '../lib/catalogos.js';
import { addDias, fechaOperativa } from '../lib/turnos.js';
import { clasificacionActual } from '../gestion/services/abcXyz.js';
import { paramsInv, finales } from './inventarioCe.js';

const SIN_CLASE = '—';
const TOP = 300;

// lunes de la semana de una fecha ISO
const lunes = (iso) => { const d = new Date(`${iso}T12:00:00`).getDay(); return addDias(iso, -((d + 6) % 7)); };
const PERIODOS = { dia: (f) => f, semana: lunes, mes: (f) => f.slice(0, 7) };

const nuevo = () => ({ lineas: 0, sis: 0, cont: 0, corr: 0, sisVal: 0, falt: 0, sobr: 0, faltVal: 0, sobrVal: 0, sinCosto: 0, skus: new Set(), skusDif: new Set(), skusFalt: new Set(), skusSobr: new Set(), locs: new Set(), locsMal: new Set() });
function acum(x, l) {
  x.lineas++; x.sis += l.sis; x.cont += l.cont; x.corr += l.corr;
  x.skus.add(l.sku); x.locs.add(l.loc);
  if (l.costo === null) x.sinCosto++; else x.sisVal += l.sis * l.costo;
  if (l.dif === 0) return;
  x.skusDif.add(l.sku); x.locsMal.add(l.loc);
  const v = l.costo || 0;
  if (l.dif < 0) { x.falt -= l.dif; x.faltVal -= l.dif * v; x.skusFalt.add(l.sku); } else { x.sobr += l.dif; x.sobrVal += l.dif * v; x.skusSobr.add(l.sku); }
}
const cerrar = (x) => ({
  lineas: x.lineas, skus: x.skus.size, skusDif: x.skusDif.size, skusFalt: x.skusFalt.size, skusSobr: x.skusSobr.size,
  ubicaciones: x.locs.size, ubicOk: x.locs.size - x.locsMal.size,
  unidSis: x.sis, unidCont: x.cont, unidCorr: x.corr, sisVal: x.sisVal, falt: x.falt, sobr: x.sobr, neto: x.sobr - x.falt, abs: x.sobr + x.falt,
  faltVal: x.faltVal, sobrVal: x.sobrVal, netoVal: x.sobrVal - x.faltVal, absVal: x.sobrVal + x.faltVal, sinCosto: x.sinCosto,
  eri: x.sis > 0 ? x.corr / x.sis : null, eru: x.locs.size ? (x.locs.size - x.locsMal.size) / x.locs.size : null
});
function agrupar(L, fn) {
  const m = new Map();
  for (const l of L) { const k = fn(l); let x = m.get(k); if (!x) m.set(k, (x = nuevo())); acum(x, l); }
  return m;
}

/** desde / hasta: fechas de toma; cd opcional; periodo: dia | semana | mes (serie histórica de ERI / ERU) */
export async function dashboardInventario({ desde, hasta, cd, periodo } = {}) {
  const hoy = fechaOperativa(Date.now(), await cat());
  hasta = soloFecha(hasta) || hoy;
  desde = soloFecha(desde) || addDias(hasta, -90);
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const cdF = txt(cd) ? txt(cd).toUpperCase() : null;
  const per = PERIODOS[periodo] ? periodo : 'semana';

  // año anterior: el mismo rango de fechas un año atrás (el 29 de febrero pasa al 28)
  const atras = (f) => `${+f.slice(0, 4) - 1}${f.slice(4) === '-02-29' ? '-02-28' : f.slice(4)}`;
  const ant = { desde: atras(desde), hasta: atras(hasta) };
  const { cds: CDS } = await paramsInv();   // solo los CD de almacenamiento
  const leer = (a, b) => q(`WITH ${finales('fecha BETWEEN $1 AND $2 AND ($3::text IS NULL OR cd = $3) AND cd = ANY($4::text[])')}
       SELECT cd, ubicacion, coalesce(sku, '') AS sku, contado::float, sistema::float, fecha::text, upper(coalesce(turno, '')) AS turno, coalesce(conteo, 1) AS conteo FROM fin`, [a, b, cdF, CDS]);
  const [res, resAnt, resConteos, cds, rango, param] = await Promise.all([
    leer(desde, hasta), leer(ant.desde, ant.hasta),
    // todos los conteos (el último registro de cada conteo por ubicación, SKU y día)
    q(`SELECT DISTINCT ON (cd, ubicacion, coalesce(sku, ''), fecha, coalesce(conteo, 1)) cd, ubicacion, coalesce(sku, '') AS sku, contado::float, sistema::float, fecha::text,
         upper(coalesce(turno, '')) AS turno, coalesce(conteo, 1) AS conteo
       FROM inv_resultado WHERE fecha BETWEEN $1 AND $2 AND ($3::text IS NULL OR cd = $3) AND cd = ANY($4::text[])
       ORDER BY cd, ubicacion, coalesce(sku, ''), fecha, coalesce(conteo, 1), f_mod DESC NULLS LAST, id DESC`, [desde, hasta, cdF, CDS]),
    q('SELECT DISTINCT cd FROM inv_resultado WHERE cd = ANY($1::text[]) ORDER BY 1', [CDS]),
    q('SELECT min(fecha)::text AS desde, max(fecha)::text AS hasta, count(*)::int AS filas, max(archivo) AS archivo, max(cargado_en) AS cargado_en FROM inv_resultado'),
    paramsInv()
  ]);

  // clasificación ABC / XYZ vigente (con el costo, la descripción y el departamento de la Base); sin Base, sin clasificar
  let clas = null, aviso = null;
  try { clas = await clasificacionActual(); } catch (e) { aviso = e.message; }
  const info = new Map();
  if (clas) for (const [c, filas] of clas.grupos) for (const x of filas) info.set(`${c}|${x.sku}`, x);
  const deSku = (c, sku) => info.get(`${c}|${sku}`) || info.get(`TODOS|${sku}`) || null;

  const lineas = (rows) => rows.map((r) => {
    const sis = Math.max(0, r.sistema || 0), cont = Math.max(0, r.contado || 0), x = deSku(r.cd, r.sku);
    return { cd: r.cd, sku: r.sku, ubic: r.ubicacion, fecha: r.fecha, turno: r.turno || 'SIN TURNO', conteo: r.conteo, sis, cont, corr: Math.min(sis, cont), dif: cont - sis, loc: `${r.cd}|${r.ubicacion}|${r.fecha}`,
      costo: x?.costo > 0 ? x.costo : null, matriz: x ? (x.xyz ? x.matriz : `${x.abc}-`) : SIN_CLASE, desc: x?.desc || '', depto: x?.depto || '' };
  });
  const L = lineas(res.rows);
  const total = (ls) => cerrar(agrupar(ls, () => 'T').get('T') || nuevo());

  const tot = total(L);
  const comp = { ant: { ...ant, ...total(lineas(resAnt.rows)) } };
  const porCd = [...agrupar(L, (l) => l.cd)].map(([v, x]) => ({ v, ...cerrar(x) })).sort((a, b) => a.v.localeCompare(b.v, undefined, { numeric: true }));

  // serie histórica de ERI / ERU por período, total y por CD
  const fP = PERIODOS[per];
  const periodos = [...new Set(L.map((l) => fP(l.fecha)))].sort();
  const serie = { periodos, total: [], cds: {} };
  const pT = agrupar(L, (l) => fP(l.fecha)), pC = agrupar(L, (l) => `${l.cd}|${fP(l.fecha)}`);
  const punto = (x) => (x ? (({ eri, eru, lineas, skus, unidSis, neto, abs, netoVal, absVal }) => ({ eri, eru, lineas, skus, unidSis, neto, abs, netoVal, absVal }))(cerrar(x)) : null);
  for (const p of periodos) serie.total.push(punto(pT.get(p)));
  for (const c of porCd) serie.cds[c.v] = periodos.map((p) => punto(pC.get(`${c.v}|${p}`)));
  // resultado neto y absoluto por día, semana y mes (el bloque de resultado elige la escala por su cuenta)
  const evolucion = Object.fromEntries(Object.keys(PERIODOS).map((e) => {
    const g = agrupar(L, (l) => PERIODOS[e](l.fecha));
    return [e, [...g.keys()].sort().map((p) => { const x = cerrar(g.get(p)); return { p, neto: x.neto, abs: x.abs, falt: x.falt, sobr: x.sobr, netoVal: x.netoVal, absVal: x.absVal, faltVal: x.faltVal, sobrVal: x.sobrVal, sisVal: x.sisVal, unidSis: x.unidSis }; })];
  }));

  // top de SKU (todas las tomas del rango, sumando los CD)
  const S = new Map();
  for (const l of L) {
    let s = S.get(l.sku);
    if (!s) S.set(l.sku, (s = { sku: l.sku, desc: l.desc, depto: l.depto, matriz: l.matriz, costo: l.costo, cds: new Set(), x: nuevo() }));
    s.cds.add(l.cd); acum(s.x, l);
  }
  const skus = [...S.values()].filter((s) => s.x.skusDif.size)
    .map((s) => { const c = cerrar(s.x); return { sku: s.sku, desc: s.desc, depto: s.depto, matriz: s.matriz, costo: s.costo, cds: [...s.cds].sort().join(', '),
      ubicaciones: c.ubicaciones, unidSis: c.unidSis, unidCont: c.unidCont, falt: c.falt, sobr: c.sobr, neto: c.neto, abs: c.abs, netoVal: c.netoVal, absVal: c.absVal }; });
  const top = (k) => [...skus].sort((a, b) => b[k] - a[k] || b.abs - a.abs).slice(0, TOP);
  const topNeg = [...skus].sort((a, b) => a.netoVal - b.netoVal || a.neto - b.neto).slice(0, TOP);

  // por conteo: cómo queda cada conteo y cuántas diferencias corrige el siguiente (misma ubicación y SKU)
  const C = lineas(resConteos.rows);
  const porLlave = new Map();
  for (const l of C) { const kk = `${l.cd}|${l.ubic}|${l.sku}`; if (!porLlave.has(kk)) porLlave.set(kk, new Map()); porLlave.get(kk).set(l.conteo, l); }
  const porConteo = [...agrupar(C, (l) => l.conteo)].sort((a, b) => a[0] - b[0]).map(([n, x]) => {
    let recontadas = 0, corregidas = 0;
    for (const l of C) {
      if (l.conteo !== n || !l.dif) continue;
      const sig = porLlave.get(`${l.cd}|${l.ubic}|${l.sku}`).get(n + 1);
      if (sig) { recontadas++; if (!sig.dif) corregidas++; }
    }
    return { conteo: n, ...cerrar(x), lineasDif: C.filter((l) => l.conteo === n && l.dif).length, recontadas, corregidas };
  });
  // por turno de ejecución (resultado final)
  const ORDEN_T = ['AM', 'PM', 'NOCHE'];
  const porTurno = [...agrupar(L, (l) => l.turno)].map(([v, x]) => ({ v, ...cerrar(x) }))
    .sort((a, b) => ((ORDEN_T.indexOf(a.v) + 1) || 9) - ((ORDEN_T.indexOf(b.v) + 1) || 9) || a.v.localeCompare(b.v));

  // match: por CD y SKU, el sobrante de unas ubicaciones cubre el faltante de otras (de mayor a mayor)
  const MS = new Map();
  for (const l of L) {
    if (!l.dif) continue;
    const kk = `${l.cd}|${l.sku}`;
    let m = MS.get(kk);
    if (!m) MS.set(kk, (m = { cd: l.cd, sku: l.sku, desc: l.desc, depto: l.depto, matriz: l.matriz, costo: l.costo, f: new Map(), s: new Map() }));
    const lado = l.dif < 0 ? m.f : m.s;
    lado.set(l.ubic, (lado.get(l.ubic) || 0) + Math.abs(l.dif));
  }
  const pares = [];
  for (const m of MS.values()) {
    if (!m.f.size || !m.s.size) continue;
    const F = [...m.f].map(([u, c]) => ({ u, c })).sort((a, b) => b.c - a.c), S = [...m.s].map(([u, c]) => ({ u, c })).sort((a, b) => b.c - a.c);
    const falt = F.reduce((a, x) => a + x.c, 0), sobr = S.reduce((a, x) => a + x.c, 0);
    const p = [];
    let i = 0, j = 0;
    while (i < F.length && j < S.length) {
      const c = Math.min(F[i].c, S[j].c);
      p.push({ desde: S[j].u, hacia: F[i].u, cant: c });
      F[i].c -= c; S[j].c -= c;
      if (!F[i].c) i++;
      if (!S[j].c) j++;
    }
    const comp = Math.min(falt, sobr), v = m.costo || 0;
    pares.push({ cd: m.cd, sku: m.sku, desc: m.desc, depto: m.depto, matriz: m.matriz, costo: m.costo, falt, sobr, comp, compVal: comp * v,
      cubre: comp >= falt ? 'Total' : 'Parcial', faltResto: falt - comp, sobrResto: sobr - comp, pares: p });
  }
  pares.sort((a, b) => b.compVal - a.compVal || b.comp - a.comp);
  const unid = pares.reduce((a, x) => a + x.comp, 0), val = pares.reduce((a, x) => a + x.compVal, 0);
  const match = {
    skus: pares.length, total: pares.filter((x) => x.cubre === 'Total').length, unid, val,
    // cada unidad compensada borra una de faltante y una de sobrante del absoluto
    absMatch: 2 * unid, absMatchVal: 2 * val, absReal: tot.abs - 2 * unid, absRealVal: tot.absVal - 2 * val,
    lista: pares.slice(0, TOP)
  };

  // matriz ABC / XYZ: dónde se concentra la diferencia
  const matriz = Object.fromEntries([...agrupar(L, (l) => l.matriz)].map(([k, x]) => [k, cerrar(x)]));

  return {
    hoy, desde, hasta, cd: cdF, periodo: per, cds: cds.rows.map((x) => x.cd), param,
    datos: rango.rows[0].filas ? rango.rows[0] : null,
    clasificacion: clas ? { metodo: clas.metodo, carga: clas.carga ? { archivo: clas.carga.archivo, fecha: clas.carga.fecha } : null, hayCosto: clas.hayCosto } : null, aviso,
    tot, comp, porCd, serie, evolucion, matriz, porConteo, porTurno, match,
    top: { abs: top('abs'), absVal: top('absVal'), neto: topNeg, total: skus.length }
  };
}
