// Informe de cierre de turno: producción + compromisos + dotación + entrega, con causas obligatorias
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api, qs } from '../../lib/api.js';
import { Kpis, Card, Cargando, PageHead, SelectorTurno, useTurnoSel } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { N, pctf, hh, hhmm, css, dmy, pctColor } from '../../lib/fmt.js';
import { esOps } from '../../components/Layout.jsx';

const estadoPill = e => e === 'Cerrado' ? 'ok' : e === 'Por cerrar' ? 'bad' : e === 'En curso' ? 'mid' : '';

export default function Cierre() {
  const { meta, usuario, avisar, refrescar } = useApp();
  const { fecha, turno, set } = useTurnoSel();
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const inf = useCarga(() => fecha ? api.get(`/cierres/${fecha}/${turno}`) : null, [fecha, turno]);
  const comp = useCarga(() => fecha ? api.get('/cierres?' + qs({ fecha })) : null, [fecha]);
  const rec = useCarga(() => api.get('/cierres/recientes?n=9'), []);
  if (!meta || !fecha) return <Cargando />;
  const I = inf.data;
  const umbral = meta.parametros.umbralDesvio ?? 0.85;
  const estados = Object.fromEntries((rec.data || []).map(r => [r.fecha + '|' + r.turno, r.estado.toLowerCase()]));

  const accion = async (fn, ok) => {
    setOcupado(true); setMsg(null);
    try { const r = await fn(); if (r?.inst) inf.setData(r); if (ok) setMsg({ ok: true, t: ok }); comp.recargar(); rec.recargar(); refrescar(); }
    catch (e) { setMsg({ ok: false, t: e.message }); }
    setOcupado(false);
  };
  const guardarCausas = lista => accion(() => api.put(`/cierres/${fecha}/${turno}/causas`, lista));

  const cuerpo = () => {
    if (!I) return <Cargando error={inf.error} />;
    const C = I.control, locked = !!I.cierre?.cerrado_en, last = C.rows.filter(r => r.fase === 'Despacho').at(-1) || C.rows.at(-1);
    const dot = I.dotacion, ho = I.handover;
    const horas = [...new Set(I.devs.map(d => d.t))].sort((a, b) => a - b);
    const pe = I.pareto, tot = pe.reduce((s, x) => s + x.brecha, 0);
    let acc = 0;
    const tras = I.tareas.filter(t => t.st !== 'cerrada').length;
    const cats = meta.categorias || {};
    const resumenTxt = [
      `CIERRE DE TURNO ${turno.toUpperCase()}, ${dmy(fecha)} (${hh(I.inst.start)} a ${hh(I.inst.end)})`,
      `Jefe de turno: ${I.jefe || 'sin registrar'}. Estado: ${I.estado.toLowerCase()}.`, '',
      `Cumplimiento productivo: ${pctf(C.pct)} (${N(C.u)} de ${N(C.mAc)} unidades).`,
      `Salida de ${last.nombre}: ${N(last.u)} de ${N(last.mAc)}.`,
      `Compromisos: ${I.tareasOk} de ${I.tareas.length} cerrados${tras ? `, ${tras} sin cerrar` : ''}.`,
      `Dotación: ${dot.presentes ?? 'sin confirmar'} de ${dot.requerida}.`, '',
      'Etapas bajo meta:', ...C.rows.filter(r => r.pct !== null && r.pct < 1).map(r => `- ${r.nombre}: ${pctf(r.pct)}, brecha ${N(Math.max(0, r.mAc - r.u))} un.`), '',
      `Causas registradas (${I.devs.length - I.sinCausa} de ${I.devs.length} desvíos):`,
      ...pe.filter(x => x.causa !== 'Sin causa registrada').map(x => `- ${x.causa}: ${N(x.brecha)} un. de brecha`),
      ...(ho ? ['', `Situación: ${ho.situacion || '—'}`, `Riesgos: ${ho.riesgos || '—'}`] : [])].join('\n');

    return <>
      <Card>
        <div className="rep-h">
          <div>
            <h2>Informe de cierre, turno {turno} del {dmy(fecha)}</h2>
            <p className="hint" style={{ margin: '4px 0 0' }}>De {hh(I.inst.start)} a {hh(I.inst.end)}. {I.estado === 'En curso' ? `Datos hasta las ${hhmm(C.ref)}, turno en curso.` : I.estado === 'No programado' ? 'Este turno no opera ese día según el calendario.' : ''}</p>
          </div>
          <div className="row">
            <label className="field" style={{ minWidth: 220 }}><span>Jefe de turno</span>
              <input type="text" defaultValue={I.jefe} key={I.jefe + fecha + turno} disabled={locked} placeholder="Nombre del responsable"
                onBlur={e => { if (e.target.value.trim() !== I.jefe) accion(() => api.put(`/cierres/${fecha}/${turno}/jefe`, { jefe: e.target.value })); }} />
            </label>
            <span className={`pill ${estadoPill(I.estado)}`}>{I.estado}{I.cierre?.cerrado_en ? ` a las ${hhmm(new Date(I.cierre.cerrado_en).getTime())}` : ''}</span>
          </div>
        </div>
      </Card>
      <Kpis items={[
        ['Cumplimiento productivo', pctf(C.pct), pctColor(C.pct, umbral)],
        [`Salida de ${last.nombre}`, <>{N(last.u)} <small>de {N(last.mAc)}</small></>],
        ['Compromisos cerrados', <>{I.tareasOk} <small>de {I.tareas.length}</small></>, I.tareas.length && I.tareasOk < I.tareas.length ? 'warn' : I.tareas.length ? 'ok' : ''],
        ['Dotación presente', dot.registro ? <>{dot.presentes} <small>de {dot.requerida}</small></> : 'Sin confirmar', !dot.registro || dot.pct < 0.9 ? 'warn' : ''],
        [`Desvíos bajo ${pctf(umbral)}`, <>{I.devs.length} <small>{I.sinCausa} sin causa</small></>, I.sinCausa ? 'warn' : ''],
        ['Minutos perdidos registrados', N(I.minutos)]]} />
      <div className="grid">
        <Card className="s7" title="Compromisos productivos por etapa" hint="Meta del turno contra lo realizado. La brecha son las unidades que faltaron.">
          <div className="tscroll"><table>
            <thead><tr><th>Etapa</th><th className="num">Meta</th><th className="num">Real</th><th className="num">Cumpl.</th><th className="num">Brecha</th><th>Peor hora</th><th className="num">Un./pers.-h</th></tr></thead>
            <tbody>{C.rows.map(r => {
              const done = r.cells.filter(c => c.estado !== 'fut' && c.pct !== null), worst = done.slice().sort((a, b) => a.pct - b.pct)[0], br = Math.round(r.mAc - r.u);
              return <tr key={r.area}><td>{r.nombre}</td><td className="num">{N(r.mAc)}</td><td className="num">{N(r.u)}</td><td className={`num ${pctColor(r.pct, umbral)}`}>{pctf(r.pct)}</td>
                <td className={`num ${br > 0 ? 'warn' : ''}`}>{br > 0 ? N(br) : '—'}</td><td>{worst ? <>{hh(worst.t)} <span className="muted">{pctf(worst.pct)}</span></> : '—'}</td><td className="num">{r.prod ? N(r.prod) : '—'}</td></tr>;
            })}</tbody>
            <tfoot><tr><td>Total</td><td className="num">{N(C.mAc)}</td><td className="num">{N(C.u)}</td><td className="num">{pctf(C.pct)}</td><td className="num">{N(Math.max(0, C.mAc - C.u))}</td><td /><td /></tr></tfoot>
          </table></div>
        </Card>
        <Card className="s5" title="Compromisos del turno" actions={<Link className="link" to={`/continuidad/turno?fecha=${fecha}&turno=${turno}`}>Abrir en Mi turno</Link>}>
          <ul className="tasks">{I.tareas.length ? I.tareas.map(t => (
            <li key={t.id} className="task" style={{ '--c': cats[t.categoria] || 'var(--line)' }}>
              <div className="t"><b>{t.titulo}</b><span className="meta">{t.categoria}{t.asignado_nombre ? `, ${t.asignado_nombre}` : ''}{t.heredada_de ? `, heredada del turno ${t.origen_turno}` : ''}</span></div>
              <span className={`st ${t.st}`}>{t.st === 'traspasada' ? 'Pasó al siguiente turno' : t.st === 'cerrada' ? 'Cerrada' : t.st === 'vencida' ? 'Sin cerrar' : 'Abierta'}</span>
            </li>)) : <li className="empty">Sin compromisos asignados a este turno.</li>}</ul>
          <h3 style={{ marginTop: 14 }}>Entrega de turno</h3>
          {ho ? <div className="handover">
            <p><b>Situación:</b> {ho.situacion || '—'}</p><p><b>Riesgos:</b> {ho.riesgos || '—'}</p>
            <p className="muted">Entregó {ho.jefe} a las {hhmm(new Date(ho.entregado_en).getTime())}. {ho.confirmado_en ? `Confirmó ${ho.jefe_entrante} a las ${hhmm(new Date(ho.confirmado_en).getTime())}.` : <span className="warn">Sin confirmación del turno siguiente.</span>}</p>
          </div> : <p className="empty">El turno aún no se entrega. <Link to={`/continuidad/turno?fecha=${fecha}&turno=${turno}`}>Registrar entrega</Link></p>}
        </Card>
      </div>
      <Card title="Desvíos y causas" hint={`Cada hora cerrada en que una etapa quedó bajo ${pctf(umbral)} de su meta. El jefe de turno registra la causa y los minutos perdidos; sin eso no se puede cerrar el turno.`}>
        {!I.devs.length ? <p className="empty">{C.transcurridas > 1 ? `Ninguna etapa quedó bajo ${pctf(umbral)} en las horas cerradas.` : 'Aún no hay horas cerradas en este turno.'}</p> :
          <div className="tscroll"><table className="dev">
            <thead><tr><th>Etapa</th><th className="num">Real / meta</th><th className="num">Cumpl.</th><th className="num">Brecha</th><th>Causa</th><th className="num">Min. perdidos</th><th>Comentario</th></tr></thead>
            <tbody>{horas.map(h => {
              const ds = I.devs.filter(d => d.t === h);
              return [
                <tr key={'g' + h} className="grp"><td colSpan={4}>{hh(h)} a {hh(h + 3600000)}, {ds.length} {ds.length === 1 ? 'etapa' : 'etapas'}</td>
                  <td colSpan={3}>{!locked && ds.some(d => !d.causa_id) && <select value="" aria-label="Aplicar causa a toda la hora" style={{ width: 'auto' }}
                    onChange={e => e.target.value && guardarCausas(ds.filter(d => !d.causa_id).map(d => ({ area: d.area, hora: d.t, causa_id: +e.target.value, minutos: d.minutos, comentario: d.comentario, brecha: d.brecha })))}>
                    <option value="">Aplicar la misma causa a las pendientes de esta hora</option>{meta.causas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>}</td></tr>,
                ...ds.map(d => {
                  const guardar = cambio => guardarCausas([{ area: d.area, hora: d.t, causa_id: d.causa_id, minutos: d.minutos, comentario: d.comentario, brecha: d.brecha, ...cambio }]);
                  return <tr key={d.key}><td>{d.nombre}</td><td className="num">{N(d.u)} / {N(d.meta)}</td><td className="num warn">{pctf(d.pct)}</td><td className="num">{N(d.brecha)}</td>
                    <td><select className={d.causa_id ? '' : 'miss'} value={d.causa_id || ''} disabled={locked || ocupado} aria-label={`Causa de ${d.nombre} a las ${hh(d.t)}`}
                      onChange={e => guardar({ causa_id: e.target.value ? +e.target.value : null })}>
                      <option value="">Seleccionar causa</option>{meta.causas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></td>
                    <td className="num"><input type="number" min="0" max="60" style={{ width: 72 }} defaultValue={d.minutos ?? ''} key={d.key + d.minutos} disabled={locked}
                      onBlur={e => { const v = e.target.value === '' ? null : +e.target.value; if (v !== d.minutos) guardar({ minutos: v }); }} /></td>
                    <td><input type="text" style={{ minWidth: 200 }} defaultValue={d.comentario || ''} key={d.key + d.comentario} disabled={locked} placeholder="Detalle opcional"
                      onBlur={e => { if (e.target.value.trim() !== (d.comentario || '')) guardar({ comentario: e.target.value }); }} /></td></tr>;
                })];
            })}</tbody></table></div>}
      </Card>
      <div className="grid">
        <Card className="s6" title="Pareto de causas" hint="Unidades de brecha por causa en este turno.">
          {pe.length ? <Grafico label="Pareto de causas" datos={{ labels: pe.map(x => x.causa), datasets: [
            { type: 'line', label: '% acumulado', data: pe.map(x => Math.round((acc += x.brecha) / Math.max(1, tot) * 100)), borderColor: css('--ink'), backgroundColor: css('--ink'), yAxisID: 'y2', pointRadius: 3 },
            { label: 'Unidades de brecha', data: pe.map(x => x.brecha), yAxisID: 'y', borderRadius: 2, backgroundColor: pe.map(x => x.causa === 'Sin causa registrada' ? css('--empty') : css('--red')) }] }}
            opciones={{ scales: { x: { ticks: { autoSkip: false, maxRotation: 40 } }, y2: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { callback: v => v + '%' } } } }} />
            : <p className="empty">Sin desvíos en este turno.</p>}
        </Card>
        <Card className="s6" title="Evidencia automática" hint="Datos del sistema para analizar por qué no se llegó a la meta.">
          <ul className="ev">{I.evidencia.map((e, i) => <li key={i} className={e.warn ? 'w' : ''}><b>{e.titulo}:</b> {e.texto}</li>)}</ul>
        </Card>
      </div>
      <Card title={`Comparativo de turnos del ${dmy(fecha)}`}>
        <div className="tscroll"><table>
          <thead><tr><th>Turno</th><th>Jefe de turno</th><th>Estado</th><th className="num">Cumpl. productivo</th><th className="num">Compromisos</th><th className="num">Dotación</th><th className="num">Desvíos</th><th>Causa principal</th></tr></thead>
          <tbody>{(comp.data || []).map(r => r.estado === 'Por comenzar'
            ? <tr key={r.turno}><td>{r.turno}</td><td colSpan={7} className="muted">Aún no comienza</td></tr>
            : <tr key={r.turno} className={`clic ${r.turno === turno ? 'selrow' : ''}`} onClick={() => set(fecha, r.turno)}>
              <td>{r.turno}</td><td>{r.jefe}</td><td><span className={`pill ${estadoPill(r.estado)}`}>{r.estado}</span></td>
              <td className={`num ${pctColor(r.pct, umbral)}`}>{pctf(r.pct)}</td><td className="num">{r.tareasOk} de {r.tareas}</td><td className="num">{pctf(r.dotacionPct)}</td>
              <td className="num">{r.desvios}{r.sinCausa ? <span className="warn"> ({r.sinCausa} sin causa)</span> : ''}</td><td>{r.causaPrincipal || '—'}</td></tr>)}</tbody>
        </table></div>
      </Card>
      <Card title="Resumen para enviar">
        <textarea className="sum" readOnly value={resumenTxt} aria-label="Resumen del cierre de turno" />
        <div className="row" style={{ marginTop: 10 }}>
          {locked
            ? esOps(usuario) && <button type="button" className="ghost" disabled={ocupado} onClick={() => accion(() => api.post(`/cierres/${fecha}/${turno}/reabrir`), 'Turno reabierto.')}>Reabrir turno</button>
            : <button type="button" className="btn" disabled={ocupado} onClick={() => accion(() => api.post(`/cierres/${fecha}/${turno}/cerrar`), 'Turno cerrado.')}>Cerrar turno</button>}
          <button type="button" className="ghost" onClick={async () => { try { await navigator.clipboard.writeText(resumenTxt); avisar('Resumen copiado.'); } catch { avisar('Selecciona el texto y cópialo manualmente.', 'err'); } }}>Copiar resumen</button>
          {msg && <span className={`msg ${msg.ok ? '' : 'err'}`} style={{ margin: 0 }} role="status">{msg.t}</span>}
        </div>
      </Card>
    </>;
  };

  return (
    <>
      <PageHead title="Cierre de turno" sub="Une la producción por hora con los compromisos, la dotación y la entrega de Continuidad Operacional.">
        <Link className="ghost" to={`/control?fecha=${fecha}&turno=${turno}`}>Ver control por hora</Link>
      </PageHead>
      <SelectorTurno fecha={fecha} turno={turno} onChange={(f, t) => { set(f, t); setMsg(null); }} conEstado={estados} />
      {cuerpo()}
    </>
  );
}
