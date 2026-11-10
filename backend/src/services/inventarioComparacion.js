// Toma de inventario oficial de Control de Existencia (CE) y su comparación con la toma de la operación.
// - Toma CE: una fila por ubicación y SKU con Teórico (sistema) y Físico (contado) del día de CE, con costo.
// - La operación cuenta la misma ubicación días antes (N días hábiles antes de la fecha de CE), así que entre una toma y
//   otra el sistema se mueve. Por ubicación de CE se busca la última toma de la operación dentro de la ventana (días antes
//   de la fecha de CE; si no hay, la primera hasta `despues` días después) y se cruzan los SKU de ambas.
// - La comparación es de diferencias (Físico − Teórico en CE contra Contado − Sistema en la operación): si son iguales, la
//   operación ya vio lo que encontró CE; el cambio del sistema entre ambas tomas (Teórico CE − Sistema op.) es el movimiento.
import { q, tx } from '../db.js';
import { txt, num, soloFecha } from '../import/excel.js';
import { addDias } from '../lib/turnos.js';
import { paramsInv } from './inventarioCe.js';

const LOTE = 5000;
const LIMITE = 5000;
const LIMITE_SKU = 3000;
const up = (v) => (txt(v) || '').toUpperCase();
const campo = (fila, ...claves) => {
  for (const c of claves) {
    if (c in fila) return fila[c];
    const k = Object.keys(fila).find((x) => x.startsWith(c));
    if (k) return fila[k];
  }
  return null;
};
// el SKU viene como número en un archivo y como texto (con ceros a la izquierda) en otro
const skuKey = (v) => up(v).replace(/^0+(?=.)/, '');
const entre = (a, b) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 864e5);
const vacia = (s) => !s || s === 'VACIA' || s === 'VACIO';

export const ESTADOS = {
  ok: 'Cuadran ambas',
  igual: 'Misma diferencia',
  ce: 'Diferencia solo en CE',
  op: 'Diferencia solo en la operación',
  distinta: 'Diferencias distintas',
  soloCe: 'SKU que la operación no contó',
  soloOp: 'SKU que CE no trae',
  sinOp: 'Sin toma de la operación'
};

/** Guarda la toma de CE: se reemplazan los días que trae el archivo. */
export async function guardarTomaCe(crudas, archivo) {
  const filas = [];
  let sinFecha = 0;
  for (const r of crudas) {
    const ubic = up(campo(r, 'UBICACION'));
    if (!ubic) continue;
    const fecha = soloFecha(campo(r, 'FECHA'));
    if (!fecha) { sinFecha++; continue; }
    const teorico = num(campo(r, 'TEORICO')), fisico = num(campo(r, 'FISICO'));
    filas.push({ fecha, ubicacion: ubic, sku: txt(campo(r, 'SKU')), descripcion: txt(campo(r, 'ELEMENTO_DESCRIPCION', 'ELEMENTO', 'DESCRIPCION')),
      costo: num(campo(r, 'COSTO')), teorico, fisico, diferencia: fisico - teorico, dif_costo: num(campo(r, 'DIF_COSTO', 'DIF_COST')),
      va: txt(campo(r, 'VA')), analisis: txt(campo(r, 'ANALISIS')), observacion: txt(campo(r, 'OBSERVACION')), cd: up(campo(r, 'CD')),
      zona: up(campo(r, 'ZONA')) || ubic.slice(0, 3), pasillo: up(campo(r, 'PASILLO')), seteo: txt(campo(r, 'SETEO')), seccion: txt(campo(r, 'SECCION')),
      depto: txt(campo(r, 'DEPTO')), sub_depto: txt(campo(r, 'SUB_DEPTO')), usuario: txt(campo(r, 'USUARIO')),
      semestre: txt(campo(r, 'SEMESTRE')), vuelta: txt(campo(r, 'VUELTA')), mes: txt(campo(r, 'MES')), semana: txt(campo(r, 'SEMANA')) });
  }
  if (!filas.length) throw Object.assign(new Error('El archivo de la toma de CE no trae filas con Fecha y Ubicación.'), { status: 400 });
  const fechas = [...new Set(filas.map((f) => f.fecha))].sort();
  const COLS = ['fecha', 'ubicacion', 'sku', 'descripcion', 'costo', 'teorico', 'fisico', 'diferencia', 'dif_costo', 'va', 'analisis', 'observacion', 'cd', 'zona',
    'pasillo', 'seteo', 'seccion', 'depto', 'sub_depto', 'usuario', 'semestre', 'vuelta', 'mes', 'semana'];
  const TIPO = { fecha: 'date', costo: 'numeric', teorico: 'numeric', fisico: 'numeric', diferencia: 'numeric', dif_costo: 'numeric' };
  let reemplazadas = 0;
  await tx(async (c) => {
    reemplazadas = (await c.query('DELETE FROM inv_ce_toma WHERE fecha = ANY($1::date[])', [fechas])).rowCount;
    const sql = `INSERT INTO inv_ce_toma (${COLS.join(', ')}, archivo) SELECT *, $${COLS.length + 1} FROM unnest(${COLS.map((k, i) => `$${i + 1}::${TIPO[k] || 'text'}[]`).join(', ')})`;
    for (let i = 0; i < filas.length; i += LOTE) {
      const lote = filas.slice(i, i + LOTE);
      await c.query(sql, [...COLS.map((k) => lote.map((f) => f[k])), archivo]);
    }
  });
  return { filas: filas.length, sinFecha, reemplazadas, desde: fechas[0], hasta: fechas[fechas.length - 1], ubicaciones: new Set(filas.map((f) => f.ubicacion)).size,
    dif: filas.reduce((s, f) => s + f.diferencia, 0) };
}

