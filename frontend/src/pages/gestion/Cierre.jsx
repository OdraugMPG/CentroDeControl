import React, { useState } from 'react';
import { api, qs, fmt, pct, color, PROC, fFecha } from './api.js';
import { useCarga, Tiles, Barra } from './ui.jsx';

export default function Cierre({ fecha }) {
  const [f, setF] = useState({ cd: '', turno: '' });
  const [est] = useCarga(() => api.get('/api/estado' + qs({ fecha })), [fecha]);
  const [k, err] = useCarga(() => api.get('/api/kpi' + qs({ fecha, ...f })), [fecha, f.cd, f.turno]);
  const meta = k?.meta ?? 0.95;
  const procs = ['INV', 'CONS', 'SU', 'SM', 'REU'];
  return (
    <>
      <div className="top"><div><h1>Cierre de turno</h1><div className="sub">Cumplimiento contra la asignación del {fFecha(fecha)}. Meta {Math.round(meta * 100)}% en tareas y en unidades.</div></div>
        <div className="row">
          <div><label className="lbl" htmlFor="k-t">Turno</label><select id="k-t" value={f.turno} onChange={(e) => setF({ ...f, turno: e.target.value })}><option value="">Todos</option><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option></select></div>
          <div><label className="lbl" htmlFor="k-c">CD</label><select id="k-c" value={f.cd} onChange={(e) => setF({ ...f, cd: e.target.value })}><option value="">Todos</option>{(est?.cds || []).map((c) => <option key={c.cd}>{c.cd}</option>)}</select></div>
        </div>
      </div>
      {err && <div className="alert bad">{err}</div>}
      {k && !k.total.tareas && <div className="alert info">No hay tareas asignadas para esta jornada.</div>}
      {k && k.total.tareas > 0 && (
        <>
          <Tiles k={k.total} meta={meta} />
          <div className="sec">
            <h2>Por CD y proceso · cumplimiento de unidades</h2>
            <div className="tbl">
              <table>
                <thead><tr><th>CD</th>{procs.map((p) => <th key={p}>{PROC[p]}</th>)}<th className="num">Tareas</th><th className="num">Unidades</th></tr></thead>
                <tbody>
                  {k.porCd.map((c) => (
                    <tr key={c.cd}><td><b>{c.cd}</b></td>
                      {procs.map((p) => { const x = k.porCdProc.find((y) => y.cd === c.cd && y.proceso === p); return <td key={p}>{x ? <Barra valor={x.cumplUnidades} meta={meta} /> : <span className="muted">—</span>}</td>; })}
                      <td className="num" style={{ color: color(c.cumplTareas, meta), fontWeight: 600 }}>{pct(c.cumplTareas)}</td>
                      <td className="num" style={{ color: color(c.cumplUnidades, meta), fontWeight: 600 }}>{pct(c.cumplUnidades)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="legend"><span style={{ '--c': 'var(--good)' }}>≥ meta</span><span style={{ '--c': 'var(--warn)' }}>hasta 10 puntos bajo la meta</span><span style={{ '--c': 'var(--bad)' }}>más de 10 puntos bajo la meta</span><span style={{ '--c': 'var(--ink)' }}>línea = meta</span></div>
          </div>
          <div className="sec">
            <h2>Por turno y supervisor</h2>
            <div className="tbl">
              <table>
                <thead><tr><th>Turno</th><th>CD</th><th>Supervisor</th><th className="num">Tareas</th><th className="num">Ejecutadas</th><th className="num">Cumpl. tareas</th><th className="num">Unid. asignadas</th><th className="num">Unid. reales</th><th className="num">Cumpl. unidades</th><th className="num">No ejecutadas</th></tr></thead>
                <tbody>{k.porTurno.map((t) => (
                  <tr key={t.turno + t.cd}><td>T{t.turno}</td><td>{t.cd}</td><td>{t.supervisor}</td><td className="num">{fmt(t.tareas)}</td><td className="num">{fmt(t.ejecutadas)}</td>
                    <td className="num" style={{ color: color(t.cumplTareas, meta) }}>{pct(t.cumplTareas)}</td><td className="num">{fmt(t.uAsig)}</td><td className="num">{fmt(t.uReal)}</td>
                    <td className="num" style={{ color: color(t.cumplUnidades, meta) }}>{pct(t.cumplUnidades)}</td><td className="num">{fmt(t.noEjecutadas)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            {k.sinDestino > 0 && <p className="note">{k.sinDestino} líneas de stock unitario quedaron SIN UBICACIÓN de destino y no cuentan en el cumplimiento (ampliar Blq_Stk_unit).</p>}
          </div>
          {k.excepciones.length > 0 && (
            <div className="sec">
              <h2>No ejecutadas, con motivo</h2>
              <div className="tbl"><table>
                <thead><tr><th>CD</th><th>Turno</th><th>Proceso</th><th>N° tarea</th><th>SKU</th><th>Origen</th><th>Supervisor</th><th>Motivo</th></tr></thead>
                <tbody>{k.excepciones.map((x) => <tr key={x.id}><td>{x.cd}</td><td>T{x.turno}</td><td><span className="tag">{x.proceso}</span></td><td className="mono">{x.folio}</td><td className="mono">{x.sku}</td><td className="mono">{x.ubic_origen}</td><td>{x.supervisor}</td><td>{x.observacion}</td></tr>)}</tbody>
              </table></div>
            </div>
          )}
        </>
      )}
    </>
  );
}
