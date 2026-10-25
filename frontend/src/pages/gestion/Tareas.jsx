import React, { useState } from 'react';
import { api, qs, PROC } from './api.js';
import { useCarga } from './ui.jsx';
import TablaTareas from './TablaTareas.jsx';

export default function Tareas({ fecha }) {
  const [f, setF] = useState({ cd: '', turno: '', proceso: '', estado: '', q: '' });
  const [est] = useCarga(() => api.get('/api/estado' + qs({ fecha })), [fecha]);
  const [ts, err, , setTs] = useCarga(() => api.get('/api/tareas' + qs({ fecha, ...f })), [fecha, f.cd, f.turno, f.proceso, f.estado, f.q]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <div className="top"><div><h1>Tareas</h1><div className="sub">Todas las tareas de la jornada, en secuencia de extracción por operario. El estado se actualiza al cargar el stock de cierre de cada turno.</div></div></div>
      <div className="sec row">
        <div><label className="lbl" htmlFor="f-cd">CD</label><select id="f-cd" value={f.cd} onChange={set('cd')}><option value="">Todos</option>{(est?.cds || []).map((c) => <option key={c.cd}>{c.cd}</option>)}</select></div>
        <div><label className="lbl" htmlFor="f-t">Turno</label><select id="f-t" value={f.turno} onChange={set('turno')}><option value="">Todos</option><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option></select></div>
        <div><label className="lbl" htmlFor="f-p">Proceso</label><select id="f-p" value={f.proceso} onChange={set('proceso')}><option value="">Todos</option>{Object.entries(PROC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="lbl" htmlFor="f-e">Estado</label><select id="f-e" value={f.estado} onChange={set('estado')}><option value="">Todos</option>{['PENDIENTE', 'PARCIAL', 'EJECUTADO', 'NO EJECUTADO', 'SIN DESTINO'].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label className="lbl" htmlFor="f-q">Buscar</label><input id="f-q" type="text" placeholder="SKU, ubicación, operario…" value={f.q} onChange={set('q')} /></div>
      </div>
      {err && <div className="alert bad">{err}</div>}
      <div className="sec">
        <div className="note" style={{ marginBottom: 8 }}>{ts ? `${ts.length} tareas${ts.length >= 5000 ? ' (se muestran las primeras 5.000; usa los filtros)' : ''}` : 'Cargando…'}</div>
        {ts && <TablaTareas tareas={ts} onCambio={(n) => setTs(ts.map((t) => (t.id === n.id ? n : t)))} />}
      </div>
    </>
  );
}
