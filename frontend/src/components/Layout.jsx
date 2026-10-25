// Estructura general: inicio de sesión, barra con módulos y vistas según los permisos del rol, estado de datos y cuenta
import { useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApp } from '../lib/contexto.jsx';
import { hhmm, fechaHora } from '../lib/fmt.js';
import { MODULOS, vistaDe, vistasDe, primeraRuta } from '../lib/permisos.js';
import { Login, CambiarClave } from './Acceso.jsx';

function Reloj() {
  const { proxima } = useApp();
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(id); }, []);
  const s = Math.max(0, Math.round((proxima - Date.now()) / 1000));
  return <span>Actualiza en {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

function Cuenta({ onClave }) {
  const { usuario, salir } = useApp();
  const ref = useRef(null);
  useEffect(() => {
    const f = e => { if (ref.current && !ref.current.contains(e.target)) ref.current.open = false; };
    document.addEventListener('click', f);
    return () => document.removeEventListener('click', f);
  }, []);
  return (
    <details className="who cuenta" ref={ref}>
      <summary><b>{usuario.nombre}</b><span>{usuario.rolAcceso}</span></summary>
      <div className="pop">
        <p className="muted" style={{ margin: '0 0 6px', fontSize: 13 }}>Usuario {usuario.usuario}{usuario.persona ? `, ${usuario.rol}${usuario.turno ? ` turno ${usuario.turno}` : ''}` : ''}</p>
        <button type="button" className="link" onClick={() => { ref.current.open = false; onClave(); }}>Cambiar contraseña</button>
        <button type="button" className="link" onClick={salir}>Salir</button>
      </div>
    </details>
  );
}

export default function Layout() {
  const { cuenta, usuario, snap, error, cargando, refrescar } = useApp();
  const { pathname } = useLocation();
  const [clave, setClave] = useState(false);
  useEffect(() => setClave(false), [pathname]);

  if (cuenta === undefined) return <div className="wrap"><p className="msg">Cargando…</p></div>;
  if (!cuenta) return <Login />;
  if (cuenta.cambiarClave) return <CambiarClave forzado />;

  const actual = vistaDe(pathname);
  const modulo = actual?.modulo || 'ctl';
  const inicio = primeraRuta(usuario);
  const modulos = MODULOS.map(([k, l]) => [k, l, vistasDe(usuario, k)]).filter(m => m[2].length);
  const sub = modulos.find(m => m[0] === modulo)?.[2] || [];
  const permitido = actual && usuario.permisos.includes(actual.vista[2]);
  // Sin permiso para esta vista: la primera permitida del mismo módulo o, si no hay, la primera de todas
  const destino = sub[0]?.[0] || inicio;
  const edad = snap?.corte ? (Date.now() - snap.corte) / 60000 : null;

  return (
    <>
      <header className="appbar">
        <div className="in">
          <div className="brand">
            <h1><NavLink to={inicio || '/'}>Centro de control del CD</NavLink></h1>
            <nav className="modnav" aria-label="Módulos">
              {modulos.map(([k, l, vs]) => <NavLink key={k} to={vs[0][0]} className={() => modulo === k ? 'active' : ''}>{l}</NavLink>)}
            </nav>
          </div>
          <div className="live">
            <span title={snap?.corte ? `Última extracción de pedidos: ${fechaHora(snap.corte)}` : ''}>
              <span className={`dot ${error ? 'err' : edad === null || edad > 20 ? 'old' : ''}`} />
              {error ? 'Sin conexión con el servidor' : snap?.corte ? `Datos al ${hhmm(snap.corte)}` : 'Sin extracciones cargadas'}
            </span>
            <Reloj />
            <button type="button" className="ghost" onClick={refrescar} disabled={cargando}>{cargando ? 'Actualizando…' : 'Actualizar'}</button>
            <Cuenta onClave={() => setClave(true)} />
          </div>
        </div>
        <nav className="subnav" aria-label="Vistas">
          {sub.map(([to, l]) => <NavLink key={to} to={to} end>{l}</NavLink>)}
        </nav>
      </header>
      <main className="wrap">
        {error && <p className="msg err" role="alert">No se pudo actualizar ({error}). Se muestran los últimos datos recibidos y se reintentará en el próximo ciclo.</p>}
        {clave ? <CambiarClave onListo={() => setClave(false)} />
          : permitido ? <Outlet />
          : destino && destino !== pathname ? <Navigate to={destino} replace />
          : <p className="msg" style={{ marginTop: 24 }}>Tu rol ({usuario.rolAcceso}) no tiene vistas asignadas. Pide al administrador que te dé permisos.</p>}
      </main>
    </>
  );
}
