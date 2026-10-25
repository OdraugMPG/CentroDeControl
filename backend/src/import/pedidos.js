// Carga de la extracción de flujo de pedidos (misma que alimenta hoy la tabla dinámica).
// Cada carga es una foto del WIP. Al comparar con la foto anterior se generan los
// movimientos: unidades que salieron de cada etapa, que alimentan el control por hora.
import { tx, q } from '../db.js';
import { asegurarEtapas } from '../lib/catalogos.js';
import { leerTablas, txt, num, fechaHora, soloFecha } from './excel.js';

const fmtCorte = t => new Date(t).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' });

const COLS = ['task_key', 'task_id', 'area', 'operacion', 'qty', 'f_mod', 'orden', 'nro_ola', 'jaula', 'flujo', 'fecha_compromiso',
  'tipo_ola', 'cd', 'tipo_od', 'region', 'tipo_transaccion', 'especial', 'retira', 'item', 'descripcion', 'usuario', 'transporte',
  'comuna', 'pasillo', 'ubicacion'];

export function normalizarFila(r, despMs = 0) {
  let fmod = fechaHora(r.F_MOD);
  if (fmod && despMs) fmod = new Date(fmod.getTime() + despMs);
  let fc = soloFecha(r.FECHA_COMPROMISO);
  if (fc && despMs) { const d = new Date(fc + 'T12:00:00'); d.setDate(d.getDate() + Math.round(despMs / 86400000)); fc = soloFecha(d); }
  let region = txt(r.REGION);
  if (region && /^\d+(\.0+)?$/.test(region)) region = String(parseInt(region, 10)).padStart(2, '0');
  const id = v => { const s = txt(v); return s && /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s; };
  const orden = id(r.ORDEN), item = id(r.ITEM);
  return {
    task_key: `${orden || ''}|${item || ''}`, task_id: id(r.TASK_ID), area: txt(r.AREA), operacion: txt(r.OPERACION),
    qty: Math.round(num(r.QTY)), f_mod: fmod, orden, nro_ola: txt(r.NRO_OLA), jaula: txt(r.JAULA), flujo: txt(r.FLUJO),
    fecha_compromiso: fc, tipo_ola: txt(r.TIPO_OLA), cd: txt(r.CD), tipo_od: txt(r.TIPO_OD), region,
    tipo_transaccion: txt(r.TIPO_TRANSACCION), especial: txt(r.ESPECIAL), retira: txt(r.RETIRA), item,
    descripcion: txt(r.DESCRIPCION), usuario: txt(r.USUARIO), transporte: txt(r.TRANSPORTE), comuna: txt(r.COMUNA),
    pasillo: txt(r.PASILLO), ubicacion: txt(r.UBICACION)
  };
}

// Compara dos fotos y devuelve las unidades que salieron de cada etapa
export function calcularMovimientos(prev, curr, prevCorte, currCorte) {
  const agrupar = filas => {
    const m = new Map();
    for (const f of filas) {
      let k = m.get(f.task_key);
      if (!k) m.set(f.task_key, k = { areas: new Map(), filas: [] });
      k.areas.set(f.area, (k.areas.get(f.area) || 0) + f.qty);
      k.filas.push(f);
    }
    return m;
  };
  const P = agrupar(prev), C = agrupar(curr), out = [];
  const clamp = t => Math.min(currCorte, Math.max(prevCorte + 1000, t));
  for (const [key, p] of P) {
    const c = C.get(key);
    for (const [area, qp] of p.areas) {
      const qc = c ? (c.areas.get(area) || 0) : 0;
      const sale = qp - qc;
      if (sale <= 0) continue;
      const ref = p.filas.find(f => f.area === area);
      let destino = 'SALIDA', t = currCorte, usuario = ref.usuario;
      if (c) {
        const subio = [...c.areas].find(([a, q]) => a !== area && q > (p.areas.get(a) || 0));
        if (subio) {
          destino = subio[0];
          const fn = c.filas.filter(f => f.area === destino && f.f_mod).sort((a, b) => b.f_mod - a.f_mod)[0];
          if (fn) { t = clamp(fn.f_mod.getTime()); usuario = fn.usuario || usuario; }
        }
      }
      out.push({ fecha_hora: new Date(t), area_origen: area, area_destino: destino, operacion: ref.operacion,
        qty: sale, usuario, task_key: key });
    }
  }
  return out;
}

export async function insertarLotes(c, tabla, cols, filas, extra = {}) {
  const todas = [...Object.keys(extra), ...cols];
  for (let i = 0; i < filas.length; i += 400) {
    const lote = filas.slice(i, i + 400), vals = [], ph = [];
    lote.forEach((f, j) => {
      ph.push('(' + todas.map((_, k) => `$${j * todas.length + k + 1}`).join(',') + ')');
      todas.forEach(k => vals.push(k in extra ? extra[k] : f[k] ?? null));
    });
    await c.query(`INSERT INTO ${tabla} (${todas.join(',')}) VALUES ${ph.join(',')}`, vals);
  }
}

export async function importarPedidos(buffer, archivo, { usuario = null, desplazamientoMs = 0 } = {}) {
  const tablas = await leerTablas(buffer, archivo, ['AREA', 'QTY']);
  if (!tablas.length) throw Object.assign(new Error('No encontré las columnas AREA y QTY en el archivo.'), { status: 400 });
  const filas = tablas[0].filas.map(r => normalizarFila(r, desplazamientoMs)).filter(f => f.area && f.qty);
  if (!filas.length) throw Object.assign(new Error('El archivo no tiene tareas con AREA y QTY.'), { status: 400 });
  const tiempos = filas.filter(f => f.f_mod).map(f => f.f_mod.getTime());
  const corte = tiempos.length ? Math.max(...tiempos) : Date.now();

  const ultima = (await q(`SELECT id, corte FROM cargas WHERE tipo = 'pedidos' ORDER BY corte DESC LIMIT 1`)).rows[0];
  if (ultima && new Date(ultima.corte).getTime() >= corte)
    throw Object.assign(new Error(`La extracción tiene corte ${fmtCorte(corte)}, igual o anterior a la última cargada (${fmtCorte(ultima.corte)}). Si es un archivo repetido, no hace falta volver a cargarlo.`), { status: 409 });

  return tx(async c => {
    await asegurarEtapas(filas.map(f => f.area), c);
    let movimientos = [];
    if (ultima) {
      const prev = (await c.query('SELECT task_key, area, qty, operacion, usuario, f_mod FROM pedido_tareas WHERE carga_id = $1', [ultima.id])).rows;
      movimientos = calcularMovimientos(prev, filas, new Date(ultima.corte).getTime(), corte);
    }
    const unidades = filas.reduce((s, f) => s + f.qty, 0);
    const salidas = movimientos.reduce((s, m) => s + m.qty, 0);
    const { rows: [carga] } = await c.query(
      `INSERT INTO cargas (tipo, archivo, filas, corte, cargado_por, resumen) VALUES ('pedidos',$1,$2,$3,$4,$5) RETURNING *`,
      [archivo, filas.length, new Date(corte), usuario, { unidades, movimientos: movimientos.length, unidadesMovidas: salidas, primera: !ultima }]);
    await insertarLotes(c, 'pedido_tareas', COLS, filas, { carga_id: carga.id });
    await insertarLotes(c, 'movimientos_etapa', ['fecha_hora', 'area_origen', 'area_destino', 'operacion', 'qty', 'usuario', 'task_key'],
      movimientos, { carga_id: carga.id });
    return carga;
  });
}
