// Prueba del motor de Gestión Diaria sin base de datos: npm run gestion:prueba-motor -- [archivo Base] [fecha aaaa-mm-dd]
import fs from 'node:fs';
import { leerBase, leerReservadas } from '../src/gestion/engine/base.js';
import { planificarDia } from '../src/gestion/engine/plan.js';
import { tareasConsolidacion, repartirConsolidacion, claveBloque } from '../src/gestion/engine/consolidacion.js';
import { stockUnitario, repartirStockUnitario } from '../src/gestion/engine/stockUnitario.js';
import { detalleSlowMoving, simular } from '../src/gestion/engine/slowMoving.js';
import { DEFAULTS } from '../src/gestion/services/parametros.js';

const archivo = process.argv[2] || 'data/ejemplo-gestion/Base_inicio_ejemplo.xlsx';
const fecha = process.argv[3] || '2026-10-20';
const p = Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, d.v]));
const t0 = Date.now();
const base = leerBase(fs.readFileSync(archivo), archivo);
console.log(`Base: ${base.filas.length} filas, hoja "${base.hoja}" (${Date.now() - t0} ms)`);
console.log('Columnas:', base.columnas);
if (base.avisos.length) console.log('Avisos:', base.avisos);
const resv = fs.existsSync('data/ejemplo-gestion/Blq_Stk_unit_ejemplo.xlsx') ? leerReservadas(fs.readFileSync('data/ejemplo-gestion/Blq_Stk_unit_ejemplo.xlsx')) : [];
const reservadas = new Set(resv.map((r) => r.ubicacion));
const cds = [...new Set(base.filas.map((f) => f.cd))].filter((c) => c !== 'OSR');
for (const cd of cds) {
  const t1 = Date.now();
  const pl = planificarDia({ filas: base.filas, cd, reservadas, excluido: false, hechas: new Set(), fecha, p, modo: 3, recInv: 2, recCon: 4 });
  const r = pl.resumen;
  console.log(`\n${cd} · plan ${fecha}: ${pl.nTurnosDia} turnos · INV hoy ${r.hhWI.toFixed(1)}/${r.totI.toFixed(1)} HH (${r.zonasHoy} zonas, ${r.zonasPend} pendientes) · CONS hoy ${r.hhWC.toFixed(1)}/${r.totC.toFixed(1)} HH · ${Date.now() - t1} ms`);
  for (const l of pl.lineas) console.log(`   T${l.turno} ${l.tarea.padEnd(13)} ${l.piso} ${l.zp}  ${l.hh.toFixed(2)} HH  ${(l.pct * 100).toFixed(0)}%  ${l.ops}  ${l.ubicaciones ?? l.movimientos}`);
  const zonas = new Set(pl.lineas.filter((l) => l.tarea === 'CONSOLIDACION').map((l) => l.piso.toUpperCase() + '|' + l.zp.toUpperCase()));
  const g = tareasConsolidacion({ filas: base.filas, cd, reservadas, zonasTurno: zonas });
  const mov = g.flatMap((x) => x.lineas.filter((l) => l.accion === 'MOVER').map((l) => ({ ...l, cd, folio: x.folio, sub: x.sub, sku: x.sku })));
  const rep = repartirConsolidacion(mov, 4, `OP ${cd} T1`, true);
  console.log(`   Consolidación del día: ${g.length} SKU, ${mov.length} movimientos`);
  rep.resumen.forEach((x) => console.log(`     ${x.operario} [${x.piso}] zonas ${x.zonas}: ${x.paradas} paradas, ${x.unidades} un.`));
  rep.alertas.forEach((a) => console.log('     ALERTA', a));
  if (mov.length && !rep.porBloque.get(claveBloque(mov[0]))) throw new Error('bloque sin operario');
  const su = stockUnitario({ filas: base.filas, cd, reservadas: resv, excluidos: new Set(['OSR']) });
  const rsu = repartirStockUnitario(su.lineas || [], 2, `OP ${cd} SU`);
  console.log(`   Stock unitario: ${su.lineas?.length} SKU, sin ubicación ${su.lineas?.filter((l) => l.dest === 'SIN UBICACION').length}`, rsu);
}
const sm = detalleSlowMoving(base.filas, { corte: fecha, tramos: [90, 180, 365] });
const sim = simular(sm.detalle, { ventas: '=0', tramos: [3, 4] });
console.log(`\nSlow moving: ${sm.detalle.length} SKU x CD · sin venta y > 180 días: ${sim.total.skus} SKU, ${sim.total.unidades} un., $${Math.round(sim.total.valor).toLocaleString('es-CL')}, libera ${sim.total.libera} ubic.`);
console.log(`Total ${Date.now() - t0} ms`);
