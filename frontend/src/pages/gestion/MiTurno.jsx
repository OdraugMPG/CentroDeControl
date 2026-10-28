import React, { useEffect, useState } from 'react';
import { api, qs, urlApi } from './api.js';
import { useCarga, Tiles } from './ui.jsx';
import TablaTareas from './TablaTareas.jsx';

const SUMAS = ['tareas', 'ejecutadas', 'parciales', 'noEjecutadas', 'pendientes', 'uAsig', 'uReal'];
/** Suma los KPI de varios CD/turnos y recalcula los cumplimientos (igual que acumular() del backend). */
function sumarKpi(lista) {
  const r = Object.fromEntries(SUMAS.map((c) => [c, lista.reduce((s, k) => s + (k.total[c] || 0), 0)]));
  return { meta: lista[0]?.meta, total: { ...r, cumplTareas: r.tareas ? r.ejecutadas / r.tareas : 0, cumplUnidades: r.uAsig ? r.uReal / r.uAsig : 0 } };
}

export default function MiTurno({ fecha }) {
  const [est] = useCarga(() => api.get('/api/estado' + qs({ fecha })), [fecha]);
  const [sup, setSup] = useState('');
  const [cdSel, setCdSel] = useState('');   // '' = todos los CD del supervisor
  // asignaciones CD/turno de cada supervisor (Configuración: sup_t1..sup_t3 de cada CD activo)
  const asig = new Map();
  (est?.cds || []).filter((c) => c.activo).forEach((c) => [1, 2, 3].forEach((t) => {
    const n = (c['sup_t' + t] || '').trim() || `SUPERVISOR T${t}`;
    if (!asig.has(n)) asig.set(n, []);
    asig.get(n).push({ k: `${c.cd}|${t}`, cd: c.cd, t });
  }));
  const nombres = [...asig.keys()].sort((a, b) => a.localeCompare(b, 'es'));
  useEffect(() => { if (!asig.has(sup) && nombres.length) setSup(nombres[0]); }, [nombres.join('|')]);
  const mias = asig.get(sup) || [];
  const vista = mias.some((a) => a.k === cdSel) ? mias.filter((a) => a.k === cdSel) : mias;
  const claves = vista.map((a) => a.k).join(',');
  const [ts, , recargar, setTs] = useCarga(() => Promise.all(vista.map((a) => api.get('/api/tareas' + qs({ fecha, cd: a.cd, turno: a.t })))).then((l) => l.flat()), [fecha, claves]);
  const [k, , recK] = useCarga(() => (vista.length ? Promise.all(vista.map((a) => api.get('/api/kpi' + qs({ fecha, cd: a.cd, turno: a.t })))).then(sumarKpi) : Promise.resolve(null)), [fecha, claves]);
  const abiertas = (ts || []).filter((t) => t.estado !== 'EJECUTADO');
  const uno = vista.length === 1 ? vista[0] : null;
  const elegirSup = (n) => { setSup(n); setCdSel(''); };
  const turnos = [...new Set(vista.map((a) => a.t))];
  return (
    <>
      <div className="top">
        <div><h1>Mi turno</h1><div className="sub">{uno ? `${uno.cd} · T${uno.t} ${est?.horarios?.[uno.t] || ''}` : `${vista.length} CD asignados · ${turnos.map((t) => `T${t} ${est?.horarios?.[t] || ''}`).join(' · ')}`} · el avance llega con el stock de cierre; aquí marcas las zonas contadas y registras lo que no se pudo hacer.</div></div>
        <div className="row">
          <div><label className="lbl" htmlFor="s">Supervisor</label><select id="s" value={sup} onChange={(e) => elegirSup(e.target.value)}>{nombres.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
          {uno && <a className="btn" href={urlApi('/api/archivos/turno' + qs({ fecha, cd: uno.cd, turno: uno.t }))}>Descargar .xlsx</a>}
        </div>
      </div>
      {mias.length > 1 && (
        <div className="row" style={{ alignItems: 'center', marginBottom: 14 }}>
          <span className="lbl" style={{ margin: 0 }}>CD asignados</span>
          <div className="chips">
            <button className="chip" aria-pressed={!cdSel} onClick={() => setCdSel('')}>Todos ({mias.length})</button>
            {mias.map((a) => <button key={a.k} className="chip" aria-pressed={cdSel === a.k} onClick={() => setCdSel(a.k)}>{a.cd} · T{a.t}</button>)}
          </div>
          {!uno && <span className="note">Elige un CD para descargar su .xlsx.</span>}
        </div>
      )}
      {k && <Tiles k={k.total} meta={k.meta} />}
      <div className="sec">
        <h2>Pendientes del turno ({abiertas.length})</h2>
        {ts && <TablaTareas tareas={abiertas} conCD={!uno} rapido onCambio={(n) => { setTs(ts.map((t) => (t.id === n.id ? n : t))); recK(); }} />}
      </div>
      {ts && ts.length > abiertas.length && <div className="sec"><h2>Ejecutadas ({ts.length - abiertas.length})</h2><TablaTareas tareas={ts.filter((t) => t.estado === 'EJECUTADO')} conCD={!uno} onCambio={() => { recargar(); recK(); }} /></div>}
    </>
  );
}
