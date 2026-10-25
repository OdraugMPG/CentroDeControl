// Roles y permisos: matriz vista × rol. Admin tiene siempre todo; los demás roles se crean, editan y eliminan aquí.
import { useEffect, useState } from 'react';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';

function FormRol({ inicial, roles, onGuardar, onCancelar, onEliminar }) {
  const [f, setF] = useState(inicial);
  const nuevo = !inicial.id;
  return (
    <form className="adm-form" onSubmit={e => { e.preventDefault(); onGuardar(f); }}>
      <label className="field"><span>Nombre del rol</span><input type="text" value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} required maxLength={60} /></label>
      <label className="field" style={{ gridColumn: 'span 2' }}><span>Descripción</span><input type="text" value={f.descripcion} onChange={e => setF({ ...f, descripcion: e.target.value })} maxLength={300} /></label>
      {nuevo && <label className="field"><span>Partir con los permisos de</span>
        <select value={f.copia || ''} onChange={e => setF({ ...f, copia: e.target.value })}>
          <option value="">Ninguno (sin permisos)</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select></label>}
      <div className="row adm-acciones">
        <button type="submit" className="btn">{nuevo ? 'Crear rol' : 'Guardar'}</button>
        <button type="button" className="ghost" onClick={onCancelar}>Cancelar</button>
        {!nuevo && <button type="button" className="link danger" onClick={onEliminar}>Eliminar rol</button>}
      </div>
    </form>
  );
}

export default function Roles() {
  const { avisar, cargarCuenta } = useApp();
  const r = useCarga(() => api.get('/admin/roles'), []);
  const cat = useCarga(() => api.get('/admin/permisos'), []);
  const [mat, setMat] = useState({});           // { rolId: Set(permisos) } con los cambios sin guardar
  const [editar, setEditar] = useState(null);   // null | 'nuevo' | rol
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (r.data) setMat(Object.fromEntries(r.data.map(x => [x.id, new Set(x.permisos)]))); }, [r.data]);
  if (!r.data || !cat.data) return <><PageHead title="Roles y permisos" /><Cargando error={r.error || cat.error} /></>;

  const roles = r.data;
  const cambiados = roles.filter(x => !x.sistema && mat[x.id] && (mat[x.id].size !== x.permisos.length || x.permisos.some(p => !mat[x.id].has(p))));
  const toggle = (id, clave) => setMat(m => { const s = new Set(m[id]); s.has(clave) ? s.delete(clave) : s.add(clave); return { ...m, [id]: s }; });
  const grupo = (id, items, on) => setMat(m => { const s = new Set(m[id]); items.forEach(i => on ? s.add(i.clave) : s.delete(i.clave)); return { ...m, [id]: s }; });

  const guardarMatriz = async () => {
    setGuardando(true);
    try {
      for (const x of cambiados) await api.put(`/admin/roles/${x.id}`, { nombre: x.nombre, descripcion: x.descripcion, permisos: [...mat[x.id]] });
      avisar('Permisos guardados. Se aplican en la próxima acción de cada usuario.'); r.recargar(); cargarCuenta();
    } catch (e) { avisar(e.message, 'err'); }
    setGuardando(false);
  };
  const guardarRol = async f => {
    try {
      if (f.id) await api.put(`/admin/roles/${f.id}`, { nombre: f.nombre, descripcion: f.descripcion, permisos: [...(mat[f.id] || [])] });
      else await api.post('/admin/roles', { nombre: f.nombre, descripcion: f.descripcion, permisos: f.copia ? [...(mat[f.copia] || [])] : [] });
      avisar(f.id ? 'Rol actualizado.' : `Rol ${f.nombre} creado. Marca sus permisos en la matriz.`); setEditar(null); r.recargar();
    } catch (e) { avisar(e.message, 'err'); }
  };
  const eliminar = async x => {
    if (!window.confirm(`¿Eliminar el rol ${x.nombre}?`)) return;
    try { await api.del(`/admin/roles/${x.id}`); avisar('Rol eliminado.'); setEditar(null); r.recargar(); } catch (e) { avisar(e.message, 'err'); }
  };

  return (
    <>
      <PageHead title="Roles y permisos" sub="Marca qué vistas ve cada rol. Ver una vista permite también trabajar en ella (cargar, registrar, editar); las acciones sensibles tienen su propia fila.">
        {cambiados.length > 0 && <button type="button" className="btn" disabled={guardando} onClick={guardarMatriz}>{guardando ? 'Guardando…' : `Guardar cambios (${cambiados.length} ${cambiados.length === 1 ? 'rol' : 'roles'})`}</button>}
        {cambiados.length > 0 && <button type="button" className="ghost" onClick={() => r.recargar()}>Descartar</button>}
        {editar !== 'nuevo' && <button type="button" className="ghost" onClick={() => setEditar('nuevo')}>Nuevo rol</button>}
      </PageHead>
      {editar && <Card title={editar === 'nuevo' ? 'Nuevo rol' : `Editar ${editar.nombre}`}>
        <FormRol key={editar === 'nuevo' ? 'n' : editar.id} inicial={editar === 'nuevo' ? { nombre: '', descripcion: '' } : editar} roles={roles}
          onGuardar={guardarRol} onCancelar={() => setEditar(null)} onEliminar={() => eliminar(editar)} />
      </Card>}
      <Card>
        <div className="tscroll"><table className="matriz">
          <thead><tr><th>Vista o acción</th>{roles.map(x => (
            <th key={x.id} className="c" title={x.descripcion}>
              {x.sistema ? x.nombre : <button type="button" className="link" onClick={() => setEditar(x)}>{x.nombre}</button>}
              <small>{x.usuarios} {x.usuarios === 1 ? 'usuario' : 'usuarios'}</small>
            </th>))}</tr></thead>
          {cat.data.map(g => (
            <tbody key={g.grupo}>
              <tr className="grupo"><th>{g.grupo}</th>{roles.map(x => {
                const n = g.items.filter(i => mat[x.id]?.has(i.clave)).length;
                return <td key={x.id} className="c">{x.sistema ? '' : <button type="button" className="link" onClick={() => grupo(x.id, g.items, n < g.items.length)}>{n < g.items.length ? 'Todas' : 'Ninguna'}</button>}</td>;
              })}</tr>
              {g.items.map(i => <tr key={i.clave}><td>{i.nombre}</td>{roles.map(x => (
                <td key={x.id} className="c"><input type="checkbox" aria-label={`${i.nombre}: ${x.nombre}`} disabled={x.sistema}
                  checked={x.sistema || !!mat[x.id]?.has(i.clave)} onChange={() => toggle(x.id, i.clave)} /></td>))}</tr>)}
            </tbody>))}
        </table></div>
      </Card>
    </>
  );
}
