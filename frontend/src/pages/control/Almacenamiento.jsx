import { useApp } from '../../lib/contexto.jsx';
import { Kpis, Card, Cargando, PageHead } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { N, pctf, sum, css, hhmm, fmtAge, minsDesde } from '../../lib/fmt.js';
import { mAlmacen } from '../../lib/ops.jsx';

export default function Almacenamiento() {
  const { snap, meta } = useApp();
  if (!snap || !meta) return <Cargando />;
  const p = meta.parametros, ahora = snap.ahora;
  const A = mAlmacen(snap, p);
  const buckets = [['< 30 min', 0, 30], ['30–60', 30, 60], ['1–2 h', 60, 120], ['2–4 h', 120, 240], ['> 4 h', 240, 1e9]];
  const enB = (l, b) => { const m = minsDesde(l.t, ahora); return m >= b[1] && m < b[2]; };
  const rp = A.A.reposiciones.slice().sort((a, b) => b.urgentes - a.urgentes || b.pendientes - a.pendientes);
  const lp = A.pend.slice().sort((a, b) => (a.t || 0) - (b.t || 0)).slice(0, 30);
  const umbral = p.umbralZona;

  return (
    <>
      <PageHead title="Almacenamiento" sub={snap.cargas.almacenamiento ? `Última carga a las ${hhmm(snap.cargas.almacenamiento.corte)}` : 'Sin cargas de almacenamiento'} />
      <Kpis items={[
        ['Ocupación total', pctf(A.util), A.util > umbral ? 'warn' : ''],
        [`Zonas sobre ${pctf(umbral)}`, A.zonas.filter(z => z.u > umbral).length, A.zonas.some(z => z.u > umbral) ? 'warn' : ''],
        ['LPN por ubicar', <>{A.pend.length} <small>{N(sum(A.pend, l => l.qty))} un.</small></>],
        ['Más antiguo sin ubicar', A.pend.length ? fmtAge(A.maxAge) : '—', A.maxAge > p.minUbicar ? 'warn' : ''],
        ['Ubicados', <>{A.ubicados.length} <small>LPN</small></>],
        ['Reposiciones', <>{A.repo} <small>{A.urg} urgentes</small></>, A.urg ? 'warn' : '']]} />
      <div className="grid">
        <Card className="s7" title="Ocupación por zona" hint={`Línea punteada: umbral de ${pctf(umbral)}.`}>
          <div className="racks" style={{ '--umbral': `${umbral * 100}%` }}>
            {A.zonas.map(z => {
              const filled = Math.min(20, Math.round(z.u * 20)), lim = Math.round(umbral * 20);
              return (
                <div className="rack" key={z.zona} role="img" aria-label={`${z.zona}: ${pctf(z.u)}`}>
                  <div><b>{z.zona}</b><small>{N(z.ocupadas)} de {N(z.posiciones)}</small></div>
                  <div className="bays">{Array.from({ length: 20 }, (_, i) => <div key={i} className={`bay ${i < filled ? (i >= lim ? 'hot' : 'on') : ''}`} />)}</div>
                  <div className={`pct ${z.u > umbral ? 'warn' : ''}`}>{pctf(z.u)}</div>
                </div>);
            })}
            {!A.zonas.length && <p className="empty">Sin datos de ocupación.</p>}
          </div>
        </Card>
        <Card className="s5" title="Por ubicar según antigüedad">
          <Grafico apilado label="LPN por ubicar según antigüedad" datos={{
            labels: buckets.map(b => b[0]),
            datasets: [
              { label: 'Por ubicar', data: buckets.map(b => A.pend.filter(l => l.estado === 'Por ubicar' && enB(l, b)).length), backgroundColor: css('--yellow'), borderRadius: 2 },
              { label: 'En curso', data: buckets.map(b => A.pend.filter(l => l.estado === 'En curso' && enB(l, b)).length), backgroundColor: css('--teal'), borderRadius: 2 }]
          }} />
        </Card>
      </div>
      <div className="grid">
        <Card className="s6" title="Reposiciones pendientes">
          <div className="tscroll"><table>
            <thead><tr><th>Zona</th><th className="num">Pendientes</th><th className="num">Urgentes</th></tr></thead>
            <tbody>{rp.map(r => <tr key={r.zona}><td>{r.zona}</td><td className="num">{r.pendientes}</td><td className={`num ${r.urgentes ? 'old' : ''}`}>{r.urgentes || '—'}</td></tr>)}</tbody>
            <tfoot><tr><td>Total</td><td className="num">{A.repo}</td><td className="num">{A.urg}</td></tr></tfoot>
          </table></div>
        </Card>
        <Card className="s6" title="LPN por ubicar, más antiguos primero">
          <div className="tscroll"><table>
            <thead><tr><th>LPN</th><th>Zona destino</th><th>Estado</th><th>Cita</th><th className="num">Unid.</th><th className="num">Antigüedad</th></tr></thead>
            <tbody>{lp.map(l => <tr key={l.lpn}><td>{l.lpn}</td><td>{l.zona}</td><td>{l.estado}</td><td>{l.cita}</td><td className="num">{l.qty}</td>
              <td className={`num ${minsDesde(l.t, ahora) > p.minUbicar ? 'old' : ''}`}>{l.t ? fmtAge(minsDesde(l.t, ahora)) : '—'}</td></tr>)}</tbody>
          </table>{!lp.length && <p className="empty">No hay LPN pendientes.</p>}</div>
        </Card>
      </div>
    </>
  );
}
