import XLSX from 'xlsx';
import { q, tx } from '../db.js';
import { leerParametros } from './parametros.js';
import { filasDeCarga, ultimaCargaInicio } from './stock.js';
import { detalleSlowMoving, simular, opcionesFiltros } from '../engine/slowMoving.js';
import { buscarCol } from '../engine/base.js';
import { up, num, cmp, hoyIso } from '../engine/util.js';
import { skuKey } from './participacionCd.js';
import { libro } from './tareas.js';

const cache = new Map();

async function detalle() {
  const carga = await ultimaCargaInicio();
  if (!carga) throw Object.assign(new Error('Carga primero una Base de stock.'), { status: 400 });
  const p = await leerParametros();
  const key = carga.id + '|' + p.tramos;
  if (!cache.has(key)) {
    cache.clear();
    cache.set(key, { carga, ...detalleSlowMoving(await filasDeCarga(carga.id), { corte: carga.fecha, tramos: p.tramosArr }) });
  }
  return { ...cache.get(key), p };
}

export async function opciones() {
  const d = await detalle();
  return { carga: d.carga, ...opcionesFiltros(d.detalle), tramos: d.p.tramosArr, hayVentas: d.hayVentas, hayCosto: d.hayCosto, destino: d.p.smDestino };
}

export async function simularSlow(filtros, limite = 500) {
  const d = await detalle();
  const r = simular(d.detalle, filtros);
  const { rows: cola } = await q("SELECT cd, count(*)::int AS n FROM sm_cola WHERE estado = 'EN COLA' AND tipo = 'SM' GROUP BY cd ORDER BY cd");
  return { carga: d.carga, total: r.total, porCD: r.porCD, filas: r.seleccion.length, detalle: r.seleccion.slice(0, limite).map(({ filas, ...x }) => x), cola };
}

