// Estado compartido: sesión y permisos, catálogos (meta), foto en vivo (snapshot cada 5 min) y avisos.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { puede as puedeU } from './permisos.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);
const REFRESCO_MS = 5 * 60 * 1000;

export function AppProvider({ children }) {
  const [meta, setMeta] = useState(null);
  const [snap, setSnap] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [proxima, setProxima] = useState(Date.now() + REFRESCO_MS);
  // undefined = comprobando la sesión; null = sin sesión; objeto = usuario conectado
  const [cuenta, setCuenta] = useState(undefined);
  const [toast, setToast] = useState(null);
  const [version, setVersion] = useState(0);    // sube cuando hay que recargar vistas
  const [filtros, setFiltros] = useState({});   // segmentadores de pedidos, se mantienen entre vistas
  const timer = useRef(null);

  const avisar = useCallback((texto, tipo = 'ok') => {
    setToast({ texto, tipo }); clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), tipo === 'err' ? 5000 : 2600);
  }, []);

  // Usuario de la sesión. id, rol y turno son los de su persona del Equipo (Continuidad los usa); el rol de acceso va en rolAcceso.
  const cargarCuenta = useCallback(async () => {
    try {
      const y = await api.get('/auth/yo');
      setCuenta({ ...y, cuentaId: y.id, rolAcceso: y.rol, id: y.persona?.id ?? null, rol: y.persona?.rol ?? null, turno: y.persona?.turno_id ?? null });
    } catch (e) { setCuenta(e.status === 403 && e.data?.cambiarClave ? { cambiarClave: true, permisos: [] } : null); }
  }, []);
  useEffect(() => { cargarCuenta(); }, [cargarCuenta]);
  useEffect(() => {
    const fuera = () => { setCuenta(null); setMeta(null); setSnap(null); };
    window.addEventListener('cc:sin-sesion', fuera);
    return () => window.removeEventListener('cc:sin-sesion', fuera);
  }, []);
  const salir = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* la sesión ya no existe */ }
    setCuenta(null); setMeta(null); setSnap(null);
  }, []);
  const activa = !!cuenta && !cuenta.cambiarClave;

  const refrescar = useCallback(async () => {
    setCargando(true);
    try {
      const [m, s] = await Promise.all([api.get('/meta'), api.get('/ops/snapshot')]);
      setMeta(m); setSnap(s); setError(null); setVersion(v => v + 1);
    } catch (e) { setError(e.message); }
    setCargando(false);
    setProxima(Date.now() + REFRESCO_MS);
  }, []);

  useEffect(() => { if (activa) refrescar(); }, [activa, refrescar]);
  useEffect(() => {
    if (!activa) return;
    const id = setInterval(() => { if (Date.now() >= proxima && !document.hidden && !cargando) refrescar(); }, 1000);
    return () => clearInterval(id);
  }, [activa, proxima, cargando, refrescar]);

  const usuario = activa ? cuenta : null;
  const puede = useCallback((...p) => puedeU(usuario, ...p), [usuario]);

  return (
    <Ctx.Provider value={{ meta, snap, error, cargando, proxima, refrescar, cuenta, usuario, puede, cargarCuenta, salir, avisar, version, filtros, setFiltros }}>
      {children}
      {toast && <div className={`toast ${toast.tipo === 'err' ? 'err' : ''}`} role="status">{toast.texto}</div>}
    </Ctx.Provider>
  );
}

// Carga de datos con recarga cuando cambian las dependencias o se refresca la foto
export function useCarga(fn, deps = []) {
  const { version } = useApp();
  const [estado, setEstado] = useState({ data: null, error: null, cargando: true });
  const recargar = useCallback(async () => {
    setEstado(s => ({ ...s, cargando: true }));
    try { setEstado({ data: await fn(), error: null, cargando: false }); }
    catch (e) { setEstado(s => ({ ...s, error: e.message, cargando: false })); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { recargar(); }, [recargar, version]);
  return { ...estado, recargar, setData: d => setEstado(s => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

// Tema claro/oscuro, para que los gráficos se redibujen con los colores correctos
export function useTema() {
  const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const [oscuro, setOscuro] = useState(mq ? mq.matches : false);
  useEffect(() => {
    if (!mq) return;
    const f = e => setOscuro(e.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [mq]);
  return oscuro;
}
