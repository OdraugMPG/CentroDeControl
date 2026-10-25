// Datos base: turnos, calendario, etapas, metas, causas y parámetros.
// Se puede ejecutar varias veces: no pisa lo que ya fue configurado.
import { fileURLToPath } from 'node:url';
import { pool, tx } from './db.js';
import { migrate } from './migrate.js';

export const TURNOS = [
  ['AM', 'AM', 6, 8, 1],
  ['PM', 'PM', 14, 8, 2],
  ['Noche', 'Noche', 22, 8, 3]
];

// Lunes a viernes 3 turnos, sábado AM y PM, domingo sin operación
const CALENDARIO = {
  0: [], 1: ['AM', 'PM', 'Noche'], 2: ['AM', 'PM', 'Noche'], 3: ['AM', 'PM', 'Noche'],
  4: ['AM', 'PM', 'Noche'], 5: ['AM', 'PM', 'Noche'], 6: ['AM', 'PM']
};

export const ETAPAS = [
  ['01_Picking_Pendiente', 'Picking pendiente', 'Picking', 1, 220],
  ['02_En_Transito', 'En tránsito', 'Picking', 2, 210],
  ['03_En_Buffer', 'En buffer', 'Picking', 3, 90],
  ['03_En_Proceso', 'En proceso', 'Picking', 4, 120],
  ['04_En_Panal', 'En panal', 'Consolidación', 5, 110],
  ['05_En_Empaque', 'En empaque', 'Empaque', 6, 200],
  ['06_Empacado', 'Empacado', 'Empaque', 7, 120],
  ['06_Empacado_OSR', 'Empacado OSR', 'Empaque', 8, 90],
  ['07_Pre_Jaula', 'Pre jaula', 'Despacho', 9, 180],
  ['09_Sorter_OSR', 'Sorter OSR', 'Despacho', 10, 80],
  ['10_Palid', 'Palid', 'Despacho', 11, 170]
];

const CAUSAS = ['Dotación o ausentismo', 'Falla de equipo (sorter, RF, impresora)', 'Sistema WMS o conectividad',
  'Falta de stock o reposición', 'Ola liberada tarde o sin trabajo', 'Recepción atrasada',
  'Congestión en la etapa siguiente', 'Calidad o reproceso', 'Pausa no planificada', 'Otra'];

export const PARAMETROS = {
  metaRecepcionHora: 1800,   // unidades por hora
  andenes: 10,
  umbralZona: 0.85,          // ocupación sobre la que se alerta
  umbralDesvio: 0.85,        // cumplimiento horario bajo el que se exige causa
  minAntiguo: 120,           // minutos de una tarea de pedidos sin movimiento
  minPatio: 45,              // minutos de espera en patio
  minAnden: 60,              // minutos de descarga
  minUbicar: 90,             // minutos de un LPN sin ubicar
  minConfirmacion: 30,       // minutos máximos para confirmar la recepción de un turno
  minAntesCierre: 30         // un turno se puede cerrar desde estos minutos antes de su término
};

export async function seed() {
  await migrate();
  await tx(async c => {
    for (const [id, nombre, ini, dur, orden] of TURNOS)
      await c.query('INSERT INTO turnos VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING', [id, nombre, ini, dur, orden]);
    for (let d = 0; d < 7; d++)
      for (const [id] of TURNOS)
        await c.query('INSERT INTO turno_calendario VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [d, id, CALENDARIO[d].includes(id)]);
    for (const [area, nombre, fase, orden, meta] of ETAPAS) {
      await c.query('INSERT INTO etapas VALUES ($1,$2,$3,$4) ON CONFLICT (area) DO NOTHING', [area, nombre, fase, orden]);
      for (const [t] of TURNOS)
        await c.query('INSERT INTO metas_etapa VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [area, t, meta]);
    }
    for (const [i, n] of CAUSAS.entries())
      await c.query('INSERT INTO causas (nombre, orden) VALUES ($1,$2) ON CONFLICT (nombre) DO NOTHING', [n, i + 1]);
    for (const [k, v] of Object.entries(PARAMETROS))
      await c.query('INSERT INTO parametros VALUES ($1,$2) ON CONFLICT (clave) DO NOTHING', [k, JSON.stringify(v)]);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed().then(() => { console.log('Catálogos cargados.'); return pool.end(); })
    .catch(e => { console.error(e); process.exit(1); });
}
