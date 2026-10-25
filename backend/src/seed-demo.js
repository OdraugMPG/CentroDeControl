// Datos de demostración: carga la extracción real de muestra (desplazada a hoy) y genera
// historia de producción, recepción, almacenamiento y Continuidad Operacional de los últimos días.
// Uso: npm run db:demo            (base vacía)
//      npm run db:demo -- --borrar (borra los datos operativos existentes antes)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, q, tx } from './db.js';
import { seed } from './seed.js';
import { cat, invalidar } from './lib/catalogos.js';
import { instancia, turnosRecientes, siguienteTurno, fechaOperativa, turnosDelDia, addDias, inicioHora, H } from './lib/turnos.js';
import { importarPedidos } from './import/pedidos.js';
import { leerTablas } from './import/excel.js';
import { filasAsistencia } from './services/continuidad.js';
import { informe } from './services/cierre.js';
import { autoTraspaso } from './services/continuidad.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MUESTRA = path.resolve(here, '../data/muestra/Flujo_de_pedido.xlsx');

let s = 20261021;
const rnd = () => (s = (s * 16807) % 2147483647, (s - 1) / 2147483646);
const pick = a => a[Math.floor(rnd() * a.length)];

async function main() {
  await seed();
  const datos = (await q(`SELECT (SELECT COUNT(*) FROM cargas) + (SELECT COUNT(*) FROM tareas) + (SELECT COUNT(*) FROM personas) AS n`)).rows[0].n;
  if (datos > 0 && !process.argv.includes('--borrar')) {
    console.error('La base ya tiene datos. Para reemplazarlos por la demostración ejecuta: npm run db:demo -- --borrar');
    process.exit(1);
  }
  await q(`TRUNCATE cargas, pedido_tareas, movimientos_etapa, recepcion_citas, alm_zonas, alm_lpn, alm_reposiciones,
    tareas, handovers, personas, asistencia, dotacion_requerida, inv_layout, inv_asignaciones, cierres_turno, desvio_causas RESTART IDENTITY CASCADE`);
  invalidar();
  const c = await cat();
  const ahora = Date.now();

  // ---------- 1. Extracción real de pedidos, desplazada para que su corte sea "hace 3 minutos" ----------
  if (!fs.existsSync(MUESTRA)) {
    console.error(`Falta ${MUESTRA}: copia ahí una extracción de Flujo de pedido (.xlsx). No se versiona porque contiene datos reales.`);
    process.exit(1);
  }
  const buf = fs.readFileSync(MUESTRA);
  const filas = (await leerTablas(buf, 'x.xlsx', ['AREA', 'QTY']))[0].filas;
  const corteOriginal = Math.max(...filas.map(f => new Date(String(f.F_MOD).replace(' ', 'T')).getTime()).filter(Number.isFinite));
  const desp = Math.round((ahora - 3 * 60000 - corteOriginal) / 60000) * 60000;
  await importarPedidos(buf, 'Flujo_de_pedido.xlsx (muestra)', { usuario: 'demo', desplazamientoMs: desp });
  console.log('Extracción de pedidos cargada.');

  // ---------- 2. Historia de producción por hora (3 días operativos) ----------
  const pesos = {}, usuarios = [...new Set(filas.map(f => String(f.USUARIO || '').trim()).filter(Boolean))];
  filas.forEach(f => { const a = String(f.AREA).trim(), o = String(f.OPERACION || '').trim(); (pesos[a] = pesos[a] || {})[o] = (pesos[a][o] || 0) + (+f.QTY || 0); });
  for (const a in pesos) { const t = Object.values(pesos[a]).reduce((x, y) => x + y, 0); for (const o in pesos[a]) pesos[a][o] /= t; }
  const movs = [];
  const desde = addDias(fechaOperativa(ahora, c), -3);
  for (let f = desde; f <= fechaOperativa(ahora, c); f = addDias(f, 1)) {
    for (const t of turnosDelDia(f, c)) {
      const inst = instancia(f, t, c);
      // cada turno tiene su "personalidad": la noche rinde algo menos, un turno al azar tiene una mala hora
      const malaHora = inst.horas[Math.floor(rnd() * inst.horas.length)];
      for (const h of inst.horas) {
        if (h > ahora) break;
        const frac = h === inicioHora(ahora) ? new Date(ahora).getMinutes() / 60 : 1;
        for (const e of c.etapas) {
          const meta = (c.metas[e.area] || {})[t] || 0;
          const sesgo = e.area === '05_En_Empaque' ? 0.86 : e.area === '09_Sorter_OSR' ? 0.93 : 1.03;
          const factor = (t === 'Noche' ? 0.94 : 1) * (h === malaHora ? 0.68 : 1) * (h === inst.start ? 0.82 : 1);
          const total = Math.round(meta * sesgo * factor * (0.9 + rnd() * 0.25) * frac);
          if (!total) continue;
          const personas = Math.max(1, Math.round(meta / 32 * (0.85 + rnd() * 0.3)));
          const ops = Object.entries(pesos[e.area] || { GENERAL: 1 });
          const equipo = Array.from({ length: personas }, (_, i) => usuarios[(e.orden * 7 + i + (t === 'AM' ? 0 : t === 'PM' ? 40 : 80)) % usuarios.length]);
          let resto = total;
          equipo.forEach((u, i) => {
            const qty = i === equipo.length - 1 ? resto : Math.round(total / personas);
            resto -= qty;
            if (qty <= 0) return;
            let r = rnd(), opName = ops[ops.length - 1][0];
            for (const [o, w] of ops) { if (r < w) { opName = o; break; } r -= w; }
            movs.push([new Date(h + Math.floor(rnd() * 3600000 * frac)), e.area, 'SIGUIENTE', opName, qty, u]);
          });
        }
      }
    }
  }
  for (let i = 0; i < movs.length; i += 500) {
    const lote = movs.slice(i, i + 500), v = [];
    const ph = lote.map((m, j) => { v.push(...m); return `($${j * 6 + 1},$${j * 6 + 2},$${j * 6 + 3},$${j * 6 + 4},$${j * 6 + 5},$${j * 6 + 6},'demo')`; });
    await q(`INSERT INTO movimientos_etapa (fecha_hora, area_origen, area_destino, operacion, qty, usuario, origen) VALUES ${ph.join(',')}`, v);
  }
  console.log(`Movimientos de producción generados: ${movs.length}.`);

  // ---------- 3. Recepción del día ----------
  const base = turnosRecientes(ahora, c, 1)[0];
  const fRec = base.fecha;
  const PROV = ['PRV-1042 Electrohogar', 'PRV-2210 Textil Andino', 'PRV-3301 Muebles del Sur', 'PRV-4410 Deportes Pacífico',
    'PRV-5120 Juguetería Norte', 'PRV-6031 Calzado Austral', 'Devolución de clientes', 'Traslado desde CD2'];
  const { rows: [cr] } = await q(`INSERT INTO cargas (tipo, archivo, filas, corte, cargado_por) VALUES ('recepcion','Datos de demostración',34,now(),'demo') RETURNING id`);
  const d0 = new Date(fRec + 'T06:00:00').getTime();
  const citas = [];
  let anden = 1;
  for (let i = 0; i < 34; i++) {
    const prog = d0 + i * 28 * 60000, esp = Math.round(180 + rnd() * 1100);
    const x = { cita: `CT-${4810 + i}`, proveedor: pick(PROV), prog, llegada: null, inicio: null, fin: null, anden: null, esperadas: esp, recibidas: 0, estado: 'Programada' };
    const diff = (ahora - prog) / 60000;
    if (diff > -15) { x.llegada = prog + (rnd() * 40 - 15) * 60000; if (x.llegada > ahora) x.llegada = ahora - 5 * 60000; }
    if (x.llegada) {
      if (diff > 150 || (diff > 90 && rnd() > 0.3)) { x.estado = 'Recibida'; x.recibidas = Math.round(esp * (0.93 + rnd() * 0.07)); x.inicio = x.llegada + rnd() * 50 * 60000; x.fin = x.inicio + (35 + rnd() * 40) * 60000; x.anden = 1 + (i % 10); }
      else if (diff > 70) { x.estado = 'En inspección'; x.recibidas = Math.round(esp * (0.85 + rnd() * 0.15)); x.inicio = x.llegada + 15 * 60000; x.anden = anden++; }
      else if (diff > 20) { x.estado = 'Descargando'; x.recibidas = Math.round(esp * rnd() * 0.7); x.inicio = x.llegada + rnd() * 20 * 60000; x.anden = anden++; }
      else x.estado = 'En patio';
    }
    citas.push(x);
    const t = v => v ? new Date(v) : null;
    await q(`INSERT INTO recepcion_citas VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [fRec, x.cita, x.proveedor, t(x.prog), t(x.llegada), t(x.inicio), t(x.fin), x.anden, x.esperadas, x.recibidas, x.estado, cr.id]);
  }

  // ---------- 4. Almacenamiento ----------
  const { rows: [ca] } = await q(`INSERT INTO cargas (tipo, archivo, filas, corte, cargado_por) VALUES ('almacenamiento','Datos de demostración',0,now(),'demo') RETURNING id`);
  const ZONAS = [['RACK', 4200], ['OSR', 6000], ['VESTUARIO 1', 900], ['VESTUARIO 2', 900], ['VESTUARIO 3', 900], ['VESTUARIO 4', 900],
    ['SHELVING 3A', 1200], ['SHELVING 3B', 1200], ['COLGADO', 800], ['RPM', 600]];
  for (const [z, p] of ZONAS) {
    await q('INSERT INTO alm_zonas VALUES ($1,$2,$3,$4)', [ca.id, z, p, Math.round(p * (0.55 + rnd() * 0.4))]);
    await q('INSERT INTO alm_reposiciones VALUES ($1,$2,$3,$4)', [ca.id, z, Math.round(rnd() * 24), rnd() > 0.55 ? Math.round(1 + rnd() * 5) : 0]);
  }
  const recibidas = citas.filter(x => x.recibidas && x.inicio);
  for (let i = 0; i < 60 && recibidas.length; i++) {
    const x = pick(recibidas), r = rnd();
    let t = x.inicio + rnd() * ((x.fin || ahora) - x.inicio + 20 * 60000); if (t > ahora) t = ahora - rnd() * 600000;
    await q('INSERT INTO alm_lpn VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [ca.id, `LPN${900120 + i * 7}`, pick(ZONAS)[0], Math.round(10 + rnd() * 110), r < 0.45 ? 'Por ubicar' : r < 0.6 ? 'En curso' : 'Ubicado', new Date(t), x.cita]);
  }
  await q(`UPDATE cargas SET resumen = jsonb_build_object('citas', 34) WHERE id = $1`, [cr.id]);
  await q(`UPDATE cargas SET filas = 80, resumen = jsonb_build_object('zonas', 10, 'lpns', 60, 'reposiciones', 10) WHERE id = $1`, [ca.id]);
  console.log('Recepción y almacenamiento de muestra cargados.');

  // ---------- 5. Continuidad Operacional ----------
  const JEFES = { AM: 'Marcela Rojas', PM: 'Cristián Soto', Noche: 'Luis Fuentes' };
  const SUPS = { AM: ['Javier Pérez', 'Andrea Muñoz'], PM: ['Paula González', 'Rodrigo Díaz'], Noche: ['Felipe Castro', 'Valeria Reyes'] };
  await q(`INSERT INTO personas (nombre, rol) VALUES ('Carlos Guardo', 'Jefe de Operaciones')`);
  const jefeId = {}, supIds = {};
  for (const t of c.turnos) {
    jefeId[t.id] = (await q(`INSERT INTO personas (nombre, rol, turno_id) VALUES ($1,'Jefe de Turno',$2) RETURNING id`, [JEFES[t.id], t.id])).rows[0].id;
    supIds[t.id] = [];
    for (const n of SUPS[t.id]) supIds[t.id].push((await q(`INSERT INTO personas (nombre, rol, turno_id, reporta_a) VALUES ($1,'Supervisor',$2,$3) RETURNING id`, [n, t.id, jefeId[t.id]])).rows[0].id);
  }
  const REQ = { 'Jefe de Operaciones': 1, 'Jefe de Turno': 1, 'Supervisor::OSR-Empaque': 1, 'Supervisor::OSR-Putwall': 1, 'Supervisor::SH1': 1,
    'Supervisor::SH2': 1, 'Supervisor::SH3': 1, 'Administrativo::OSR-Empaque': 1, 'Administrativo::OSR-Putwall': 1, 'Administrativo::SH1': 1,
    'Administrativo::SH2': 1, 'Operario Multifuncional::OSR-Empaque': 10, 'Operario Multifuncional::OSR-Putwall': 8,
    'Operario Multifuncional::SH1': 6, 'Operario Multifuncional::SH2': 6, 'Operario Multifuncional::SH3': 4 };
  for (const t of c.turnos) for (const f of filasAsistencia()) {
    const base = REQ[f.fila] || 0;
    const cant = f.fila.startsWith('Operario') && t.id === 'Noche' ? Math.max(1, Math.round(base * 0.7)) : f.fila === 'Jefe de Operaciones' && t.id !== 'AM' ? 0 : base;
    await q('INSERT INTO dotacion_requerida VALUES ($1,$2,$3)', [t.id, f.fila, cant]);
  }

  const TAREAS = [['Inventario', 'Inventario cíclico pasillo 12'], ['Recall', 'Recall SKU 4410-22, retirar de ubicación'],
    ['Extracción Tote Vacíos', 'Extracción de totes vacíos en OSR'], ['Consolidación', 'Consolidar ola 118 antes del corte'],
    ['Control PKT', 'Control PKT andén 3'], ['Flujo Click y DD', 'Despachar corte Click y DD de las 13:00'],
    ['Almacenamiento', 'Ubicar LPN pendientes de recepción'], ['Stock Unitario', 'Revisión stock unitario vestuario 2'],
    ['Flujo de Traspaso', 'Traspaso a CD2, 4 pallets'], ['Inventario', 'Conteo de diferencias zona SH2'],
    ['Consolidación', 'Liberar posiciones del putwall 3']];
  const SIT = ['Operación estable. Sorter OSR con dos detenciones cortas por atasco.', 'Se liberaron dos olas con retraso por validación de stock.',
    'Empaque con dotación incompleta la primera hora; se reasignó personal desde picking.', 'Sin novedades mayores. Andén 3 con puerta lenta.'];
  const RIE = ['Quedan 4 pallets de traspaso a CD2 sin despachar.', 'Impresora de etiquetas de empaque 2 fallando intermitente.',
    'Stock bajo en ubicaciones de picking de vestuario 1.', 'Compromiso Click y DD de mañana con volumen alto.'];

  const recientes = turnosRecientes(ahora, c, 10);
  const futuros = []; { let x = recientes.at(-1); for (let i = 0; i < 3; i++) { x = siguienteTurno(x.fecha, x.turno, c); futuros.push(x); } }
  for (const inst of [...recientes, ...futuros]) {
    const terminado = ahora >= inst.end, enCurso = ahora >= inst.start && !terminado;
    const avance = terminado ? 1 : enCurso ? (ahora - inst.start) / (inst.end - inst.start) : 0;
    const pool_ = TAREAS.slice();
    const n = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const [cat_, tit] = pool_.splice(Math.floor(rnd() * pool_.length), 1)[0];
      // los turnos más antiguos dejan muy pocas tareas abiertas; los recientes, algunas más
      const antiguo = terminado && ahora - inst.end > 16 * H;
      const cerrada = (terminado || enCurso) && rnd() < (antiguo ? 0.93 : 0.55 + avance * 0.37);
      const asignado = rnd() < 0.5 ? pick(supIds[inst.turno]) : jefeId[inst.turno];
      await q(`INSERT INTO tareas (titulo, categoria, fecha, turno_id, estado, origen, asignado_por, asignado_a, creado_en, cerrado_en, cerrado_por)
        VALUES ($1,$2,$3,$4,$5,'operaciones','Carlos Guardo',$6,$7,$8,$9)`,
        [tit, cat_, inst.fecha, inst.turno, cerrada ? 'cerrada' : 'abierta', asignado, new Date(inst.start - 3 * H),
          cerrada ? new Date(Math.min(ahora, inst.start + rnd() * (inst.end - inst.start))) : null, cerrada ? JEFES[inst.turno] : null]);
    }
    if (terminado || enCurso) {
      const valores = {};
      const req = (await q('SELECT fila, cantidad FROM dotacion_requerida WHERE turno_id = $1', [inst.turno])).rows;
      const ausentismo = inst.turno === 'Noche' ? 0.78 : 0.86;
      req.forEach(r => { valores[r.fila] = r.fila.startsWith('Operario') ? Math.round(r.cantidad * (ausentismo + rnd() * 0.18)) : r.cantidad; });
      await q('INSERT INTO asistencia VALUES ($1,$2,$3,$4,$5)', [inst.fecha, inst.turno, valores, JEFES[inst.turno], new Date(inst.start + 25 * 60000)]);
    }
    if (terminado) {
      const sig = siguienteTurno(inst.fecha, inst.turno, c);
      const entrega = inst.end + (4 + rnd() * 15) * 60000;
      const confirma = sig && ahora > entrega + 20 * 60000 && rnd() < 0.88;
      await q(`INSERT INTO handovers (fecha, turno_id, jefe, situacion, riesgos, entregado_en, estado, jefe_entrante, confirmado_en)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [inst.fecha, inst.turno, JEFES[inst.turno], pick(SIT), pick(RIE), new Date(Math.min(entrega, ahora - 60000)),
          confirma ? 'confirmado' : 'pendiente', confirma ? JEFES[sig.turno] : null, confirma ? new Date(entrega + (8 + rnd() * 30) * 60000) : null]);
    }
  }
  // Traspaso de pendientes; la mayoría de las tareas heredadas se cierran en el turno que las recibe
  await autoTraspaso();
  const heredadas = (await q(`SELECT id, fecha, turno_id FROM tareas WHERE veces_transferida = 1`)).rows;
  for (const t of heredadas) {
    const i = instancia(t.fecha, t.turno_id, c);
    if (ahora < i.start + 2 * H || rnd() > 0.8) continue;
    await q(`WITH RECURSIVE d AS (SELECT id FROM tareas WHERE heredada_de = $1 UNION ALL SELECT x.id FROM tareas x JOIN d ON x.heredada_de = d.id)
      DELETE FROM tareas WHERE id IN (SELECT id FROM d)`, [t.id]);
    await q(`UPDATE tareas SET estado = 'cerrada', cerrado_en = $2, cerrado_por = $3 WHERE id = $1`, [t.id, new Date(i.start + 2 * H), JEFES[t.turno_id]]);
  }
  console.log('Equipo, compromisos, asistencia y entregas de turno generados.');

  // ---------- 6. Cierres de los turnos anteriores (el último terminado queda por cerrar) ----------
  const terminados = recientes.filter(i => ahora >= i.end);
  const causas = (await q('SELECT id, nombre FROM causas ORDER BY orden')).rows;
  const sesgoCausa = [0, 0, 1, 3, 3, 4, 6, 0, 8];
  for (const inst of terminados.slice(0, -1)) {
    const inf = await informe(inst.fecha, inst.turno);
    await tx(async cl => {
      for (const d of inf.devs) {
        const cz = causas[pick(sesgoCausa)] || causas[0];
        await cl.query(`INSERT INTO desvio_causas (fecha, turno_id, area, hora, causa_id, minutos, brecha) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [inst.fecha, inst.turno, d.area, new Date(d.t), cz.id, Math.round(5 + rnd() * 25), d.brecha]);
      }
      await cl.query(`INSERT INTO cierres_turno (fecha, turno_id, jefe, resumen, cerrado_en, cerrado_por) VALUES ($1,$2,$3,$4,$5,$3)`,
        [inst.fecha, inst.turno, JEFES[inst.turno], { pct: inf.control.pct, unidades: inf.control.u, meta: inf.control.mAc }, new Date(inst.end + 40 * 60000)]);
    });
  }
  console.log(`Cierres registrados: ${Math.max(0, terminados.length - 1)}. Listo.`);
}

main().then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