const nuevo = () => ({ L: [], ubic: new Set(), conOp: new Set(), lineas: 0, teo: 0, fis: 0, okCe: 0, sis: 0, cont: 0, okOp: 0, difCe: 0, absCe: 0, difCeC: 0, absCeC: 0, difOp: 0, absOp: 0,
  dias: 0, nDias: 0, est: Object.fromEntries(Object.keys(ESTADOS).map((k) => [k, 0])), ubicOkCe: new Map(), ubicOkOp: new Map() });
function acum(x, l) {
  x.ubic.add(l.ubicacion);
  x.L.push(l);
  if (l.fechaOp) x.conOp.add(l.ubicacion);
  x.lineas++; x.est[l.estado]++;
  if (l.enCe) {
    x.teo += l.teo; x.fis += l.fis; x.okCe += Math.min(l.teo, l.fis); x.difCe += l.difCe; x.absCe += Math.abs(l.difCe);
    x.difCeC += l.difCe * l.costo; x.absCeC += Math.abs(l.difCe * l.costo);
    x.ubicOkCe.set(l.ubicacion, (x.ubicOkCe.get(l.ubicacion) ?? true) && !l.difCe);
  }
  if (l.enOp) {
    x.sis += l.sis; x.cont += l.cont; x.okOp += Math.min(l.sis, l.cont); x.difOp += l.difOp; x.absOp += Math.abs(l.difOp);
    x.ubicOkOp.set(l.ubicacion, (x.ubicOkOp.get(l.ubicacion) ?? true) && !l.difOp);
  }
}
// ---------- medida: todo el módulo se mide en ubicaciones, SKU, líneas, unidades o valor ----------
export const MEDIDAS = ['ubic', 'sku', 'lineas', 'unid', 'valor'];
const ORDEN_EST = Object.keys(ESTADOS);
const comparar = (dCe, dOp) => (dCe === dOp ? (dCe ? 'igual' : 'ok') : !dOp ? 'ce' : !dCe ? 'op' : 'distinta');
const s0 = (l, f) => l.reduce((t, x) => t + f(x), 0);

