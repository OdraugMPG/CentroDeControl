import XLSX from 'xlsx';
import { q, tx } from '../db.js';
import { leerParametros } from './parametros.js';
import { filasDeCarga, guardarCarga } from './stock.js';
import { conciliar, mapaStock } from '../engine/conciliacion.js';
import { up, txt, num, normTxt, fmtFecha } from '../engine/util.js';

export const PROCESOS = { INV: 'INVENTARIO', CONS: 'CONSOLIDACION', SU: 'STOCK UNITARIO', SM: 'SLOW MOVING', REU: 'REUBICACION ABC' };
export const ESTADOS = ['PENDIENTE', 'PARCIAL', 'EJECUTADO', 'NO EJECUTADO'];

export async function listarTareas(f) {
  const w = ['fecha = $1'], v = [f.fecha];
  const add = (sql, val) => { v.push(val); w.push(sql.replace('?', '$' + v.length)); };
  if (f.cd) add('cd = ?', f.cd);
  if (f.turno) add('turno = ?', Number(f.turno));
  if (f.proceso) add('proceso = ?', f.proceso);
  if (f.estado) add('estado = ?', f.estado);
  if (f.supervisor) add('supervisor = ?', f.supervisor);
  if (f.q) add("(sku ILIKE ? OR ubic_origen ILIKE ? OR ubic_destino ILIKE ? OR asignado_a ILIKE ? OR folio ILIKE ?)".replace(/\?/g, '$' + (v.length + 1)), '%' + f.q + '%');
  const { rows } = await q(`SELECT * FROM tareas WHERE ${w.join(' AND ')} ORDER BY cd, turno, proceso, asignado_a NULLS LAST, secuencia NULLS LAST, id LIMIT ${Number(f.limite) || 5000}`, v);
  return rows;
}

/** Registra el cierre de una zona de inventario en el ciclo cuando todas sus tareas del día quedan EJECUTADAS. */
async function revisarCicloInventario(c, t) {
  if (t.proceso !== 'INV') return;
  const { rows } = await c.query("SELECT bool_and(estado = 'EJECUTADO') AS ok FROM tareas WHERE fecha = $1 AND cd = $2 AND proceso = 'INV' AND piso = $3 AND zona = $4", [t.fecha, t.cd, t.piso, t.zona]);
  const { rows: pl } = await c.query("SELECT coalesce(sum(pct),0) AS pct FROM plan_lineas WHERE fecha = $1 AND cd = $2 AND tarea = 'INVENTARIO' AND piso = $3 AND zona = $4", [t.fecha, t.cd, t.piso, t.zona]);
  if (rows[0].ok && pl[0].pct >= 0.999) {
    await c.query('INSERT INTO avance_inventario (cd, piso, zona, fecha) VALUES ($1,$2,$3,$4) ON CONFLICT (cd, piso, zona) DO UPDATE SET fecha = EXCLUDED.fecha', [t.cd, up(t.piso), up(t.zona), t.fecha]);
  } else {
    await c.query('DELETE FROM avance_inventario WHERE cd = $1 AND piso = $2 AND zona = $3 AND fecha = $4', [t.cd, up(t.piso), up(t.zona), t.fecha]);
  }
}

