import { useApp } from '../../lib/contexto.jsx';
import { Kpis, Card, Cargando, PageHead } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import Flujo from '../../components/Flujo.jsx';
import { N, pctf, sum, css, hhmm, fmtAge, minsDesde, dmy } from '../../lib/fmt.js';
import { mRecepcion } from '../../lib/ops.jsx';

const ESTADOS = [['Programada', '--muted'], ['En patio', '--yellow'], ['Descargando', '--teal'], ['En inspección', '--violet'], ['Recibida', '--slate']];

export default function Recepcion() {
  const { snap, meta } = useApp();
  if (!snap || !meta) return <Cargando />;
  const p = meta.parametros, ahora = snap.ahora;
  const R = mRecepcion(snap, p);
  const recibidas = R.citas.filter(c => c.estado === 'Recibida');
  const cumpl = sum(recibidas, c => c.recibidas) / Math.max(1, sum(recibidas, c => c.esperadas));
  const curH = new Date(ahora).setMinutes(0, 0, 0);
  const docks = Array.from({ length: p.andenes || 10 }, (_, i) => R.enAnden.find(c => c.anden === i + 1));
  const turnoDe = snap.recepcion.turnoDeHora || {};

  return (
    <>
      <PageHead title="Recepción" sub={`Día operativo ${dmy(snap.recepcion.fecha)}${snap.cargas.recepcion ? `. Última carga a las ${hhmm(snap.cargas.recepcion.corte)}` : '. Sin cargas de recepción'}`} />
      <Kpis items={[
        ['Recibidas en el día', N(R.hoy)],
        ['Ritmo últimos 60 min', <>{N(R.ritmo)} <small>/h de {N(p.metaRecepcionHora)}</small></>, R.ritmo < p.metaRecepcionHora ? 'warn' : 'ok'],
        ['Citas recibidas', <>{recibidas.length} <small>de {R.citas.length}</small></>],
        ['Camiones en patio', R.patio.length],
        ['Espera máxima en patio', R.patio.length ? fmtAge(R.esperaPatio) : '—', R.esperaPatio > p.minPatio ? 'warn' : ''],
        ['Andenes ocupados', <>{R.enAnden.length} <small>de {p.andenes}</small></>],
        ['Recibido vs esperado', recibidas.length ? pctf(cumpl) : '—', recibidas.length && cumpl < 0.97 ? 'warn' : '']]} />
      <Card title="Citas por estado">
        <Flujo anchoMin={120} etapas={ESTADOS.map(([e, color]) => {
          const rows = R.citas.filter(c => c.estado === e);
          return { key: e, nombre: e, color, sinMarca: true, qty: sum(rows, c => e === 'Recibida' ? c.recibidas : c.esperadas), meta: `${rows.length} citas` };
        })} />
      </Card>
      <div className="grid">
        <Card className="s7" title="Unidades recibidas por hora" hint="Línea punteada: meta por hora. Verde cumple, amarillo bajo meta, gris es la hora en curso.">
          <Grafico label="Unidades recibidas por hora" datos={{
            labels: R.ph.map(h => `${new Date(h.t).getHours()}:00 ${turnoDe[h.t] || ''}`),
            datasets: [
              { type: 'line', label: 'Meta por hora', data: R.ph.map(() => p.metaRecepcionHora), borderColor: css('--ink'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
              { label: 'Recibidas', data: R.ph.map(h => h.unidades), borderRadius: 2,
                backgroundColor: R.ph.map(h => h.t === curH ? css('--muted') : h.unidades >= p.metaRecepcionHora ? css('--teal') : css('--yellow')) }]
          }} />
        </Card>
        <Card className="s5" title="Andenes" hint={`En rojo, descargas que superan ${p.minAnden} minutos.`}>
          <div className="docks">
            {docks.map((c, i) => c
              ? <div key={i} className={`dock ${minsDesde(c.inicio, ahora) > p.minAnden ? 'late' : 'busy'}`}><b>Andén {i + 1}</b>{c.cita}<br />{c.estado}<br />{fmtAge(minsDesde(c.inicio, ahora))}</div>
              : <div key={i} className="dock"><b>Andén {i + 1}</b><span className="muted">Libre</span></div>)}
          </div>
        </Card>
      </div>
      <Card title="Citas del día">
        {R.citas.length ? <div className="tscroll"><table>
          <thead><tr><th>Cita</th><th>Proveedor</th><th>Programada</th><th>Llegada</th><th>Estado</th><th>Andén</th><th className="num">Esperadas</th><th className="num">Recibidas</th><th className="num">Tiempo en estado</th></tr></thead>
          <tbody>{R.citas.map(c => {
            const ref = c.estado === 'En patio' ? c.llegada : ['Descargando', 'En inspección'].includes(c.estado) ? c.inicio : null;
            const m = ref ? minsDesde(ref, ahora) : 0;
            const atrasada = c.estado === 'Programada' && c.prog && c.prog < ahora - 30 * 60000;
            const late = (c.estado === 'En patio' && m > p.minPatio) || (ref && c.estado !== 'En patio' && m > p.minAnden) || atrasada;
            const col = ESTADOS.find(e => e[0] === c.estado)?.[1] || '--muted';
            return <tr key={c.cita}><td>{c.cita}</td><td>{c.proveedor}</td><td>{hhmm(c.prog)}</td><td>{hhmm(c.llegada)}</td>
              <td><span className="pill" style={{ background: `color-mix(in srgb,var(${col}) 22%,transparent)` }}>{c.estado}</span></td>
              <td>{c.anden && !['Programada', 'En patio'].includes(c.estado) ? c.anden : '—'}</td>
              <td className="num">{N(c.esperadas)}</td><td className="num">{c.recibidas ? N(c.recibidas) : '—'}</td>
              <td className={`num ${late ? 'old' : ''}`}>{ref ? fmtAge(m) : atrasada ? 'Atrasada' : '—'}</td></tr>;
          })}</tbody></table></div>
          : <p className="empty">No hay citas cargadas para este día. Súbelas en Datos, Cargas de extracciones.</p>}
      </Card>
    </>
  );
}
