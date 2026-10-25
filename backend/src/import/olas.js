// Carga del reporte "Simulador de olas" (líneas por liberar). Cada carga reemplaza a la anterior.
import { tx } from '../db.js';
import { leerTablas, txt, num, fechaHora, soloFecha } from './excel.js';
import { insertarLotes } from './pedidos.js';

const TEXTOS = ['estado', 'desc_estado', 'jaula', 'od', 'solicitud', 'rut', 'destinatario', 'sku', 'descripcion', 'dpto', 'region',
  'city', 'facility', 'tipo_orden', 'tipo_ola', 'dia', 'mes', 'anio', 'dest', 'rut_cliente', 'location_id', 'zona', 'pasillo',
  'especial', 'tipo_picking', 'operacion', 'cd', 'marca_osr', 'logistica_osr', 'clasif_cd', 'clasif_picking'];
const FECHAS = ['fecha_salida', 'fecha_eta_cliente', 'fecha_venta'];
const COLS = [...TEXTOS, ...FECHAS, 'qty', 'fecha_mod'];

// Excel suele convertir códigos numéricos en 123.0
const id = v => { const s = txt(v); return s && /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s; };

export function normalizarFila(r) {
  const f = {};
  for (const k of TEXTOS) f[k] = id(r[k.toUpperCase()]);
  for (const k of FECHAS) f[k] = soloFecha(r[k.toUpperCase()]);
  if (f.region && /^\d+$/.test(f.region)) f.region = f.region.padStart(2, '0');
  f.qty = num(r.QTY);
  f.fecha_mod = fechaHora(r.FECHA_MOD);
  return f;
}

export async function importarOlas(buffer, archivo, { usuario = null } = {}) {
  const tablas = await leerTablas(buffer, archivo, ['FECHA_SALIDA', 'TIPO_PICKING', 'QTY']);
  if (!tablas.length) throw Object.assign(new Error('No encontré las columnas FECHA_SALIDA, TIPO_PICKING y QTY en el archivo.'), { status: 400 });
  const filas = tablas[0].filas.map(normalizarFila).filter(f => f.qty);
  if (!filas.length) throw Object.assign(new Error('El archivo no tiene líneas con QTY.'), { status: 400 });
  const tiempos = filas.filter(f => f.fecha_mod).map(f => f.fecha_mod.getTime());
  const corte = tiempos.length ? tiempos.reduce((a, b) => Math.max(a, b)) : Date.now();
  const unidades = filas.reduce((s, f) => s + f.qty, 0);
  const ods = new Set(filas.map(f => f.od).filter(Boolean)).size;

  return tx(async c => {
    await c.query(`DELETE FROM cargas WHERE tipo = 'olas'`);
    const { rows: [carga] } = await c.query(
      `INSERT INTO cargas (tipo, archivo, filas, corte, cargado_por, resumen) VALUES ('olas',$1,$2,$3,$4,$5) RETURNING *`,
      [archivo, filas.length, new Date(corte), usuario, { unidades, ods }]);
    await insertarLotes(c, 'olas_lineas', COLS, filas, { carga_id: carga.id });
    return carga;
  });
}