/** Resultado de una ubicación: el de sus líneas con diferencia (si mezcla varios, Diferencias distintas). */
function estadoUbic(ls) {
  if (ls.every((l) => l.estado === 'sinOp')) return 'sinOp';
  const S = new Set(ls.map((l) => l.estado).filter((e) => e !== 'ok' && e !== 'sinOp'));
  if (!S.size) return 'ok';
  S.delete('igual');
  return !S.size ? 'igual' : S.size === 1 ? [...S][0] : 'distinta';
}
/** Resultado de un SKU con sus ubicaciones juntas: diferencia neta de CE contra la neta de la operación
 *  (solo en las ubicaciones que la operación contó). */
function estadoSku(ls) {
  const t = ls.filter((l) => l.estado !== 'sinOp');
  if (!t.length) return 'sinOp';
  const ce = t.filter((l) => l.enCe), op = t.filter((l) => l.enOp);
  if (!op.length) return 'soloCe';
  if (!ce.length) return 'soloOp';
  return comparar(s0(ce, (l) => l.difCe), s0(op, (l) => l.difOp));
}

/** Una medida sobre un conjunto de líneas: total, con toma op., resultado del cruce, exactitud y diferencias de CE y de la operación.
 *  Ubicaciones, SKU y líneas cuentan elementos (exactitud = % sin diferencia: ERU en ubicaciones; en SKU, con la diferencia neta);
 *  unidades y valor suman (exactitud = ERI: lo que el conteo confirma / lo registrado). */
function medir(L, medida, costoSku) {
  const est = Object.fromEntries(ORDEN_EST.map((k) => [k, 0]));
  const lado = () => ({ n: 0, ok: 0, conDif: 0, falt: 0, sobr: 0, base: 0, fis: 0, neto: 0, abs: 0 });
  const ce = lado(), op = lado();
  let total = 0, conOp = 0;
  if (medida === 'unid' || medida === 'valor') {
    const c = (l) => (medida === 'valor' ? l.costo || costoSku.get(skuKey(l.sku)) || 0 : 1);
    for (const l of L) {
      const k = c(l);
      if (l.enCe) {
        total += l.teo * k; if (l.fechaOp) conOp += l.teo * k;
        ce.n++; ce.base += l.teo * k; ce.fis += l.fis * k; ce.ok += Math.min(l.teo, l.fis) * k;
        const d = l.difCe * k; ce.neto += d; ce.abs += Math.abs(d); if (d < 0) ce.falt -= d; else ce.sobr += d;
      }
      if (l.enOp) {
        op.n++; op.base += l.sis * k; op.fis += l.cont * k; op.ok += Math.min(l.sis, l.cont) * k;
        const d = l.difOp * k; op.neto += d; op.abs += Math.abs(d); if (d < 0) op.falt -= d; else op.sobr += d;
      }
      // peso de la línea en el resultado del cruce: lo registrado o lo contado (lo mayor), para que un sobrante en 0 también pese
      est[l.estado] += (l.enCe ? Math.max(l.teo, l.fis) : Math.max(l.sis || 0, l.cont || 0)) * k;
    }
    const ex = (x) => (x.base ? x.ok / x.base : null);
    return { total, conOp, est, ce, op, exCe: ex(ce), exOp: ex(op) };
  }
  // elementos: cada línea, cada ubicación (fecha CE + ubicación) o cada SKU
  const grupos = new Map();
  for (const l of L) {
    const k = medida === 'lineas' ? grupos.size : medida === 'ubic' ? `${l.fechaCe}|${l.ubicacion}` : skuKey(l.sku);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(l);
  }
  const lado1 = (x, ls, dif, lineaOk) => {
    if (!ls.length) return;
    x.n++;
    const neto = s0(ls, dif);
    // en ubicaciones vale el ERU (todas sus líneas sin diferencia); en SKU, la diferencia neta de sus ubicaciones
    const ok = medida === 'ubic' ? ls.every(lineaOk) : !neto;
    if (ok) x.ok++; else { x.conDif++; if (neto < 0) x.falt++; else if (neto > 0) x.sobr++; }
  };
  for (const ls of grupos.values()) {
    total++;
    if (ls.some((l) => l.fechaOp)) conOp++;
    est[medida === 'lineas' ? ls[0].estado : medida === 'ubic' ? estadoUbic(ls) : estadoSku(ls)]++;
    lado1(ce, ls.filter((l) => l.enCe), (l) => l.difCe, (l) => !l.difCe);
    lado1(op, ls.filter((l) => l.enOp), (l) => l.difOp, (l) => !l.difOp);
  }
  return { total, conOp, est, ce, op, exCe: ce.n ? ce.ok / ce.n : null, exOp: op.n ? op.ok / op.n : null };
}

