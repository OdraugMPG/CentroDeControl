// Módulo Gestión Diaria (proyecto GestionOperaciones): plan diario, asignación, tareas, conciliación,
// cierre por tareas, slow moving, ABC/XYZ y optimización. Cada vista exige su permiso (lib/permisos.js).
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../lib/contexto.jsx';
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
import AbastecimientoOsr from './AbastecimientoOsr.jsx';
import ParticipacionCd from './ParticipacionCd.jsx';
import Config from './Config.jsx';
import './gestion.css';

// [ruta, componente, permiso]
const VISTAS_GD = [
  ['', Hoy, 'gd.asignacion'], ['tareas', Tareas, 'gd.tareas'], ['conciliacion', Conciliacion, 'gd.conciliacion'],
  ['turno', MiTurno, 'gd.turno'], ['cierre', Cierre, 'gd.cierre'], ['slow', Slow, 'gd.slow'], ['abc', AbcXyz, 'gd.abc'],
  ['optimizacion', Optimizacion, 'gd.optimizacion'], ['osr', AbastecimientoOsr, 'gd.osr'], ['participacion', ParticipacionCd, 'gd.participacion'], ['config', Config, 'gd.config']
];
// Nombres de las vistas en el proyecto original (para irA)
const ALIAS = { hoy: '', opt: 'optimizacion' };


export default function Gestion() {
  const { usuario, puede, avisar } = useApp();
  const { vista = '' } = useParams();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [fecha, setFecha] = useState(() => /^\d{4}-\d{2}-\d{2}$/.test(sp.get('fecha') || '') ? sp.get('fecha') : hoyIso());
  useEffect(() => { conectarAvisos((m, err) => avisar(m, err ? 'err' : 'ok')); }, [avisar]);

  const mias = VISTAS_GD.filter(v => puede(v[2]));
  const v = mias.find(x => x[0] === vista);
  if (!v) return <Navigate to={`/gestion/${mias[0][0]}`} replace />;
  const [, Vista] = v;
  const irA = k => navigate(`/gestion/${ALIAS[k] ?? k}`);

  return (
    <div className="gd">
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
        <label className="lbl" htmlFor="gd-fecha" style={{ margin: 0 }}>Jornada</label>
        <input id="gd-fecha" type="date" value={fecha} style={{ width: 'auto' }} onChange={e => setFecha(e.target.value || hoyIso())} />
      </div>
      <Vista fecha={fecha} rol={usuario.rolAcceso} irA={irA} />
    </div>
  );
}
