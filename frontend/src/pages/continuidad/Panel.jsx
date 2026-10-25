// Panel de Continuidad: entregas por confirmar, asistencia y actividades del día
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api, qs } from '../../lib/api.js';
import { Kpis, Card, Cargando, PageHead } from '../../components/ui.jsx';
import Tareas from '../../components/Tareas.jsx';
import { pctf, fechaHora, dmy, diaNombre } from '../../lib/fmt.js';

export function Indice({ valor }) {
  const color = valor === null ? 'var(--muted)' : valor >= 85 ? 'var(--green)' : valor >= 60 ? 'var(--yellow)' : 'var(--red)';
  const c = 2 * Math.PI * 20, off = c * (1 - (valor || 0) / 100);
  return (
    <div className="ring" title="50% entregas confirmadas, 30% confirmadas a tiempo, 20% compromisos cumplidos (últimos 30 días)">
      <svg width="52" height="52" aria-hidden="true"><circle cx="26" cy="26" r="20" stroke="var(--line)" strokeWidth="5" fill="none" />
        <circle cx="26" cy="26" r="20" stroke={color} strokeWidth="5" fill="none" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" transform="rotate(-90 26 26)" /></svg>
      <div><b style={{ color }}>{valor === null ? '—' : `${valor}%`}</b><small>Índice de continuidad</small></div>
    </div>
  );
}

export function Entrega({ h, onConfirmada }) {
  const { usuario, avisar } = useApp();
  const [nombre, setNombre] = useState(usuario?.nombre || '');
  const confirmar = async () => {
    try { const r = await api.post(`/continuidad/handovers/${h.id}/confirmar`, { nombre }); avisar(r.traspasadas ? `Recepción confirmada. ${r.traspasadas} tareas pendientes pasaron a tu turno con prioridad alta.` : 'Recepción confirmada.'); onConfirmada?.(); }
    catch (e) { avisar(e.message, 'err'); }
  };
  return (
    <div className="handover">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b><span className="badge-turno">{h.turno_id}</span> {dmy(h.fecha)}</b>
        <span className={`st ${h.estado === 'confirmado' ? 'cerrada' : 'abierta'}`}>{h.estado === 'confirmado' ? 'Confirmada' : 'Por confirmar'}</span>
      </div>
      <p className="muted">Entregó {h.jefe}, {fechaHora(new Date(h.entregado_en).getTime())}</p>
      {h.situacion && <p><b>Situación:</b> {h.situacion}</p>}
      {h.riesgos && <p><b>Riesgos:</b> {h.riesgos}</p>}
      {h.tareas?.length > 0 && <p><b>Pendientes registrados:</b> {h.tareas.map(t => t.titulo).join('; ')}</p>}
      {h.estado === 'pendiente'
        ? <div className="row"><input type="text" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Jefe que recibe" style={{ maxWidth: 260 }} aria-label="Jefe que recibe" />
            <button type="button" className="btn" disabled={!nombre.trim()} onClick={confirmar}>Confirmar recepción</button></div>
        : <p className="muted">Recibió {h.jefe_entrante}, {fechaHora(new Date(h.confirmado_en).getTime())}</p>}
    </div>
  );
}

