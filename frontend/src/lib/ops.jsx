// Cálculos del centro de control a partir de la foto en vivo (snapshot)
import { sum, uniq, minsDesde, fmtAge, pctf, N, FASES, hh } from './fmt.js';

export const BLANCO = '(en blanco)';
export const FILTROS = [
  ['fecha_compromiso', 'Fecha compromiso'], ['tipo_ola', 'Tipo ola'], ['cd', 'CD'], ['flujo', 'Flujo'], ['tipo_od', 'Tipo OD'],
  ['region', 'Región'], ['jaula', 'Jaula'], ['tipo_transaccion', 'Tipo transacción'], ['operacion', 'Operación'],
  ['especial', 'Especial'], ['retira', 'Retira']
];
export const val = (r, k) => r[k] || BLANCO;
export const filtrar = (pedidos, f) => pedidos.filter(r => FILTROS.every(([k]) => !f[k]?.size || f[k].has(val(r, k))));
export const nFiltros = f => Object.values(f).reduce((s, x) => s + (x?.size || 0), 0);

export function catalogoEtapas(meta, pedidos) {
  const cat = meta?.etapas || [];
  const conocidas = new Set(cat.map(e => e.area));
  const extra = [...new Set(pedidos.map(p => p.area))].filter(a => !conocidas.has(a)).sort()
    .map(a => ({ area: a, nombre: a.replace(/^\d+_/, '').replace(/_/g, ' '), fase: 'Despacho' }));
  return [...cat, ...extra];
}

export function mPedidos(f, etapas, corte, p, hoy) {
  const ord = new Map(etapas.map((e, i) => [e.area, i]));
  const faseDe = a => etapas[ord.get(a)]?.fase || 'Despacho';
  const pend = f.filter(r => r.area === etapas[0]?.area);
  const listo = f.filter(r => faseDe(r.area) === 'Despacho');
  const riesgo = f.filter(r => r.fecha_compromiso && r.fecha_compromiso <= hoy && faseDe(r.area) !== 'Despacho');
  const maxPend = pend.length ? Math.max(...pend.map(r => minsDesde(r.t, corte))) : 0;
  const st = etapas.map(e => {
    const rows = f.filter(r => r.area === e.area);
    return { ...e, qty: sum(rows, r => r.qty), ord: uniq(rows, 'orden'), max: rows.length ? Math.max(...rows.map(r => minsDesde(r.t, corte))) : 0 };
  });
  return { pend, listo, riesgo, maxPend, st, tot: sum(f, r => r.qty), faseDe };
}

export function etapasParaFlujo(st, p, compacto) {
  return st.map(s => ({
    key: s.area, nombre: s.nombre, qty: s.qty, fase: s.fase, color: FASES[s.fase] || '--slate',
    meta: compacto
      ? <span className={s.max > p.minAntiguo ? 'old' : ''}>{s.qty ? fmtAge(s.max) : '—'}</span>
      : <>{s.ord} órdenes<br /><span className={s.max > p.minAntiguo ? 'old' : ''}>{s.qty ? `Más antigua ${fmtAge(s.max)}` : 'Sin tareas'}</span></>
  }));
}
export const FASES_FLUJO = Object.entries(FASES).map(([nombre, color]) => ({ nombre, color }));

export function mRecepcion(snap, p, turnoSel) {
  const citas = snap.recepcion.citas, ahora = snap.ahora;
  const patio = citas.filter(x => x.estado === 'En patio');
  const enAnden = citas.filter(x => ['Descargando', 'En inspección'].includes(x.estado));
  const tdh = snap.recepcion.turnoDeHora || {};
  const ph = snap.recepcion.porHora.filter(h => !turnoSel || tdh[h.t] === turnoSel);
  return {
    citas, patio, enAnden, ph, hoy: sum(ph, h => h.unidades), ritmo: snap.recepcion.ritmo,
    esperaPatio: patio.length ? Math.max(...patio.map(x => minsDesde(x.llegada, ahora))) : 0,
    atrasadas: citas.filter(x => x.estado === 'Programada' && x.prog && x.prog < ahora - 30 * 60000)
  };
}

