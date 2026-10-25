// Asignación de compromisos a los turnos (compositor por categoría y asignación individual)
import { useState } from 'react';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api, qs } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';
import Tareas from '../../components/Tareas.jsx';

function Compositor({ meta, cds, onListo }) {
  const { avisar, usuario } = useApp();
  const [turno, setTurno] = useState(meta.turnoActual?.turno || 'AM');
  const [fecha, setFecha] = useState(meta.fechaOperativa);
  const [selCds, setSelCds] = useState([]);
  const [secs, setSecs] = useState([{ categoria: '', items: [''] }]);
  const upd = (i, fn) => setSecs(secs.map((s, j) => j === i ? fn(s) : s));
  const enviar = async () => {
    try { const r = await api.post('/continuidad/tareas/grupo', { turno, fecha, cds: selCds, secciones: secs, asignado_por: usuario?.nombre });
      avisar(`${r.creadas} compromisos asignados al turno ${turno}.`); setSecs([{ categoria: '', items: [''] }]); onListo(); }
    catch (e) { avisar(e.message, 'err'); }
  };
  return (
    <Card title="Compromisos del turno" hint="Arma la lista por categoría y asígnala al grupo del turno. El jefe de turno la ve en Mi turno y la delega a sus supervisores.">
      <div className="grid3">
        <label className="field"><span>Turno</span><select value={turno} onChange={e => setTurno(e.target.value)}>{meta.turnos.map(t => <option key={t.id}>{t.id}</option>)}</select></label>
        <label className="field"><span>Fecha</span><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></label>
        <div className="field"><span>CDs involucrados (opcional)</span>
          {cds.length ? <div className="checks">{cds.map(c => <label key={c}><input type="checkbox" checked={selCds.includes(c)} onChange={e => setSelCds(e.target.checked ? [...selCds, c] : selCds.filter(x => x !== c))} />{c}</label>)}</div>
            : <span className="muted" style={{ fontWeight: 400 }}>Agrega CDs en Inventario CD para marcarlos aquí.</span>}</div>
      </div>
      <datalist id="cats">{Object.keys(meta.categorias).map(c => <option key={c} value={c} />)}</datalist>
      {secs.map((s, i) => (
        <div key={i} className="card" style={{ background: 'var(--bg)' }}>
          <div className="row">
            <input type="text" list="cats" value={s.categoria} onChange={e => upd(i, x => ({ ...x, categoria: e.target.value }))} placeholder="Categoría (Flujo de Traspaso, Control PKT, Almacenamiento…)" style={{ flex: 1 }} aria-label="Categoría" />
            {secs.length > 1 && <button type="button" className="link danger" onClick={() => setSecs(secs.filter((_, j) => j !== i))}>Quitar categoría</button>}
          </div>
          {s.items.map((it, k) => (
            <div key={k} className="row" style={{ marginTop: 6 }}>
              <input type="text" value={it} onChange={e => upd(i, x => ({ ...x, items: x.items.map((y, z) => z === k ? e.target.value : y) }))} placeholder="Compromiso" style={{ flex: 1 }} aria-label="Compromiso" />
              <button type="button" className="link danger" onClick={() => upd(i, x => ({ ...x, items: x.items.filter((_, z) => z !== k) }))}>Quitar</button>
            </div>))}
          <button type="button" className="ghost" style={{ marginTop: 6 }} onClick={() => upd(i, x => ({ ...x, items: [...x.items, ''] }))}>Agregar compromiso</button>
        </div>))}
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="ghost" onClick={() => setSecs([...secs, { categoria: '', items: [''] }])}>Agregar categoría</button>
        <button type="button" className="btn" onClick={enviar}>Asignar al turno</button>
      </div>
    </Card>
  );
}

function Individual({ meta, onListo }) {
  const { avisar, usuario } = useApp();
  const [f, setF] = useState({ categoria: '', titulo: '', fecha: meta.fechaOperativa, responsable: '', repetir: 'no', veces: 5, turnos: meta.turnos.map(t => t.id) });
  const s = (k, v) => setF({ ...f, [k]: v });
  const enviar = async () => {
    try { const r = await api.post('/continuidad/tareas', { ...f, asignado_por: usuario?.nombre });
      avisar(`${r.creadas} actividades creadas${r.omitidas.length ? `. Se omitieron ${r.omitidas.length} turnos que no operan según el calendario` : ''}.`); setF({ ...f, titulo: '' }); onListo(); }
    catch (e) { avisar(e.message, 'err'); }
  };
  return (
    <Card title="Asignar actividad" hint="Se crea una actividad por cada turno y fecha. Los turnos que no operan ese día (domingo, noche del sábado) se omiten.">
      <div className="grid3">
        <label className="field"><span>Categoría</span><input type="text" list="cats" value={f.categoria} onChange={e => s('categoria', e.target.value)} placeholder="Inventario, Recall…" /></label>
        <label className="field"><span>Fecha</span><input type="date" value={f.fecha} onChange={e => s('fecha', e.target.value)} /></label>
        <label className="field"><span>Responsable sugerido (opcional)</span><input type="text" value={f.responsable} onChange={e => s('responsable', e.target.value)} /></label>
      </div>
      <label className="field" style={{ marginTop: 10 }}><span>Título</span><input type="text" value={f.titulo} onChange={e => s('titulo', e.target.value)} placeholder="Conteo cíclico zona B" /></label>
      <div className="grid3" style={{ marginTop: 10 }}>
        <div className="field"><span>Turnos destino</span><div className="checks">{meta.turnos.map(t => <label key={t.id}>
          <input type="checkbox" checked={f.turnos.includes(t.id)} onChange={e => s('turnos', e.target.checked ? [...f.turnos, t.id] : f.turnos.filter(x => x !== t.id))} />{t.id}</label>)}</div></div>
        <label className="field"><span>Repetir</span><select value={f.repetir} onChange={e => s('repetir', e.target.value)}>
          <option value="no">No repetir</option><option value="diario">Diario</option><option value="semanal">Semanal, mismo día</option></select></label>
        {f.repetir !== 'no' && <label className="field"><span>Repeticiones</span><input type="number" min="1" max="60" value={f.veces} onChange={e => s('veces', e.target.value)} /></label>}
      </div>
      <div className="row" style={{ marginTop: 10 }}><button type="button" className="btn" disabled={!f.titulo.trim() || !f.turnos.length} onClick={enviar}>Asignar</button></div>
    </Card>
  );
}

export default function Asignar() {
  const { meta } = useApp();
  const d = useCarga(async () => {
    const [pend, personas, inv] = await Promise.all([api.get('/continuidad/tareas?' + qs({ abiertas: 1, origen: 'operaciones', desde: meta?.fechaOperativa })),
      api.get('/continuidad/personas'), api.get('/continuidad/inventario')]);
    return { pend, personas, cds: [...new Set(inv.layout.map(l => l.cd))] };
  }, [meta?.fechaOperativa]);
  if (!meta || !d.data) return <Cargando error={d.error} />;
  return (
    <>
      <PageHead title="Asignar compromisos" />
      <Compositor meta={meta} cds={d.data.cds} onListo={d.recargar} />
      <Individual meta={meta} onListo={d.recargar} />
      <Card title={`Actividades abiertas desde hoy (${d.data.pend.length})`}>
        <Tareas tareas={d.data.pend} personas={d.data.personas} onCambio={d.recargar} mostrarTurno vacio="No hay actividades abiertas asignadas." />
      </Card>
    </>
  );
}