export default function Panel() {
  const { meta } = useApp();
  const hoy = meta?.fechaOperativa;
  const d = useCarga(async () => {
    if (!hoy) return null;
    const [ind, hos, tareas, asis, personas] = await Promise.all([
      api.get('/continuidad/indicadores'), api.get('/continuidad/handovers'),
      api.get('/continuidad/tareas?' + qs({ fecha: hoy })), api.get('/continuidad/asistencia/dia?' + qs({ fecha: hoy })), api.get('/continuidad/personas')]);
    return { ind, hos, tareas, asis, personas };
  }, [hoy]);
  if (!meta || !d.data) return <Cargando error={d.error} />;
  const { ind, hos, tareas, asis, personas } = d.data;
  const pend = hos.filter(h => h.estado === 'pendiente');
  const turnosHoy = asis.map(a => a.turno);
  return (
    <>
      <PageHead title="Continuidad Operacional" sub={`${diaNombre(hoy)} ${dmy(hoy)}. ${turnosHoy.length ? `Turnos programados: ${turnosHoy.join(', ')}` : 'Sin turnos programados hoy'}.`}>
        <Indice valor={ind.indice} />
      </PageHead>
      <Kpis items={[
        ['Entregas por confirmar', pend.length, pend.length ? 'warn' : 'ok'],
        ['Actividades de hoy', tareas.filter(t => t.estado !== 'traspasada').length],
        ['Tareas vencidas', ind.vencidas, ind.vencidas ? 'warn' : 'ok'],
        ['Entregas confirmadas a tiempo', ind.pctATiempo === null ? '—' : `${ind.pctATiempo}%`, ind.pctATiempo !== null && ind.pctATiempo < 80 ? 'warn' : 'ok'],
        ['Heredadas de un turno anterior hoy', tareas.filter(t => t.heredada_de).length, tareas.some(t => t.heredada_de && t.st !== 'cerrada') ? 'warn' : ''],
        ['Asistencia confirmada hoy', `${asis.filter(a => a.registro).length}/${asis.length}`, asis.some(a => !a.registro) ? 'warn' : 'ok']]} />
      <div className="grid">
        <Card className="s5" title="Asistencia de hoy">
          {asis.length ? <div className="tscroll"><table><tbody>{asis.map(a => (
            <tr key={a.turno}><td><span className="badge-turno">{a.turno}</span></td>
              <td>{a.registro ? a.registro.confirmado_por : <span className="muted">Sin confirmar</span>}</td>
              <td className="num">{a.registro ? `${a.presentes} de ${a.requerida}` : `${a.requerida} requeridas`}</td>
              <td className="num">{a.registro && <span className={`pill ${a.pct >= 0.95 ? 'ok' : a.pct >= 0.8 ? 'mid' : 'bad'}`}>{pctf(a.pct)}</span>}</td>
              <td><Link className="link" to={`/continuidad/turno?fecha=${hoy}&turno=${a.turno}`}>{a.registro ? 'Ver' : 'Confirmar'}</Link></td></tr>))}</tbody></table></div>
            : <p className="empty">Hoy no hay turnos programados.</p>}
        </Card>
        <Card className="s7" title={`Entregas por confirmar (${pend.length})`}>
          {pend.length ? <div style={{ display: 'grid', gap: 8 }}>{pend.map(h => <Entrega key={h.id} h={h} onConfirmada={d.recargar} />)}</div>
            : <p className="empty">No hay entregas pendientes de confirmación.</p>}
        </Card>
      </div>
      <Card title="Actividades de hoy por turno">
        {turnosHoy.length === 0 && <p className="empty">Sin turnos hoy.</p>}
        {turnosHoy.map(t => {
          const items = tareas.filter(x => x.turno_id === t);
          return <div key={t} style={{ marginBottom: 14 }}>
            <div className="row" style={{ marginBottom: 6 }}><span className="badge-turno">{t}</span>
              <span className="muted" style={{ fontSize: 13 }}>{items.filter(i => i.estado === 'cerrada').length}/{items.length} cerradas</span>
              <Link className="link" to={`/cierre?fecha=${hoy}&turno=${t}`}>Cierre del turno</Link></div>
            <Tareas tareas={items} personas={personas} onCambio={d.recargar} vacio="Sin actividades asignadas." />
          </div>;
        })}
      </Card>
      <Card title="Últimas entregas confirmadas">
        <div className="grid">{hos.filter(h => h.estado === 'confirmado').slice(0, 4).map(h => <div key={h.id} className="s6"><Entrega h={h} /></div>)}</div>
      </Card>
    </>
  );
}