export function mAlmacen(snap, p) {
  const A = snap.almacenamiento;
  const pend = A.lpns.filter(l => l.estado !== 'Ubicado');
  const pos = sum(A.zonas, z => z.posiciones), occ = sum(A.zonas, z => z.ocupadas);
  const zonas = A.zonas.map(z => ({ ...z, u: z.ocupadas / z.posiciones })).sort((a, b) => b.u - a.u);
  return { A, pend, util: pos ? occ / pos : null, zonas, maxAge: pend.length ? Math.max(...pend.map(l => minsDesde(l.t, snap.ahora))) : 0,
    urg: sum(A.reposiciones, r => r.urgentes), repo: sum(A.reposiciones, r => r.pendientes), ubicados: A.lpns.filter(l => l.estado === 'Ubicado') };
}

// Alertas transversales: [nivel, ruta, título, detalle]
export function alertas(snap, R, A, P, p) {
  const L = [], ahora = snap.ahora;
  (snap.pendientesCierre || []).forEach(c => L.push([c.sinCausa ? 'crit' : '', `/cierre?fecha=${c.fecha}&turno=${c.turno}`,
    `Turno ${c.turno} del ${c.fecha.slice(8, 10)}-${c.fecha.slice(5, 7)} sin cerrar`, c.sinCausa ? `${c.sinCausa} desvíos sin causa registrada` : 'Listo para cerrar']));
  R.patio.filter(c => minsDesde(c.llegada, ahora) > p.minPatio).forEach(c =>
    L.push(['crit', '/recepcion', `${c.cita} lleva ${fmtAge(minsDesde(c.llegada, ahora))} en patio`, c.proveedor || '']));
  R.enAnden.filter(c => minsDesde(c.inicio, ahora) > p.minAnden).forEach(c =>
    L.push(['', '/recepcion', `Andén ${c.anden}: descarga de ${fmtAge(minsDesde(c.inicio, ahora))}`, c.cita]));
  if (R.atrasadas.length) L.push(['', '/recepcion', `${R.atrasadas.length} citas sin llegar pasada su hora`, 'Recepción']);
  if (R.citas.length && R.ritmo < p.metaRecepcionHora * 0.85) L.push(['', '/recepcion', `Ritmo de recepción ${N(R.ritmo)}/h, meta ${N(p.metaRecepcionHora)}/h`, 'Últimos 60 minutos']);
  A.zonas.filter(z => z.u > p.umbralZona).forEach(z => L.push(['crit', '/almacenamiento', `${z.zona} al ${pctf(z.u)} de ocupación`, 'Almacenamiento']));
  if (A.maxAge > p.minUbicar) L.push(['', '/almacenamiento', `LPN sin ubicar desde hace ${fmtAge(A.maxAge)}`, `${A.pend.length} LPN por ubicar`]);
  if (A.urg) L.push(['crit', '/almacenamiento', `${A.urg} reposiciones urgentes`, 'Ubicaciones de picking sin stock']);
  if (P.riesgo.length) L.push(['crit', '/pedidos', `${N(sum(P.riesgo, r => r.qty))} un. con compromiso hoy aún sin llegar a despacho`, `${uniq(P.riesgo, 'orden')} órdenes`]);
  (snap.control?.rows || []).filter(r => r.bajo).forEach(r =>
    L.push(['', '/control', `${r.nombre} a ${pctf(r.ult.pct)} de la meta a las ${hh(r.ult.t)}`, `${N(r.ult.u)} de ${N(r.ult.meta)} un./h`]));
  if (P.maxPend > p.minAntiguo) L.push(['', '/pedidos', `Picking pendiente con ${fmtAge(P.maxPend)} sin movimiento`, 'Flujo de pedidos']);
  return L.sort((a, b) => (b[0] === 'crit') - (a[0] === 'crit'));
}
