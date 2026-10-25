// Administración de usuarios: alta con contraseña temporal, rol, persona del Equipo, activación y restablecimiento de clave
import { useState } from 'react';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';
import { fechaHora } from '../../lib/fmt.js';

// Contraseña temporal legible (sin caracteres que se confunden: 0/O, 1/l/I)
const temporal = () => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = crypto.getRandomValues(new Uint32Array(10));
  return [...a].map(n => c[n % c.length]).join('');
};
const VACIO = { usuario: '', nombre: '', rol_id: '', persona_id: '', clave: '' };

function FormUsuario({ inicial, roles, personas, onGuardar, onCancelar, nuevo }) {
  const [f, setF] = useState(inicial);
  const [enviando, setEnviando] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const enviar = async e => { e.preventDefault(); setEnviando(true); await onGuardar(f); setEnviando(false); };
  return (
    <form onSubmit={enviar} className="adm-form">
      <label className="field"><span>Usuario (para entrar)</span><input type="text" value={f.usuario} onChange={set('usuario')} required pattern="[\w.@\-]+" title="Letras, números, punto, guion, guion bajo y @" autoComplete="off" /></label>
      <label className="field"><span>Nombre y apellido</span><input type="text" value={f.nombre} onChange={set('nombre')} required /></label>
      <label className="field"><span>Rol</span>
        <select value={f.rol_id} onChange={set('rol_id')} required>
          <option value="">Elige un rol</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select></label>
      <label className="field"><span>Persona del Equipo (opcional)</span>
        <select value={f.persona_id ?? ''} onChange={set('persona_id')}>
          <option value="">Sin vincular</option>
          {personas.map(p => <option key={p.id} value={p.id}>{p.nombre}: {p.rol}{p.turno_id ? `, ${p.turno_id}` : ''}</option>)}
        </select></label>
      {nuevo && <label className="field"><span>Contraseña temporal</span>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input type="text" value={f.clave} onChange={set('clave')} required minLength={8} autoComplete="off" />
          <button type="button" className="ghost" onClick={() => setF({ ...f, clave: temporal() })}>Generar</button>
        </div></label>}
      {!nuevo && <label className="check"><input type="checkbox" checked={!!f.activo} onChange={set('activo')} /> Cuenta activa</label>}
      <div className="row adm-acciones">
        <button type="submit" className="btn" disabled={enviando}>{enviando ? 'Guardando…' : nuevo ? 'Crear usuario' : 'Guardar'}</button>
        <button type="button" className="ghost" onClick={onCancelar}>Cancelar</button>
      </div>
      <p className="hint adm-acciones">La persona del Equipo de Continuidad le da su turno y función (Jefe de Turno o Supervisor) en «Mi turno». {nuevo && 'Al entrar por primera vez se le pedirá cambiar la contraseña temporal.'}</p>
    </form>
  );
}

export default function Usuarios() {
  const { avisar, usuario } = useApp();
  const u = useCarga(() => api.get('/admin/usuarios'), []);
  const r = useCarga(() => api.get('/admin/roles'), []);
  const p = useCarga(() => api.get('/continuidad/personas'), []);
  const [editar, setEditar] = useState(null);     // 'nuevo' o id
  const [clave, setClave] = useState(null);       // { nombre, usuario, clave } recién restablecida
  if (!u.data || !r.data || !p.data) return <><PageHead title="Usuarios" /><Cargando error={u.error || r.error || p.error} /></>;

  const crear = async f => {
    try { await api.post('/admin/usuarios', { ...f, persona_id: f.persona_id || null }); avisar(`Usuario ${f.usuario} creado.`); setClave({ nombre: f.nombre, usuario: f.usuario, clave: f.clave }); setEditar(null); u.recargar(); }
    catch (e) { avisar(e.message, 'err'); }
  };
  const guardar = id => async f => {
    try { await api.patch(`/admin/usuarios/${id}`, { usuario: f.usuario, nombre: f.nombre, rol_id: f.rol_id, persona_id: f.persona_id || null, activo: f.activo }); avisar('Usuario actualizado.'); setEditar(null); u.recargar(); }
    catch (e) { avisar(e.message, 'err'); }
  };
  const restablecer = async x => {
    if (!window.confirm(`¿Restablecer la contraseña de ${x.nombre}? Se cerrarán sus sesiones abiertas y deberá cambiarla al entrar.`)) return;
    const c = temporal();
    try { await api.post(`/admin/usuarios/${x.id}/clave`, { clave: c }); setClave({ nombre: x.nombre, usuario: x.usuario, clave: c }); u.recargar(); }
    catch (e) { avisar(e.message, 'err'); }
  };
  const estado = x => !x.activo ? <span className="pill">Desactivado</span> : x.bloqueado ? <span className="pill bad">Bloqueado</span>
    : x.cambiar_clave ? <span className="pill mid">Clave temporal</span> : <span className="pill ok">Activo</span>;

  return (
    <>
      <PageHead title="Usuarios" sub="Cada persona entra con su usuario y contraseña. Lo que ve y puede hacer depende de su rol (Administración, Roles y permisos).">
        {editar !== 'nuevo' && <button type="button" className="btn" onClick={() => { setEditar('nuevo'); setClave(null); }}>Nuevo usuario</button>}
      </PageHead>
      {clave && <div className="card clave-temp" role="status">
        <b>Contraseña temporal de {clave.nombre}</b>
        <p>Usuario <code>{clave.usuario}</code>, contraseña <code>{clave.clave}</code>. Entrégasela por un canal privado: no se volverá a mostrar y deberá cambiarla al entrar.</p>
        <button type="button" className="link" onClick={() => setClave(null)}>Listo, ya la entregué</button>
      </div>}
      {editar === 'nuevo' && <Card title="Nuevo usuario">
        <FormUsuario nuevo inicial={{ ...VACIO, clave: temporal() }} roles={r.data} personas={p.data} onGuardar={crear} onCancelar={() => setEditar(null)} />
      </Card>}
      <Card>
        <div className="tscroll"><table>
          <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Persona del Equipo</th><th>Estado</th><th>Último acceso</th><th /></tr></thead>
          <tbody>{u.data.map(x => editar === x.id
            ? <tr key={x.id}><td colSpan={7}><FormUsuario inicial={{ ...x, persona_id: x.persona_id ?? '' }} roles={r.data} personas={p.data} onGuardar={guardar(x.id)} onCancelar={() => setEditar(null)} /></td></tr>
            : <tr key={x.id} className={x.activo ? '' : 'muted'}>
              <td>{x.nombre}{x.id === usuario.cuentaId && <small className="muted"> (tú)</small>}</td><td>{x.usuario}</td><td>{x.rol}</td>
              <td>{x.persona ? `${x.persona}, ${x.persona_rol}${x.persona_turno ? ` ${x.persona_turno}` : ''}` : '—'}</td>
              <td>{estado(x)}</td><td>{x.ultimo_acceso ? fechaHora(new Date(x.ultimo_acceso).getTime()) : 'Nunca'}</td>
              <td className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                <button type="button" className="link" onClick={() => { setEditar(x.id); setClave(null); }}>Editar</button>
                <button type="button" className="link" onClick={() => restablecer(x)}>Restablecer contraseña</button>
              </td></tr>)}</tbody>
        </table></div>
      </Card>
    </>
  );
}
