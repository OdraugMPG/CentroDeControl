// Administración, Configuración: empresas externas, supervisores Paris, jefes de turno y supervisores de empresa externa,
// y la rotación semanal de turnos de cada grupo. Lo que se configura aquí lo usan Continuidad, Inventario CD y los
// supervisores por turno de cada CD en la asignación diaria.
import React, { useEffect, useState } from 'react';
import { api, fFecha } from './api.js';
import { toast, useCarga } from './ui.jsx';

const TIPOS = [['Supervisor', 'Supervisores Paris', 'SUP_PARIS'], ['Jefe de Turno Empresa', 'Jefes de turno de empresa externa', 'JEFE_EMPRESA'],
  ['Supervisor Empresa', 'Supervisores de empresa externa', 'SUP_EMPRESA']];
const COLOR = ['--yellow', '--blue', '--ink'];
const dm = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
// turnos que opera la empresa de una persona externa (todos si no tiene empresa o regla)
const turnosDe = (d, empresaId) => d.turnos.filter((t) => !empresaId || !d.rotEmpresa[empresaId] || d.rotEmpresa[empresaId].turnos.includes(t.id));
// resumen de la regla: qué turnos rotan, cada cuánto y cuáles quedan fijos
const nocheTxt = (n) => `Noche ${n} semanas (lun. a vie.) → PM → AM / PM cada semana (lun. a sáb.) → vuelve a la noche desde PM. Ciclo de ${3 * n} semanas en 3 equipos: cada semana hay un equipo en cada turno`;
const reglaTxt = (f) => { if (f.activo && f.tipo === 'noche_mensual') return nocheTxt(f.noche_semanas); const fijos = f.turnos.filter((t) => !f.activo || !f.ciclo.includes(t)); return f.activo && f.ciclo.length > 1
  ? `${f.ciclo.join(' ↔ ')} rotan cada ${f.semanas === 1 ? 'semana' : `${f.semanas} semanas`}${fijos.length ? ` · ${fijos.join(', ')} fijo` : ''}` : `Sin rotación: cada persona queda en su turno (${f.turnos.join(', ')})`; };

function TipoRotacion({ f, setF }) {
  return <>
    <div><div className="lbl">Tipo de rotación</div><select value={f.tipo} disabled={!f.activo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
      <option value="ciclo">Ciclo semanal</option><option value="noche_mensual">Noche mensual + AM / PM semanal</option></select></div>
    {f.tipo === 'noche_mensual' && <div><div className="lbl">Semanas en noche</div><select value={f.noche_semanas} disabled={!f.activo} onChange={(e) => setF({ ...f, noche_semanas: +e.target.value })}>
      {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} semanas</option>)}</select></div>}
  </>;
}

function Turno({ t, turnos }) {
  if (!t) return <span className="muted">—</span>;
  const i = turnos.findIndex((x) => x.id === t);
  return <span className="pill" style={{ background: `color-mix(in srgb,var(${COLOR[i] || '--muted'}) ${i === 2 ? 70 : 28}%,transparent)`, color: i === 2 ? 'var(--panel)' : undefined }}>{t}</span>;
}