/** Deja en cola una tarea por ubicación de cada SKU seleccionado; entran a la próxima asignación diaria. */
export async function generarColaSlow(filtros, destino) {
  const d = await detalle();
  const r = simular(d.detalle, filtros);
  const dst = (destino || d.p.smDestino || 'ZONA SLOW MOVING').trim();
  let n = 0;
  await tx(async (c) => {
    for (const x of r.seleccion) {
      for (const f of x.filas) {
        const ya = await c.query("SELECT 1 FROM sm_cola WHERE cd=$1 AND sku=$2 AND ubicacion=$3 AND estado='EN COLA'", [x.cd, x.sku, f.ubic]);
        if (ya.rowCount) continue;
        await c.query('INSERT INTO sm_cola (cd, sku, descripcion, depto, temporada, mes, piso, zona, ubicacion, unidades, destino) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [x.cd, x.sku, x.desc, x.depto, x.temporada, x.mes, f.piso, f.zp, f.ubic, f.qty, dst]);
        n++;
      }
    }
  });
  return { tareas: n, skus: r.seleccion.length };
}

export async function colaSlow() {
  const { rows } = await q("SELECT * FROM sm_cola WHERE estado = 'EN COLA' AND tipo = 'SM' ORDER BY cd, id");
  return rows;
}
export async function vaciarColaSlow(cd, tipo = 'SM') {
  const r = await q("DELETE FROM sm_cola WHERE estado = 'EN COLA' AND tipo = $1" + (cd ? ' AND cd = $2' : ''), cd ? [tipo, cd] : [tipo]);
  return { eliminadas: r.rowCount };
}

// ---------------------------------------------------------------------------------------------
// Validación de un listado slow moving (SKU | QTY): stock del SKU en la Base vigente, por CD y por ubicación,
// y diferencia contra el QTY del listado. El listado cargado se guarda en parametros (JSON).
// ---------------------------------------------------------------------------------------------
const CLAVE_VAL = 'slowValidar';
export const ESTADOS_VAL = { CUADRA: 'Cuadra', MAYOR: 'Sistema mayor', MENOR: 'Sistema menor', SIN: 'Sin stock en la Base' };
const errVal = (m) => Object.assign(new Error(m), { status: 400 });

export async function cargarListadoSlow(buffer, archivo) {
  const wb = XLSX.read(buffer, { type: 'buffer', dense: true });
  const m = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
  let f = -1, cS = 0, cQ = 1;
  for (let i = 0; i < Math.min(10, m.length); i++) {
    const s = buscarCol(m[i], 'SKU|COD SKU|CODIGO SKU|CODIGO|PRODUCTO'), qn = buscarCol(m[i], 'QTY|CANTIDAD|UNIDADES|STOCK|UNID');
    if (s >= 0 && qn >= 0) { f = i; cS = s; cQ = qn; break; }
  }
  // sin encabezado reconocible: columna A = SKU, columna B = QTY
  const filas = new Map();
  for (const r of m.slice(f + 1)) {
    const sku = skuKey(r[cS]);
    if (!sku || (f < 0 && !/\d/.test(sku))) continue;
    filas.set(sku, (filas.get(sku) || 0) + num(r[cQ]));
  }
  if (!filas.size) throw errVal('El listado no trae SKU: debe tener las columnas SKU y QTY.');
  const valor = { archivo, cargado: hoyIso(), filas: [...filas].map(([sku, qty]) => ({ sku, qty })) };
  await q('INSERT INTO parametros (clave, valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor', [CLAVE_VAL, JSON.stringify(valor)]);
  return { archivo, skus: filas.size, unidades: [...filas.values()].reduce((s, x) => s + x, 0) };
}

export async function borrarListadoSlow() {
  await q('DELETE FROM parametros WHERE clave = $1', [CLAVE_VAL]);
  return { ok: true };
}

async function calcularListado() {
  const { rows } = await q('SELECT valor FROM parametros WHERE clave = $1', [CLAVE_VAL]);
  if (!rows.length) return null;
  const lst = typeof rows[0].valor === 'string' ? JSON.parse(rows[0].valor) : rows[0].valor;
  const d = await detalle();
  const porSku = new Map();
  for (const x of d.detalle) {
    const k = skuKey(x.sku);
    if (!porSku.has(k)) porSku.set(k, []);
    porSku.get(k).push(x);
  }
  const cds = [...new Set(d.detalle.map((x) => x.cd))].sort(cmp);
  const lista = lst.filas.map(({ sku, qty }) => {
    const enCd = porSku.get(sku) || [];
    const stock = enCd.reduce((s, x) => s + x.uni, 0);
    const mayor = [...enCd].sort((a, b) => b.uni - a.uni)[0];
    const dias = enCd.reduce((m, x) => (x.dias !== null && (m === null || x.dias < m) ? x.dias : m), null);
    return {
      sku, qty, desc: mayor?.desc || '', depto: mayor?.depto || '', temporada: mayor?.temporada || '', stock, dif: stock - qty,
      unidades: Object.fromEntries(enCd.map((x) => [x.cd, x.uni])), nUb: enCd.reduce((s, x) => s + x.nUb, 0), nCds: enCd.length,
      ventas: enCd.reduce((mx, x) => Math.max(mx, x.ventas || 0), 0), dias, tramo: mayor?.tramoNom || '', valor: enCd.reduce((s, x) => s + x.valor, 0),
      estado: !stock ? ESTADOS_VAL.SIN : stock === qty ? ESTADOS_VAL.CUADRA : stock > qty ? ESTADOS_VAL.MAYOR : ESTADOS_VAL.MENOR,
      ubicaciones: enCd.flatMap((x) => x.filas.map((u) => ({ cd: x.cd, piso: u.piso, zp: u.zp, ubic: u.ubic, qty: u.qty, tramo: x.tramoNom, dias: x.dias }))),
    };
  });
  const porCd = cds.map((cd) => {
    const l = lista.filter((x) => x.unidades[cd]);
    return { cd, skus: l.length, unidades: l.reduce((s, x) => s + x.unidades[cd], 0), ubicaciones: l.reduce((s, x) => s + x.ubicaciones.filter((u) => u.cd === cd).length, 0) };
  }).filter((c) => c.skus);
  const porEstado = Object.values(ESTADOS_VAL).map((estado) => {
    const l = lista.filter((x) => x.estado === estado);
    return { estado, skus: l.length, qty: l.reduce((s, x) => s + x.qty, 0), stock: l.reduce((s, x) => s + x.stock, 0) };
  });
  const sum = (k) => lista.reduce((s, x) => s + x[k], 0);
  return { carga: d.carga, archivo: lst.archivo, cargado: lst.cargado, cds: porCd.map((c) => c.cd), lista, porCd, porEstado,
    tot: { skus: lista.length, qty: sum('qty'), stock: sum('stock'), conStock: lista.filter((x) => x.stock > 0).length, ubic: sum('nUb'), valor: sum('valor') } };
}

/** Resultado para la vista: totales, por CD, por estado y los primeros 500 SKU (filtro por estado, CD o texto). */
export async function validarListadoSlow({ estado = '', cd = '', buscar = '' } = {}) {
  const r = await calcularListado();
  if (!r) return { sinListado: true };
  const b = up(buscar);
  const sel = r.lista.filter((x) => (!estado || x.estado === estado) && (!cd || x.unidades[cd]) && (!b || x.sku.includes(b) || up(x.desc).includes(b)));
  sel.sort((a, z) => Math.abs(z.dif) - Math.abs(a.dif) || cmp(a.sku, z.sku));
  const { lista, ...resto } = r;
  return { ...resto, filtrados: sel.length, detalle: sel.slice(0, 500).map((x) => ({ ...x, ubicaciones: x.ubicaciones.slice(0, 30) })) };
}

/** Excel: resumen, por SKU (stock por CD y diferencia) y por ubicación. */
export async function archivoListadoSlow() {
  const r = await calcularListado();
  if (!r) throw errVal('Carga primero el listado de SKU a validar.');
  const fecha = r.carga.fecha instanceof Date ? r.carga.fecha.toISOString().slice(0, 10) : String(r.carga.fecha).slice(0, 10);
  const resumen = [
    ['Validación de listado slow moving'], ['Listado', r.archivo], ['Base de stock', fecha], [],
    ['SKU del listado', r.tot.skus], ['SKU con stock en la Base', r.tot.conStock], ['Unidades del listado (QTY)', r.tot.qty], ['Stock en la Base', r.tot.stock],
    ['Diferencia (Base − listado)', r.tot.stock - r.tot.qty], ['Ubicaciones', r.tot.ubic], [],
    ['Estado', 'SKU', 'QTY listado', 'Stock Base'], ...r.porEstado.map((e) => [e.estado, e.skus, e.qty, e.stock]), [],
    ['CD', 'SKU', 'Unidades', 'Ubicaciones'], ...r.porCd.map((c) => [c.cd, c.skus, c.unidades, c.ubicaciones]),
  ];
  const porSku = [['SKU', 'Descripción', 'Depto', 'Temporada', 'QTY listado', ...r.cds.map((cd) => 'Stock ' + cd), 'Stock Base', 'Diferencia', 'Estado', 'N° CD', 'Ubicaciones',
    'Ventas', 'Días último almac.', 'Tramo', 'Valor'],
  ...r.lista.map((x) => [x.sku, x.desc, x.depto, x.temporada, x.qty, ...r.cds.map((cd) => x.unidades[cd] || 0), x.stock, x.dif, x.estado, x.nCds, x.nUb, x.ventas, x.dias ?? '', x.tramo, Math.round(x.valor)])];
  const ubic = [['SKU', 'Descripción', 'QTY listado', 'CD', 'Piso', 'Zona pasillo', 'Ubicación', 'Unidades', 'Tramo', 'Días último almac.'],
    ...r.lista.flatMap((x) => (x.ubicaciones.length ? x.ubicaciones : [{ cd: 'SIN STOCK' }]).map((u) => [x.sku, x.desc, x.qty, u.cd, u.piso || '', u.zp || '', u.ubic || '', u.qty || 0, u.tramo || '', u.dias ?? '']))];
  return {
    buffer: libro([['Resumen', resumen, [30, 16, 12, 12]], ['Por SKU', porSku, [14, 36, 22, 14, 10, ...r.cds.map(() => 11), 11, 11, 18, 7, 10, 9, 10, 22, 12]],
      ['Por ubicación', ubic, [14, 36, 10, 10, 8, 12, 18, 10, 22, 10]]]),
    nombre: 'Validacion_SlowMoving_' + fecha + '.xlsx',
  };
}
