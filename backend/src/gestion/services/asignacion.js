// Asignación diaria en un clic (port de mod11_AsignacionDiaria): plan diario, stock unitario, tareas de
// consolidación por turno con su reparto, inventario del plan y slow moving en cola.
import { q, tx } from '../db.js';
import { leerParametros } from './parametros.js';
import { filasDeCarga, cargaInicio } from './stock.js';
import { planificarDia } from '../engine/plan.js';
import { tareasConsolidacion, repartirConsolidacion, claveBloque } from '../engine/consolidacion.js';
import { stockUnitario, repartirStockUnitario, SIN_UBICACION } from '../engine/stockUnitario.js';
import { clasificacionActual } from './abcXyz.js';
import { TODOS } from '../engine/abcXyz.js';
import { up, cmp, fmtFecha } from '../engine/util.js';

const T_COLS = ['asignacion_id', 'fecha', 'cd', 'turno', 'proceso', 'folio', 'sub', 'secuencia', 'piso', 'zona', 'ubic_origen', 'sku', 'descripcion',
  'ubic_destino', 'asignado_a', 'supervisor', 'unid_asig', 'estado', 'detalle', 'observacion', 'ext_id'];

export async function avanceRegistrado(fecha) {
  const { rows } = await q("SELECT count(*)::int AS n FROM tareas WHERE fecha = $1 AND (estado NOT IN ('PENDIENTE','SIN DESTINO') OR unid_real IS NOT NULL)", [fecha]);
  return rows[0].n;
}

