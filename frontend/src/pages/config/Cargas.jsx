// Carga de extracciones del WMS (pedidos, recepción, almacenamiento, olas), archivos de stock de Gestión Diaria e historial
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api, API_URL } from '../../lib/api.js';
import { Card, Cargando, PageHead, SubirArchivo } from '../../components/ui.jsx';
import { N, fechaHora, ymd, dmy } from '../../lib/fmt.js';

const TIPOS = [
  ['pedidos', 'Flujo de pedidos', 'La misma extracción que hoy alimenta la tabla dinámica (Flujo de pedido.xlsx). Se detecta sola la fila de encabezados. Cada carga se compara con la anterior para calcular las unidades que salieron de cada etapa: cuanto más seguido se cargue, más preciso es el control por hora.', null],
  ['recepcion', 'Recepción', 'Citas del día con sus horas de llegada, descarga y unidades. Volver a cargar el mismo día actualiza las citas.', 'recepcion'],
  ['almacenamiento', 'Almacenamiento', 'Ocupación por zona, LPN por ubicar y reposiciones. Cada hoja es opcional.', 'almacenamiento'],
  ['olas', 'Simulador de olas', 'El reporte del simulador de olas (ESTADO, OD, SKU, QTY, FECHA_SALIDA, TIPO_PICKING…). Cada carga reemplaza a la anterior y se analiza en Operación, Simulador de olas.', null]
];

const detalle = c => c.tipo === 'pedidos'
  ? `${N(c.resumen.unidades)} un. en flujo${c.resumen.primera ? ', primera carga (sin comparación)' : `, ${N(c.resumen.unidadesMovidas)} un. avanzaron de etapa`}`
  : c.tipo === 'recepcion' ? `${c.resumen.citas} citas` : c.tipo === 'olas' ? `${N(c.resumen.unidades)} un., ${N(c.resumen.ods)} OD` : `${c.resumen.zonas || 0} zonas, ${c.resumen.lpns || 0} LPN, ${c.resumen.reposiciones || 0} reposiciones`;

// Archivos de stock de Gestión Diaria: Base del inicio de la jornada o foto al cierre de un turno (concilia las tareas)
function StockGestion({ onCargado }) {
  const { puede: p } = useApp();
  const [fecha, setFecha] = useState(ymd(new Date()));
  const [tipo, setTipo] = useState('inicio');
  const [subiendo, setSubiendo] = useState(false);
  const [res, setRes] = useState(null);
  const puede = p('da.cargas');
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
  const ej = a => `${API_URL}/gestion/ejemplo/${a}`;
  return (
    <section className="card s12">
      <h3>Gestión diaria: stock</h3>
      <p className="hint">El mismo archivo de stock que hoy se pega en la hoja Base del libro de consolidación (.xlsx, .xlsm o .csv). La Base del inicio genera el plan y las tareas del día; la foto al cierre de cada turno mide el avance sin digitar nada.</p>
      {puede ? <>
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="field" style={{ width: 'auto' }}><span>Jornada</span><input type="date" value={fecha} onChange={e => setFecha(e.target.value || ymd(new Date()))} /></label>
          <label className="field" style={{ width: 'auto' }}><span>Archivo</span>
            <select value={tipo} onChange={e => setTipo(e.target.value)}>
              <option value="inicio">Base del inicio de la jornada</option>
              {[1, 2, 3].map(t => <option key={t} value={t}>Stock al cierre del turno T{t}</option>)}
            </select></label>
        </div>
        <SubirArchivo accept=".xlsx,.xlsm,.xls,.csv" onFile={subir} disabled={subiendo} texto={subiendo ? 'Procesando…' : 'Elegir archivo'} />
        {res && <p className={`msg ${res.ok ? '' : 'err'}`} role="status">{res.t}</p>}
      </> : null}
      <p className="hint" style={{ marginTop: 8 }}>
        <Link to={`/gestion?fecha=${fecha}`}>Ir a la asignación del día</Link> · Ejemplos para probar: <a href={ej('Base_inicio_ejemplo.xlsx')}>Base de stock</a>, <a href={ej('Blq_Stk_unit_ejemplo.xlsx')}>ubicaciones reservadas</a> (se cargan en Gestión diaria, Configuración)
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

export default function Cargas() {
  const { avisar, refrescar, puede } = useApp();
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
  return (
    <>
      <PageHead title="Cargas de extracciones" sub="Mientras no haya conexión directa al WMS, el panel se alimenta con estos archivos. Todos los usuarios ven la información apenas se carga." />
      <div className="grid">
        <StockGestion onCargado={hs.recargar} />
        {TIPOS.map(([tipo, titulo, ayuda, plantilla]) => (
          <section key={tipo} className="card s6">
            <h3>{titulo}</h3><p className="hint">{ayuda}</p>
            <SubirArchivo onFile={f => subir(tipo, f)} disabled={!!subiendo} texto={subiendo === tipo ? 'Procesando…' : 'Elegir archivo'} />
            {plantilla && <p className="hint" style={{ marginTop: 8 }}><a href={`${API_URL}/cargas/plantilla/${plantilla}`}>Descargar plantilla de {titulo.toLowerCase()}</a></p>}
            {res[tipo] && <p className={`msg ${res[tipo].ok ? '' : 'err'}`} role="status">{res[tipo].t}</p>}
          </section>))}
      </div>
      <Card title="Historial de cargas" hint="Una extracción de pedidos solo se puede eliminar si es la última, porque las siguientes se calcularon comparando contra ella.">
        {!d.data ? <Cargando error={d.error} /> : d.data.length ? <div className="tscroll"><table>
          <thead><tr><th>Cargada</th><th>Tipo</th><th>Archivo</th><th>Corte</th><th className="num">Filas</th><th>Resultado</th><th>Por</th><th /></tr></thead>
          <tbody>{d.data.map(c => <tr key={c.id}><td>{fechaHora(new Date(c.cargado_en).getTime())}</td><td>{TIPOS.find(t => t[0] === c.tipo)?.[1]}</td><td>{c.archivo}</td>
            <td>{fechaHora(new Date(c.corte).getTime())}</td><td className="num">{N(c.filas)}</td><td>{detalle(c)}</td><td>{c.cargado_por || '—'}</td>
            <td>{puede('da.cargas') && <button type="button" className="link danger" onClick={() => borrar(c)}>Eliminar</button>}</td></tr>)}</tbody>
        </table></div> : <p className="empty">Aún no hay cargas.</p>}
      </Card>
      <HistorialStock h={hs} />
    </>
  );
}
