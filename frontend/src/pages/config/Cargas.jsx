// Carga de todos los archivos del sistema, agrupados por módulo: extracciones del WMS (Operación), archivos de Gestión diaria
// (stock, avance del turno, historia de ventas, ubicaciones reservadas, Pro_Evt, picking por CD, listado slow moving) y el
// calendario de inventario (Continuidad). Cada carga tiene su modelo descargable con las columnas que lee el sistema.
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api, API_URL } from '../../lib/api.js';
import { Card, Cargando, PageHead, SubirArchivo } from '../../components/ui.jsx';
import { N, fechaHora, ymd, dmy } from '../../lib/fmt.js';

const modelo = (tipo) => `${API_URL}/cargas/modelo/${tipo}`;
const LinkModelo = ({ tipo, texto = 'Descargar modelo' }) => <a href={modelo(tipo)}>{texto}</a>;

const TIPOS = [
  ['pedidos', 'Flujo de pedidos', 'La misma extracción que hoy alimenta la tabla dinámica (Flujo de pedido.xlsx). Se detecta sola la fila de encabezados. Cada carga se compara con la anterior para calcular las unidades que salieron de cada etapa: cuanto más seguido se cargue, más preciso es el control por hora.'],
  ['recepcion', 'Recepción', 'Citas del día con sus horas de llegada, descarga y unidades. Volver a cargar el mismo día actualiza las citas.'],
  ['almacenamiento', 'Almacenamiento', 'Ocupación por zona, LPN por ubicar y reposiciones. Cada hoja es opcional.'],
  ['olas', 'Simulador de olas', 'El reporte del simulador de olas (ESTADO, OD, SKU, QTY, FECHA_SALIDA, TIPO_PICKING…). Cada carga reemplaza a la anterior y se analiza en Operación, Simulador de olas.']
];

const detalle = c => c.tipo === 'pedidos'
  ? `${N(c.resumen.unidades)} un. en flujo${c.resumen.primera ? ', primera carga (sin comparación)' : `, ${N(c.resumen.unidadesMovidas)} un. avanzaron de etapa`}`
  : c.tipo === 'recepcion' ? `${c.resumen.citas} citas` : c.tipo === 'olas' ? `${N(c.resumen.unidades)} un., ${N(c.resumen.ods)} OD` : `${c.resumen.zonas || 0} zonas, ${c.resumen.lpns || 0} LPN, ${c.resumen.reposiciones || 0} reposiciones`;

