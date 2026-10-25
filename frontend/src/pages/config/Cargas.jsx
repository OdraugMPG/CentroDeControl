// Carga de extracciones del WMS (pedidos, recepción, almacenamiento) e historial
import { useState } from 'react';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api, API_URL } from '../../lib/api.js';
import { Card, Cargando, PageHead, SubirArchivo } from '../../components/ui.jsx';
import { N, fechaHora } from '../../lib/fmt.js';
import { esOps } from '../../components/Layout.jsx';

const TIPOS = [
  ['pedidos', 'Flujo de pedidos', 'La misma extracción que hoy alimenta la tabla dinámica (Flujo de pedido.xlsx). Se detecta sola la fila de encabezados. Cada carga se compara con la anterior para calcular las unidades que salieron de cada etapa: cuanto más seguido se cargue, más preciso es el control por hora.', null],
  ['recepcion', 'Recepción', 'Citas del día con sus horas de llegada, descarga y unidades. Volver a cargar el mismo día actualiza las citas.', 'recepcion'],
  ['almacenamiento', 'Almacenamiento', 'Ocupación por zona, LPN por ubicar y reposiciones. Cada hoja es opcional.', 'almacenamiento'],
  ['olas', 'Simulador de olas', 'El reporte del simulador de olas (ESTADO, OD, SKU, QTY, FECHA_SALIDA, TIPO_PICKING…). Cada carga reemplaza a la anterior y se analiza en Operación, Simulador de olas.', null]
];

const detalle = c => c.tipo === 'pedidos'
  ? `${N(c.resumen.unidades)} un. en flujo${c.resumen.primera ? ', primera carga (sin comparación)' : `, ${N(c.resumen.unidadesMovidas)} un. avanzaron de etapa`}`
  : c.tipo === 'recepcion' ? `${c.resumen.citas} citas` : c.tipo === 'olas' ? `${N(c.resumen.unidades)} un., ${N(c.resumen.ods)} OD` : `${c.resumen.zonas || 0} zonas, ${c.resumen.lpns || 0} LPN, ${c.resumen.reposiciones || 0} reposiciones`;

export default function Cargas() {
  const { avisar, refrescar, usuario } = useApp();
  const d = useCarga(() => api.get('/cargas'), []);
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
            <td>{esOps(usuario) && <button type="button" className="link danger" onClick={() => borrar(c)}>Eliminar</button>}</td></tr>)}</tbody>
        </table></div> : <p className="empty">Aún no hay cargas.</p>}
      </Card>
    </>
  );
}
