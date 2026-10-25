// Estructura general: barra con módulos, estado de datos, usuario y subnavegación
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApp } from '../lib/contexto.jsx';
import { api } from '../lib/api.js';
import { hhmm, fechaHora } from '../lib/fmt.js';
import { vistasDe } from '../pages/gestion/Gestion.jsx';

const SUB_CONTROL = [['/', 'Resumen'], ['/recepcion', 'Recepción'], ['/almacenamiento', 'Almacenamiento'], ['/pedidos', 'Flujo de pedidos'],
  ['/control', 'Control por hora'], ['/cierre', 'Cierre de turno'], ['/mapa', 'Pedidos por región'], ['/olas', 'Simulador de olas']];
const SUB_CONT = [['/continuidad', 'Panel', 'todos'], ['/continuidad/turno', 'Mi turno', 'todos'], ['/continuidad/calendario', 'Calendario', 'todos'],
  ['/continuidad/asignar', 'Asignar', 'ops'], ['/continuidad/equipo', 'Equipo', 'ops'], ['/continuidad/dotacion', 'Dotación', 'ops'],
  ['/continuidad/inventario', 'Inventario CD', 'ops'], ['/continuidad/indicadores', 'Indicadores', 'ops']];
export const esOps = u => !u || u.rol === 'Jefe de Operaciones';

function Reloj() {
  const { proxima } = useApp();
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(id); }, []);
  const s = Math.max(0, Math.round((proxima - Date.now()) / 1000));
  return <span>Actualiza en {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

function ElegirUsuario({ onListo }) {
  const { setUsuario } = useApp();
  const [personas, setPersonas] = useState([]);
  const [nombre, setNombre] = useState('');
  useEffect(() => { api.get('/continuidad/personas').then(setPersonas).catch(() => {}); }, []);
  const elegir = u => { setUsuario(u); onListo?.(); };
  return (
    <div className="role-pick">
      <h2 style={{ fontSize: 28 }}>¿Quién eres?</h2>
      <p className="muted" style={{ margin: 0 }}>Tu nombre queda registrado en cierres, entregas y tareas. Se recuerda en este navegador.</p>
      {personas.map(p => (
        <button key={p.id} type="button" onClick={() => elegir({ id: p.id, nombre: p.nombre, rol: p.rol, turno: p.turno_id })}>
          {p.nombre}<span>{p.rol}{p.turno_id ? `, turno ${p.turno_id}` : ''}</span>
        </button>
      ))}
      <div className="card" style={{ marginTop: 0 }}>
        <label className="field"><span>No estoy en la lista</span>
          <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre y apellido" />
        </label>
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" className="btn" disabled={!nombre.trim()} onClick={() => elegir({ nombre: nombre.trim(), rol: 'Visualización' })}>Entrar</button>
          <span className="muted" style={{ fontSize: 13 }}>El Jefe de Operaciones puede agregarte en Continuidad, Equipo.</span>
        </div>
      </div>
    </div>
  );
}

export default function Layout() {
  const { snap, error, cargando, refrescar, usuario, setUsuario } = useApp();
  const { pathname } = useLocation();
  const [cambiando, setCambiando] = useState(false);
  const modulo = pathname.startsWith('/continuidad') ? 'cont' : pathname.startsWith('/gestion') ? 'gd' : pathname.startsWith('/cargas') || pathname.startsWith('/configuracion') ? 'cfg' : 'ctl';
  const sub = modulo === 'ctl' ? SUB_CONTROL : modulo === 'gd' ? vistasDe(usuario).map(([r, t]) => [`/gestion${r ? '/' + r : ''}`, t]) : modulo === 'cont' ? SUB_CONT.filter(s => s[2] === 'todos' || esOps(usuario)) :
    [['/cargas', 'Cargas de extracciones'], ...(esOps(usuario) ? [['/configuracion', 'Metas y calendario']] : [])];
  const edad = snap?.corte ? (Date.now() - snap.corte) / 60000 : null;

  if (!usuario || cambiando) return <div className="wrap"><ElegirUsuario onListo={() => setCambiando(false)} /></div>;

  return (
    <>
      <header className="appbar">
        <div className="in">
          <div className="brand">
            <h1><NavLink to="/">Centro de control del CD</NavLink></h1>
            <nav className="modnav" aria-label="Módulos">
              <NavLink to="/" className={() => modulo === 'ctl' ? 'active' : ''}>Operación</NavLink>
              <NavLink to="/gestion" className={() => modulo === 'gd' ? 'active' : ''}>Gestión diaria</NavLink>
              <NavLink to="/continuidad" className={() => modulo === 'cont' ? 'active' : ''}>Continuidad</NavLink>
              <NavLink to="/cargas" className={() => modulo === 'cfg' ? 'active' : ''}>Datos</NavLink>
            </nav>
          </div>
          <div className="live">
            <span title={snap?.corte ? `Última extracción de pedidos: ${fechaHora(snap.corte)}` : ''}>
              <span className={`dot ${error ? 'err' : edad === null || edad > 20 ? 'old' : ''}`} />
              {error ? 'Sin conexión con el servidor' : snap?.corte ? `Datos al ${hhmm(snap.corte)}` : 'Sin extracciones cargadas'}
            </span>
            <Reloj />
            <button type="button" className="ghost" onClick={refrescar} disabled={cargando}>{cargando ? 'Actualizando…' : 'Actualizar'}</button>
            <span className="who"><b>{usuario.nombre}</b><button type="button" onClick={() => { setUsuario(null); setCambiando(true); }}>Cambiar</button></span>
          </div>
        </div>
        <nav className="subnav" aria-label="Vistas">
          {sub.map(([to, l]) => <NavLink key={to} to={to} end>{l}</NavLink>)}
        </nav>
      </header>
      <main className="wrap">
        {error && <p className="msg err" role="alert">No se pudo actualizar ({error}). Se muestran los últimos datos recibidos y se reintentará en el próximo ciclo.</p>}
        <Outlet />
      </main>
    </>
  );
}
