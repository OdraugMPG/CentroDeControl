// Mi turno: actividades, asistencia y entrega de turno (paso a paso)
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api, qs } from '../../lib/api.js';
import { Card, Cargando, PageHead, SelectorTurno, useTurnoSel } from '../../components/ui.jsx';
import Tareas from '../../components/Tareas.jsx';
import { Entrega } from './Panel.jsx';
import { dmy, fechaHora, pctf } from '../../lib/fmt.js';

function Asistencia({ fecha, turno, filas, onGuardada }) {
  const { usuario, avisar } = useApp();
  const a = useCarga(() => api.get('/continuidad/asistencia?' + qs({ fecha, turno })), [fecha, turno]);
  const dot = useCarga(() => api.get('/continuidad/dotacion'), []);
  const [vals, setVals] = useState({});
  const [quien, setQuien] = useState('');
  useEffect(() => {
    const fuente = a.data?.registro || a.data?.previa;
    setVals(fuente ? fuente.valores : {});
    setQuien(a.data?.registro?.confirmado_por || usuario?.nombre || '');
  }, [a.data, usuario]);
  if (!a.data || !dot.data) return <Cargando error={a.error || dot.error} />;
  const req = dot.data[turno] || {};
  const reg = a.data.registro;
  const guardar = async () => {
    try { await api.put('/continuidad/asistencia', { fecha, turno, confirmado_por: quien, valores: vals }); avisar('Asistencia confirmada.'); a.recargar(); onGuardada?.(); }
    catch (e) { avisar(e.message, 'err'); }
  };
  let cargoPrev = null;
  return (
    <>
      {!reg && a.data.previa && <p className="hint">Prellenado con la última confirmación del turno {turno} ({dmy(a.data.previa.fecha)}). Ajusta lo que cambió y confirma.</p>}
      <div className="tscroll"><table>
        <thead><tr><th>Cargo / área</th><th className="num">Requerida</th><th className="num">Presentes</th><th className="num">Diferencia</th></tr></thead>
        <tbody>{filas.flatMap(f => {
          const out = [];
          if (f.funcion && f.cargo !== cargoPrev) out.push(<tr key={'h' + f.cargo} className="grp"><td colSpan={4}>{f.cargo}</td></tr>);
          cargoPrev = f.cargo;
          const r = req[f.fila] || 0, pres = vals[f.fila] ?? '', diff = pres === '' ? null : +pres - r;
          out.push(<tr key={f.fila}><td>{f.funcion ? <span style={{ paddingLeft: 14 }}>{f.funcion}</span> : <b>{f.cargo}</b>}</td><td className="num">{r}</td>
            <td className="num"><input type="number" min="0" style={{ width: 76 }} value={pres} aria-label={`Presentes ${f.fila}`}
              onChange={e => setVals({ ...vals, [f.fila]: e.target.value === '' ? '' : Math.max(0, +e.target.value) })} /></td>
            <td className={`num ${diff === null ? '' : diff < 0 ? 'warn' : 'ok'}`}>{diff === null ? '—' : (diff > 0 ? '+' : '') + diff}</td></tr>);
          return out;
        })}</tbody>
      </table></div>
      <div className="row" style={{ marginTop: 10 }}>
        <input type="text" value={quien} onChange={e => setQuien(e.target.value)} placeholder="Confirmado por" aria-label="Confirmado por" style={{ maxWidth: 260 }} />
        <button type="button" className="btn" disabled={!quien.trim()} onClick={guardar}>{reg ? 'Actualizar confirmación' : 'Confirmar asistencia'}</button>
        {reg && <span className="muted" style={{ fontSize: 13 }}>Última confirmación {fechaHora(new Date(reg.confirmado_en).getTime())}, {pctf(a.data.pct)} de la dotación.</span>}
      </div>
    </>
  );
}

