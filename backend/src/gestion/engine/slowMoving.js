// Slow moving (port de mod8_SlowMoving): VENTAS > 0 = ACTIVO; sin venta, el tramo sale de los días desde
// FECHA_ULT_ALMACENAMIENTO. Valor = Qty x COSTO (costo unitario).
import { up, cmp, diaNum, isoDeDia } from './util.js';

export const TEMPORADAS = { I: 'I - INVIERNO', V: 'V - VERANO', T: 'T - TODA TEMPORADA' };
export const nomTemporada = (s) => TEMPORADAS[up(s)] || (s ? String(s).trim() : '(sin temporada)');

export function tramo(dias, t) {
  if (dias === null || dias < 0) return 5;
  if (dias <= t[0]) return 1;
  if (dias <= t[1]) return 2;
  if (dias <= t[2]) return 3;
  return 4;
}
export function nomTramo(tr, t) {
  return [null, `ACTIVO (0-${t[0]} d)`, `LENTO (${t[0] + 1}-${t[1]} d)`, `MUY LENTO (${t[1] + 1}-${t[2]} d)`, `SIN MOVIMIENTO (> ${t[2]} d)`, 'SIN DATO'][tr];
}

/** Detalle por CD x SKU (equivale a SlowMoving_Detalle). */
export function detalleSlowMoving(filas, { corte, tramos }) {
  const corteN = diaNum(corte);
  const idx = new Map();
  const locN = new Map();
  const vistos = new Set();
  const det = [];
  let hayVentas = false, hayCosto = false;
  for (const r of filas) {
    if (!r.sku || !r.cd || !(r.qty > 0)) continue;
    const k = r.cd + '|' + r.sku;
    let x = idx.get(k);
    if (!x) {
      x = { cd: r.cd, sku: r.sku, desc: r.desc, depto: r.depto || '(sin depto)', temporada: nomTemporada(r.temp), uni: 0, ventas: 0, dias: null, valor: 0, ubic: [], filas: [], pisos: new Set(), zonas: new Set() };
      idx.set(k, x); det.push(x);
    }
    x.uni += r.qty;
    x.filas.push({ ubic: r.ubic, qty: r.qty, piso: r.piso, zp: r.zp });
    if (!vistos.has('L|' + r.cd + '|' + r.ubic + '|' + r.sku)) { vistos.add('L|' + r.cd + '|' + r.ubic + '|' + r.sku); locN.set(r.cd + '|' + r.ubic, (locN.get(r.cd + '|' + r.ubic) || 0) + 1); }
    if (!x.ubic.includes(r.ubic)) x.ubic.push(r.ubic);
    x.pisos.add(r.piso); x.zonas.add(r.zp);
    let d = null;
    if (r.falm) d = corteN - diaNum(r.falm);
    else if (r.dias !== null && r.dias !== undefined) d = r.dias;
    if (d !== null && d >= 0 && (x.dias === null || d < x.dias)) x.dias = d;
    if (r.ventas !== null && r.ventas !== undefined) { hayVentas = true; if (r.ventas > x.ventas) x.ventas = r.ventas; }
    if (r.costo !== null && r.costo !== undefined) { hayCosto = true; x.valor += r.costo * r.qty; }
  }
  for (const x of det) {
    x.libera = x.ubic.filter((u) => locN.get(x.cd + '|' + u) === 1).length;
    x.nUb = x.ubic.length;
    x.nPisos = x.pisos.size; x.nZonas = x.zonas.size;
    delete x.pisos; delete x.zonas;
    x.tramo = hayVentas && x.ventas > 0 ? 1 : tramo(x.dias, tramos);
    x.tramoNom = nomTramo(x.tramo, tramos);
    x.fechaAlm = x.dias === null ? null : isoDeDia(corteN - x.dias);
    x.mes = x.fechaAlm ? x.fechaAlm.slice(0, 7) : '(sin fecha)';
  }
  det.sort((a, b) => cmp(a.cd, b.cd) || b.valor - a.valor);
  return { detalle: det, hayVentas, hayCosto };
}

/** Criterio numérico: {min, max} o '=0' / '>0'. */
function pasaNum(c, v) {
  if (!c || c === '*' || c === '') return true;
  if (c === '=0' || c === '0') return v === 0;
  if (c === '>0') return v > 0;
  if (typeof c === 'object') return (c.min === null || c.min === undefined || c.min === '' || v >= Number(c.min)) && (c.max === null || c.max === undefined || c.max === '' || v <= Number(c.max));
  return true;
}
const pasaLista = (lista, v) => !lista || !lista.length || lista.includes(v);

export function simular(detalle, f = {}) {
  const sel = detalle.filter((x) => pasaLista(f.cds, x.cd) && pasaLista(f.deptos, x.depto) && pasaLista(f.temporadas, x.temporada) && pasaLista(f.meses, x.mes)
    && pasaLista(f.tramos, x.tramo) && pasaNum(f.unidades, x.uni) && pasaNum(f.ventas, x.ventas));
  const porCD = new Map();
  for (const x of sel) {
    const r = porCD.get(x.cd) || { cd: x.cd, skus: 0, unidades: 0, valor: 0, ubicaciones: 0, libera: 0 };
    r.skus++; r.unidades += x.uni; r.valor += x.valor; r.ubicaciones += x.nUb; r.libera += x.libera;
    porCD.set(x.cd, r);
  }
  const tot = [...porCD.values()].reduce((a, r) => ({ skus: a.skus + r.skus, unidades: a.unidades + r.unidades, valor: a.valor + r.valor, ubicaciones: a.ubicaciones + r.ubicaciones, libera: a.libera + r.libera }), { skus: 0, unidades: 0, valor: 0, ubicaciones: 0, libera: 0 });
  sel.sort((a, b) => cmp(a.mes, b.mes) || cmp(a.cd, b.cd) || b.valor - a.valor);
  return { total: tot, porCD: [...porCD.values()].sort((a, b) => cmp(a.cd, b.cd)), seleccion: sel };
}

/** Opciones de los filtros (valores distintos). */
export function opcionesFiltros(detalle) {
  const s = (k) => [...new Set(detalle.map((x) => x[k]))].sort(cmp);
  return { cds: s('cd'), deptos: s('depto'), temporadas: s('temporada'), meses: s('mes') };
}
