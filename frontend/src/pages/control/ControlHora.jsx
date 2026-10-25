// Control por hora: unidades que salen de cada etapa contra la meta, por turno o día operativo
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api, qs } from '../../lib/api.js';
import { Kpis, Card, Cargando, PageHead, SelectorTurno, useTurnoSel } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { N, pctf, hh, hhmm, css, dmy, pctClass, pctColor, FASES } from '../../lib/fmt.js';

export default function ControlHora() {
  const { meta, puede, avisar, refrescar } = useApp();
  const { fecha, turno, set } = useTurnoSel({ permitirDia: true });
  const [sel, setSel] = useState(null);
  const [hora, setHora] = useState(null);
  const { data: C, error, recargar } = useCarga(() => fecha ? api.get('/control?' + qs({ fecha, turno })) : null, [fecha, turno]);
  const area = C?.rows?.length ? (C.rows.find(r => r.area === sel) ? sel : C.rows.filter(r => r.pct !== null).sort((a, b) => a.pct - b.pct)[0]?.area || C.rows[0].area) : null;
  const ops = useCarga(() => area ? api.get('/control/operaciones?' + qs({ fecha, turno, area, hora })) : [], [fecha, turno, area, hora]);
  if (!meta) return <Cargando />;
  const puedeEditar = puede('da.configuracion') && turno !== 'dia';
  const umbral = meta.parametros.umbralDesvio ?? 0.85;

  const guardarMeta = async (a, v) => {
    try { await api.put('/config/metas', { [a]: { [turno]: v } }); avisar(`Meta de ${turno} actualizada.`); recargar(); refrescar(); }
    catch (e) { avisar(e.message, 'err'); }
  };

  const cuerpo = () => {
    if (!C) return <Cargando error={error} />;
    if (!C.inst) return <Card><p className="empty">No hay turnos programados ese día.</p></Card>;
    const r = C.rows.find(x => x.area === area);
    const desp = C.rows.filter(x => x.fase === 'Despacho').at(-1) || C.rows.at(-1);
    const bajo = C.rows.filter(x => x.bajo);
    const con = C.rows.filter(x => x.pct !== null).sort((a, b) => b.pct - a.pct);
    const hs = r ? r.cells.filter(c => c.estado !== 'fut') : [];
    const rk = C.rows.filter(x => x.ult && x.ult.pct !== null).sort((a, b) => a.ult.pct - b.ult.pct);
    const sinDatos = C.corte && C.ref < C.ahora - 15 * 60000;
    const tu = ops.data ? ops.data.reduce((s, o) => s + o.unidades, 0) : 0, tp = ops.data ? ops.data.reduce((s, o) => s + o.personas_hora, 0) : 0;
    return <>
      {sinDatos && <p className="msg err">La última extracción de pedidos es de las {hhmm(C.corte)}. Las horas siguientes aparecen sin datos hasta la próxima carga.</p>}
      <Kpis items={[
        ['Horas transcurridas', <>{Math.min(C.transcurridas, C.inst.horas.length)} <small>de {C.inst.horas.length}</small></>],
        ['Cumplimiento acumulado', pctf(C.pct), pctColor(C.pct, umbral)],
        [`Salida de ${desp?.nombre || ''}`, <>{N(desp?.u)} <small>un.</small></>],
        [`Etapas bajo ${pctf(umbral)} en la última hora`, C.ultT ? <>{bajo.length} <small>de {C.rows.length}</small></> : '—', bajo.length ? 'warn' : ''],
        ['Menor cumplimiento', con.length ? <>{con.at(-1).nombre} <small>{pctf(con.at(-1).pct)}</small></> : '—', con.length && con.at(-1).pct < umbral ? 'warn' : ''],
        ['Mayor cumplimiento', con.length ? <>{con[0].nombre} <small>{pctf(con[0].pct)}</small></> : '—']]} />
      <Card title={`Unidades procesadas por etapa y hora, ${turno === 'dia' ? 'día operativo' : 'turno ' + turno} del ${dmy(fecha)}`}
        hint={`Cada celda muestra las unidades que salieron de la etapa en esa hora y su cumplimiento contra la meta.${puedeEditar ? ' La meta por hora de este turno se edita en la segunda columna.' : ''} Toca una etapa o una celda para ver el detalle.`}>
        <div className="tscroll"><table className="ctl">
          <thead><tr><th className="st">Etapa</th>{turno !== 'dia' && <th>Meta/h</th>}{C.inst.horas.map(h => <th key={h}>{hh(h)}</th>)}<th>Total</th><th>Meta acum.</th><th>Cumpl.</th></tr></thead>
          <tbody>{C.rows.map(x => (
            <tr key={x.area} className={x.area === area ? 'sel' : ''}>
              <td className="st"><button type="button" style={{ '--c': `var(${FASES[x.fase] || '--slate'})` }} onClick={() => { setSel(x.area); setHora(null); }}>{x.nombre}</button></td>
              {turno !== 'dia' && <td>{puedeEditar
                ? <input type="number" min="0" step="10" defaultValue={x.metaHora || ''} key={x.area + turno + x.metaHora} aria-label={`Meta por hora de ${x.nombre}`}
                    onBlur={e => { const v = Math.max(0, +e.target.value || 0); if (v !== x.metaHora) guardarMeta(x.area, v); }} />
                : <span className="muted" style={{ padding: '0 8px' }}>{N(x.metaHora)}</span>}</td>}
              {x.cells.map(c => <td key={c.t}>{c.estado === 'fut'
                ? <div className="hc fut"><small>—</small></div>
                : <button type="button" className={`hc ${pctClass(c.pct, umbral)} ${c.estado === 'cur' ? 'cur' : ''} ${x.area === area && c.t === hora ? 'sel' : ''}`}
                    title={`${x.nombre} ${hh(c.t)}: ${N(c.u)} un. de ${N(c.meta)}${c.estado === 'cur' ? ' (meta proporcional, hora en curso)' : ''}`}
                    onClick={() => { setSel(x.area); setHora(c.t); }}><b>{N(c.u)}</b><small>{pctf(c.pct)}</small></button>}</td>)}
              <td className="tt">{N(x.u)}</td><td className="tt muted">{N(x.mAc)}</td><td className={`tt ${pctColor(x.pct, umbral)}`}>{pctf(x.pct)}</td>
            </tr>))}</tbody>
          <tfoot><tr><td className="st">Total</td>{turno !== 'dia' && <td />}{C.inst.horas.map(h => <td key={h} className="tt">{h > C.cur ? '' : N(C.rows.reduce((s, x) => s + x.cells.find(c => c.t === h).u, 0))}</td>)}
            <td className="tt">{N(C.u)}</td><td className="tt muted">{N(C.mAc)}</td><td className="tt">{pctf(C.pct)}</td></tr></tfoot>
        </table></div>
        <div className="legend">
          <span><i style={{ background: 'color-mix(in srgb,var(--green) 26%,transparent)' }} />100% o más</span>
          <span><i style={{ background: 'color-mix(in srgb,var(--yellow) 32%,transparent)' }} />{pctf(umbral)} a 99%</span>
          <span><i style={{ background: 'color-mix(in srgb,var(--red) 26%,transparent)' }} />Bajo {pctf(umbral)}</span>
          <span><i style={{ border: '2px dashed var(--ink)' }} />Hora en curso, contra la meta proporcional</span>
        </div>
      </Card>
      <div className="grid">
        {r && <Card className="s8" title={r.nombre} hint="Barras: unidades por hora. Línea punteada: meta. Línea continua: unidades por persona.">
          <Grafico label={`Producción por hora de ${r.nombre}`} datos={{
            labels: hs.map(c => hh(c.t) + (c.estado === 'cur' ? ' (en curso)' : '')),
            datasets: [
              { type: 'line', label: 'Meta', data: hs.map(c => c.meta), borderColor: css('--ink'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' },
              { type: 'line', label: 'Unidades por persona', data: hs.map(c => c.p ? Math.round(c.u / c.p) : null), borderColor: css('--blue'), backgroundColor: css('--blue'), tension: 0.3, yAxisID: 'y2' },
              { label: 'Unidades', data: hs.map(c => c.u), borderRadius: 2, yAxisID: 'y',
                backgroundColor: hs.map(c => css(c.pct === null ? '--muted' : c.pct >= 1 ? '--green' : c.pct >= umbral ? '--yellow' : '--red')) }]
          }} opciones={{ scales: { y2: { position: 'right', grid: { display: false }, beginAtZero: true, title: { display: true, text: 'Un./persona' } } } }} />
        </Card>}
        <Card className="s4" title={C.ultT ? `Última hora cerrada, ${hh(C.ultT)}` : 'Última hora cerrada'} hint="Cumplimiento por etapa. La línea punteada marca el 100%.">
          <div className="rank">{rk.length ? rk.map(x => {
            const pc = x.ult.pct, col = pc >= 1 ? '--green' : pc >= umbral ? '--yellow' : '--red';
            return <div key={x.area}><span>{x.nombre}</span><span className="tr"><i style={{ width: `${Math.min(100, pc / 1.3 * 100)}%`, background: `var(${col})` }} /></span><b className={pc < umbral ? 'warn' : ''}>{pctf(pc)}</b></div>;
          }) : <p className="empty">Aún no hay horas cerradas.</p>}</div>
        </Card>
      </div>
      {r && <Card title={`Por operación: ${r.nombre}${hora ? ', ' + hh(hora) : ', todo el período'}`}
        actions={hora && <button type="button" className="ghost" onClick={() => setHora(null)}>Ver todo el período</button>}>
        {ops.data?.length ? <div className="tscroll"><table>
          <thead><tr><th>Operación</th><th className="num">Unidades</th><th className="num">% de la etapa</th><th className="num">Personas-hora</th><th className="num">Un./persona-hora</th></tr></thead>
          <tbody>{ops.data.map(o => <tr key={o.operacion}><td>{o.operacion}</td><td className="num">{N(o.unidades)}</td><td className="num">{pctf(o.unidades / Math.max(1, tu))}</td><td className="num">{N(o.personas_hora)}</td><td className="num">{o.personas_hora ? N(o.unidades / o.personas_hora) : '—'}</td></tr>)}</tbody>
          <tfoot><tr><td>Total</td><td className="num">{N(tu)}</td><td className="num">100%</td><td className="num">{N(tp)}</td><td className="num">{tp ? N(tu / tp) : '—'}</td></tr></tfoot>
        </table></div> : <p className="empty">Sin producción registrada para esta selección.</p>}
      </Card>}
    </>;
  };

  return (
    <>
      <PageHead title="Control por hora" sub="Unidades que salieron de cada etapa, calculadas comparando extracciones sucesivas.">
        {turno !== 'dia' && <Link className="ghost" to={`/cierre?fecha=${fecha}&turno=${turno}`}>Ir al cierre de este turno</Link>}
      </PageHead>
      <SelectorTurno fecha={fecha} turno={turno} permitirDia onChange={(f, t) => { set(f, t); setHora(null); }} />
      {cuerpo()}
    </>
  );
}