export async function actualizarTarea(id, cambios, quien = 'Supervisor') {
  return tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM tareas WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) throw Object.assign(new Error('La tarea no existe.'), { status: 404 });
    const t = rows[0];
    const n = { ...t };
    if (cambios.estado !== undefined) {
      if (!ESTADOS.includes(cambios.estado)) throw Object.assign(new Error('Estado no válido.'), { status: 400 });
      n.estado = cambios.estado;
    }
    if (cambios.unid_real !== undefined) n.unid_real = cambios.unid_real === '' || cambios.unid_real === null ? null : num(cambios.unid_real);
    if (cambios.observacion !== undefined) n.observacion = txt(cambios.observacion) || null;
    if (cambios.asignado_a !== undefined) n.asignado_a = txt(cambios.asignado_a) || null;
    if (n.estado === 'NO EJECUTADO' && !n.observacion) throw Object.assign(new Error('Indica el motivo en la observación cuando la tarea queda NO EJECUTADO.'), { status: 400 });
    if (n.estado === 'EJECUTADO' && (n.unid_real === null || n.unid_real === undefined)) n.unid_real = t.unid_asig;
    const igual = n.estado === t.estado && Number(n.unid_real ?? -1) === Number(t.unid_real ?? -1) && (n.observacion || '') === (t.observacion || '') && (n.asignado_a || '') === (t.asignado_a || '');
    if (igual) return { ...t, sinCambio: true };
    const { rows: out } = await c.query(
      'UPDATE tareas SET estado=$2, unid_real=$3, observacion=$4, asignado_a=$5, fuente=$6, actualizado_en=now() WHERE id=$1 RETURNING *',
      [id, n.estado, n.unid_real, n.observacion, n.asignado_a, quien]);
    await revisarCicloInventario(c, out[0]);
    return out[0];
  });
}

/** Carga de stock al cierre de un turno: compara con la Base de la asignación y actualiza el avance. */
export async function cierreConStock({ buffer, archivo, fecha, turno }) {
  const { rows: a } = await q('SELECT * FROM asignaciones WHERE fecha = $1 ORDER BY id DESC LIMIT 1', [fecha]);
  if (!a.length) throw Object.assign(new Error(`No hay asignación del ${fmtFecha(fecha)} para conciliar.`), { status: 400 });
  const { carga } = await guardarCarga({ buffer, archivo, fecha, tipo: 'CIERRE', turno });
  const antes = mapaStock(await filasDeCarga(a[0].carga_id));
  const despues = mapaStock(await filasDeCarga(carga.id));
  const { rows: resv } = await q('SELECT ubicacion FROM ubic_reservadas');
  const turnoMax = Number(turno) || 9;
  const { rows: abiertas } = await q("SELECT * FROM tareas WHERE fecha = $1 AND turno <= $2 AND proceso <> 'INV' AND estado IN ('PENDIENTE','PARCIAL')", [fecha, turnoMax]);
  const res = conciliar(abiertas, antes, despues, new Set(resv.map((r) => up(r.ubicacion))));
  const porId = new Map(abiertas.map((t) => [t.id, t]));
  const hora = new Date().toTimeString().slice(0, 5);
  let ejec = 0, parc = 0, rev = 0;
  await tx(async (c) => {
    for (const r of res) {
      const t = porId.get(r.id);
      const real = Math.max(Number(t.unid_real) || 0, r.unid_real);
      let estado = t.estado;
      if (real >= Number(t.unid_asig)) estado = 'EJECUTADO'; else if (real > 0) estado = 'PARCIAL';
      if (estado === 'EJECUTADO') ejec++; else if (estado === 'PARCIAL') parc++;
      if (r.obs) rev++;
      await c.query('UPDATE tareas SET estado=$2, unid_real=$3, fuente=$4, observacion=COALESCE($5, observacion), actualizado_en=now() WHERE id=$1',
        [r.id, estado, real || null, `Stock cierre ${turno ? 'T' + turno + ' ' : ''}${hora}`, r.obs || null]);
    }
    await c.query('INSERT INTO conciliaciones (fecha, carga_id, turno, resumen) VALUES ($1,$2,$3,$4)',
      [fecha, carga.id, turno || null, JSON.stringify({ revisadas: abiertas.length, ejecutadas: ejec, parciales: parc, revisar: rev })]);
  });
  return { carga, revisadas: abiertas.length, ejecutadas: ejec, parciales: parc, revisar: rev, sinCambio: abiertas.length - res.length };
}

