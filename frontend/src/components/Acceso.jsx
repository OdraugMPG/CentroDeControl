// Inicio de sesión, primer administrador y cambio de contraseña
import { useEffect, useState } from 'react';
import { useApp } from '../lib/contexto.jsx';
import { api } from '../lib/api.js';

const CLAVE_MIN = 8;

function Marco({ titulo, sub, children }) {
  return (
    <div className="wrap">
      <div className="login">
        <h1>Centro de control del CD</h1>
        <h2>{titulo}</h2>
        {sub && <p className="muted">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

function Campo({ label, ...props }) {
  return <label className="field"><span>{label}</span><input {...props} /></label>;
}

export function Login() {
  const { cargarCuenta } = useApp();
  const [config, setConfig] = useState(null);
  const [f, setF] = useState({ usuario: '', nombre: '', clave: '', clave2: '' });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { api.get('/auth/estado').then(e => setConfig(e.configurado)).catch(e => setError(`No hay conexión con el servidor (${e.message}).`)); }, []);
  const set = k => e => setF({ ...f, [k]: e.target.value });

  const enviar = async e => {
    e.preventDefault(); setError(null);
    if (config === false) {
      if (f.clave.length < CLAVE_MIN) return setError(`La contraseña debe tener al menos ${CLAVE_MIN} caracteres.`);
      if (f.clave !== f.clave2) return setError('Las contraseñas no coinciden.');
    }
    setEnviando(true);
    try {
      await api.post(config ? '/auth/login' : '/auth/primer-admin', config ? { usuario: f.usuario, clave: f.clave } : { usuario: f.usuario, nombre: f.nombre, clave: f.clave });
      await cargarCuenta();
    } catch (err) { setError(err.message); setF(x => ({ ...x, clave: '', clave2: '' })); }
    setEnviando(false);
  };

  if (config === null) return <Marco titulo="Iniciar sesión">{error ? <p className="msg err" role="alert">{error}</p> : <p className="msg">Cargando…</p>}</Marco>;
  return (
    <Marco titulo={config ? 'Iniciar sesión' : 'Crear el administrador'}
      sub={config ? null : 'Aún no hay cuentas. Crea la del administrador: después podrás crear los usuarios y definir qué ve cada rol en Administración.'}>
      <form onSubmit={enviar} className="login-form">
        <Campo label="Usuario" autoComplete="username" autoFocus value={f.usuario} onChange={set('usuario')} required />
        {!config && <Campo label="Nombre y apellido" value={f.nombre} onChange={set('nombre')} required />}
        <Campo label="Contraseña" type="password" autoComplete={config ? 'current-password' : 'new-password'} value={f.clave} onChange={set('clave')} required />
        {!config && <Campo label="Repite la contraseña" type="password" autoComplete="new-password" value={f.clave2} onChange={set('clave2')} required />}
        {error && <p className="msg err" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={enviando}>{enviando ? 'Entrando…' : config ? 'Entrar' : 'Crear y entrar'}</button>
      </form>
    </Marco>
  );
}

// forzado: contraseña temporal entregada por el administrador (no se puede usar la aplicación sin cambiarla)
export function CambiarClave({ forzado = false, onListo }) {
  const { cargarCuenta, salir, avisar } = useApp();
  const [f, setF] = useState({ actual: '', nueva: '', nueva2: '' });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const enviar = async e => {
    e.preventDefault(); setError(null);
    if (f.nueva.length < CLAVE_MIN) return setError(`La nueva contraseña debe tener al menos ${CLAVE_MIN} caracteres.`);
    if (f.nueva !== f.nueva2) return setError('Las contraseñas nuevas no coinciden.');
    setEnviando(true);
    try { await api.post('/auth/clave', { actual: f.actual, nueva: f.nueva }); avisar('Contraseña actualizada.'); await cargarCuenta(); onListo?.(); }
    catch (err) { setError(err.message); }
    setEnviando(false);
  };
  const form = (
    <form onSubmit={enviar} className="login-form">
      <Campo label={forzado ? 'Contraseña temporal' : 'Contraseña actual'} type="password" autoComplete="current-password" autoFocus value={f.actual} onChange={set('actual')} required />
      <Campo label="Nueva contraseña" type="password" autoComplete="new-password" value={f.nueva} onChange={set('nueva')} required />
      <Campo label="Repite la nueva contraseña" type="password" autoComplete="new-password" value={f.nueva2} onChange={set('nueva2')} required />
      {error && <p className="msg err" role="alert">{error}</p>}
      <div className="row">
        <button type="submit" className="btn" disabled={enviando}>{enviando ? 'Guardando…' : 'Cambiar contraseña'}</button>
        <button type="button" className="ghost" onClick={forzado ? salir : onListo}>{forzado ? 'Salir' : 'Cancelar'}</button>
      </div>
    </form>
  );
  return forzado
    ? <Marco titulo="Cambia tu contraseña" sub={`Entraste con una contraseña temporal. Elige una nueva de al menos ${CLAVE_MIN} caracteres para continuar.`}>{form}</Marco>
    : <div className="login" style={{ margin: '24px 0' }}><h2>Cambiar contraseña</h2>{form}</div>;
}