function FormEntrega({ fecha, turno, jefeDef, onEntregada }) {
  const { avisar, meta } = useApp();
  const [jefe, setJefe] = useState(jefeDef || '');
  const [situacion, setSituacion] = useState('');
  const [riesgos, setRiesgos] = useState('');
  const [tareas, setTareas] = useState([]);
  useEffect(() => { setJefe(jefeDef || ''); }, [jefeDef]);
  const cats = Object.keys(meta.categorias || {});
  const upd = (i, k, v) => setTareas(tareas.map((t, j) => j === i ? { ...t, [k]: v } : t));
  const entregar = async () => {
    try { await api.post('/continuidad/handovers', { fecha, turno, jefe, situacion, riesgos, tareas }); avisar('Turno entregado. El jefe siguiente debe confirmar la recepción.'); setSituacion(''); setRiesgos(''); setTareas([]); onEntregada?.(); }
    catch (e) { avisar(e.message, 'err'); }
  };
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <label className="field"><span>Jefe de turno que entrega</span><input type="text" value={jefe} onChange={e => setJefe(e.target.value)} placeholder="Nombre y apellido" /></label>
      <label className="field"><span>Situación (estado general del turno)</span><textarea value={situacion} onChange={e => setSituacion(e.target.value)} placeholder="Volumen procesado, cumplimiento, novedades relevantes" /></label>
      <label className="field"><span>Riesgos y alertas para el turno siguiente</span><textarea value={riesgos} onChange={e => setRiesgos(e.target.value)} placeholder="Algo que el turno siguiente debe vigilar" /></label>
      <div className="field"><span>Otros pendientes de este turno</span>
        {tareas.map((t, i) => (
          <div key={i} className="row">
            <input type="text" value={t.titulo} onChange={e => upd(i, 'titulo', e.target.value)} placeholder="Pendiente" style={{ flex: 2, minWidth: 180 }} aria-label="Pendiente" />
            <select value={t.categoria} onChange={e => upd(i, 'categoria', e.target.value)} style={{ flex: 1, minWidth: 140 }} aria-label="Categoría">{cats.map(c => <option key={c}>{c}</option>)}</select>
            <input type="text" value={t.responsable} onChange={e => upd(i, 'responsable', e.target.value)} placeholder="Responsable" style={{ flex: 1, minWidth: 120 }} aria-label="Responsable" />
            <button type="button" className="link danger" onClick={() => setTareas(tareas.filter((_, j) => j !== i))}>Quitar</button>
          </div>))}
        <div><button type="button" className="ghost" onClick={() => setTareas([...tareas, { titulo: '', categoria: 'Otra', responsable: '' }])}>Agregar pendiente</button></div>
      </div>
      <div className="row"><button type="button" className="btn" disabled={!jefe.trim()} onClick={entregar}>Entregar turno</button>
        <span className="muted" style={{ fontSize: 13 }}>Queda registrado con hora exacta. Las tareas abiertas pasan al turno siguiente cuando su jefe confirma la recepción.</span></div>
    </div>
  );
}

export default function MiTurno() {
  const { meta, usuario } = useApp();
  const { fecha, turno, set } = useTurnoSel();
  const d = useCarga(async () => {
    if (!fecha) return null;
    const [tareas, personas, hos] = await Promise.all([api.get('/continuidad/tareas?' + qs({ fecha, turno })), api.get('/continuidad/personas'),
      api.get('/continuidad/handovers?' + qs({ fecha }))]);
    return { tareas, personas, hos: hos.filter(h => h.turno_id === turno) };
  }, [fecha, turno]);
  if (!meta || !fecha) return <Cargando />;
  const programado = (meta.calendario[new Date(fecha + 'T12:00:00').getDay()] || []).includes(turno);
  const jefe = d.data?.personas.find(p => p.rol === 'Jefe de Turno' && p.turno_id === turno);
  const heredadas = d.data?.tareas.some(t => t.prioridad === 'alta' && t.estado === 'abierta');

  return (
    <>
      <PageHead title={`Mi turno: ${turno} del ${dmy(fecha)}`} sub={jefe ? `Jefe de turno: ${jefe.nombre}` : 'Sin jefe de turno registrado en Equipo'}>
        <Link className="ghost" to={`/cierre?fecha=${fecha}&turno=${turno}`}>Ver cierre del turno</Link>
      </PageHead>
      <SelectorTurno fecha={fecha} turno={turno} onChange={set} />
      {!programado && <p className="msg err">El turno {turno} no opera ese día según el calendario.</p>}
      {!d.data ? <Cargando error={d.error} /> : <>
        <Card title={<><span className="step">1</span>Actividades del turno</>}
          hint={heredadas ? 'Hay actividades que quedaron pendientes del turno anterior: priorízalas.' : 'Asignadas por Jefatura de Operaciones o heredadas del turno anterior. Delega a tus supervisores y ciérralas al terminarlas.'}>
          <Tareas tareas={d.data.tareas} personas={d.data.personas} onCambio={d.recargar} vacio="No hay actividades asignadas para este turno." />
        </Card>
        <Card title={<><span className="step">2</span>Asistencia</>} hint="Confirma cuántas personas se presentaron por cargo y área.">
          <Asistencia fecha={fecha} turno={turno} filas={meta.filasAsistencia} />
        </Card>
        <Card title={<><span className="step">3</span>Entrega de turno</>}>
          {d.data.hos.length > 0 && <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>{d.data.hos.map(h => <Entrega key={h.id} h={h} onConfirmada={d.recargar} />)}</div>}
          <FormEntrega fecha={fecha} turno={turno} jefeDef={usuario?.rol === 'Jefe de Turno' ? usuario.nombre : jefe?.nombre} onEntregada={d.recargar} />
        </Card>
      </>}
    </>
  );
}