// Archivos de Gestión diaria y Continuidad: [id, título, ayuda, URL de carga, permisos, modelo, vista del módulo, resultado]
const ARCHIVOS = {
  gestion: [
    ['avances', 'Avance del turno (Conciliación)', 'El archivo del turno que se descarga en Tareas o Mi turno, con ESTADO, Unid. reales y Observación completados. Actualiza las tareas sin digitar.',
      '/gestion/avances/importar', ['gd.conciliacion'], 'avances', ['/gestion/conciliacion', 'Conciliación'],
      r => `${N(r.actualizadas)} tareas actualizadas${r.errores?.length ? ` · ${r.errores.length} con error: ${r.errores.slice(0, 3).join('; ')}` : ''}.`],
    ['historia', 'Historia de ventas (ABC / XYZ)', 'Venta mensual por SKU (y CD, opcional) para la clasificación XYZ por historia. Un mes ya cargado para el mismo CD y SKU se reemplaza.',
      '/gestion/abcxyz/historia', ['gd.abc'], 'historia', ['/gestion/abc', 'ABC / XYZ'],
      r => `${N(r.filas)} filas, ${N(r.skus)} SKU, ${r.meses.length} meses (${r.meses[0]} a ${r.meses[r.meses.length - 1]}), formato ${r.formato}.`],
    ['reservadas', 'Ubicaciones reservadas (Blq_Stk_unit)', 'Ubicaciones reservadas para stock unitario: columna A la ubicación, B el grupo y C el máximo. Cada carga reemplaza la lista anterior.',
      '/gestion/config/reservadas', ['gd.config'], 'reservadas', ['/gestion/config', 'Configuración'],
      r => `${N(r.cargadas)} ubicaciones reservadas.`],
    ['proevt', 'Proyección del evento (Pro_Evt)', 'Departamento, Desc Dpto y Unidades proyectadas (opcional % OSR por depto). Es la base del reabasto OSR del evento.',
      '/gestion/optimizacion/abastecimiento/proyeccion', ['gd.osr'], 'proevt', ['/gestion/osr', 'Abastecimiento OSR'],
      r => `${r.evento}: ${N(r.deptos)} deptos, ${N(r.unidades)} unidades proyectadas.`, 'evento'],
    ['venta', 'Picking por CD (Participación por CD)', 'Archivo de picking con SKU, QTY_PICKING, CD_PICKING, TIPO_PICKING, FECHA_SALIDA y SOLICITUD (en una hoja o como origen de una tabla dinámica). Las unidades son solo QTY_PICKING. Se reemplazan los días que trae.',
      '/gestion/participacion/venta', ['gd.participacion'], 'venta', ['/gestion/participacion', 'Participación por CD'],
      r => `${N(r.filas)} líneas · ${r.dias} días${r.desde ? ` (${dmy(r.desde)} al ${dmy(r.hasta)})` : ''} · ${N(r.pedidos)} pedidos, ${N(r.pedidosMixtos)} mixtos · ${N(r.anuladas)} líneas CANCELLED excluidas.`],
    ['slow', 'Listado a validar (Slow moving)', 'Listado de SKU y QTY para cruzar con la Base vigente: stock y ubicaciones por CD y diferencia contra el listado. Cada carga reemplaza el listado anterior.',
      '/gestion/slow/validar', ['gd.slow'], 'slow', ['/gestion/slow', 'Slow moving'],
      r => `${N(r.skus)} SKU, ${N(r.unidades)} unidades.`],
  ],
  continuidad: [
    ['inventario', 'Calendario de inventario', 'Asignaciones del inventario cíclico por CD, nivel, zona y pasillo, con fechas de asignación y ejecución.',
      '/continuidad/inventario/importar', ['co.inventario'], 'inventario', ['/continuidad/inventario', 'Inventario CD'],
      r => `${N(r.importadas)} asignaciones importadas.`],
  ],
};

/** Tarjeta de carga de un archivo con su modelo, el resultado de la última carga y el acceso a la vista que lo usa. */
function CargaArchivo({ id, titulo, ayuda, url, modeloTipo, ir, mensaje, campo }) {
  const [subiendo, setSubiendo] = useState(false);
  const [res, setRes] = useState(null);
  const [valor, setValor] = useState('');
  const subir = async f => {
    setSubiendo(true); setRes(null);
    const fd = new FormData(); fd.append('archivo', f);
    if (campo && valor) fd.append(campo, valor);
    try { const r = await api.post(url, fd); setRes({ ok: true, t: `${f.name}: ${mensaje(r)}` }); } catch (e) { setRes({ ok: false, t: e.message }); }
    setSubiendo(false);
  };
  return (
    <section id={`carga-${id}`} className="card s6">
      <h3>{titulo}</h3><p className="hint">{ayuda}</p>
      {campo === 'evento' && <label className="field" style={{ width: 'auto', marginBottom: 8 }}><span>Nombre del evento (opcional)</span>
        <input type="text" value={valor} placeholder="Se toma del nombre del archivo" onChange={e => setValor(e.target.value)} /></label>}
      <SubirArchivo onFile={subir} disabled={subiendo} texto={subiendo ? 'Procesando…' : 'Elegir archivo'} />
      <p className="hint" style={{ marginTop: 8 }}><LinkModelo tipo={modeloTipo} /> · <Link to={ir[0]}>Ir a {ir[1]}</Link></p>
      {res && <p className={`msg ${res.ok ? '' : 'err'}`} role="status">{res.t}</p>}
    </section>
  );
}

