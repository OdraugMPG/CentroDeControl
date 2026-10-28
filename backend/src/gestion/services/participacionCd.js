// Participación de la venta por CD. El archivo de pedidos/despachos (SKU, QTY, DPTO, CD_PICKING, TIPO_PICKING,
// FECHA_SALIDA...) se agrega por día de salida, CD de picking, tipo de picking y SKU. La vista muestra unidades y %
// por CD y por depto, y simula qué SKU aptos para OSR que hoy no están en OSR hay que ingresar para llegar a un
// target de participación del OSR: al ingresar un SKU se supone que el OSR pasa a despachar toda su venta.
import XLSX from 'xlsx';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { q, tx } from '../db.js';
import { leerParametros } from './parametros.js';
import { baseSku, digitos, deptosPrioritarios, pctNum } from './abastecimientoOsr.js';
import { buscarCol } from '../engine/base.js';
import { txt, up, num, cmp, aIso, hoyIso, fmtFecha } from '../engine/util.js';
import { libro } from './tareas.js';

const AL = {
  sku: 'SKU|COD SKU|CODIGO SKU',
  desc: 'DESCRIPCION|DESC SKU|DESCRIPCION SKU',
  qty: 'QTY|CANTIDAD|UNIDADES',
  qtyPick: 'QTY_PICKING|QTY PICKING',
  dpto: 'DPTO|DEPTO|DEPARTAMENTO',
  cd: 'CD_PICKING|CD PICKING',
  facility: 'FACILITY',
  tipo: 'TIPO_PICKING|TIPO PICKING',
  estado: 'DESC_ESTADO|ESTADO',
  fecha: 'FECHA_SALIDA|FECHA SALIDA|FECHA_PICKING|FECHA_VENTA',
};
export const TIPOS_PICKING = ['TAREA', 'ETIQUETA'];
export const ESTADOS = { EN: 'YA EN OSR', CAND: 'APTO SIN OSR', NO: 'NO APTO OSR', SIN_STOCK: 'NO ESTÁ EN LA BASE', SIN_VAL: 'SIN VALIDAR (sin Base)' };
const LIMITE = 500;

const skuKey = (s) => txt(s).replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
const tipoDe = (s) => { const t = up(s); return t.includes('TAREA') ? 'TAREA' : t.includes('ETIQ') ? 'ETIQUETA' : t || '(SIN TIPO)'; };
const error = (m) => Object.assign(new Error(m), { status: 400 });

