// Componentes básicos reutilizables
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../lib/contexto.jsx';
import { dm, hh } from '../lib/fmt.js';

export function Kpis({ items }) {
  return (
    <dl className="kpis">
      {items.filter(Boolean).map(([l, v, cls], i) => (
        <div className="kpi" key={i}><dt>{l}</dt><dd className={cls || ''}>{v}</dd></div>
      ))}
    </dl>
  );
}

export function Stats({ items, className = '' }) {
  return (
    <dl className={`stats ${className}`}>
      {items.map(([l, v, cls], i) => <div key={i}><dt>{l}</dt><dd className={cls || ''}>{v}</dd></div>)}
    </dl>
  );
}

export const Card = ({ title, hint, actions, className = '', children }) => (
  <section className={`card ${className}`}>
    {(title || actions) && <div className="card-h">{title && <h3>{title}</h3>}{actions}</div>}
    {hint && <p className="hint">{hint}</p>}
    {children}
  </section>
);

export const Cargando = ({ error }) => error
  ? <p className="msg err" role="alert">No se pudieron cargar los datos: {error}</p>
  : <p className="msg">Cargando…</p>;

export function PageHead({ title, sub, children }) {
  return (
    <div className="pagehead">
      <div><h2>{title}</h2>{sub && <p className="sub">{sub}</p>}</div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

// Selector tipo segmentador de Excel, con búsqueda cuando hay muchos valores
// conDatos (opcional): valores con datos bajo los demás filtros; el resto se muestra atenuado
export function Segmentador({ label, valores, sel, onChange, etiqueta = v => v, conDatos }) {
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    const f = e => { if (ref.current && !ref.current.contains(e.target)) ref.current.open = false; };
    document.addEventListener('click', f);
    return () => document.removeEventListener('click', f);
  }, []);
  const on = sel.size > 0;
  const resumen = !on ? 'Todas' : sel.size === 1 ? etiqueta([...sel][0]) : `${sel.size} seleccionadas`;
  const toggle = v => { const n = new Set(sel); n.has(v) ? n.delete(v) : n.add(v); onChange(n); };
  return (
    <details className={`flt ${on ? 'on' : ''}`} ref={ref}>
      <summary>{label} <em>{resumen}</em></summary>
      <div className="pop">
        {valores.length > 10 && <input type="search" placeholder="Buscar" aria-label={`Buscar ${label}`} value={q} onChange={e => setQ(e.target.value)} />}
        <div className="opts">
          {valores.filter(v => String(etiqueta(v)).toLowerCase().includes(q.toLowerCase())).map(v => (
            <label key={v} className={conDatos && !conDatos.has(v) ? 'off' : ''}><input type="checkbox" checked={sel.has(v)} onChange={() => toggle(v)} />{etiqueta(v)}</label>
          ))}
        </div>
        <div className="row">
          <button type="button" className="link" onClick={() => onChange(new Set())}>Todas</button>
          <button type="button" className="link" onClick={() => { ref.current.open = false; }}>Listo</button>
        </div>
      </div>
    </details>
  );
}

// Turno seleccionado en la URL (?fecha=&turno=). Por defecto, el turno en curso o el último.
export function useTurnoSel({ permitirDia = false } = {}) {
  const { meta } = useApp();
  const [sp, setSp] = useSearchParams();
  const def = meta?.turnoActual || meta?.ultimoTurno;
  const fecha = sp.get('fecha') || def?.fecha || meta?.fechaOperativa;
  let turno = sp.get('turno') || def?.turno || 'AM';
  if (turno === 'dia' && !permitirDia) turno = def?.turno || 'AM';
  const set = (f, t) => { const n = new URLSearchParams(sp); n.set('fecha', f); n.set('turno', t); setSp(n, { replace: true }); };
  return { fecha, turno, set, esDefecto: !sp.get('fecha') };
}

// Chips con los turnos recientes + selector libre de fecha y turno
export function SelectorTurno({ fecha, turno, onChange, permitirDia = false, conEstado }) {
  const { meta } = useApp();
  if (!meta) return null;
  const recientes = meta.recientes || [];
  const cal = meta.calendario || {};
  const turnosDe = f => cal[new Date(f + 'T12:00:00').getDay()] || [];
  const opciones = [...turnosDe(fecha), ...(permitirDia ? ['dia'] : [])];
  const t = meta.turnos.find(x => x.id === turno);
  return (
    <div className="filters">
      <div className="chips" aria-label="Turnos recientes">
        {recientes.map(r => (
          <button key={r.fecha + r.turno} type="button" className="chip" aria-pressed={r.fecha === fecha && r.turno === turno}
            onClick={() => onChange(r.fecha, r.turno)}>
            {r.turno} {dm(r.fecha)}{conEstado?.[r.fecha + '|' + r.turno] && <small>{conEstado[r.fecha + '|' + r.turno]}</small>}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginLeft: 'auto' }}>
        <input type="date" value={fecha || ''} aria-label="Fecha operativa" style={{ width: 'auto' }}
          onChange={e => { const f = e.target.value; if (!f) return; const ts = turnosDe(f); onChange(f, ts.includes(turno) ? turno : (ts[0] || turno)); }} />
        <select value={turno} aria-label="Turno" style={{ width: 'auto' }} onChange={e => onChange(fecha, e.target.value)}>
          {opciones.length ? opciones.map(o => <option key={o} value={o}>{o === 'dia' ? 'Día operativo' : o}</option>)
            : <option value={turno}>Sin turnos ese día</option>}
        </select>
        {t && turno !== 'dia' && <span className="muted" style={{ fontSize: 13 }}>{hh(new Date(2000, 0, 1, t.hora_inicio))} a {hh(new Date(2000, 0, 1, t.hora_inicio + t.duracion_h))}</span>}
      </div>
    </div>
  );
}

export function SubirArchivo({ accept = '.xlsx,.xls,.csv', onFile, texto = 'Elegir archivo', disabled }) {
  const [drag, setDrag] = useState(false);
  const inp = useRef(null);
  return (
    <div className={`upload ${drag ? 'drag' : ''}`}
      onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
      <div className="row">
        <button type="button" className="btn" disabled={disabled} onClick={() => inp.current.click()}>{texto}</button>
        <span className="muted" style={{ fontSize: 13 }}>o arrastra el archivo aquí</span>
      </div>
      <input ref={inp} type="file" accept={accept} hidden onChange={e => { const f = e.target.files[0]; if (f) onFile(f); e.target.value = ''; }} />
    </div>
  );
}