// Archivos de stock de Gestión Diaria: Base del inicio de la jornada o foto al cierre de un turno (concilia las tareas)
function StockGestion({ onCargado }) {
  const { puede: p } = useApp();
  const [sp] = useSearchParams();
  const [fecha, setFecha] = useState(() => /^\d{4}-\d{2}-\d{2}$/.test(sp.get('fecha') || '') ? sp.get('fecha') : ymd(new Date()));
  const [tipo, setTipo] = useState('inicio');
  const [subiendo, setSubiendo] = useState(false);
  const [res, setRes] = useState(null);
  const puedeInicio = p('da.cargas', 'gd.asignacion'), puedeCierre = p('da.cargas', 'gd.conciliacion');
  const tipoOk = tipo === 'inicio' ? puedeInicio : puedeCierre;
  const subir = async f => {
    setSubiendo(true); setRes(null);
    const fd = new FormData(); fd.append('archivo', f);
    try {
      if (tipo === 'inicio') {
        const r = await api.post(`/gestion/cargas/inicio?fecha=${fecha}`, fd);
        setRes({ ok: true, t: `${f.name}: ${N(r.carga.filas)} filas para la jornada del ${dmy(fecha)}.${r.cdsNuevos.length ? ` CD nuevos: ${r.cdsNuevos.join(', ')} (revisa su configuración).` : ''}${r.avisos.length ? ' ' + r.avisos.join(' ') : ''} Ahora genera la asignación.` });
      } else {
        fd.append('turno', tipo);
        const r = await api.post(`/gestion/cargas/cierre?fecha=${fecha}`, fd);
        setRes({ ok: true, t: `${f.name}: cierre T${tipo} del ${dmy(fecha)}. ${N(r.revisadas)} tareas revisadas: ${N(r.ejecutadas)} ejecutadas, ${N(r.parciales)} parciales, ${N(r.sinCambio)} sin cambio.` });
      }
      onCargado();
    } catch (e) { setRes({ ok: false, t: e.message }); }
    setSubiendo(false);
  };
  if (!puedeInicio && !puedeCierre) return null;
  return (
    <section id="carga-stock" className="card s12">
      <h3>Base de stock</h3>
      <p className="hint">El mismo archivo de stock que hoy se pega en la hoja Base del libro de consolidación (.xlsx, .xlsm o .csv). La Base del inicio genera el plan y las tareas del día; la foto al cierre de cada turno mide el avance sin digitar nada. La Base vigente también la usan Slow moving, ABC / XYZ, Optimización y Abastecimiento OSR.</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <label className="field" style={{ width: 'auto' }}><span>Jornada</span><input type="date" value={fecha} onChange={e => setFecha(e.target.value || ymd(new Date()))} /></label>
        <label className="field" style={{ width: 'auto' }}><span>Archivo</span>
          <select value={tipo} onChange={e => setTipo(e.target.value)}>
            {puedeInicio && <option value="inicio">Base del inicio de la jornada</option>}
            {puedeCierre && [1, 2, 3].map(t => <option key={t} value={t}>Stock al cierre del turno T{t}</option>)}
          </select></label>
      </div>
      <SubirArchivo accept=".xlsx,.xlsm,.xls,.csv" onFile={subir} disabled={subiendo || !tipoOk} texto={subiendo ? 'Procesando…' : 'Elegir archivo'} />
      {res && <p className={`msg ${res.ok ? '' : 'err'}`} role="status">{res.t}</p>}
      <p className="hint" style={{ marginTop: 8 }}>
        <LinkModelo tipo="stock" texto="Descargar modelo de la Base" /> · <Link to={`/gestion?fecha=${fecha}`}>Ir a la asignación del día</Link>
      </p>
    </section>
  );
}

function HistorialStock({ h }) {
  return (
    <Card title="Archivos de stock de Gestión diaria">
      {!h.data ? <Cargando error={h.error} /> : h.data.length ? <div className="tscroll"><table>
        <thead><tr><th>Cargado</th><th>Jornada</th><th>Tipo</th><th>Archivo</th><th className="num">Filas</th></tr></thead>
        <tbody>{h.data.map(c => <tr key={c.id}><td>{fechaHora(new Date(c.creado_en).getTime())}</td><td>{dmy(c.fecha)}</td>
          <td>{c.tipo === 'INICIO' ? 'Base del inicio' : `Cierre T${c.turno}`}</td><td>{c.archivo}</td><td className="num">{N(c.filas)}</td></tr>)}</tbody>
      </table></div> : <p className="empty">Aún no hay archivos de stock.</p>}
    </Card>
  );
}

const Grupo = ({ titulo }) => <h2 style={{ margin: '22px 0 0', fontSize: 18 }}>{titulo}</h2>;