// ---------------------------------------------------------------------------------------------
// Carga del archivo: se reemplazan los días de venta que trae el archivo (se pueden ir sumando periodos)
// ---------------------------------------------------------------------------------------------
export async function cargarVentaCd(buffer, archivo) {
  const t = leerTabla(buffer);
  const { c } = t;
  const ag = new Map();
  let filas = 0, sinFecha = 0, anuladas = 0;
  for await (const r of t.filas()) {
    const sku = skuKey(r[c.sku]);
    if (!sku) continue;
    if (c.estado >= 0 && /CANCEL|ANULAD/.test(up(r[c.estado]))) { anuladas++; continue; }
    // con QTY_PICKING se cuenta solo lo pickeado (igual que la tabla dinámica "Suma de QTY_PICKING")
    const u = c.qtyPick >= 0 ? num(r[c.qtyPick]) : num(r[c.qty]);
    if (!(u > 0)) continue;
    const cd = (c.cd >= 0 ? up(r[c.cd]) : up(r[c.facility])) || '(SIN CD)';
    const tipo = c.tipo >= 0 ? tipoDe(r[c.tipo]) : '(SIN TIPO)';
    const fecha = c.fecha >= 0 ? aIso(r[c.fecha]) : null;
    if (!fecha) sinFecha++;
    const k = `${fecha}|${cd}|${tipo}|${sku}`;
    let x = ag.get(k);
    if (!x) ag.set(k, x = { fecha, cd, tipo, sku, dpto: c.dpto >= 0 ? txt(r[c.dpto]) : '', desc: c.desc >= 0 ? txt(r[c.desc]) : '', u: 0, l: 0 });
    x.u += u; x.l++;
    filas++;
  }
  if (!filas) throw error('El archivo no tiene líneas con SKU y unidades pickeadas.');
  const regs = [...ag.values()];
  const fechas = [...new Set(regs.map((x) => x.fecha).filter(Boolean))].sort();
  await tx(async (cn) => {
    await cn.query('DELETE FROM venta_cd WHERE fecha = ANY($1::date[])', [fechas]);
    if (sinFecha) await cn.query('DELETE FROM venta_cd WHERE fecha IS NULL');
    for (let i = 0; i < regs.length; i += 5000) {
      const l = regs.slice(i, i + 5000);
      await cn.query(`INSERT INTO venta_cd (fecha, cd, tipo, sku, dpto, descripcion, unidades, lineas)
        SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::numeric[], $8::int[])`,
      [l.map((x) => x.fecha), l.map((x) => x.cd), l.map((x) => x.tipo), l.map((x) => x.sku), l.map((x) => x.dpto), l.map((x) => x.desc), l.map((x) => x.u), l.map((x) => x.l)]);
    }
  });
  return { archivo, hoja: t.hoja, filas, anuladas, registros: regs.length, desde: fechas[0] || null, hasta: fechas[fechas.length - 1] || null, dias: fechas.length, sinFecha,
    unidades: c.qtyPick >= 0 ? 'QTY_PICKING' : 'QTY', fecha: t.enc[c.fecha] || '', tipos: [...new Set(regs.map((x) => x.tipo))].sort(cmp) };
}

const columnas = (enc) => Object.fromEntries(Object.entries(AL).map(([k, a]) => [k, buscarCol(enc, a)]));
const reconoce = (c) => c.sku >= 0 && (c.qty >= 0 || c.qtyPick >= 0) && (c.cd >= 0 || c.facility >= 0);

/** Detalle del archivo: una hoja con encabezados o, si el libro solo trae una tabla dinámica, su caché de registros. */
function leerTabla(buffer) {
  const zip = entradasZip(buffer);
  const rec = zip && [...zip.values()].find((e) => /pivotCacheRecords\d*\.xml$/.test(e.nombre));
  const hojas = zip ? [...zip.values()].filter((e) => /worksheets\/sheet\d*\.xml$/.test(e.nombre)).reduce((s, e) => s + e.tam, 0) : Infinity;
  // Libro de solo tabla dinámica: no se abre con XLSX (descomprimiría la caché completa en memoria)
  if (rec && rec.tam > hojas * 4) {
    const t = cachePivot(buffer, zip);
    if (t && reconoce(t.c)) return t;
  }
  const wb = XLSX.read(buffer, { type: 'buffer', dense: true });
  for (const n of wb.SheetNames) {
    const m = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
    for (let i = 0; i < Math.min(10, m.length); i++) {
      const c = columnas(m[i]);
      if (reconoce(c)) return { hoja: n, enc: m[i], c, filas: () => m.slice(i + 1) };
    }
  }
  const t = rec ? cachePivot(buffer, zip) : null;
  if (t && reconoce(t.c)) return t;
  const vistos = t?.enc?.length ? ` Columnas de la tabla dinámica: ${t.enc.join(', ')}.` : '';
  throw error(`No reconocí los encabezados: el archivo debe traer SKU, QTY (o QTY_PICKING) y CD_PICKING (o FACILITY), en una hoja o como origen de una tabla dinámica.${vistos}`);
}

