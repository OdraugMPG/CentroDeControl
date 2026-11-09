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
  ['almacenado', 'Almacenados', 'La extracción de almacenados del WMS (ALM_USER): una fila por LPN ubicado con QUANTITY, F_MOD, TURNO, ITEM_ID, TARGET_LOCATION_ID, USUARIO, CD, OPERACION… Se reemplazan los días que trae el archivo y se analiza en Operación, Almacenado.', true],
  ['recepcion', 'Recepción: citas', 'Citas del día con sus horas de llegada, descarga y unidades. Volver a cargar el mismo día actualiza las citas.'],
  ['almacenamiento', 'Por almacenar y almacenados', 'Se reconoce solo cuál archivo es. Pendiente por almacenar: la foto del WMS con una fila por iLPN (ILPN_ID, QTY, ZONA, ORIGEN, FECHA_CREAC, CD…); cada carga reemplaza la anterior. Almacenados (ALM_USER): una fila por LPN ubicado (QUANTITY, F_MOD, TURNO, USUARIO, CD, OPERACION…); se reemplazan los días que trae. Lo pendiente se analiza en Operación, Por almacenar y los almacenados en Operación, Almacenado.'],
  ['pendiente', 'Pendiente por almacenar', '', true],
  ['olas', 'Simulador de olas', 'El reporte del simulador de olas (ESTADO, OD, SKU, QTY, FECHA_SALIDA, TIPO_PICKING…). Cada carga reemplaza a la anterior y se analiza en Operación, Simulador de olas.']
];

const detalle = c => c.tipo === 'pedidos'
  ? `${N(c.resumen.unidades)} un. en flujo${c.resumen.primera ? ', primera carga (sin comparación)' : `, ${N(c.resumen.unidadesMovidas)} un. avanzaron de etapa`}`
  : c.tipo === 'pendiente' ? `${N(c.resumen.unidades)} un. pendientes en ${N(c.resumen.ilpns)} iLPN, ${N(c.resumen.skus)} SKU`
  : c.tipo === 'almacenado' ? `${N(c.resumen.unidades)} un. en ${N(c.resumen.lpns)} LPN, ${c.resumen.dias} días (${dmy(c.resumen.desde)} al ${dmy(c.resumen.hasta)})`
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
      r => r.anterior ? `${r.evento}: ${N(r.deptos)} deptos, ${N(r.unidades)} unidades (hoja ${r.hoja}), guardada como versión anterior. La proyección activa sigue siendo ${r.activa}: compáralas al final de Reabasto por proyección.` : `${r.evento}: ${N(r.deptos)} deptos, ${N(r.unidades)} unidades proyectadas (hoja ${r.hoja}).${r.hojas?.length > 1 ? ` El libro trae ${r.hojas.length} hojas de proyección: queda activa la de fecha más reciente y todas quedan como versiones para comparar en Abastecimiento OSR.` : ''}`, 'evento'],
    ['osrcap', 'Capacidad del OSR (rack lines)', 'Una fila por rack line con Rack line, Positions, Locked, Occupied, Load unit stacked y Free/available. La rack line 6 (seguridad de la máquina) no cuenta en la capacidad. Cada carga reemplaza la anterior.',
      '/gestion/optimizacion/osr/capacidad/cargar', ['gd.osr'], 'osrcap', ['/gestion/osr', 'Abastecimiento OSR'],
      r => `${N(r.lineas)} rack lines (${N(r.cuentan)} cuentan en la capacidad): ${N(r.positions)} posiciones, ${N(r.occupied)} ocupadas (${N(r.positions ? Math.round(r.occupied / r.positions * 100) : 0)}%).`],
    ['osrtotes', 'Distribución de totes OSR', 'Una fila por SKU con Article number, Article name, Stock, Stock locations y los compartimentos que ocupa en FULL, HALF y QUARTER. Cada carga reemplaza la anterior.',
      '/gestion/optimizacion/osr/totes/distribucion', ['gd.osr'], 'osrtotes', ['/gestion/osr', 'Abastecimiento OSR'],
      r => `${N(r.skus)} SKU, ${N(r.stock)} u., ${N(r.ubicaciones)} compartimentos (${N(r.full)} full, ${N(r.half)} half, ${N(r.quarter)} quarter) = ${N(Math.ceil(r.totes))} totes${r.noCuadra ? ` · ${N(r.noCuadra)} SKU con Stock locations distinto de FULL + HALF + QUARTER` : ''}.`],
    ['venta', 'Picking por CD (Participación por CD)', 'Archivo de picking con SKU, QTY_PICKING, CD_PICKING, TIPO_PICKING, FECHA_SALIDA y SOLICITUD (en una hoja o como origen de una tabla dinámica). Las unidades son solo QTY_PICKING. Se reemplazan los días que trae.',
      '/gestion/participacion/venta', ['gd.participacion'], 'venta', ['/gestion/participacion', 'Participación por CD'],
      r => `${N(r.filas)} líneas · ${r.dias} días${r.desde ? ` (${dmy(r.desde)} al ${dmy(r.hasta)})` : ''} · ${N(r.pedidos)} pedidos, ${N(r.pedidosMixtos)} mixtos · ${N(r.anuladas)} líneas CANCELLED excluidas.`],
    ['slow', 'Listado a validar (Slow moving)', 'Listado de SKU y QTY para cruzar con la Base vigente: stock y ubicaciones por CD y diferencia contra el listado. Cada carga reemplaza el listado anterior.',
      '/gestion/slow/validar', ['gd.slow'], 'slow', ['/gestion/slow', 'Slow moving'],
      r => `${N(r.skus)} SKU, ${N(r.unidades)} unidades.`],
  ],
  continuidad: [
    ['inventario', 'Inventario: programación de CE y resultado de la toma', 'Se reconoce solo cuál archivo es. Programación de Control de Existencia (Loc, Ubicación, Zona, Pasillo, Fecha programada, Re-Programación…): se reemplaza todo el rango de fechas programadas que cubre el archivo (del primer al último día), sin perder las asignaciones. Una Re-Programación más de un mes antes de la fecha programada es la toma anterior y no cambia la fecha. Resultado de la toma (UBICACION, CD, SKU, CONTADO, SISTEMA, FECHA…): se reemplazan los días que trae.',
      '/continuidad/inventario/importar', ['co.inventario.cargar'], [['inventario', 'Modelo programación CE'], ['inventario_resultado', 'Modelo resultado de la toma']], ['/inventario', 'Inventario CD'],
      r => (r.tipo === 'programa'
        ? `Programación: ${N(r.filas)} ubicaciones, fechas CE del ${dmy(r.desde)} al ${dmy(r.hasta)} (operación del ${dmy(r.opDesde)} al ${dmy(r.opHasta)})${r.reprogramadas ? `, ${N(r.reprogramadas)} re-programadas` : ''}${r.reprogAntigua ? `. ${N(r.reprogAntigua)} con Re-Programación de un ciclo anterior quedaron en su fecha programada` : ''}${r.reemplazadas ? `. Se reemplazaron ${N(r.reemplazadas)} ubicaciones que había${r.todo ? ' (toda la programación anterior)' : ' en ese rango'}` : ''}${r.sinFecha ? `. ${N(r.sinFecha)} filas sin fecha programada se omitieron` : ''}.`
        : `Resultado de la toma: ${N(r.filas)} líneas en ${N(r.ubicaciones)} ubicaciones, del ${dmy(r.desde)} al ${dmy(r.hasta)}.`)],
  ],
};

