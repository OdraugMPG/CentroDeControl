import React, { useEffect, useState } from 'react';
import { api, qs, urlApi } from './api.js';
import { useCarga, Tiles } from './ui.jsx';
import TablaTareas from './TablaTareas.jsx';

export default function MiTurno({ fecha }) {
  const [est] = useCarga(() => api.get('/api/estado' + qs({ fecha })), [fecha]);
  const [sel, setSel] = useState('');
  const sups = [];
  (est?.cds || []).filter((c) => c.activo).forEach((c) => [1, 2, 3].forEach((t) => sups.push({ k: `${c.cd}|${t}`, cd: c.cd, t, n: c['sup_t' + t] || `SUPERVISOR T${t}` })));
  useEffect(() => { if (!sel && sups.length) setSel(sups[0].k); }, [sups.length]);
  const [cd, turno] = sel.split('|');
  const [ts, , recargar, setTs] = useCarga(() => (cd ? api.get('/api/tareas' + qs({ fecha, cd, turno })) : Promise.resolve([])), [fecha, sel]);
  const [k, , recK] = useCarga(() => (cd ? api.get('/api/kpi' + qs({ fecha, cd, turno })) : Promise.resolve(null)), [fecha, sel]);
  const abiertas = (ts || []).filter((t) => t.estado !== 'EJECUTADO');
  const yo = sups.find((s) => s.k === sel);
  return (
    <>
      <div className="top">
        <div><h1>Mi turno</h1><div className="sub">{yo ? `${yo.cd} · T${yo.t} ${est?.horarios?.[yo.t] || ''}` : ''} · el avance llega con el stock de cierre; aquí marcas las zonas contadas y registras lo que no se pudo hacer.</div></div>
        <div className="row">
          <div><label className="lbl" htmlFor="s">Supervisor</label><select id="s" value={sel} onChange={(e) => setSel(e.target.value)}>{sups.map((s) => <option key={s.k} value={s.k}>{s.n} — {s.cd} T{s.t}</option>)}</select></div>
          {cd && <a className="btn" href={urlApi('/api/archivos/turno' + qs({ fecha, cd, turno }))}>Descargar .xlsx</a>}
        </div>
      </div>
      {k && <Tiles k={k.total} meta={k.meta} />}
      <div className="sec">
        <h2>Pendientes del turno ({abiertas.length})</h2>
        {ts && <TablaTareas tareas={abiertas} conCD={false} rapido onCambio={(n) => { setTs(ts.map((t) => (t.id === n.id ? n : t))); recK(); }} />}
      </div>
      {ts && ts.length > abiertas.length && <div className="sec"><h2>Ejecutadas ({ts.length - abiertas.length})</h2><TablaTareas tareas={ts.filter((t) => t.estado === 'EJECUTADO')} conCD={false} onCambio={() => { recargar(); recK(); }} /></div>}
    </>
  );
}
