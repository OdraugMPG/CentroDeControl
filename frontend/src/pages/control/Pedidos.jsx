// Flujo de pedidos: reemplaza la tabla dinámica (segmentadores, operación × etapa y detalle)
import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../../lib/contexto.jsx';
import { Kpis, Card, Cargando, PageHead, Segmentador } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import Flujo from '../../components/Flujo.jsx';
import { N, sum, uniq, css, fmtAge, minsDesde, hhmm, fechaHora, ymd, REGIONES, FASES, FASES_ORDEN } from '../../lib/fmt.js';
import { FILTROS, BLANCO, val, filtrar, nFiltros, catalogoEtapas, mPedidos, etapasParaFlujo, FASES_FLUJO } from '../../lib/ops.jsx';

export default function Pedidos() {
  const { snap, meta, filtros, setFiltros } = useApp();
  const [sp] = useSearchParams();
  const [drill, setDrill] = useState(() => sp.get('etapa') ? { area: sp.get('etapa') } : null);
  const [limite, setLimite] = useState(50);
  const detalle = useRef(null);
  const opciones = useMemo(() => snap ? Object.fromEntries(FILTROS.map(([k]) =>
    [k, [...new Set(snap.pedidos.map(r => val(r, k)))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))])) : {}, [snap]);
  if (!snap || !meta) return <Cargando />;
  const p = meta.parametros, hoy = ymd(new Date(snap.ahora));
  const f = filtrar(snap.pedidos, filtros);
  const etapas = catalogoEtapas(meta, snap.pedidos);
  const P = mPedidos(f, etapas, snap.corte, p, hoy);
  const nombre = a => etapas.find(e => e.area === a)?.nombre || a;
  const ops = [...new Set(snap.pedidos.map(r => r.operacion || BLANCO))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const areas = etapas.map(e => e.area).filter(a => snap.pedidos.some(r => r.area === a) || P.st.find(s => s.area === a));

  const irDetalle = d => { setDrill(d); setLimite(50); setTimeout(() => detalle.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const cell = {}; f.forEach(r => { const k = (r.operacion || BLANCO) + '|' + r.area; cell[k] = (cell[k] || 0) + r.qty; });
  const cmax = Math.max(1, ...Object.values(cell));
  const flujos = [...new Set(f.map(r => r.flujo || BLANCO))].sort();
  const pal = ['--blue', '--yellow', '--teal', '--violet', '--red', '--muted'];
  const fechas = [...new Set(f.map(r => r.fecha_compromiso || BLANCO))].sort();
  const dRows = (drill ? f.filter(r => r.area === drill.area && (!drill.op || (r.operacion || BLANCO) === drill.op)) : f).slice().sort((a, b) => (a.t || 0) - (b.t || 0));

  if (!snap.pedidos.length) return <><PageHead title="Flujo de pedidos" /><Card><p className="empty">Aún no hay extracciones de pedidos. <Link to="/cargas">Carga la primera</Link>.</p></Card></>;

  return (
    <>
      <PageHead title="Flujo de pedidos" sub={`Extracción ${snap.cargas.pedidos?.archivo || ''}, corte ${fechaHora(snap.corte)}`} />
      <div className="filters" aria-label="Filtros de pedidos">
        {FILTROS.map(([k, l]) => (
          <Segmentador key={k} label={l} valores={opciones[k] || []} sel={filtros[k] || new Set()}
            etiqueta={v => k === 'region' && REGIONES[v] ? `${v} ${REGIONES[v]}` : v}
            onChange={s => { setFiltros({ ...filtros, [k]: s }); setLimite(50); }} />))}
        {nFiltros(filtros) > 0 && <button type="button" className="ghost" onClick={() => { setFiltros({}); setDrill(null); }}>Limpiar filtros</button>}
      </div>
      <Kpis items={[
        ['Unidades en flujo', N(P.tot)], ['Órdenes', N(uniq(f, 'orden'))], ['Olas', N(uniq(f, 'nro_ola'))],
        ['Picking pendiente', <>{N(sum(P.pend, r => r.qty))} <small>un.</small></>],
        ['Tarea más antigua en picking', P.pend.length ? fmtAge(P.maxPend) : '—', P.maxPend > p.minAntiguo ? 'warn' : ''],
        ['Listo para despacho', <>{N(sum(P.listo, r => r.qty))} <small>un.</small></>],
        ['Compromiso hoy o vencido sin llegar a despacho', <>{N(sum(P.riesgo, r => r.qty))} <small>un., {uniq(P.riesgo, 'orden')} órd.</small></>, P.riesgo.length ? 'warn' : '']]} />
      <Card title="Unidades en cada etapa" hint="Toca una etapa para ver su detalle. La antigüedad se mide desde la última modificación de cada tarea.">
        <Flujo etapas={etapasParaFlujo(P.st, p, false)} fases={FASES_FLUJO} seleccion={drill && !drill.op ? drill.area : null}
          onSelect={k => irDetalle(drill && drill.area === k && !drill.op ? null : { area: k })} />
      </Card>
      <Card title="Operación por etapa" hint="Misma vista que la tabla dinámica. Toca una celda para ver las tareas.">
        <div className="tscroll"><table className="heat">
          <thead><tr><th>Operación</th>{areas.map(a => <th key={a} className="v" title={a}>{nombre(a)}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>{ops.map(o => {
            const rt = sum(areas, a => cell[o + '|' + a] || 0); if (!rt) return null;
            return <tr key={o}><td>{o}</td>{areas.map(a => {
              const v = cell[o + '|' + a] || 0, pr = v / cmax;
              return <td key={a}><button type="button" disabled={!v} className={drill && drill.area === a && drill.op === o ? 'sel' : ''}
                style={{ background: v ? `color-mix(in srgb, var(--blue) ${Math.round(12 + pr * 78)}%, transparent)` : 'transparent', ...(pr > 0.5 ? { color: '#fff', fontWeight: 600 } : {}) }}
                onClick={() => irDetalle(drill && drill.area === a && drill.op === o ? null : { area: a, op: o })}>{v || '·'}</button></td>;
            })}<td className="tot">{N(rt)}</td></tr>;
          })}</tbody>
          <tfoot><tr><td>Total</td>{areas.map(a => <td key={a}>{N(sum(f.filter(r => r.area === a), r => r.qty))}</td>)}<td>{N(P.tot)}</td></tr></tfoot>
        </table></div>
      </Card>
      <div className="grid">
        <Card className="s7" title="Etapas por flujo">
          <Grafico apilado label="Unidades por etapa y flujo" datos={{ labels: areas.map(nombre),
            datasets: flujos.map((x, i) => ({ label: x, backgroundColor: css(pal[i % pal.length]), borderRadius: 2,
              data: areas.map(a => sum(f.filter(r => r.area === a && (r.flujo || BLANCO) === x), r => r.qty)) })) }} />
        </Card>
        <Card className="s5" title="Compromiso de entrega por fase">
          <Grafico apilado horizontal label="Unidades por fecha de compromiso y fase" datos={{ labels: fechas.map(d => d === hoy ? `${d} (hoy)` : d),
            datasets: FASES_ORDEN.map(fa => ({ label: fa, backgroundColor: css(FASES[fa]), borderRadius: 2,
              data: fechas.map(d => sum(f.filter(r => (r.fecha_compromiso || BLANCO) === d && P.faseDe(r.area) === fa), r => r.qty)) })) }} />
        </Card>
      </div>
      <section className="card" ref={detalle}>
        <div className="card-h">
          <h3>{drill ? `Detalle: ${nombre(drill.area)}${drill.op ? ', ' + drill.op : ''} (${N(sum(dRows, r => r.qty))} un.)` : 'Detalle de tareas, más antiguas primero'}</h3>
          {drill && <button type="button" className="ghost" onClick={() => setDrill(null)}>Quitar selección</button>}
        </div>
        {dRows.length ? <div className="tscroll"><table>
          <thead><tr><th>Orden</th><th>Etapa</th><th>Operación</th><th>Ítem</th><th>Descripción</th><th className="num">Cant.</th><th className="num">Antigüedad</th><th>Flujo</th><th>Compromiso</th><th>Región</th><th>Jaula</th><th>Usuario</th></tr></thead>
          <tbody>{dRows.slice(0, limite).map((r, i) => { const m = minsDesde(r.t, snap.corte); return (
            <tr key={i}><td>{r.orden}</td><td>{nombre(r.area)}</td><td>{r.operacion}</td><td>{r.item}</td><td>{r.descripcion}</td><td className="num">{r.qty}</td>
              <td className={`num ${m > p.minAntiguo ? 'old' : ''}`} title={hhmm(r.t)}>{fmtAge(m)}</td><td>{r.flujo}</td>
              <td className={r.fecha_compromiso && r.fecha_compromiso <= hoy ? 'old' : ''}>{r.fecha_compromiso}</td><td>{REGIONES[r.region] || r.region}</td><td>{r.jaula}</td><td>{r.usuario}</td></tr>); })}</tbody>
          {dRows.length > limite && <tfoot><tr><td colSpan={12} className="muted">Mostrando {limite} de {dRows.length} tareas. <button type="button" className="ghost" onClick={() => setLimite(limite + 50)}>Mostrar 50 más</button></td></tr></tfoot>}
        </table></div> : <p className="empty">No hay tareas con estos filtros. Prueba quitando alguno.</p>}
      </section>
    </>
  );
}