/** Directorio de un .xlsx (zip): nombre → { método, tamaño comprimido / descomprimido, inicio de los datos }. null si no es zip. */
function entradasZip(b) {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const n = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const m = new Map();
  for (let k = 0; k < n && b.readUInt32LE(p) === 0x02014b50; k++) {
    const lNom = b.readUInt16LE(p + 28), lExt = b.readUInt16LE(p + 30), lCom = b.readUInt16LE(p + 32);
    const nombre = b.toString('utf8', p + 46, p + 46 + lNom);
    const local = b.readUInt32LE(p + 42);
    const ini = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    m.set(nombre, { nombre, metodo: b.readUInt16LE(p + 10), comp: b.readUInt32LE(p + 20), tam: b.readUInt32LE(p + 24), ini });
    p += 46 + lNom + lExt + lCom;
  }
  return m;
}
const crudo = (b, e) => b.subarray(e.ini, e.ini + e.comp);
const inflar = (b, e) => (e.metodo === 8 ? zlib.inflateRawSync(crudo(b, e)) : crudo(b, e));

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const desXml = (s) => (s.includes('&') ? s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENT[e] ?? m)) : s);
const valXml = (tag, v) => (tag === 'm' ? '' : tag === 'n' ? Number(v) : desXml(v ?? ''));

/** Lee pivotCacheDefinition / pivotCacheRecords (xlsx) por partes: solo se llenan las columnas que usa el módulo. */
function cachePivot(buffer, zip) {
  const def = [...zip.values()].find((e) => /pivotCacheDefinition\d*\.xml$/.test(e.nombre));
  const rec = [...zip.values()].find((e) => /pivotCacheRecords\d*\.xml$/.test(e.nombre));
  if (!def || !rec) return null;
  const xml = inflar(buffer, def).toString('utf8');
  const campos = [...xml.matchAll(/<cacheField\b[^>]*\bname="([^"]*)"[^>]*?(?:\/>|>([^]*?)<\/cacheField>)/g)].map((m) => {
    const sh = (m[2] || '').match(/<sharedItems\b[^>]*>([^]*?)<\/sharedItems>/);
    return { nom: desXml(m[1]), items: sh ? [...sh[1].matchAll(/<(\w)(?:\s+v="([^"]*)")?\s*\/>/g)].map((x) => valXml(x[1], x[2])) : [] };
  });
  const enc = campos.map((x) => x.nom);
  const c = columnas(enc);
  if (!reconoce(c)) return { enc, c };
  c.estado = buscarCol(enc, 'DESC_ESTADO');
  const usar = new Set(Object.values(c).filter((j) => j >= 0));
  const fila = (txtR) => {
    const r = new Array(enc.length);
    let j = 0;
    for (const v of txtR.matchAll(/<(\w)(?:\s+v="([^"]*)")?\s*\/>/g)) {
      if (usar.has(j)) r[j] = v[1] === 'x' ? campos[j].items[Number(v[2])] : valXml(v[1], v[2]);
      j++;
    }
    return r;
  };
  async function* filas() {
    const fuente = Readable.from([crudo(buffer, rec)]);
    const flujo = rec.metodo === 8 ? fuente.pipe(zlib.createInflateRaw()) : fuente;
    let resto = Buffer.alloc(0);
    for await (const trozo of flujo) {
      const b = resto.length ? Buffer.concat([resto, trozo]) : trozo;
      const k = b.lastIndexOf('</r>');
      if (k < 0) { resto = b; continue; }
      resto = Buffer.from(b.subarray(k + 4));
      for (const m of b.toString('utf8', 0, k + 4).matchAll(/<r>([^]*?)<\/r>/g)) yield fila(m[1]);
    }
  }
  return { hoja: 'tabla dinámica (caché)', enc, c, filas };
}

export async function borrarVentaCd() {
  const r = await q('DELETE FROM venta_cd');
  return { eliminadas: r.rowCount };
}

async function infoCarga() {
  const { rows } = await q(`SELECT min(fecha)::text AS desde, max(fecha)::text AS hasta, count(DISTINCT fecha)::int AS dias, count(*)::int AS registros,
    coalesce(sum(unidades), 0)::float8 AS unidades, coalesce(array_agg(DISTINCT tipo), '{}') AS tipos, coalesce(array_agg(DISTINCT cd ORDER BY cd), '{}') AS cds FROM venta_cd`);
  return rows[0];
}

