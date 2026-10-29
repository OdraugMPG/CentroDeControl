// Inventario CD: layout reutilizable, asignación y seguimiento del calendario de inventarios
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Card, Cargando, PageHead, Kpis } from '../../components/ui.jsx';
import { dmy } from '../../lib/fmt.js';

function estadoInv(r, hoy) {
  if (r.fecha_ejecutado) {
    if (r.fecha_ejecutado <= r.fecha_asignado) return ['Realizado a tiempo', 'cerrada'];
    const dias = Math.round((new Date(r.fecha_ejecutado) - new Date(r.fecha_asignado)) / 86400000);
    return [`${dias} día(s) de retraso`, 'vencida'];
  }
  return r.fecha_asignado < hoy ? ['No realizado', 'vencida'] : ['Pendiente', 'abierta'];
}

export default function Inventario() {
  const { meta, avisar } = useApp();
  const d = useCarga(async () => { const [inv, personas] = await Promise.all([api.get('/continuidad/inventario'), api.get('/continuidad/personas')]); return { ...inv, personas }; }, []);
  const [lay, setLay] = useState({ cd: '', nivel: '', zona: '', pasillo: '' });
  const [a, setA] = useState({ cd: '', nivel: '', zona: '', pasillo: '', jefe_turno: '', supervisor: '', qty_op: '', adecco: '', fecha_asignado: '' });
  const [filtro, setFiltro] = useState('');
  const L = d.data?.layout || [];
  const cds = useMemo(() => [...new Set(L.map(l => l.cd))].sort(), [L]);
  if (!meta || !d.data) return <Cargando error={d.error} />;
  const hoy = meta.fechaOperativa;
  const op = (campo, filtros) => [...new Set(L.filter(l => Object.entries(filtros).every(([k, v]) => !v || l[k] === v)).map(l => l[campo]))].filter(Boolean);
  const act = async (fn, ok) => { try { await fn(); avisar(ok); d.recargar(); } catch (e) { avisar(e.message, 'err'); } };
  const filas = d.data.asignaciones.filter(r => !filtro || r.cd === filtro);
  const est = filas.map(r => estadoInv(r, hoy)[1]);

  return (
    <>
      <PageHead title="Inventario CD" />
      <Kpis items={[['Asignados', filas.length], ['Realizados a tiempo', est.filter(x => x === 'cerrada').length, 'ok'],
        ['Con retraso o no realizados', est.filter(x => x === 'vencida').length, est.includes('vencida') ? 'warn' : ''], ['Pendientes', est.filter(x => x === 'abierta').length]]} />
      <div className="grid">
        <Card className="s6" title="Cargar calendario desde Excel" hint="Reconoce las columnas CD, Nivel, Zona, Pasillo, Jefe Turno, Supervisor, Qty. Op., Asignado, Adecco, Ejecutado, Tiempo y Estado, en cualquier orden.">
          <Link className="btn" to="/cargas#carga-inventario">Cargar calendario (en Datos)</Link>
        </Card>
        <Card className="s6" title="Layout del CD" hint="Ubicaciones reutilizables: se registran una vez y luego se eligen al asignar.">
          <div className="grid4">
            {['cd', 'nivel', 'zona', 'pasillo'].map(k => <label key={k} className="field"><span>{k.toUpperCase()}</span>
              <input type="text" value={lay[k]} onChange={e => setLay({ ...lay, [k]: e.target.value })} /></label>)}
          </div>
          <div className="row" style={{ marginTop: 8 }}><button type="button" className="ghost" disabled={!lay.cd.trim()} onClick={() => act(() => api.post('/continuidad/inventario/layout', lay), 'Agregado al layout.')}>Agregar al layout</button>
            <span className="muted" style={{ fontSize: 13 }}>{L.length} ubicaciones registradas</span></div>
        </Card>
      </div>
      <Card title="Asignar inventario">
        <div className="grid4">
          <label className="field"><span>CD</span><select value={a.cd} onChange={e => setA({ ...a, cd: e.target.value, nivel: '', zona: '', pasillo: '' })}><option value="">Seleccionar</option>{cds.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="field"><span>Nivel</span><select value={a.nivel} onChange={e => setA({ ...a, nivel: e.target.value, zona: '', pasillo: '' })}><option value="">Todos</option>{op('nivel', { cd: a.cd }).map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="field"><span>Zona</span><select value={a.zona} onChange={e => setA({ ...a, zona: e.target.value, pasillo: '' })}><option value="">Todas</option>{op('zona', { cd: a.cd, nivel: a.nivel }).map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="field"><span>Pasillo</span><select value={a.pasillo} onChange={e => setA({ ...a, pasillo: e.target.value })}><option value="">Todos</option>{op('pasillo', { cd: a.cd, nivel: a.nivel, zona: a.zona }).map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="field"><span>Jefe de turno</span><select value={a.jefe_turno} onChange={e => setA({ ...a, jefe_turno: e.target.value })}><option value="">Sin asignar</option>
            {d.data.personas.filter(p => p.rol === 'Jefe de Turno').map(p => <option key={p.id} value={p.nombre}>{p.nombre} ({p.turno_id})</option>)}</select></label>
          <label className="field"><span>Supervisor</span><select value={a.supervisor} onChange={e => setA({ ...a, supervisor: e.target.value })}><option value="">Sin asignar</option>
            {d.data.personas.filter(p => p.rol === 'Supervisor').map(p => <option key={p.id} value={p.nombre}>{p.nombre} ({p.turno_id})</option>)}</select></label>
          <label className="field"><span>Operarios (máx. 6)</span><input type="number" min="1" max="6" value={a.qty_op} onChange={e => setA({ ...a, qty_op: e.target.value })} /></label>
          <label className="field"><span>Fecha asignada</span><input type="date" value={a.fecha_asignado} onChange={e => setA({ ...a, fecha_asignado: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button type="button" className="btn" disabled={!a.cd || !a.fecha_asignado} onClick={() => act(() => api.post('/continuidad/inventario', a), 'Inventario asignado.')}>Asignar inventario</button></div>
      </Card>
      <Card title="Calendario de inventarios" actions={<select value={filtro} onChange={e => setFiltro(e.target.value)} style={{ width: 'auto' }} aria-label="Filtrar por CD"><option value="">Todos los CD</option>{cds.map(c => <option key={c}>{c}</option>)}</select>}>
        {filas.length ? <div className="tscroll"><table>
          <thead><tr><th>Asignado</th><th>CD</th><th>Nivel</th><th>Zona</th><th>Pasillo</th><th>Jefe de turno</th><th>Supervisor</th><th className="num">Op.</th><th>Ejecutado</th><th>Estado</th><th /></tr></thead>
          <tbody>{filas.map(r => { const [lab, cls] = estadoInv(r, hoy); return (
            <tr key={r.id}><td>{dmy(r.fecha_asignado)}</td><td>{r.cd}</td><td>{r.nivel}</td><td>{r.zona}</td><td>{r.pasillo}</td><td>{r.jefe_turno}</td><td>{r.supervisor}</td><td className="num">{r.qty_op}</td>
              <td>{r.fecha_ejecutado ? dmy(r.fecha_ejecutado) : '—'}</td><td><span className={`st ${cls}`}>{lab}</span></td>
              <td className="row">{!r.fecha_ejecutado && <button type="button" className="ghost" onClick={() => act(() => api.patch(`/continuidad/inventario/${r.id}`, {}), 'Marcado como ejecutado hoy.')}>Ejecutado hoy</button>}
                <button type="button" className="link danger" onClick={() => window.confirm('¿Eliminar el registro?') && act(() => api.del(`/continuidad/inventario/${r.id}`), 'Registro eliminado.')}>Eliminar</button></td></tr>); })}</tbody>
        </table></div> : <p className="empty">Sin inventarios asignados.</p>}
      </Card>
    </>
  );
}