function FilaPersona({ p, externa, d, onGuardar, onBaja }) {
  const [x, setX] = useState(p);
  useEffect(() => setX(p), [p]);
  const cambio = ['nombre', 'empresa_id', 'cd', 'turno_id', 'rota'].some((k) => String(x[k] ?? '') !== String(p[k] ?? ''));
  const s = (k) => (e) => setX({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <tr>
      <td><input type="text" aria-label="Nombre" value={x.nombre} onChange={s('nombre')} style={{ width: 190 }} /></td>
      {externa && <td><select aria-label="Empresa" value={x.empresa_id || ''} onChange={s('empresa_id')}><option value="">Elegir</option>
        {d.empresas.filter((e) => e.activo || e.id === p.empresa_id).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></td>}
      <td><select aria-label="CD" value={x.cd || ''} onChange={s('cd')}><option value="">Todos</option>{d.cds.map((c) => <option key={c}>{c}</option>)}</select></td>
      <td><select aria-label="Turno esta semana" value={x.turno_id || ''} onChange={s('turno_id')}><option value="">Sin turno</option>{turnosDe(d, externa && +x.empresa_id).map((t) => <option key={t.id}>{t.id}</option>)}</select></td>
      <td className="c"><input type="checkbox" aria-label="Rota" checked={x.rota} onChange={s('rota')} /></td>
      <td><Turno t={p.calendario?.[1]} turnos={d.turnos} /></td>
      <td className="row" style={{ gap: 6 }}>
        <button type="button" className="btn sm primary" disabled={!cambio || !x.nombre.trim()} onClick={() => onGuardar(x)}>Guardar</button>
        <button type="button" className="btn sm danger" onClick={() => onBaja(p)}>Dar de baja</button>
      </td>
    </tr>
  );
}

function Tipo({ rol, titulo, d, recargar }) {
  const externa = rol !== 'Supervisor';
  const lista = d.personas.filter((p) => p.rol === rol);
  const [n, setN] = useState({ nombre: '', empresa_id: '', cd: '', turno_id: d.turnos[0]?.id || '', rota: true });
  const guardar = async (x) => {
    try {
      if (x.id) await api.put(`/api/config/personal/${x.id}`, x); else await api.post('/api/config/personal', { ...x, rol });
      toast(x.id ? `${x.nombre} actualizado.` : `${x.nombre} agregado.`);
      if (!x.id) setN({ ...n, nombre: '' });
      recargar();
    } catch (e) { toast(e.message, true); }
  };
  const baja = async (p) => {
    if (!window.confirm(`¿Dar de baja a ${p.nombre}?`)) return;
    try { await api.del(`/api/config/personal/${p.id}`); toast(`${p.nombre} dado de baja.`); recargar(); } catch (e) { toast(e.message, true); }
  };
  const s = (k) => (e) => setN({ ...n, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ margin: '0 0 6px' }}>{titulo} ({lista.length})</h3>
      <div className="tbl">
        <table>
          <thead><tr><th>Nombre</th>{externa && <th>Empresa</th>}<th>CD</th><th>Turno esta semana</th><th className="c">Rota</th><th>Próxima semana</th><th /></tr></thead>
          <tbody>
            {lista.map((p) => <FilaPersona key={p.id} p={p} externa={externa} d={d} onGuardar={guardar} onBaja={baja} />)}
            <tr style={{ background: 'var(--band)' }}>
              <td><input type="text" placeholder="Nombre y apellido" aria-label={`Nombre del nuevo: ${titulo}`} value={n.nombre} onChange={s('nombre')} style={{ width: 190 }} /></td>
              {externa && <td><select aria-label="Empresa" value={n.empresa_id} onChange={s('empresa_id')}><option value="">Elegir</option>
                {d.empresas.filter((e) => e.activo).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></td>}
              <td><select aria-label="CD" value={n.cd} onChange={s('cd')}><option value="">Todos</option>{d.cds.map((c) => <option key={c}>{c}</option>)}</select></td>
              <td><select aria-label="Turno esta semana" value={n.turno_id} onChange={s('turno_id')}>{turnosDe(d, externa && +n.empresa_id).map((t) => <option key={t.id}>{t.id}</option>)}</select></td>
              <td className="c"><input type="checkbox" aria-label="Rota" checked={n.rota} onChange={s('rota')} /></td>
              <td />
              <td><button type="button" className="btn sm primary" disabled={!n.nombre.trim() || (externa && !n.empresa_id)} onClick={() => guardar(n)}>Agregar</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      {externa && !d.empresas.some((e) => e.activo) && <p className="note">Crea primero la empresa externa en "Rotación de turnos".</p>}
    </div>
  );
}

function Rotacion({ grupo, titulo, rol, d, recargar }) {
  const r = d.rotacion[grupo];
  const orden = d.turnos.map((t) => t.id);
  // el ciclo se guarda empezando por el primer turno incluido: en orden (AM → PM → Noche) o al revés (AM → Noche → PM)
  const inicial = () => { const incl = orden.filter((t) => r.ciclo.includes(t)); return { activo: r.activo, tipo: r.tipo || 'ciclo', noche_semanas: r.noche_semanas || 4, incl, sentido: r.ciclo.join() === incl.join() ? 'dir' : 'inv', semanas: r.semanas, inicio: r.inicio }; };
  const [f, setF] = useState(inicial);
  useEffect(() => setF(inicial()), [d]);   // eslint-disable-line react-hooks/exhaustive-deps
  const ciclo = f.sentido === 'inv' ? [f.incl[0], ...f.incl.slice(1).reverse()].filter(Boolean) : f.incl;
  const guardar = async () => {
    try { await api.put(`/api/config/rotacion/${grupo}`, { activo: f.activo, tipo: f.tipo, noche_semanas: f.noche_semanas, ciclo, semanas: f.semanas, inicio: f.inicio }); toast(`Rotación de ${titulo.toLowerCase()} guardada.`); recargar(); }
    catch (e) { toast(e.message, true); }
  };
  const lista = d.personas.filter((p) => p.rol === rol);
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
      <div className="row" style={{ gap: 18, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, minWidth: 230 }}>{titulo}</h3>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Rotación automática</label>
        <TipoRotacion f={f} setF={setF} />
        {f.tipo !== 'noche_mensual' && <>
        <div><div className="lbl">Turnos del ciclo</div><div className="row" style={{ gap: 10 }}>
          {orden.map((t) => <label key={t} className="row" style={{ gap: 4 }}><input type="checkbox" checked={f.incl.includes(t)}
            onChange={(e) => setF({ ...f, incl: orden.filter((x) => (x === t ? e.target.checked : f.incl.includes(x))) })} />{t}</label>)}</div></div>
        <div><div className="lbl">Sentido</div><select value={f.sentido} onChange={(e) => setF({ ...f, sentido: e.target.value })}>
          <option value="dir">{f.incl.join(' → ')}{f.incl.length > 1 ? ` → ${f.incl[0]}` : ''}</option>
          <option value="inv">{[f.incl[0], ...f.incl.slice(1).reverse()].filter(Boolean).join(' → ')}{f.incl.length > 1 ? ` → ${f.incl[0]}` : ''}</option></select></div>
        <div><div className="lbl">Cambia cada</div><select value={f.semanas} onChange={(e) => setF({ ...f, semanas: +e.target.value })}>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'semana' : 'semanas'}</option>)}</select></div>
        </>}
        <div><div className="lbl">{f.tipo === 'noche_mensual' ? 'La noche actual empezó la semana del' : 'Desde la semana del'}</div><input type="date" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /></div>
        <button type="button" className="btn primary" disabled={f.tipo !== 'noche_mensual' && f.incl.length < 2} onClick={guardar}>Guardar rotación</button>
      </div>
      <p className="note" style={{ margin: '6px 0 8px' }}>{f.activo && f.tipo === 'noche_mensual' ? `${nocheTxt(f.noche_semanas)}. El equipo de cada persona sale de su turno de esta semana.` : f.activo
        ? `El turno cambia los lunes: cada persona que rota avanza al siguiente turno del ciclo cada ${f.semanas === 1 ? 'semana' : `${f.semanas} semanas`}. El turno de esta semana de cada uno se mantiene al guardar.`
        : 'Sin rotación automática: cada persona queda en el turno que se le asigna.'}</p>
      {lista.length > 0 && <div className="tbl"><table>
        <thead><tr><th>Nombre</th>{rol !== 'Supervisor' && <th>Empresa</th>}<th>CD</th>{d.semanas.map((s, i) => <th key={s} className="c" style={i === 0 ? { background: 'var(--band)' } : undefined}>{i === 0 ? 'Esta semana' : `Sem. ${dm(s)}`}</th>)}</tr></thead>
        <tbody>{lista.map((p) => <tr key={p.id}><td>{p.nombre}{!p.rota && <span className="note"> (fijo)</span>}</td>{rol !== 'Supervisor' && <td>{p.empresa}</td>}<td>{p.cd || 'Todos'}</td>
          {p.calendario.map((t, i) => <td key={i} className="c" style={i === 0 ? { background: 'var(--band)' } : undefined}><Turno t={t} turnos={d.turnos} /></td>)}</tr>)}</tbody>
      </table></div>}
    </div>
  );
}

