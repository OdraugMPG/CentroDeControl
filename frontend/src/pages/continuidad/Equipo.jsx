import { useState } from 'react';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';

export default function Equipo() {
  const { meta, avisar } = useApp();
  const d = useCarga(() => api.get('/continuidad/personas'), []);
  const [f, setF] = useState({ nombre: '', rol: 'Jefe de Turno', turno_id: 'AM' });
  if (!meta || !d.data) return <Cargando error={d.error} />;
  const P = d.data;
  const agregar = async () => {
    try { await api.post('/continuidad/personas', f); avisar('Persona agregada.'); setF({ ...f, nombre: '' }); d.recargar(); }
    catch (e) { avisar(e.message, 'err'); }
  };
  const baja = async p => {
    if (!window.confirm(`¿Dar de baja a ${p.nombre}? Sus tareas abiertas vuelven al jefe de su turno.`)) return;
    try { await api.del(`/continuidad/personas/${p.id}`); avisar('Persona dada de baja.'); d.recargar(); } catch (e) { avisar(e.message, 'err'); }
  };
  return (
    <>
      <PageHead title="Equipo" sub="Un jefe de turno por turno. Cada supervisor reporta al jefe de su turno." />
      <Card title="Agregar persona">
        <div className="grid4">
          <label className="field"><span>Nombre</span><input type="text" value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} placeholder="Nombre y apellido" /></label>
          <label className="field"><span>Rol</span><select value={f.rol} onChange={e => setF({ ...f, rol: e.target.value })}>
            <option>Jefe de Turno</option><option>Supervisor</option><option>Jefe de Operaciones</option></select></label>
          {f.rol !== 'Jefe de Operaciones' && <label className="field"><span>Turno</span><select value={f.turno_id} onChange={e => setF({ ...f, turno_id: e.target.value })}>
            {meta.turnos.map(t => <option key={t.id}>{t.id}</option>)}</select></label>}
          <div className="field"><span>&nbsp;</span><button type="button" className="btn" disabled={!f.nombre.trim()} onClick={agregar}>Agregar</button></div>
        </div>
      </Card>
      <Card title="Estructura de turnos">
        <div className="tree">
          {P.filter(p => p.rol === 'Jefe de Operaciones').map(p => <div key={p.id} className="t row"><b>{p.nombre}</b><span className="muted">Jefe de Operaciones</span><button type="button" className="link danger" onClick={() => baja(p)}>Dar de baja</button></div>)}
          {meta.turnos.map(t => {
            const jefe = P.find(p => p.rol === 'Jefe de Turno' && p.turno_id === t.id);
            const sups = P.filter(p => p.rol === 'Supervisor' && p.turno_id === t.id);
            return <div key={t.id} className="t">
              <div className="row"><span className="badge-turno">{t.id}</span>
                {jefe ? <><b>{jefe.nombre}</b><span className="muted">Jefe de Turno</span><button type="button" className="link danger" onClick={() => baja(jefe)}>Dar de baja</button></> : <span className="muted">Sin jefe de turno</span>}</div>
              <div className="sub">{sups.length ? sups.map(s => <div key={s.id} className="row">{s.nombre}<span className="muted">Supervisor</span><button type="button" className="link danger" onClick={() => baja(s)}>Dar de baja</button></div>)
                : <span className="muted">Sin supervisores</span>}</div>
            </div>;
          })}
        </div>
      </Card>
    </>
  );
}