const cerrar = (x) => {
  const eru = (m) => (m.size ? [...m.values()].filter(Boolean).length / m.size : null);
  return { m: x.medir ? x.medir(x.L) : null, ubicaciones: x.ubic.size, conOp: x.conOp.size, lineas: x.lineas, teo: x.teo, fis: x.fis, sis: x.sis, cont: x.cont,
    difCe: x.difCe, absCe: x.absCe, difCeC: x.difCeC, absCeC: x.absCeC, difOp: x.difOp, absOp: x.absOp, est: x.est,
    eriCe: x.teo ? x.okCe / x.teo : null, eriOp: x.sis ? x.okOp / x.sis : null, eruCe: eru(x.ubicOkCe), eruOp: eru(x.ubicOkOp) };
};

/** desde / hasta: fechas de la toma de CE (por defecto, la última semana con toma de CE); zona (3 primeras letras);
 *  antes: días hacia atrás para buscar la toma de la operación (por defecto 10); despues: días hacia adelante si no hubo antes (0).
 *  ver (estado) y buscar (ubicación o SKU) filtran solo el detalle. */
export async function comparacionCe({ desde, hasta, zona, antes, despues, ver, buscar, medida } = {}) {
  const med = MEDIDAS.includes(medida) ? medida : 'ubic';
  const { cds: CDS } = await paramsInv();
  const rango = (await q('SELECT min(fecha)::text AS desde, max(fecha)::text AS hasta, count(*)::int AS filas FROM inv_ce_toma')).rows[0];
  hasta = soloFecha(hasta) || rango.hasta || null;
  desde = soloFecha(desde) || (hasta ? addDias(hasta, -6) : null);
  const nAntes = Number.isFinite(Number(antes)) && antes !== '' && antes !== undefined ? Math.max(0, Math.min(60, Math.round(Number(antes)))) : 10;
  const nDespues = Number.isFinite(Number(despues)) && despues !== '' && despues !== undefined ? Math.max(0, Math.min(30, Math.round(Number(despues)))) : 0;
  const base = { datos: rango.hasta ? rango : null, desde, hasta, antes: nAntes, despues: nDespues, estados: ESTADOS, medida: med };
  if (!hasta) return { ...base, zonas: [], tot: null, fechas: [], porZona: [], porPasillo: [], porSku: { total: 0, filas: [] }, detalle: [], totalDetalle: 0, cuenta: {} };
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const zonF = txt(zona) ? txt(zona).toUpperCase() : null;

  const [ce, zon] = await Promise.all([
    q(`SELECT fecha::text, ubicacion, coalesce(sku, '') AS sku, max(descripcion) AS descripcion, max(depto) AS depto, max(coalesce(costo, 0))::float AS costo,
         sum(teorico)::float AS teo, sum(fisico)::float AS fis, max(analisis) AS analisis, max(observacion) AS observacion, max(usuario) AS usuario, max(cd) AS cd
       FROM inv_ce_toma WHERE fecha BETWEEN $1 AND $2 AND ($3::text IS NULL OR left(ubicacion, 3) = $3)
       GROUP BY fecha, ubicacion, coalesce(sku, '')`, [desde, hasta, zonF]),
    q(`SELECT array_agg(DISTINCT left(ubicacion, 3) ORDER BY left(ubicacion, 3)) AS zonas FROM inv_ce_toma WHERE fecha BETWEEN $1 AND $2`, [desde, hasta])
  ]);
  const ubics = [...new Set(ce.rows.map((r) => r.ubicacion))];
  // toma de la operación de esas ubicaciones: por ubicación, SKU y día, el resultado final (la pasada más alta)
  const op = ubics.length ? (await q(`SELECT DISTINCT ON (cd, ubicacion, coalesce(sku, ''), fecha)
         cd, ubicacion, coalesce(sku, '') AS sku, fecha::text, coalesce(conteo, 1) AS conteo, coalesce(contado, 0)::float AS cont, coalesce(sistema, 0)::float AS sis, usuario
       FROM inv_resultado
       WHERE ubicacion = ANY($1::text[]) AND fecha BETWEEN $2 AND $3 AND cd = ANY($4::text[])
       ORDER BY cd, ubicacion, coalesce(sku, ''), fecha, coalesce(conteo, 1) DESC, f_mod DESC NULLS LAST, id DESC`,
  [ubics, addDias(desde, -nAntes), addDias(hasta, nDespues), CDS])).rows : [];
  // por ubicación: días con toma de la operación y sus líneas
  const opU = new Map();
  for (const r of op) {
    if (!opU.has(r.ubicacion)) opU.set(r.ubicacion, new Map());
    const d = opU.get(r.ubicacion);
    if (!d.has(r.fecha)) d.set(r.fecha, []);
    d.get(r.fecha).push(r);
  }
  const tomaOp = (ubic, fCe) => {
    const d = opU.get(ubic);
    if (!d) return null;
    const fs = [...d.keys()].sort();
    const previa = fs.filter((f) => f <= fCe && f >= addDias(fCe, -nAntes)).pop();
    const f = previa || fs.find((x) => x > fCe && x <= addDias(fCe, nDespues));
    return f ? { fecha: f, lineas: d.get(f) } : null;
  };

  // por ubicación y fecha de CE: cruce de SKU de ambas tomas
  const ceU = new Map();
  for (const r of ce.rows) {
    const k = `${r.fecha}|${r.ubicacion}`;
    if (!ceU.has(k)) ceU.set(k, []);
    ceU.get(k).push(r);
  }
  const L = [];
  for (const [k, filas] of ceU) {
    const [fCe, ubic] = k.split('|');
    const t = tomaOp(ubic, fCe);
    const opS = new Map();
    if (t) for (const o of t.lineas) {
      const s = skuKey(o.sku);
      if (vacia(s) && !o.cont && !o.sis) continue;
      const x = opS.get(s);
      if (x) { x.cont += o.cont; x.sis += o.sis; } else opS.set(s, { ...o });
    }
    const comun = { fechaCe: fCe, ubicacion: ubic, zona: ubic.slice(0, 3), pasillo: ubic.slice(0, 5), fechaOp: t?.fecha || null, dias: t ? entre(t.fecha, fCe) : null };
    for (const c of filas) {
      const s = skuKey(c.sku);
      const o = opS.get(s);
      opS.delete(s);
      const l = { ...comun, sku: c.sku, desc: c.descripcion, depto: c.depto, costo: c.costo, teo: c.teo, fis: c.fis, difCe: c.fis - c.teo, analisis: c.analisis, observacion: c.observacion,
        enCe: true, enOp: !!o, cdOp: o?.cd || null, sis: o?.sis ?? null, cont: o?.cont ?? null, difOp: o ? o.cont - o.sis : null, pasadas: o?.conteo ?? null };
      l.mov = o ? c.teo - o.sis : null;
      l.estado = !t ? 'sinOp' : !o ? 'soloCe' : l.difCe === l.difOp ? (l.difCe ? 'igual' : 'ok') : !l.difOp ? 'ce' : !l.difCe ? 'op' : 'distinta';
      L.push(l);
    }
    // SKU que la operación contó en la ubicación y CE no trae
    for (const o of opS.values()) {
      if (!o.cont && !o.sis) continue;
      L.push({ ...comun, sku: o.sku, desc: null, depto: null, costo: 0, teo: null, fis: null, difCe: null, enCe: false, enOp: true, cdOp: o.cd,
        sis: o.sis, cont: o.cont, difOp: o.cont - o.sis, pasadas: o.conteo, mov: null, estado: 'soloOp' });
    }
  }

  // costo por SKU (para valorizar los SKU que CE no trae en esa ubicación)
  const costoSku = new Map();
  for (const l of L) if (l.costo && !costoSku.has(skuKey(l.sku))) costoSku.set(skuKey(l.sku), l.costo);
  const medirCon = (ls) => medir(ls, med, costoSku);
  const nuevoM = () => Object.assign(nuevo(), { medir: medirCon });
  const tot = nuevoM(), porF = new Map(), porZ = new Map(), porP = new Map(), porS = new Map();
  for (const l of L) {
    acum(tot, l);
    if (!porF.has(l.fechaCe)) porF.set(l.fechaCe, nuevoM());
    acum(porF.get(l.fechaCe), l);
    if (!porZ.has(l.zona)) porZ.set(l.zona, nuevoM());
    acum(porZ.get(l.zona), l);
    // pasillo: los 5 primeros caracteres de la ubicación (como en el Calendario de planificación)
    if (!porP.has(l.pasillo)) porP.set(l.pasillo, nuevoM());
    acum(porP.get(l.pasillo), l);
    // SKU: todas sus ubicaciones juntas (la diferencia neta compensa faltantes y sobrantes entre ubicaciones)
    const ks = skuKey(l.sku);
    if (!porS.has(ks)) porS.set(ks, Object.assign(nuevoM(), { sku: l.sku, desc: null, depto: null }));
    const s = porS.get(ks);
    s.desc ||= l.desc; s.depto ||= l.depto;
    acum(s, l);
    if (l.dias !== null && l.enCe) { tot.dias += l.dias; tot.nDias++; }
  }
  // distribución de días entre la toma de la operación y la de CE (por ubicación)
  const diasU = new Map();
  for (const l of L) if (l.dias !== null) diasU.set(`${l.fechaCe}|${l.ubicacion}`, l.dias);
  const histDias = {};
  for (const d of diasU.values()) histDias[d] = (histDias[d] || 0) + 1;

  const cuenta = { todo: L.length };
  for (const l of L) cuenta[l.estado] = (cuenta[l.estado] || 0) + 1;
  const b = txt(buscar) ? txt(buscar).toUpperCase() : null;
  const VER = { dif: (l) => !['ok', 'sinOp'].includes(l.estado) };
  const sel = L.filter((l) => (!ver || ver === 'todo' || (VER[ver] ? VER[ver](l) : l.estado === ver)) && (!b || l.ubicacion.includes(b) || up(l.sku).includes(b)))
    // primero lo que más pesa en costo, luego la mayor diferencia en unidades
    .sort((a, c) => Math.abs((c.difCe || 0) * c.costo) - Math.abs((a.difCe || 0) * a.costo) || Math.abs(c.difCe ?? c.difOp ?? 0) - Math.abs(a.difCe ?? a.difOp ?? 0)
      || a.fechaCe.localeCompare(c.fechaCe) || a.ubicacion.localeCompare(c.ubicacion));

  return { ...base, desde, hasta, zonas: zon.rows[0].zonas || [],
    tot: { ...cerrar(tot), diasProm: tot.nDias ? tot.dias / tot.nDias : null, histDias },
    fechas: [...porF].sort(([a], [c]) => a.localeCompare(c)).map(([fecha, x]) => ({ fecha, ...cerrar(x) })),
    porZona: [...porZ].map(([zona, x]) => ({ zona, ...cerrar(x) })).sort((a, c) => c.absCeC - a.absCeC || a.zona.localeCompare(c.zona)),
    porSku: (() => {
      const l = [...porS.values()].map((x) => ({ sku: x.sku, desc: x.desc, depto: x.depto, ...cerrar(x) }))
        .sort((a, c) => c.absCeC - a.absCeC || c.absCe - a.absCe || c.absOp - a.absOp || String(a.sku).localeCompare(String(c.sku)));
      return { total: l.length, filas: l.slice(0, LIMITE_SKU) };
    })(),
    porPasillo: [...porP].map(([pasillo, x]) => ({ pasillo, ...cerrar(x) })).sort((a, c) => c.absCeC - a.absCeC || a.pasillo.localeCompare(c.pasillo)),
    cuenta, totalDetalle: sel.length, detalle: sel.slice(0, LIMITE) };
}