// Empresa externa con su regla: turnos que opera, si rota, qué turnos rotan, cada cuánto y desde qué semana
function FormEmpresa({ e, d, onGuardar, boton }) {
  const orden = d.turnos.map((t) => t.id);
  const inicial = () => {
    const r = e ? d.rotEmpresa[e.id] : null;
    return { nombre: e?.nombre || '', activa: e ? e.activo : true, turnos: r?.turnos || orden, activo: r ? r.activo : true, tipo: r?.tipo || 'ciclo', noche_semanas: r?.noche_semanas || 4,
      ciclo: r?.ciclo || orden.slice(0, 2), semanas: r?.semanas || 1, inicio: r?.inicio || d.semanas[0] };
  };
  const [f, setF] = useState(inicial);
  useEffect(() => setF(inicial()), [d]);   // eslint-disable-line react-hooks/exhaustive-deps
  const marcar = (k, t, on) => setF((x) => {
    const lista = orden.filter((y) => (y === t ? on : x[k].includes(y)));
    return k === 'turnos' ? { ...x, turnos: lista, ciclo: x.ciclo.filter((y) => lista.includes(y)) } : { ...x, ciclo: lista };
  });
  const noche = f.activo && f.tipo === 'noche_mensual';
  const valido = f.nombre.trim() && f.turnos.length && (!f.activo || (noche ? f.turnos.length === orden.length : f.ciclo.length >= 2));
  const chk = (k, t, dis) => <label key={t} className="row" style={{ gap: 4, opacity: dis ? 0.45 : 1 }}><input type="checkbox" disabled={dis} checked={f[k].includes(t)} onChange={(ev) => marcar(k, t, ev.target.checked)} />{t}</label>;
  return (
    <div className="row" style={{ gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div><div className="lbl">Empresa</div><input type="text" aria-label="Nombre de la empresa" placeholder="Nombre de la empresa" value={f.nombre} onChange={(ev) => setF({ ...f, nombre: ev.target.value })} style={{ width: 170 }} /></div>
      {e && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.activa} onChange={(ev) => setF({ ...f, activa: ev.target.checked })} /> Activa</label>}
      <div><div className="lbl">Turnos que opera</div><div className="row" style={{ gap: 10 }}>{orden.map((t) => chk('turnos', t, false))}</div></div>
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.activo} onChange={(ev) => setF({ ...f, activo: ev.target.checked })} /> Rotación automática</label>
      <TipoRotacion f={f} setF={setF} />
      {!noche && <>
        <div><div className="lbl">Turnos que rotan</div><div className="row" style={{ gap: 10 }}>{orden.map((t) => chk('ciclo', t, !f.activo || !f.turnos.includes(t)))}</div></div>
        <div><div className="lbl">Cambia cada</div><select value={f.semanas} disabled={!f.activo} onChange={(ev) => setF({ ...f, semanas: +ev.target.value })}>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'semana' : 'semanas'}</option>)}</select></div>
      </>}
      <div><div className="lbl">{noche ? 'La noche actual empezó la semana del' : 'Desde la semana del'}</div><input type="date" value={f.inicio} disabled={!f.activo} onChange={(ev) => setF({ ...f, inicio: ev.target.value })} /></div>
      <button type="button" className="btn primary" disabled={!valido} onClick={() => onGuardar(f)}>{boton}</button>
      <span className="note" style={{ flexBasis: '100%', margin: 0 }}>{reglaTxt(f)}{noche && f.turnos.length < orden.length ? '. Para la noche mensual la empresa debe operar los tres turnos.' : f.activo && !noche && f.ciclo.length < 2 ? '. Marca al menos dos turnos que roten.' : '.'}</span>
    </div>
  );
}