// ---------------------------------------------------------------------------------------------
// Participación y simulación del target
// ---------------------------------------------------------------------------------------------
/** Greedy: SKU candidatos de mayor venta en otros CD primero, hasta cubrir lo que falta para el target. */
function simular(lista, target) {
  let u = 0, obj = 0, potCand = 0, potNo = 0, potEn = 0;
  for (const x of lista) {
    u += x.u; obj += x.uObj;
    if (x.cand) potCand += x.otros; else if (x.estado === ESTADOS.NO) potNo += x.otros; else if (x.estado === ESTADOS.EN) potEn += x.otros;
  }
  const brecha = Math.max(0, target * u - obj);
  const sel = [];
  let cub = 0;
  if (brecha > 0) {
    for (const x of lista.filter((y) => y.cand).sort((a, b) => b.otros - a.otros)) {
      if (cub >= brecha - 1e-9) break;
      cub += x.otros; sel.push(x);
    }
  }
  const p = (v) => (u ? v / u : 0);
  return { u, obj, pct: p(obj), brecha, sel, nSel: sel.length, cub, pctRes: p(obj + cub), alcanza: cub >= brecha - 1e-9,
    potCand, pctMax: p(obj + potCand), potNo, pctMaxNo: p(obj + potCand + potNo), potEn };
}