export default function Cargas() {
  const { avisar, refrescar, puede } = useApp();
  const ops = puede('da.cargas');
  // desde un módulo se llega con #carga-<archivo>: se baja a esa tarjeta y se resalta un momento
  const { hash } = useLocation();
  useEffect(() => {
    const el = hash && document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('resaltar');
    const t = setTimeout(() => el.classList.remove('resaltar'), 2200);
    return () => clearTimeout(t);
  }, [hash]);
  const d = useCarga(() => api.get('/cargas'), []);
  const hs = useCarga(() => api.get('/gestion/cargas'), []);
  const [subiendo, setSubiendo] = useState(null);
  const [res, setRes] = useState({});
  const subir = async (tipo, f) => {
    setSubiendo(tipo); setRes({ ...res, [tipo]: null });
    const fd = new FormData(); fd.append('archivo', f);
    try { const c = await api.post(`/cargas/${tipo}`, fd); setRes({ ...res, [tipo]: { ok: true, t: `${f.name}: ${c.filas} filas, corte ${fechaHora(new Date(c.corte).getTime())}. ${detalle(c)}.` } }); d.recargar(); refrescar(); }
    catch (e) { setRes({ ...res, [tipo]: { ok: false, t: e.message } }); }
    setSubiendo(null);
  };
  const borrar = async c => {
    if (!window.confirm(`¿Eliminar la carga "${c.archivo}"?`)) return;
    try { await api.del(`/cargas/${c.id}`); avisar('Carga eliminada.'); d.recargar(); refrescar(); } catch (e) { avisar(e.message, 'err'); }
  };
  const tarjetas = (lista) => lista.filter(([, , , , permisos]) => puede(...permisos)).map(([id, titulo, ayuda, url, , modeloTipo, ir, mensaje, campo]) => (
    <CargaArchivo key={id} id={id} titulo={titulo} ayuda={ayuda} url={url} modeloTipo={modeloTipo} ir={ir} mensaje={mensaje} campo={campo} />));
  const gestion = tarjetas(ARCHIVOS.gestion), continuidad = tarjetas(ARCHIVOS.continuidad);
  return (
    <>
      <PageHead title="Cargas de archivos" sub="Todos los archivos del sistema se cargan aquí. Cada carga tiene su modelo descargable con las columnas que se leen. Todos los usuarios ven la información apenas se carga." />
      {ops && <>
        <Grupo titulo="Operación (extracciones del WMS)" />
        <div className="grid">
          {TIPOS.map(([tipo, titulo, ayuda]) => (
            <section key={tipo} id={`carga-${tipo}`} className="card s6">
              <h3>{titulo}</h3><p className="hint">{ayuda}</p>
              <SubirArchivo onFile={f => subir(tipo, f)} disabled={!!subiendo} texto={subiendo === tipo ? 'Procesando…' : 'Elegir archivo'} />
              <p className="hint" style={{ marginTop: 8 }}><LinkModelo tipo={tipo} /></p>
              {res[tipo] && <p className={`msg ${res[tipo].ok ? '' : 'err'}`} role="status">{res[tipo].t}</p>}
            </section>))}
        </div>
      </>}
      <Grupo titulo="Gestión diaria" />
      <div className="grid">
        <StockGestion onCargado={hs.recargar} />
        {gestion}
      </div>
      {continuidad.length > 0 && <>
        <Grupo titulo="Continuidad" />
        <div className="grid">{continuidad}</div>
      </>}
      {ops && <Card title="Historial de extracciones" hint="Una extracción de pedidos solo se puede eliminar si es la última, porque las siguientes se calcularon comparando contra ella.">
        {!d.data ? <Cargando error={d.error} /> : d.data.length ? <div className="tscroll"><table>
          <thead><tr><th>Cargada</th><th>Tipo</th><th>Archivo</th><th>Corte</th><th className="num">Filas</th><th>Resultado</th><th>Por</th><th /></tr></thead>
          <tbody>{d.data.map(c => <tr key={c.id}><td>{fechaHora(new Date(c.cargado_en).getTime())}</td><td>{TIPOS.find(t => t[0] === c.tipo)?.[1]}</td><td>{c.archivo}</td>
            <td>{fechaHora(new Date(c.corte).getTime())}</td><td className="num">{N(c.filas)}</td><td>{detalle(c)}</td><td>{c.cargado_por || '—'}</td>
            <td><button type="button" className="link danger" onClick={() => borrar(c)}>Eliminar</button></td></tr>)}</tbody>
        </table></div> : <p className="empty">Aún no hay cargas.</p>}
      </Card>}
      <HistorialStock h={hs} />
    </>
  );
}