function RotacionEmpresa({ e, d, recargar }) {
  const lista = d.personas.filter((p) => p.rol !== 'Supervisor' && p.empresa_id === e.id);
  const guardar = async (f) => {
    try {
      if (f.nombre.trim().toUpperCase() !== e.nombre || f.activa !== e.activo) await api.put(`/api/config/empresas/${e.id}`, { nombre: f.nombre, activo: f.activa });
      await api.put(`/api/config/rotacion-empresa/${e.id}`, { turnos: f.turnos, activo: f.activo, tipo: f.tipo, noche_semanas: f.noche_semanas, ciclo: f.ciclo, semanas: f.semanas, inicio: f.inicio });
      toast(`${f.nombre.toUpperCase()}: turnos y rotación guardados.`); recargar();
    } catch (x) { toast(x.message, true); }
  };
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', opacity: e.activo ? 1 : 0.6 }}>
      <FormEmpresa e={e} d={d} onGuardar={guardar} boton="Guardar" />
      {lista.length > 0 ? <div className="tbl" style={{ marginTop: 8 }}><table>
        <thead><tr><th>Nombre</th><th>Cargo</th><th>CD</th>{d.semanas.map((s, i) => <th key={s} className="c" style={i === 0 ? { background: 'var(--band)' } : undefined}>{i === 0 ? 'Esta semana' : `Sem. ${dm(s)}`}</th>)}</tr></thead>
        <tbody>{lista.map((p) => <tr key={p.id}><td>{p.nombre}{!p.rota && <span className="note"> (fijo)</span>}</td><td>{p.rol === 'Jefe de Turno Empresa' ? 'Jefe de turno' : 'Supervisor'}</td><td>{p.cd || 'Todos'}</td>
          {p.calendario.map((t, i) => <td key={i} className="c" style={i === 0 ? { background: 'var(--band)' } : undefined}><Turno t={t} turnos={d.turnos} /></td>)}</tr>)}</tbody>
      </table></div> : <p className="note" style={{ margin: '6px 0 0' }}>Sin jefes de turno ni supervisores registrados en esta empresa.</p>}
    </div>
  );
}