export async function generarAsignacion(fecha, { forzar = false } = {}) {
  const t0 = Date.now();
  const log = [];
  const L = (tipo, ctx, texto) => log.push({ hora: new Date().toISOString(), tipo, ctx, texto });
  const carga = await cargaInicio(fecha);
  if (!carga) throw Object.assign(new Error(`No hay Base del inicio de la jornada para el ${fmtFecha(fecha)}. Cárgala en "Asignación del día".`), { status: 400 });
  const conAvance = await avanceRegistrado(fecha);
  if (conAvance > 0 && !forzar) {
    throw Object.assign(new Error(`El ${fmtFecha(fecha)} ya tiene ${conAvance} tareas con avance registrado. Si regeneras, ese avance se pierde.`), { status: 409, conAvance });
  }
  // al regenerar, lo que se asignó ese día vuelve a estar disponible (slow moving en cola y zonas del ciclo)
  await q("UPDATE sm_cola SET estado = 'EN COLA', fecha_asig = NULL WHERE estado = 'ASIGNADA' AND fecha_asig = $1", [fecha]);
  await q('DELETE FROM avance_inventario WHERE fecha = $1', [fecha]);
  const p = await leerParametros();
  const filas = await filasDeCarga(carga.id);
  const { rows: cds } = await q('SELECT * FROM cd_config WHERE activo ORDER BY cd');
  if (!cds.length) throw Object.assign(new Error('No hay CD activos en Configuración.'), { status: 400 });
  const { rows: resv } = await q('SELECT ubicacion, grupo, max FROM ubic_reservadas');
  const reservadas = new Set(resv.map((r) => up(r.ubicacion)));
  const cdsBase = new Set(filas.map((r) => r.cd));
  // clase ABC/XYZ consolidada por SKU: prioriza la consolidación y queda en el detalle de cada tarea
  let claseSku = new Map();
  try { claseSku = new Map((await clasificacionActual()).grupos.get(TODOS).map((x) => [x.sku, x.matriz])); } catch (e) { L('ALERTA', 'ABC/XYZ', `Sin clasificación ABC/XYZ: ${e.message}`); }
  const cls = (sku) => claseSku.get(sku) || '';
  const conCls = (txt, sku) => (cls(sku) ? (txt ? `${txt} · ABC ${cls(sku)}` : `ABC ${cls(sku)}`) : txt || null);
  const ORDEN_ABC = { A: 0, B: 1, C: 2 };

  const tareas = [], plan = [], resumen = [], smUsadas = [];
  for (const c of cds) {
    const cd = c.cd;
    if (!cdsBase.has(cd)) { L('ALERTA', cd, 'El CD no aparece en la Base del día: no se generaron tareas.'); continue; }
    const pref = (c.prefijo || 'OP').trim();
    // --- ciclo de inventario
    const { rows: av } = await q('SELECT piso, zona FROM avance_inventario WHERE cd = $1', [cd]);
    let hechas = new Set(av.map((r) => up(r.piso) + '|' + up(r.zona)));
    // --- plan diario
    let pl = planificarDia({ filas, cd, reservadas, excluido: p.excluidos.has(cd), hechas, fecha, p, modo: p.modoTareas, recInv: c.rec_inv, recCon: c.op_cons });
    if (pl.resumen && p.modoTareas !== 2 && pl.resumen.zonasInv === 0 && hechas.size > 0) {
      await q('DELETE FROM avance_inventario WHERE cd = $1', [cd]);
      hechas = new Set();
      L('INFO', cd, `Ciclo de inventario completo (${pl.resumen.zonasCiclo} zonas). Se reinició el ciclo.`);
      pl = planificarDia({ filas, cd, reservadas, excluido: p.excluidos.has(cd), hechas, fecha, p, modo: p.modoTareas, recInv: c.rec_inv, recCon: c.op_cons });
    }
    const nTur = pl.nTurnosDia;
    if (!nTur) { L('INFO', cd, 'Hoy no hay turnos en el calendario.'); continue; }
    pl.lineas.forEach((l) => plan.push({ cd, ...l }));
    const r = pl.resumen;
    if (r) L('INFO', cd, `Plan diario: inventario ${r.hhWI.toFixed(1)} de ${r.totI.toFixed(1)} HH (${r.zonasHoy} zonas hoy, ${r.zonasPend} pendientes, ${r.zonasCiclo} ya en el ciclo); consolidación ${r.hhWC.toFixed(1)} de ${r.totC.toFixed(1)} HH.`);
    const sup = (tt) => (c['sup_t' + tt] || '').trim() || `SUPERVISOR T${tt}`;

    // --- consolidación del día: todos los movimientos de las zonas del plan, repartidos por turno según el % de cada zona
    const linCons = pl.lineas.filter((l) => l.tarea === 'CONSOLIDACION');
    const zonasDia = new Set(linCons.map((l) => up(l.piso) + '|' + up(l.zp)));
    const grupos = zonasDia.size ? tareasConsolidacion({ filas, cd, reservadas, zonasTurno: zonasDia }) : [];
    const movsPorZona = new Map();
    for (const g of grupos) for (const l of g.lineas) {
      if (l.accion !== 'MOVER') continue;
      const zk = up(l.piso) + '|' + up(l.zp);
      if (!movsPorZona.has(zk)) movsPorZona.set(zk, []);
      movsPorZona.get(zk).push({ ...l, sku: g.sku, desc: g.desc, cap: g.cap });
    }
    const turnoDeMov = new Map();
    for (const [zk, movs] of movsPorZona) {
      movs.sort((a, b) => cmp(a.ori, b.ori) || cmp(a.sku, b.sku));
      const lz = linCons.filter((l) => up(l.piso) + '|' + up(l.zp) === zk);
      let acum = 0, desde = 0;
      lz.forEach((l, i) => {
        acum += l.pct;
        const hasta = i === lz.length - 1 ? movs.length : Math.min(movs.length, Math.round(acum * movs.length));
        for (let j = desde; j < hasta; j++) turnoDeMov.set(movs[j], l.turno);
        desde = hasta;
      });
    }
    const resCD = { cd, turnos: [] };
    // --- stock unitario
    let su = null;
    if (c.stock_unitario) {
      su = stockUnitario({ filas, cd, reservadas: resv, excluidos: p.excluidos, maxDef: p.suMaxDef });
      if (su.aviso) L('ALERTA', cd, su.aviso);
      else {
        repartirStockUnitario(su.lineas, c.op_su, `${pref} ${cd} SU`, p.suMin2Op);
        const sin = su.lineas.filter((l) => l.dest === SIN_UBICACION).length;
        L(sin ? 'ALERTA' : 'INFO', cd, `Stock unitario: ${su.lineas.length} SKU unitarios, ${su.lineas.length - sin} con destino${sin ? `, ${sin} SIN UBICACIÓN (ampliar Blq_Stk_unit)` : ''}.`);
      }
    }
    const turSU = Math.min(Math.max(1, c.turno_su || 1), nTur);
    const turSM = Math.min(Math.max(1, c.turno_sm || 1), nTur);
    const { rows: cola } = await q("SELECT * FROM sm_cola WHERE cd = $1 AND estado = 'EN COLA' ORDER BY id", [cd]);

    for (let tt = 1; tt <= nTur; tt++) {
      const s = sup(tt);
      const rt = { turno: tt, supervisor: s, INV: 0, CONS: 0, SU: 0, SM: 0, REU: 0, unidades: 0, operarios: [] };
      // inventario del plan
      for (const l of pl.lineas.filter((x) => x.tarea === 'INVENTARIO' && x.turno === tt)) {
        tareas.push({ fecha, cd, turno: tt, proceso: 'INV', folio: `INV-${fecha.slice(8, 10)}${fecha.slice(5, 7)}-T${tt}`, sub: null, secuencia: null,
          piso: l.piso, zona: l.zp, ubic_origen: null, sku: null, descripcion: `Contar zona ${l.zp} (${l.nOps} operario/s, ${Math.round(l.pct * 100)}% de la zona)`,
          ubic_destino: null, asignado_a: `${pref} ${cd} T${tt} INV ${l.ops}`, supervisor: s, unid_asig: l.ubicaciones || 0, estado: 'PENDIENTE',
          detalle: `${l.hh.toFixed(2)} HH plan`, observacion: null, ext_id: `I|${cd}|${fecha.replace(/-/g, '')}|T${tt}|${up(l.piso)}|${up(l.zp)}` });
        rt.INV++; rt.unidades += l.ubicaciones || 0;
      }
      // consolidación del turno, agrupada por SKU (una tarea por SKU)
      const porSku = new Map();
      for (const [mv, t] of turnoDeMov) if (t === tt) {
        if (!porSku.has(mv.sku)) porSku.set(mv.sku, []);
        porSku.get(mv.sku).push(mv);
      }
      // primero los SKU clase A (picking más frecuente), después B y C; dentro de la clase, los que más ubicaciones liberan
      const prio = (sku) => ORDEN_ABC[cls(sku)[0]] ?? 3;
      const gruposT = [...porSku.entries()].map(([sku, movs]) => ({ sku, movs })).sort((a, b) => prio(a.sku) - prio(b.sku) || b.movs.length - a.movs.length || cmp(a.sku, b.sku));
      const lineasMover = [];
      gruposT.forEach((g, i) => g.movs.forEach((m) => lineasMover.push({ ...m, cd, folio: `T-${String(i + 1).padStart(5, '0')}`, sub: '1/1' })));
      if (lineasMover.length) {
        const rep = repartirConsolidacion(lineasMover, Math.max(1, c.op_cons), `${pref} ${cd} T${tt}`, String(p.porPiso).toUpperCase().startsWith('S'));
        rep.alertas.forEach((a) => L('ALERTA', `${cd} T${tt}`, a));
        for (const l of lineasMover) { const b = rep.porBloque.get(claveBloque(l)); l.op = b.operario; l.obs = b.obs; l.orden = b.orden; }
        const porOp = new Map();
        lineasMover.forEach((l) => { if (!porOp.has(l.op)) porOp.set(l.op, []); porOp.get(l.op).push(l); });
        for (const [, ls] of porOp) {
          ls.sort((a, b) => cmp(a.orden, b.orden) || cmp(a.sku, b.sku) || cmp(a.ori, b.ori));
          ls.forEach((l, i) => tareas.push({ fecha, cd, turno: tt, proceso: 'CONS', folio: l.folio, sub: l.sub, secuencia: i + 1, piso: l.piso, zona: l.zp,
            ubic_origen: l.ori, sku: l.sku, descripcion: l.desc, ubic_destino: l.dest, asignado_a: l.op, supervisor: s, unid_asig: l.q, estado: 'PENDIENTE',
            detalle: conCls(l.detalle, l.sku), observacion: l.obs || null, ext_id: `CON|${l.folio}|${l.sub}|${l.ori}` }));
        }
        rt.CONS = lineasMover.length; rt.unidades += lineasMover.reduce((a, l) => a + l.q, 0);
        rt.operarios = rep.resumen.filter((x) => x.bloques);
        L('INFO', `${cd} T${tt}`, `Consolidación: ${gruposT.length} SKU, ${lineasMover.length} movimientos (= ubicaciones que se liberan), ${rt.operarios.length} operarios.`);
      } else if (linCons.some((l) => l.turno === tt)) {
        L('INFO', `${cd} T${tt}`, 'Sin movimientos de consolidación ejecutables en las zonas del turno.');
      }
      // stock unitario en su turno
      if (su && su.lineas && tt === turSU) {
        for (const l of su.lineas) {
          const sinDest = l.dest === SIN_UBICACION;
          tareas.push({ fecha, cd, turno: tt, proceso: 'SU', folio: l.folio, sub: null, secuencia: l.sec, piso: l.piso, zona: l.zp, ubic_origen: l.ori, sku: l.sku,
            descripcion: l.desc, ubic_destino: l.dest, asignado_a: l.asignado, supervisor: s, unid_asig: 1, estado: sinDest ? 'SIN DESTINO' : 'PENDIENTE',
            detalle: conCls(l.ocupacion ? `Destino ${l.grupo} · ocupación ${l.ocupacion}${l.libera ? ' · libera la ubicación' : ''}` : null, l.sku), observacion: l.obs || null,
            ext_id: `STO|${l.folio}||${l.ori}` });
          if (!sinDest) { rt.SU++; rt.unidades += 1; }
        }
      }
      // slow moving y reubicaciones ABC en cola
      if (tt === turSM && cola.length) {
        const n = { SM: 0, REU: 0 };
        cola.forEach((x) => {
          const reu = x.tipo === 'REU';
          const i = ++n[reu ? 'REU' : 'SM'];
          tareas.push({ fecha, cd, turno: tt, proceso: reu ? 'REU' : 'SM', folio: `${reu ? 'R' : 'S'}-${String(i).padStart(5, '0')}`, sub: null, secuencia: i, piso: x.piso, zona: x.zona,
            ubic_origen: x.ubicacion, sku: x.sku, descripcion: x.descripcion, ubic_destino: x.destino, asignado_a: `${pref} ${cd} T${tt} ${reu ? 'REU' : 'SM'}`, supervisor: s,
            unid_asig: x.unidades, estado: 'PENDIENTE',
            detalle: reu ? `Reubicación ABC ${x.temporada} → ${x.destino}` : conCls(`${x.depto} · ${x.temporada} · almacenado ${x.mes}`, x.sku),
            observacion: null, ext_id: `${reu ? 'REU' : 'SLO'}|S-${x.id}||${x.ubicacion}` });
          rt.unidades += Number(x.unidades) || 0;
          smUsadas.push(x.id);
        });
        rt.SM = n.SM; rt.REU = n.REU;
        if (n.SM) L('INFO', `${cd} T${tt}`, `Slow moving: ${n.SM} tareas desde el simulador.`);
        if (n.REU) L('INFO', `${cd} T${tt}`, `Reubicación ABC: ${n.REU} tareas de alta rotación hacia ${up(p.cdPrioritario)}.`);
      }
      resCD.turnos.push(rt);
    }
    resumen.push(resCD);
  }

  const seg = (Date.now() - t0) / 1000;
  const asig = await tx(async (cx) => {
    // reemplaza la asignación anterior del mismo día
    const { rows: prev } = await cx.query('SELECT id FROM asignaciones WHERE fecha = $1', [fecha]);
    if (prev.length) {
      await cx.query('DELETE FROM asignaciones WHERE fecha = $1', [fecha]);
      await cx.query('DELETE FROM tareas WHERE fecha = $1', [fecha]);
    }
    const { rows } = await cx.query('INSERT INTO asignaciones (fecha, carga_id, segundos, resumen, log) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [fecha, carga.id, seg, JSON.stringify(resumen), JSON.stringify(log)]);
    const id = rows[0].id;
    for (let i = 0; i < tareas.length; i += 2000) {
      const lote = tareas.slice(i, i + 2000);
      const vals = [], params = [];
      lote.forEach((t, j) => {
        const row = { asignacion_id: id, ...t };
        vals.push('(' + T_COLS.map((_, k) => `$${j * T_COLS.length + k + 1}`).join(',') + ')');
        T_COLS.forEach((k) => params.push(row[k] ?? null));
      });
      await cx.query(`INSERT INTO tareas (${T_COLS.join(',')}) VALUES ${vals.join(',')}`, params);
    }
    for (const l of plan) {
      await cx.query('INSERT INTO plan_lineas (asignacion_id, cd, fecha, turno, tarea, piso, zona, hh, pct, operarios, ubicaciones, movimientos, orden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [id, l.cd, l.fecha, l.turno, l.tarea, l.piso, l.zp, l.hh, l.pct, l.ops, l.ubicaciones, l.movimientos, l.orden]);
    }
    if (smUsadas.length) await cx.query("UPDATE sm_cola SET estado = 'ASIGNADA', fecha_asig = $1 WHERE id = ANY($2)", [fecha, smUsadas]);
    return rows[0];
  });
  return { ...asig, tareas: tareas.length };
}
