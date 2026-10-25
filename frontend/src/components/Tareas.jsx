// Lista de tareas de Continuidad con acciones (cerrar, delegar, eliminar)
import { useApp } from '../lib/contexto.jsx';
import { api } from '../lib/api.js';
import { dm } from '../lib/fmt.js';

const ST = { cerrada: 'Cerrada', abierta: 'Abierta', vencida: 'Vencida', traspasada: 'Pasó al siguiente turno' };

export default function Tareas({ tareas, personas = [], onCambio, mostrarTurno = false, vacio = 'Sin actividades.' }) {
  const { meta, puede, avisar } = useApp();
  const cats = meta?.categorias || {};
  const ops = puede('co.asignar');
  const act = async (fn, ok) => { try { await fn(); if (ok) avisar(ok); onCambio?.(); } catch (e) { avisar(e.message, 'err'); } };
  if (!tareas.length) return <p className="empty">{vacio}</p>;
  return (
    <ul className="tasks">
      {tareas.map(t => {
        const sups = personas.filter(p => p.rol === 'Supervisor' && p.turno_id === t.turno_id);
        const delegada = t.asignado_rol === 'Supervisor';
        const editable = t.estado !== 'traspasada';
        return (
          <li key={t.id} className="task" style={{ '--c': cats[t.categoria] || 'var(--line)' }}>
            <div>
              <div className="t">
                {mostrarTurno && <span className="badge-turno">{t.turno_id} {dm(t.fecha)}</span>}
                <b>{t.titulo}</b>
                {t.prioridad === 'alta' && <span className="st alta" title={`Pendiente del turno ${t.heredada_de_turno || 'anterior'}`}>Pendiente turno anterior</span>}
              </div>
              <div className="meta">
                <span className="cat" style={{ '--c': cats[t.categoria] || 'var(--muted)' }}><i />{t.categoria}</span>
                {t.asignado_nombre && <> · {delegada ? 'Delegada a ' : ''}{t.asignado_nombre}</>}
                {t.responsable && <> · {t.responsable}</>}
                {t.cd && <> · {t.cd}</>}
                {t.cerrado_por && t.estado === 'cerrada' && <> · cerró {t.cerrado_por}</>}
                {t.veces_transferida > 1 && <> · <span className="warn">traspasada {t.veces_transferida} veces</span></>}
              </div>
            </div>
            <div className="acts">
              <span className={`st ${t.st}`}>{ST[t.st] || t.st}</span>
              {editable && !delegada && sups.length > 0 && t.estado === 'abierta' && (
                <select value="" aria-label="Delegar a supervisor" onChange={e => e.target.value && act(() => api.patch(`/continuidad/tareas/${t.id}`, { asignado_a: +e.target.value }), 'Actividad delegada.')}>
                  <option value="">Delegar a…</option>{sups.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>)}
              {editable && delegada && t.estado === 'abierta' && <button type="button" className="ghost" onClick={() => act(() => api.patch(`/continuidad/tareas/${t.id}`, { asignado_a: null }), 'Delegación retirada.')}>Quitar delegación</button>}
              {editable && <button type="button" className="ghost" onClick={() => act(() => api.patch(`/continuidad/tareas/${t.id}`, { estado: t.estado === 'cerrada' ? 'abierta' : 'cerrada' }))}>
                {t.estado === 'cerrada' ? 'Reabrir' : 'Marcar cerrada'}</button>}
              {ops && <button type="button" className="link danger" onClick={() => window.confirm(`¿Eliminar "${t.titulo}"?`) && act(() => api.del(`/continuidad/tareas/${t.id}`), 'Actividad eliminada.')}>Eliminar</button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
