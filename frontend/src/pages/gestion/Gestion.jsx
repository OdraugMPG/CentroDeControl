// Módulo Gestión Diaria (proyecto GestionOperaciones): plan diario, asignación, tareas, conciliación,
// cierre por tareas, slow moving, ABC/XYZ y optimización. Las vistas se muestran según el rol del usuario.
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../lib/contexto.jsx';
import { esOps } from '../../components/Layout.jsx';
import { hoyIso } from './api.js';
import { conectarAvisos } from './ui.jsx';
import Hoy from './Hoy.jsx';
import Tareas from './Tareas.jsx';
import Conciliacion from './Conciliacion.jsx';
import MiTurno from './MiTurno.jsx';
import Cierre from './Cierre.jsx';
import Slow from './Slow.jsx';
import AbcXyz from './AbcXyz.jsx';
import Optimizacion from './Optimizacion.jsx';
import Config from './Config.jsx';
import './gestion.css';

// [ruta, título, componente, quién la ve]: plan = Jefe de Operaciones, sup = supervisores y jefes de turno, ger = el resto
export const VISTAS_GD = [
  ['', 'Asignación del día', Hoy, 'plan'],
  ['tareas', 'Tareas', Tareas, 'plan'],
  ['conciliacion', 'Conciliación', Conciliacion, 'plan'],
  ['turno', 'Mi turno', MiTurno, 'sup'],
  ['cierre', 'Cierre por tareas', Cierre, 'todos'],
  ['slow', 'Slow moving', Slow, 'ger'],
  ['abc', 'ABC / XYZ', AbcXyz, 'ger'],
  ['optimizacion', 'Optimización ABC', Optimizacion, 'ger'],
  ['config', 'Configuración', Config, 'plan']
];
// Nombres de las vistas en el proyecto original (para irA)
const ALIAS = { hoy: '', opt: 'optimizacion' };

const rolGd = u => esOps(u) ? 'plan' : ['Supervisor', 'Jefe de Turno'].includes(u?.rol) ? 'sup' : 'ger';
export const vistasDe = u => { const r = rolGd(u); return VISTAS_GD.filter(v => r === 'plan' || v[3] === 'todos' || v[3] === r); };

export default function Gestion() {
  const { usuario, avisar } = useApp();
  const { vista = '' } = useParams();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [fecha, setFecha] = useState(() => /^\d{4}-\d{2}-\d{2}$/.test(sp.get('fecha') || '') ? sp.get('fecha') : hoyIso());
  useEffect(() => { conectarAvisos((m, err) => avisar(m, err ? 'err' : 'ok')); }, [avisar]);

  const mias = vistasDe(usuario);
  const v = mias.find(x => x[0] === vista);
  if (!v) return <Navigate to={`/gestion/${mias[0][0]}`} replace />;
  const [, , Vista] = v;
  const irA = k => navigate(`/gestion/${ALIAS[k] ?? k}`);

  const rol = rolGd(usuario);
  return (
    <div className="gd">
      {rol !== 'plan' && <div className="alert info">Entraste como {usuario?.rol || 'visualización'}: ves {mias.map(x => x[1]).join(', ')}. Cargar la Base de stock, generar la asignación y configurar los CD es del Jefe de Operaciones (usa «Cambiar» arriba a la derecha).</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
        <label className="lbl" htmlFor="gd-fecha" style={{ margin: 0 }}>Jornada</label>
        <input id="gd-fecha" type="date" value={fecha} style={{ width: 'auto' }} onChange={e => setFecha(e.target.value || hoyIso())} />
      </div>
      <Vista fecha={fecha} rol={rol} irA={irA} />
    </div>
  );
}