const pctD = (a, b) => (b > 0 ? a / b : 0);
function acumular(lista) {
  const r = { tareas: 0, ejecutadas: 0, parciales: 0, noEjecutadas: 0, pendientes: 0, uAsig: 0, uReal: 0 };
  for (const t of lista) {
    const ua = Number(t.unid_asig) || 0;
    const ur = t.unid_real !== null && t.unid_real !== undefined ? Number(t.unid_real) : t.estado === 'EJECUTADO' ? ua : 0;
    r.tareas++; r.uAsig += ua; r.uReal += Math.min(ur, ua);
    if (t.estado === 'EJECUTADO') r.ejecutadas++;
    else if (t.estado === 'PARCIAL') r.parciales++;
    else if (t.estado === 'NO EJECUTADO') r.noEjecutadas++;
    else r.pendientes++;
  }
  r.cumplTareas = pctD(r.ejecutadas, r.tareas);
  r.cumplUnidades = pctD(r.uReal, r.uAsig);
  return r;
}

/** KPI de cierre de turno: cumplimiento por tareas y por unidades contra la asignación del día. */
export async function kpi({ fecha, cd, turno }) {
  const p = await leerParametros();
  const w = ["fecha = $1", "estado <> 'SIN DESTINO'"], v = [fecha];
  if (cd) { v.push(cd); w.push('cd = $' + v.length); }
  if (turno) { v.push(Number(turno)); w.push('turno = $' + v.length); }
  const { rows } = await q(`SELECT * FROM tareas WHERE ${w.join(' AND ')}`, v);
  const grupo = (fk) => {
    const m = new Map();
    for (const t of rows) { const k = fk(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
    return m;
  };
  const porCdProc = [...grupo((t) => t.cd + '|' + t.proceso)].map(([k, l]) => ({ cd: k.split('|')[0], proceso: k.split('|')[1], ...acumular(l) }));
  const porCd = [...grupo((t) => t.cd)].map(([k, l]) => ({ cd: k, ...acumular(l) }));
  const porTurno = [...grupo((t) => t.turno + '|' + t.cd + '|' + (t.supervisor || ''))].map(([k, l]) => {
    const [tu, c, s] = k.split('|');
    return { turno: Number(tu), cd: c, supervisor: s, ...acumular(l) };
  }).sort((a, b) => a.turno - b.turno || a.cd.localeCompare(b.cd));
  const excepciones = rows.filter((t) => t.estado === 'NO EJECUTADO').map((t) => ({ id: t.id, cd: t.cd, turno: t.turno, proceso: t.proceso, folio: t.folio, sku: t.sku, ubic_origen: t.ubic_origen, observacion: t.observacion, supervisor: t.supervisor }));
  const { rows: sinDest } = await q("SELECT count(*)::int AS n FROM tareas WHERE fecha = $1 AND estado = 'SIN DESTINO'" + (cd ? ' AND cd = $2' : ''), cd ? [fecha, cd] : [fecha]);
  return { meta: p.meta, total: acumular(rows), porCd, porCdProc, porTurno, excepciones, sinDestino: sinDest[0].n };
}

// ---------------- archivos .xlsx ----------------
export const libro = (hojas) => {
  const wb = XLSX.utils.book_new();
  for (const [nombre, aoa, anchos] of hojas) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (anchos) ws['!cols'] = anchos.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, nombre);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
};

/** Archivo del turno para el supervisor (misma estructura que ExportarTurno del libro). */
export async function archivoTurno({ fecha, cd, turno }) {
  const ts = await listarTareas({ fecha, cd, turno });
  const sup = ts.find((t) => t.supervisor)?.supervisor || '';
  const enc = ['Proceso', 'N° Tarea', 'Piso', 'Zona', 'Ubic. origen', 'SKU', 'Descripción', 'Ubic. destino', 'Asignado a', 'Unid. asignadas', 'ESTADO', 'Unid. reales', 'Observación', 'ID'];
  const aoa = [
    [`TAREAS DEL TURNO · ${cd} · T${turno} · ${fmtFecha(fecha)}`],
    [`Supervisor: ${sup}`],
    [`Tareas: ${ts.length}`],
    ['Completa ESTADO (PENDIENTE, PARCIAL, EJECUTADO, NO EJECUTADO), Unid. reales y Observación. Luego impórtalo en "Conciliación".'],
    [],
    enc,
    ...ts.map((t) => [PROCESOS[t.proceso], t.folio, t.piso, t.zona, t.ubic_origen, t.sku, t.descripcion, t.ubic_destino, t.asignado_a, Number(t.unid_asig),
      t.estado, t.unid_real, t.observacion, 'W' + t.id]),
  ];
  return { buffer: libro([['Tareas', aoa, [15, 11, 10, 10, 16, 12, 34, 16, 24, 10, 14, 10, 34, 9]]]), nombre: `Turno_${cd}_T${turno}_${fecha}.xlsx` };
}

/** Archivo de tareas para cargar en el WMS (todas las tareas de movimiento del día). */
export async function archivoWms({ fecha }) {
  const ts = (await listarTareas({ fecha })).filter((t) => t.proceso !== 'INV' && t.estado !== 'SIN DESTINO');
  const aoa = [['CD', 'Turno', 'Proceso', 'N° Tarea', 'Secuencia', 'SKU', 'Descripción', 'Ubicación origen', 'Ubicación destino', 'Cantidad', 'Operario', 'ID'],
    ...ts.map((t) => [t.cd, 'T' + t.turno, PROCESOS[t.proceso], t.folio, t.secuencia, t.sku, t.descripcion, t.ubic_origen, t.ubic_destino, Number(t.unid_asig), t.asignado_a, 'W' + t.id])];
  const inv = (await listarTareas({ fecha, proceso: 'INV' })).map((t) => [t.cd, 'T' + t.turno, t.piso, t.zona, Number(t.unid_asig), t.asignado_a, 'W' + t.id]);
  return { buffer: libro([['Movimientos', aoa, [8, 6, 16, 10, 9, 12, 34, 18, 18, 9, 24, 9]], ['Inventario', [['CD', 'Turno', 'Piso', 'Zona', 'Ubicaciones', 'Recursos', 'ID'], ...inv]]]), nombre: `Tareas_WMS_${fecha}.xlsx` };
}

/** Importa el archivo del turno completado por el supervisor (respaldo cuando no hay foto de stock). */
export async function importarAvances(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const m = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
  const f = m.findIndex((r) => r.some((x) => normTxt(x) === 'ID') && r.some((x) => normTxt(x) === 'ESTADO'));
  if (f < 0) throw Object.assign(new Error('El archivo no tiene las columnas ID y ESTADO.'), { status: 400 });
  const h = m[f].map(normTxt);
  const c = (n) => h.indexOf(n);
  let n = 0, err = [];
  for (const r of m.slice(f + 1)) {
    const id = Number(String(r[c('ID')]).replace(/^W/i, ''));
    if (!id) continue;
    const est = up(r[c('ESTADO')]);
    try {
      const out = await actualizarTarea(id, { estado: ESTADOS.includes(est) ? est : undefined, unid_real: c('UNIDREALES') >= 0 && txt(r[c('UNIDREALES')]) !== '' ? r[c('UNIDREALES')] : undefined,
        observacion: c('OBSERVACION') >= 0 ? r[c('OBSERVACION')] : undefined, asignado_a: c('ASIGNADOA') >= 0 && txt(r[c('ASIGNADOA')]) ? r[c('ASIGNADOA')] : undefined }, 'Archivo supervisor');
      if (!out.sinCambio) n++;
    } catch (e) { err.push(`W${id}: ${e.message}`); }
  }
  return { actualizadas: n, errores: err.slice(0, 20) };
}
