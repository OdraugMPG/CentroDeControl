// Carga de citas de recepción (plantilla en /api/cargas/plantilla/recepcion).
import { tx } from '../db.js';
import { cat } from '../lib/catalogos.js';
import { fechaOperativa } from '../lib/turnos.js';
import { leerTablas, txt, num, fechaHora, soloFecha } from './excel.js';

const ESTADOS = ['Programada', 'En patio', 'Descargando', 'En inspección', 'Recibida'];
const alias = (r, ...ks) => { for (const k of ks) if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k]; return null; };

function estadoDe(r) {
  const e = txt(r.estado);
  if (e) {
    const n = e.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const hit = ESTADOS.find(x => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === n);
    if (hit) return hit;
  }
  if (r.fin) return 'Recibida';
  if (r.inicio) return 'Descargando';
  if (r.llegada) return 'En patio';
  return 'Programada';
}

export async function importarRecepcion(buffer, archivo, { usuario = null } = {}) {
  const tablas = await leerTablas(buffer, archivo, ['CITA']);
  if (!tablas.length) throw Object.assign(new Error('No encontré la columna CITA. Usa la plantilla de recepción.'), { status: 400 });
  const c = await cat();
  const hoy = fechaOperativa(Date.now(), c);
  const filas = tablas[0].filas.map(r => {
    const fecha = soloFecha(alias(r, 'FECHA')) || hoy;
    const o = {
      fecha, cita: txt(alias(r, 'CITA')), proveedor: txt(alias(r, 'PROVEEDOR')),
      prog: fechaHora(alias(r, 'HORA_PROGRAMADA', 'PROGRAMADA', 'PROG'), fecha),
      llegada: fechaHora(alias(r, 'HORA_LLEGADA', 'LLEGADA'), fecha),
      inicio: fechaHora(alias(r, 'INICIO_DESCARGA', 'INICIO'), fecha),
      fin: fechaHora(alias(r, 'FIN_RECEPCION', 'FIN'), fecha),
      anden: alias(r, 'ANDEN') === null ? null : Math.round(num(alias(r, 'ANDEN'))) || null,
      esperadas: Math.round(num(alias(r, 'UNIDADES_ESPERADAS', 'ESPERADAS'))),
      recibidas: Math.round(num(alias(r, 'UNIDADES_RECIBIDAS', 'RECIBIDAS'))),
      estado: txt(alias(r, 'ESTADO'))
    };
    o.estado = estadoDe(o);
    return o;
  }).filter(f => f.cita);
  if (!filas.length) throw Object.assign(new Error('El archivo no tiene citas.'), { status: 400 });

  return tx(async cl => {
    const { rows: [carga] } = await cl.query(
      `INSERT INTO cargas (tipo, archivo, filas, corte, cargado_por, resumen) VALUES ('recepcion',$1,$2,now(),$3,$4) RETURNING *`,
      [archivo, filas.length, usuario, { citas: filas.length, recibidas: filas.reduce((s, f) => s + f.recibidas, 0) }]);
    for (const f of filas) {
      await cl.query(`INSERT INTO recepcion_citas (fecha, cita, proveedor, prog, llegada, inicio, fin, anden, esperadas, recibidas, estado, carga_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (fecha, cita) DO UPDATE SET proveedor=$3, prog=$4, llegada=$5, inicio=$6, fin=$7, anden=$8,
          esperadas=$9, recibidas=$10, estado=$11, carga_id=$12`,
        [f.fecha, f.cita, f.proveedor, f.prog, f.llegada, f.inicio, f.fin, f.anden, f.esperadas, f.recibidas, f.estado, carga.id]);
    }
    return carga;
  });
}