/** Tarjeta de carga de un archivo con su modelo, el resultado de la última carga y el acceso a la vista que lo usa. */
function CargaArchivo({ id, titulo, ayuda, url, modeloTipo, ir, mensaje, campo }) {
  const [subiendo, setSubiendo] = useState(false);
  const [res, setRes] = useState(null);
  const [valor, setValor] = useState('');
  const [anterior, setAnterior] = useState(false);
  const subir = async f => {
    setSubiendo(true); setRes(null);
    const fd = new FormData(); fd.append('archivo', f);
    if (campo && valor) fd.append(campo, valor);
    if (campo === 'evento' && anterior) fd.append('anterior', '1');
    if (id === 'inventario' && anterior) fd.append('reemplazar', 'todo');
    try { const r = await api.post(url, fd); setRes({ ok: true, t: `${f.name}: ${mensaje(r)}` }); } catch (e) { setRes({ ok: false, t: e.message }); }
    setSubiendo(false);
  };
  return (
    <section id={`carga-${id}`} className="card s6">
      <h3>{titulo}</h3><p className="hint">{ayuda}</p>
      {campo === 'evento' && <label className="field" style={{ width: 'auto', marginBottom: 8 }}><span>Nombre del evento (opcional)</span>
        <input type="text" value={valor} placeholder="Se toma del nombre del archivo" onChange={e => setValor(e.target.value)} /></label>}
      {campo === 'evento' && <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <input type="checkbox" checked={anterior} onChange={e => setAnterior(e.target.checked)} />
        Es una versión anterior: solo se guarda para comparar y no reemplaza la proyección activa</label>}
      {id === 'inventario' && <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <input type="checkbox" checked={anterior} onChange={e => setAnterior(e.target.checked)} />
        Programación definitiva: reemplaza toda la programación de CE cargada, no solo las fechas del archivo (las asignaciones y los resultados se conservan)</label>}
      <SubirArchivo onFile={subir} disabled={subiendo} texto={subiendo ? 'Procesando…' : 'Elegir archivo'} />
      <p className="hint" style={{ marginTop: 8 }}>{Array.isArray(modeloTipo) ? modeloTipo.map(([t, l]) => <span key={t}><LinkModelo tipo={t} texto={l} /> · </span>) : <><LinkModelo tipo={modeloTipo} /> · </>}<Link to={ir[0]}>Ir a {ir[1]}</Link></p>
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
  const puedeInicio = p('da.cargas', 'gd.asignacion.base'), puedeCierre = p('da.cargas', 'gd.conciliacion');
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
          {TIPOS.filter(([, , , oculto]) => !oculto).map(([tipo, titulo, ayuda]) => (
            <section key={tipo} id={`carga-${tipo}`} className="card s6">
              <h3>{titulo}</h3><p className="hint">{ayuda}</p>
              <SubirArchivo onFile={f => subir(tipo, f)} disabled={!!subiendo} texto={subiendo === tipo ? 'Procesando…' : 'Elegir archivo'} />
              <p className="hint" style={{ marginTop: 8 }}>{tipo === 'almacenamiento' ? <><LinkModelo tipo="pendiente" texto="Modelo pendiente por almacenar" /> · <LinkModelo tipo="almacenado" texto="Modelo almacenados" /></> : <LinkModelo tipo={tipo} />}</p>
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