async function calcular(params = {}) {
  const p = await leerParametros();
  const info = await infoCarga();
  const target = params.target !== undefined && params.target !== '' && params.target !== null ? pctNum(params.target) : pctNum(p.partTargetOsr);
  const tipo = TIPOS_PICKING.includes(up(params.tipo)) ? up(params.tipo) : up(params.tipo) === 'TODOS' ? 'TODOS' : 'TAREA';
  const modo = params.modo === 'depto' ? 'depto' : 'total';
  const excluir = (Array.isArray(params.excluir) ? params.excluir : txt(params.excluir).split(',')).map(up).filter(Boolean);
  const base0 = { info, target, tipo, modo, tipos: info.tipos, excluir };
  if (!info.registros) return { ...base0, sinDatos: true };

  const cond = [], val = [];
  if (tipo !== 'TODOS') { val.push(tipo); cond.push(`tipo = $${val.length}`); }
  if (params.desde) { val.push(params.desde); cond.push(`fecha >= $${val.length}`); }
  if (params.hasta) { val.push(params.hasta); cond.push(`fecha <= $${val.length}`); }
  if (excluir.length) { val.push(excluir); cond.push(`NOT (cd = ANY($${val.length}::text[]))`); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const { rows } = await q(`SELECT cd, sku, max(dpto) AS dpto, max(descripcion) AS descripcion, sum(unidades)::float8 AS u, sum(lineas)::int AS l
    FROM venta_cd ${where} GROUP BY cd, sku`, val);

  const totCd = new Map();
  for (const r of rows) totCd.set(r.cd, (totCd.get(r.cd) || 0) + r.u);
  const cds = [...totCd.keys()].sort((a, b) => totCd.get(b) - totCd.get(a));
  const osrPar = up(p.cdOsr);
  const cdObj = cds.includes(up(params.cd)) ? up(params.cd) : cds.includes(osrPar) ? osrPar : cds[0] || osrPar;

  // Base de stock: Logística OSR, stock en OSR y fuera, clase ABC-XYZ y nombre del depto
  let base = null;
  try { base = await baseSku(); } catch { /* sin Base cargada: los SKU quedan sin validar */ }
  const bMap = new Map((base?.skus || []).map((x) => [skuKey(x.sku), x]));
  const listaOSR = deptosPrioritarios(p.deptosOsr);

  const sk = new Map();
  for (const r of rows) {
    let x = sk.get(r.sku);
    if (!x) sk.set(r.sku, x = { sku: r.sku, desc: r.descripcion || '', dptoArch: r.dpto || '', u: 0, uObj: 0, l: 0, porCd: {} });
    x.u += r.u; x.l += r.l;
    x.porCd[r.cd] = (x.porCd[r.cd] || 0) + r.u;
    if (r.cd === cdObj) x.uObj += r.u;
  }
  const nomDep = new Map();
  let skus = [...sk.values()];
  for (const x of skus) {
    const b = bMap.get(x.sku);
    x.b = b;
    if (!x.desc && b) x.desc = b.desc;
    x.cod = digitos(x.dptoArch) || (b ? b.cod : '');
    x.dkey = x.cod || up(x.dptoArch) || '(SIN DEPTO)';
    if (b && !nomDep.has(x.dkey)) nomDep.set(x.dkey, b.depto);
    x.enLista = listaOSR.has(x.cod);
    x.otros = x.u - x.uObj;
    x.estado = x.uObj > 0 || (b && b.osr > 0) ? ESTADOS.EN : !base ? ESTADOS.SIN_VAL : !b ? ESTADOS.SIN_STOCK : b.log === 'Y' ? ESTADOS.CAND : ESTADOS.NO;
    x.cand = x.otros > 0 && (x.estado === ESTADOS.CAND || x.estado === ESTADOS.SIN_VAL);
    let cdP = '', uP = 0;
    for (const [cd, v] of Object.entries(x.porCd)) if (cd !== cdObj && v > uP) { cdP = cd; uP = v; }
    x.cdPrincipal = cdP;
  }
  const nomDe = (k, x) => nomDep.get(k) || x?.dptoArch || k;
  if (params.soloOsr) skus = skus.filter((x) => x.enLista);
  const deptosTodos = skus;
  if (params.depto) skus = skus.filter((x) => x.dkey === params.depto);

  // Por CD
  const total = { u: 0, l: 0, skus: skus.length };
  const porCdM = new Map();
  for (const x of skus) {
    total.u += x.u; total.l += x.l;
    for (const [cd, v] of Object.entries(x.porCd)) {
      let c = porCdM.get(cd);
      if (!c) porCdM.set(cd, c = { cd, u: 0, skus: 0 });
      c.u += v; c.skus++;
    }
  }
  const porCd = [...porCdM.values()].map((c) => ({ ...c, pct: total.u ? c.u / total.u : 0, obj: c.cd === cdObj })).sort((a, b) => b.u - a.u);
  const cdsCol = porCd.map((c) => c.cd);

  // Por depto (siempre todos los deptos, para poder elegir uno)
  const dM = new Map();
  for (const x of deptosTodos) {
    let d = dM.get(x.dkey);
    if (!d) dM.set(x.dkey, d = { key: x.dkey, cod: x.cod, nom: nomDe(x.dkey, x), enLista: x.enLista, skus: [], porCd: {} });
    d.skus.push(x);
    for (const [cd, v] of Object.entries(x.porCd)) d.porCd[cd] = (d.porCd[cd] || 0) + v;
  }
  const deptos = [...dM.values()].map((d) => {
    const s = simular(d.skus, target);
    return { key: d.key, cod: d.cod, nom: d.nom, enLista: d.enLista, porCd: d.porCd, nSkus: d.skus.length, ...s,
      nCand: d.skus.filter((x) => x.cand).length, sel: s.sel };
  }).sort((a, b) => b.u - a.u);

  // Simulación del alcance elegido
  const sim = simular(skus, target);
  if (modo === 'depto') {
    const sel = deptos.filter((d) => !params.depto || d.key === params.depto).flatMap((d) => d.sel).sort((a, b) => b.otros - a.otros);
    sim.sel = sel; sim.nSel = sel.length; sim.cub = sel.reduce((s, x) => s + x.otros, 0);
    sim.pctRes = sim.u ? (sim.obj + sim.cub) / sim.u : 0; sim.alcanza = sim.cub >= sim.brecha - 1e-9;
  }
  let acum = sim.obj;
  for (const x of sim.sel) { acum += x.otros; x.acum = acum; x.pctAcum = sim.u ? acum / sim.u : 0; }
  const selSet = new Set(sim.sel.map((x) => x.sku));

  const estM = new Map();
  for (const x of skus) {
    if (!(x.otros > 0)) continue;
    let e = estM.get(x.estado);
    if (!e) estM.set(x.estado, e = { estado: x.estado, skus: 0, u: 0 });
    e.skus++; e.u += x.otros;
  }
  const estados = Object.values(ESTADOS).filter((e) => estM.has(e)).map((e) => estM.get(e));

  // Participación diaria del CD objetivo (mismos filtros de depto)
  const dptos = params.depto || params.soloOsr ? [...new Set(skus.map((x) => x.dptoArch))] : null;
  const valD = [...val];
  let whereD = where;
  if (dptos) { valD.push(dptos); whereD += (whereD ? ' AND ' : 'WHERE ') + `dpto = ANY($${valD.length}::text[])`; }
  const { rows: dia } = await q(`SELECT fecha::text AS fecha, cd, sum(unidades)::float8 AS u FROM venta_cd ${whereD} GROUP BY fecha, cd ORDER BY fecha`, valD);
  const diaM = new Map();
  for (const r of dia) {
    const k = r.fecha || '(sin fecha)';
    let d = diaM.get(k);
    if (!d) diaM.set(k, d = { fecha: r.fecha, u: 0, porCd: {} });
    d.u += r.u; d.porCd[r.cd] = (d.porCd[r.cd] || 0) + r.u;
  }
  const porDia = [...diaM.values()].map((d) => ({ ...d, pct: d.u ? (d.porCd[cdObj] || 0) / d.u : 0 }));

  return { ...base0, cds, cdObj, cdsCol, hayBase: !!base, baseCarga: base?.carga ? { fecha: base.carga.fecha, archivo: base.carga.archivo } : null,
    hayColOsr: base ? base.hayCol : null, listaOSR: p.deptosOsr, total, porCd, deptos, sim, estados, porDia, skus, selSet };
}

const filaSku = (x) => ({ sku: x.sku, desc: x.desc, depto: x.dkey, cod: x.cod, matriz: x.b?.matriz || '', u: x.u, otros: x.otros, uObj: x.uObj, cdPrincipal: x.cdPrincipal,
  estado: x.estado, log: x.b?.log || '', stockFuera: x.b ? x.b.fuera : null, stockOsr: x.b ? x.b.osr : null, acum: x.acum, pctAcum: x.pctAcum });

export async function participacion(params = {}) {
  const d = await calcular(params);
  if (d.sinDatos) return d;
  const { skus, selSet, sim, deptos, ...r } = d;
  const nomDep = new Map(deptos.map((x) => [x.key, x.nom]));
  const est = params.estado || ESTADOS.CAND;
  const lista = skus.filter((x) => x.otros > 0 && x.estado === est).sort((a, b) => b.otros - a.otros);
  const conNom = (x) => ({ ...filaSku(x), deptoNom: nomDep.get(x.dkey) || x.dkey, sel: selSet.has(x.sku) });
  return {
    ...r,
    sim: { ...sim, sel: undefined },
    deptos: deptos.map(({ sel, ...x }) => x),
    seleccion: sim.sel.slice(0, LIMITE).map(conNom),
    estado: est, nLista: lista.length, lista: lista.slice(0, LIMITE).map(conNom),
  };
}

// ---------------------------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------------------------
export async function archivoParticipacion(params = {}) {
  const d = await calcular(params);
  if (d.sinDatos) throw error('Carga primero el archivo de venta por CD.');
  const { cdObj, target, sim, porCd, deptos, cdsCol, total } = d;
  const nomDep = new Map(deptos.map((x) => [x.key, x.nom]));
  const r1 = (x) => Math.round(x * 10000) / 10000;
  const periodo = `${fmtFecha(params.desde || d.info.desde)} al ${fmtFecha(params.hasta || d.info.hasta)}`;
  const resumen = [
    [`PARTICIPACIÓN DE LA VENTA POR CD · picking ${d.tipo === 'TODOS' ? 'TAREA + ETIQUETA' : d.tipo} · ${periodo}`],
    [`CDs considerados: ${d.cds.join(', ')}`],
    [`CD objetivo: ${cdObj}   ·   Target: ${r1(target * 100)}%   ·   Cómo se cumple: ${d.modo === 'depto' ? 'en cada depto' : 'en el total'}${params.depto ? `   ·   Depto: ${nomDep.get(params.depto) || params.depto}` : ''}${params.soloOsr ? '   ·   Solo deptos OSR' : ''}`],
    [],
    ['Unidades', total.u], [`Unidades ${cdObj}`, sim.obj], [`% ${cdObj} hoy`, r1(sim.pct)], ['Unidades que faltan para el target', Math.round(sim.brecha)],
    ['SKU aptos sin OSR a ingresar', sim.nSel], ['Unidades que cubren', sim.cub], [`% ${cdObj} con el ingreso`, r1(sim.pctRes)],
    ['% máximo con todos los aptos sin OSR', r1(sim.pctMax)], ['% máximo habilitando además los no aptos', r1(sim.pctMaxNo)],
    [],
    ['CD', 'Unidades', '% participación', 'SKU'],
    ...porCd.map((c) => [c.cd, c.u, r1(c.pct), c.skus]),
    ['TOTAL', total.u, 1, total.skus],
  ];
  const dep = [
    ['Cod. depto', 'Depto', 'Lista OSR', 'Unidades', ...cdsCol.map((c) => `Unid. ${c}`), ...cdsCol.map((c) => `% ${c}`), 'SKU', 'Unid. faltan para target',
      'SKU aptos sin OSR', 'SKU a ingresar', 'Unid. que cubren', `% ${cdObj} con ingreso`, '% máximo aptos', '% máximo con no aptos'],
    ...deptos.map((x) => [x.cod, x.nom, x.enLista ? 'SI' : 'NO', x.u, ...cdsCol.map((c) => x.porCd[c] || 0), ...cdsCol.map((c) => r1(x.u ? (x.porCd[c] || 0) / x.u : 0)),
      x.nSkus, Math.round(x.brecha), x.nCand, x.nSel, x.cub, r1(x.pctRes), r1(x.pctMax), r1(x.pctMaxNo)]),
  ];
  const encSku = ['SKU', 'Descripción', 'Cod. depto', 'Depto', 'Clase', 'Unid. vendidas', `Unid. ${cdObj}`, 'Unid. otros CD', 'CD principal', 'Estado', 'Logística OSR', `Stock ${cdObj}`, `Stock fuera ${cdObj}`];
  const fila = (x) => [x.sku, x.desc, x.cod, nomDep.get(x.dkey) || x.dkey, x.b?.matriz || '', x.u, x.uObj, x.otros, x.cdPrincipal, x.estado, x.b?.log || '', x.b ? x.b.osr : '', x.b ? x.b.fuera : ''];
  const sel = [[...encSku, 'Acumulado', `% ${cdObj} acumulado`], ...sim.sel.map((x) => [...fila(x), x.acum, r1(x.pctAcum)])];
  const otros = [[...encSku, 'Seleccionado'], ...d.skus.filter((x) => x.otros > 0).sort((a, b) => b.otros - a.otros).map((x) => [...fila(x), d.selSet.has(x.sku) ? 'SI' : ''])];
  const dia = [['Fecha salida', 'Unidades', ...cdsCol.map((c) => `Unid. ${c}`), `% ${cdObj}`], ...d.porDia.map((x) => [x.fecha, x.u, ...cdsCol.map((c) => x.porCd[c] || 0), r1(x.pct)])];
  const anchos = [12, 40, 9, 26, 7, 11, 11, 11, 12, 22, 12, 11, 12, 11, 11];
  return {
    buffer: libro([['Resumen', resumen, [34, 14, 14, 10]], ['Deptos', dep, [9, 30, 9, 11]], ['SKU a ingresar', sel, anchos], ['SKU venta otros CD', otros, anchos], ['Por dia', dia, [12, 11]]]),
    nombre: `Participacion_CD_${d.tipo}_${hoyIso()}.xlsx`,
  };
}