export default function PersonalTurnos() {
  const [d, err, recargar] = useCarga(() => api.get('/api/config/personal'), []);
  if (err) return <div className="alert bad">{err}</div>;
  if (!d) return <p className="muted">Cargando…</p>;
  const crear = async (f) => {
    try {
      await api.post('/api/config/empresas', { nombre: f.nombre, rotacion: { turnos: f.turnos, activo: f.activo, tipo: f.tipo, noche_semanas: f.noche_semanas, ciclo: f.ciclo, semanas: f.semanas, inicio: f.inicio } });
      toast(`Empresa ${f.nombre.toUpperCase()} creada con su rotación.`); recargar();
    } catch (e) { toast(e.message, true); }
  };
  return (
    <>
      <div className="sec">
        <h2>Empresas y personal por turno</h2>
        <p className="note">Supervisores Paris, jefes de turno y supervisores de empresas externas con su turno de esta semana. Lo usan Continuidad, Inventario CD y los supervisores por turno de cada CD en la asignación diaria (los supervisores Paris con CD completan Sup. T1, T2 y T3 de ese CD).</p>
        {TIPOS.map(([rol, titulo]) => <Tipo key={rol} rol={rol} titulo={titulo} d={d} recargar={recargar} />)}
      </div>
      <div className="sec">
        <h2>Rotación de turnos</h2>
        <p className="note">Hoy es {fFecha(d.hoy)}. Se aplica sola al empezar cada semana (lunes): el sistema actualiza el turno de cada persona sin que nadie lo cambie a mano.</p>
        <Rotacion grupo="SUP_PARIS" titulo="Supervisores Paris" rol="Supervisor" d={d} recargar={recargar} />
        <h3 style={{ margin: '22px 0 0' }}>Empresas externas</h3>
        <p className="note" style={{ margin: '4px 0 0' }}>Cada empresa tiene su regla: los turnos que opera y cuáles rotan. Sus jefes de turno y supervisores rotan juntos; quien está en un turno que no rota (por ejemplo, la noche) queda fijo.</p>
        {d.empresas.map((e) => <RotacionEmpresa key={e.id} e={e} d={d} recargar={recargar} />)}
        <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: 'var(--band)' }}>
          <div className="lbl" style={{ marginBottom: 6 }}>Nueva empresa externa</div>
          <FormEmpresa key={d.empresas.length} d={d} onGuardar={crear} boton="Crear empresa" />
        </div>
      </div>
    </>
  );
}
