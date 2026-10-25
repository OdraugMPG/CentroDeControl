// Metas por etapa y turno, calendario de turnos, causas de desvío y parámetros
import { useEffect, useState } from 'react';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';
import { DIAS, N } from '../../lib/fmt.js';

const PARAMS = {
  metaRecepcionHora: ['Meta de recepción', 'unidades por hora'], andenes: ['Andenes', 'cantidad'],
  umbralZona: ['Umbral de ocupación de zona', 'proporción, 0,85 = 85%'], umbralDesvio: ['Umbral de cumplimiento horario', 'bajo este valor se exige causa'],
  minAntiguo: ['Tarea de pedidos sin movimiento', 'minutos'], minPatio: ['Espera máxima en patio', 'minutos'], minAnden: ['Descarga máxima en andén', 'minutos'],
  minUbicar: ['LPN sin ubicar', 'minutos'], minConfirmacion: ['Plazo para confirmar una entrega de turno', 'minutos'], minAntesCierre: ['Cierre anticipado del turno', 'minutos antes del término']
};

export default function Configuracion() {
  const { avisar, refrescar } = useApp();
  const d = useCarga(() => api.get('/config'), []);
  const [metas, setMetas] = useState({});
  const [cal, setCal] = useState({});
  const [par, setPar] = useState({});
  const [causa, setCausa] = useState('');
  useEffect(() => { if (d.data) { setMetas(d.data.metas); setCal(d.data.calendario); setPar(d.data.parametros); } }, [d.data]);
  if (!d.data) return <Cargando error={d.error} />;
  const C = d.data;
  const guardar = async (url, body, ok) => { try { await api.put(url, body); avisar(ok); d.recargar(); refrescar(); } catch (e) { avisar(e.message, 'err'); } };
  const totalTurno = t => C.etapas.reduce((s, e) => s + (+metas[e.area]?.[t] || 0), 0);
  const calBody = () => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(dd => [dd, Object.fromEntries(C.turnos.map(t => [t.id, (cal[dd] || []).includes(t.id)]))]));

  return (
    <>
      <PageHead title="Metas y calendario" />
      <Card title="Metas de unidades por hora" hint="Unidades que deben salir de cada etapa en una hora, por turno. Se usan en el control por hora y en el cierre de turno.">
        <div className="tscroll"><table>
          <thead><tr><th>Etapa</th><th>Fase</th>{C.turnos.map(t => <th key={t.id} className="num">{t.id}</th>)}</tr></thead>
          <tbody>{C.etapas.map(e => <tr key={e.area}><td>{e.nombre} <span className="muted" style={{ fontSize: 12 }}>{e.area}</span></td><td>{e.fase}</td>
            {C.turnos.map(t => <td key={t.id} className="num"><input type="number" min="0" step="10" style={{ width: 86 }} value={metas[e.area]?.[t.id] ?? 0}
              aria-label={`Meta ${e.nombre} turno ${t.id}`} onChange={ev => setMetas({ ...metas, [e.area]: { ...(metas[e.area] || {}), [t.id]: ev.target.value } })} /></td>)}</tr>)}</tbody>
          <tfoot><tr><td>Total por hora</td><td />{C.turnos.map(t => <td key={t.id} className="num">{N(totalTurno(t.id))}</td>)}</tr></tfoot>
        </table></div>
        <div className="row" style={{ marginTop: 10 }}><button type="button" className="btn" onClick={() => guardar('/config/metas', metas, 'Metas guardadas.')}>Guardar metas</button></div>
      </Card>
      <div className="grid">
        <Card className="s6" title="Calendario de turnos" hint="Qué turnos operan cada día. Define las tareas que se pueden asignar, el traspaso de pendientes y los cierres esperados.">
          <table>
            <thead><tr><th>Día</th>{C.turnos.map(t => <th key={t.id} className="num">{t.id} <span className="muted" style={{ fontWeight: 400 }}>{String(t.hora_inicio).padStart(2, '0')}:00</span></th>)}</tr></thead>
            <tbody>{[1, 2, 3, 4, 5, 6, 0].map(dd => <tr key={dd}><td>{DIAS[dd]}</td>{C.turnos.map(t => <td key={t.id} className="num">
              <input type="checkbox" aria-label={`${t.id} el ${DIAS[dd]}`} checked={(cal[dd] || []).includes(t.id)}
                onChange={ev => setCal({ ...cal, [dd]: ev.target.checked ? [...(cal[dd] || []), t.id] : (cal[dd] || []).filter(x => x !== t.id) })} /></td>)}</tr>)}</tbody>
          </table>
          <div className="row" style={{ marginTop: 10 }}><button type="button" className="btn" onClick={() => guardar('/config/calendario', calBody(), 'Calendario guardado.')}>Guardar calendario</button></div>
        </Card>
        <Card className="s6" title="Causas de desvío" hint="Catálogo que usan los jefes de turno al cerrar. Desactivar una causa la oculta sin perder el historial.">
          <ul className="tasks">{C.causas.map(c => <li key={c.id} className="task" style={{ '--c': c.activo ? 'var(--green)' : 'var(--line)' }}>
            <div className={c.activo ? '' : 'muted'}>{c.nombre}</div>
            <div className="acts"><button type="button" className="ghost" onClick={async () => { try { await api.patch(`/config/causas/${c.id}`, { activo: !c.activo }); d.recargar(); refrescar(); } catch (e) { avisar(e.message, 'err'); } }}>
              {c.activo ? 'Desactivar' : 'Activar'}</button></div></li>)}</ul>
          <div className="row" style={{ marginTop: 8 }}>
            <input type="text" value={causa} onChange={e => setCausa(e.target.value)} placeholder="Nueva causa" style={{ flex: 1 }} aria-label="Nueva causa" />
            <button type="button" className="btn" disabled={!causa.trim()} onClick={async () => { try { await api.post('/config/causas', { nombre: causa }); setCausa(''); d.recargar(); refrescar(); } catch (e) { avisar(e.message, 'err'); } }}>Agregar</button>
          </div>
        </Card>
      </div>
      <Card title="Parámetros y umbrales">
        <div className="grid3">{Object.entries(PARAMS).map(([k, [l, u]]) => <label key={k} className="field"><span>{l}</span>
          <input type="number" min="0" step={k.startsWith('umbral') ? 0.01 : 1} value={par[k] ?? ''} onChange={e => setPar({ ...par, [k]: e.target.value })} />
          <small>{u}</small></label>)}</div>
        <div className="row" style={{ marginTop: 10 }}><button type="button" className="btn" onClick={() => guardar('/config/parametros', par, 'Parámetros guardados.')}>Guardar parámetros</button></div>
      </Card>
    </>
  );
}
