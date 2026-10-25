// Carga de almacenamiento: un libro con hasta tres hojas (Ocupacion, LPN, Reposiciones).
// Se reconocen por sus columnas, no por el nombre de la hoja.
import { tx } from '../db.js';
import { leerTablas, txt, num, fechaHora } from './excel.js';

const ESTADOS_LPN = { 'POR UBICAR': 'Por ubicar', 'EN CURSO': 'En curso', 'UBICADO': 'Ubicado', 'PENDIENTE': 'Por ubicar', 'COMPLETADO': 'Ubicado' };

export async function importarAlmacenamiento(buffer, archivo, { usuario = null } = {}) {
  const [zonasT, lpnT, repoT] = await Promise.all([
    leerTablas(buffer, archivo, ['ZONA', 'POSICIONES', 'OCUPADAS']),
    leerTablas(buffer, archivo, ['LPN', 'ESTADO']),
    leerTablas(buffer, archivo, ['ZONA', 'PENDIENTES'])
  ]);
  const zonas = (zonasT[0]?.filas || []).map(r => ({ zona: txt(r.ZONA), posiciones: Math.round(num(r.POSICIONES)), ocupadas: Math.round(num(r.OCUPADAS)) }))
    .filter(z => z.zona && z.posiciones > 0);
  const lpns = (lpnT[0]?.filas || []).map(r => ({
    lpn: txt(r.LPN), zona: txt(r.ZONA ?? r.ZONA_DESTINO), qty: Math.round(num(r.QTY ?? r.CANTIDAD ?? r.UNIDADES)),
    estado: ESTADOS_LPN[String(txt(r.ESTADO) || '').toUpperCase()] || 'Por ubicar',
    fecha_recepcion: fechaHora(r.FECHA_RECEPCION ?? r.RECEPCION), cita: txt(r.CITA)
  })).filter(l => l.lpn);
  const repos = (repoT[0]?.filas || []).map(r => ({ zona: txt(r.ZONA), pendientes: Math.round(num(r.PENDIENTES)), urgentes: Math.round(num(r.URGENTES)) }))
    .filter(r => r.zona);
  if (!zonas.length && !lpns.length && !repos.length)
    throw Object.assign(new Error('No encontré hojas de ocupación (ZONA, POSICIONES, OCUPADAS), LPN (LPN, ESTADO) ni reposiciones (ZONA, PENDIENTES). Usa la plantilla.'), { status: 400 });

  return tx(async c => {
    const { rows: [carga] } = await c.query(
      `INSERT INTO cargas (tipo, archivo, filas, corte, cargado_por, resumen) VALUES ('almacenamiento',$1,$2,now(),$3,$4) RETURNING *`,
      [archivo, zonas.length + lpns.length + repos.length, usuario, { zonas: zonas.length, lpns: lpns.length, reposiciones: repos.length }]);
    for (const z of zonas) await c.query('INSERT INTO alm_zonas VALUES ($1,$2,$3,$4)', [carga.id, z.zona, z.posiciones, z.ocupadas]);
    for (const l of lpns) await c.query('INSERT INTO alm_lpn VALUES ($1,$2,$3,$4,$5,$6,$7)', [carga.id, l.lpn, l.zona, l.qty, l.estado, l.fecha_recepcion, l.cita]);
    for (const r of repos) await c.query('INSERT INTO alm_reposiciones VALUES ($1,$2,$3,$4)', [carga.id, r.zona, r.pendientes, r.urgentes]);
    return carga;
  });
}