// ---------- precisión de la programación de CE (dashboard) ----------
// Cada ubicación programada se cruza con la toma real de CE (inv_ce_toma) más cercana a su fecha vigente (±30 días):
// en la fecha programada original, en la re-programada, adelantada, atrasada, no tomada (hay toma de CE cargada de su fecha
// vigente y la ubicación no está) o sin toma de CE cargada (aún no llega su fecha o no se cargó el archivo de ese día).
const lunes = (iso) => { const d = new Date(`${iso}T12:00:00`).getDay(); return addDias(iso, -((d + 6) % 7)); };
const PERIODOS = { dia: (f) => f, semana: lunes, mes: (f) => f.slice(0, 7) };
export const EST_PROG = {
  original: 'En la fecha programada',
  reprog: 'En la fecha re-programada',
  adelantada: 'Adelantada',
  atrasada: 'Atrasada',
  noTomada: 'No tomada',
  pendiente: 'Sin toma de CE cargada'
};
const VENTANA = 30;

/** desde / hasta: fechas programadas (originales); cd: CD de la operación; periodo: dia | semana | mes */
export async function precisionProgramacion({ desde, hasta, cd, periodo } = {}) {
  const per = PERIODOS[periodo] ? periodo : 'semana';
  const cdF = txt(cd) ? txt(cd).toUpperCase() : null;
  const rCe = (await q('SELECT min(fecha)::text AS desde, max(fecha)::text AS hasta, array_agg(DISTINCT fecha::text) AS dias FROM inv_ce_toma')).rows[0];
  const diasCe = new Set(rCe.dias || []);
  const base = { estados: EST_PROG, periodo: per, ce: rCe.hasta ? { desde: rCe.desde, hasta: rCe.hasta, dias: diasCe.size } : null };
  if (!rCe.hasta) return { ...base, tot: null };
  desde = soloFecha(desde); hasta = soloFecha(hasta);
  const [prog, tomas] = await Promise.all([
    q(`SELECT cd, ubicacion, left(ubicacion, 3) AS zona, coalesce(cd_op, '') AS cd_op, fecha_prog::text, fecha_reprog::text, fecha_ce::text, coalesce(excluida, false) AS excluida, coalesce(ajustada, false) AS ajustada
       FROM inv_programa WHERE ($1::date IS NULL OR fecha_prog >= $1) AND ($2::date IS NULL OR fecha_prog <= $2) AND ($3::text IS NULL OR upper(cd_op) = $3)`, [desde, hasta, cdF]),
    q(`SELECT DISTINCT ubicacion, fecha::text FROM inv_ce_toma WHERE ($1::date IS NULL OR fecha >= $1::date - ${VENTANA}) AND ($2::date IS NULL OR fecha <= $2::date + ${VENTANA * 2})`, [desde, hasta])
  ]);
  const tomU = new Map();
  for (const t of tomas.rows) { if (!tomU.has(t.ubicacion)) tomU.set(t.ubicacion, []); tomU.get(t.ubicacion).push(t.fecha); }
  const usadas = new Set();

  const L = [];
  let quitadas = 0;
  for (const p of prog.rows) {
    if (p.excluida) { quitadas++; continue; }
    const fs = (tomU.get(p.ubicacion) || []).filter((f) => Math.abs(entre(p.fecha_ce, f)) <= VENTANA);
    // la toma real: la más cercana a la fecha vigente
    const real = fs.sort((a, b) => Math.abs(entre(p.fecha_ce, a)) - Math.abs(entre(p.fecha_ce, b)) || a.localeCompare(b))[0] || null;
    if (real) usadas.add(`${p.ubicacion}|${real}`);
    const reprog = !!p.fecha_reprog && p.fecha_reprog !== p.fecha_prog;
    const estado = real
      ? (real === p.fecha_prog ? 'original' : real === p.fecha_ce ? 'reprog' : real < p.fecha_ce ? 'adelantada' : 'atrasada')
      : (diasCe.has(p.fecha_ce) ? 'noTomada' : 'pendiente');
    L.push({ ...p, real, reprog, estado, desfase: real ? entre(p.fecha_ce, real) : null, desfaseOrig: real ? entre(p.fecha_prog, real) : null, diasReprog: reprog ? entre(p.fecha_prog, p.fecha_reprog) : 0 });
  }

  const nuevoG = () => ({ prog: 0, reprog: 0, diasReprog: 0, evaluables: 0, tomadas: 0, enOrig: 0, enVig: 0, reprogEval: 0, reprogEnNueva: 0, est: Object.fromEntries(Object.keys(EST_PROG).map((k) => [k, 0])) });
  const sumar = (g, l) => {
    g.prog++; g.est[l.estado]++;
    if (l.reprog) { g.reprog++; g.diasReprog += Math.abs(l.diasReprog); }
    if (l.estado === 'pendiente') return;
    g.evaluables++;
    if (l.real) g.tomadas++;
    if (l.real === l.fecha_prog) g.enOrig++;
    if (l.real === l.fecha_ce) g.enVig++;
    if (l.reprog) { g.reprogEval++; if (l.real === l.fecha_ce) g.reprogEnNueva++; }
  };
  const cerrarG = (g) => ({ ...g, diasReprog: g.reprog ? g.diasReprog / g.reprog : null,
    accOrig: g.evaluables ? g.enOrig / g.evaluables : null,     // la toma real coincide con la programación original
    accVig: g.evaluables ? g.enVig / g.evaluables : null,       // coincide con la programación vigente (con re-programación)
    cumpl: g.evaluables ? g.tomadas / g.evaluables : null,      // se tomó, en cualquier fecha
    pReprog: g.prog ? g.reprog / g.prog : null, efReprog: g.reprogEval ? g.reprogEnNueva / g.reprogEval : null });

  const tot = nuevoG(), porP = new Map(), porZ = new Map();
  const desf = {};
  for (const l of L) {
    sumar(tot, l);
    const k = PERIODOS[per](l.fecha_prog);
    if (!porP.has(k)) porP.set(k, nuevoG());
    sumar(porP.get(k), l);
    if (!porZ.has(l.zona)) porZ.set(l.zona, nuevoG());
    sumar(porZ.get(l.zona), l);
    // desfase de la toma real contra la fecha vigente, en días (−3 o menos y +3 o más se agrupan)
    if (l.desfase !== null) { const d = Math.max(-3, Math.min(3, l.desfase)); desf[d] = (desf[d] || 0) + 1; }
  }
  // tomas de CE en el rango que no corresponden a ninguna ubicación programada
  const noProg = tomas.rows.filter((t) => (!desde || t.fecha >= desde) && (!hasta || t.fecha <= hasta) && !usadas.has(`${t.ubicacion}|${t.fecha}`)).length;

  return { ...base, desde, hasta, cd: cdF, quitadas, noProg,
    tot: cerrarG(tot), desfase: [-3, -2, -1, 0, 1, 2, 3].map((d) => ({ d, n: desf[d] || 0 })),
    serie: [...porP].sort(([a], [b]) => a.localeCompare(b)).map(([p, g]) => ({ p, ...cerrarG(g) })),
    porZona: [...porZ].map(([zona, g]) => ({ zona, ...cerrarG(g) })).sort((a, b) => b.prog - a.prog) };
}
