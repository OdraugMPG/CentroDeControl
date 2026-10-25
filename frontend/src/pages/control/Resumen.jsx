// Vista de una pantalla: recepción, almacenamiento, alertas, flujo de pedidos y mapa
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../lib/contexto.jsx';
import { Stats, Cargando } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import Flujo from '../../components/Flujo.jsx';
import MapaChile, { regionesDe } from '../../components/MapaChile.jsx';
import { N, pctf, sum, uniq, css, REGIONES, ymd } from '../../lib/fmt.js';
import { filtrar, nFiltros, catalogoEtapas, mPedidos, etapasParaFlujo, FASES_FLUJO, mRecepcion, mAlmacen, alertas } from '../../lib/ops.jsx';

export default function Resumen() {
  const { snap, meta, filtros } = useApp();
  const nav = useNavigate();
  if (!snap || !meta) return <Cargando />;
  const p = meta.parametros;
  const turnoSel = snap.turno.base?.turno;
  const R = mRecepcion(snap, p, turnoSel), A = mAlmacen(snap, p);
  const f = filtrar(snap.pedidos, filtros);
  const etapas = catalogoEtapas(meta, snap.pedidos);
  const P = mPedidos(f, etapas, snap.corte, p, ymd(new Date(snap.ahora)));
  const L = alertas(snap, R, A, P, p);
  const reg = regionesDe(f);
  const ranked = Object.entries(reg).filter(([, v]) => v.qty).sort((a, b) => b[1].qty - a[1].qty);
  const rmax = Math.max(1, ...ranked.map(([, v]) => v.qty));
  const C = snap.control;
  const ir = ruta => e => { if (!e.target.closest('a,button,path,select,input')) nav(ruta); };
  const turnoTxt = snap.turno.actual ? `Turno ${snap.turno.actual.turno} en curso` : snap.turno.base ? `Sin turno en curso. Último: ${snap.turno.base.turno}` : '';

  return (
    <>
      <p className="hint" style={{ margin: '12px 0 0' }}>{turnoTxt}</p>
      <div className="ov">
        <article className="pnl p-rec" onClick={ir('/recepcion')}>
          <div className="pnl-h"><h2>Recepción</h2><Link to="/recepcion">Ver detalle</Link></div>
          <Stats items={[
            [`Recibidas, turno ${turnoSel || ''}`, <>{N(R.hoy)} <small>un.</small></>],
            ['Ritmo últimos 60 min', <>{N(R.ritmo)} <small>/h</small></>, R.ritmo < p.metaRecepcionHora ? 'warn' : 'ok'],
            ['Camiones en patio', R.patio.length, R.esperaPatio > p.minPatio ? 'warn' : '']]} />
          {R.ph.length ? <Grafico alto={120} leyenda={false} label="Unidades recibidas por hora" datos={{
            labels: R.ph.map(h => new Date(h.t).getHours() + 'h'),
            datasets: [
              { type: 'line', label: 'Meta', data: R.ph.map(() => p.metaRecepcionHora), borderColor: css('--ink'), borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0 },
              { label: 'Recibidas', data: R.ph.map(h => h.unidades), borderRadius: 2,
                backgroundColor: R.ph.map((h, i) => i === R.ph.length - 1 && snap.turno.actual ? css('--muted') : h.unidades >= p.metaRecepcionHora ? css('--teal') : css('--yellow')) }]
          }} opciones={{ scales: { y: { ticks: { maxTicksLimit: 4 } } } }} /> : <p className="empty">Sin citas cargadas para hoy.</p>}
        </article>

        <article className="pnl p-alm" onClick={ir('/almacenamiento')}>
          <div className="pnl-h"><h2>Almacenamiento</h2><Link to="/almacenamiento">Ver detalle</Link></div>
          <Stats items={[
            ['Ocupación total', pctf(A.util), A.util > p.umbralZona ? 'warn' : ''],
            ['Por ubicar', <>{A.pend.length} <small>LPN</small></>, A.maxAge > p.minUbicar ? 'warn' : ''],
            ['Repos. urgentes', A.urg, A.urg ? 'warn' : '']]} />
          <div className="zbars" style={{ '--umbral': `${p.umbralZona * 100}%` }}>
            {A.zonas.slice(0, 7).map(z => (
              <div className="zb" key={z.zona}><span>{z.zona}</span>
                <span className="tr"><i className={z.u > p.umbralZona ? 'hot' : ''} style={{ width: `${Math.min(100, z.u * 100)}%` }} /></span>
                <b className={z.u > p.umbralZona ? 'warn' : ''}>{pctf(z.u)}</b></div>))}
            {!A.zonas.length && <p className="empty">Sin carga de ocupación.</p>}
          </div>
        </article>

        <article className="pnl p-alert" style={{ cursor: 'default' }}>
          <div className="pnl-h"><h2>Atención ahora</h2><span className="muted" style={{ fontSize: 13 }}>{L.length} {L.length === 1 ? 'alerta' : 'alertas'}</span></div>
          <ul className="alerts">
            {L.length ? L.map(([k, ruta, t, s], i) => <li key={i} className={k}><Link to={ruta}><b>{t}</b><span className="src">{s}</span></Link></li>)
              : <li className="okk"><Link to="/">Todo dentro de rango.</Link></li>}
          </ul>
        </article>

        <article className="pnl p-map" onClick={ir('/mapa')}>
          <div className="pnl-h"><h2>Pedidos por región</h2><Link to="/mapa">Ver detalle</Link></div>
          <div className="mapbox">
            <MapaChile valores={reg} onSelect={k => nav(`/mapa?region=${k}`)} />
            <div className="rlist">
              {ranked.map(([k, v]) => (
                <button key={k} type="button" onClick={() => nav(`/mapa?region=${k}`)}>
                  <span>{REGIONES[k] || k}</span><b>{N(v.qty)}</b><i style={{ width: `${v.qty / rmax * 100}%` }} />
                </button>))}
              <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>Unidades por región de destino{nFiltros(filtros) ? ', con filtros de pedidos' : ''}</span>
            </div>
          </div>
        </article>

        <article className="pnl p-ped" onClick={ir('/pedidos')}>
          <div className="pnl-h"><h2>Flujo de pedidos</h2>
            <span className="links"><Link to="/control">Control por hora</Link><Link to="/cierre">Cierre de turno</Link><Link to="/pedidos">Ver detalle</Link></span></div>
          <Stats className="six" items={[
            ['Unidades en flujo', N(P.tot)], ['Órdenes', N(uniq(f, 'orden'))],
            ['Picking pendiente', <>{N(sum(P.pend, r => r.qty))} <small>un.</small></>, P.maxPend > p.minAntiguo ? 'warn' : ''],
            ['Listo para despacho', <>{N(sum(P.listo, r => r.qty))} <small>un.</small></>],
            ['Compromiso hoy en riesgo', <>{N(sum(P.riesgo, r => r.qty))} <small>un.</small></>, P.riesgo.length ? 'warn' : ''],
            [`Cumplimiento turno ${C?.turno || ''}`, pctf(C?.pct), C?.pct == null ? '' : C.pct < (p.umbralDesvio ?? 0.85) ? 'warn' : C.pct >= 1 ? 'ok' : '']]} />
          {snap.pedidos.length
            ? <Flujo compacto anchoMin={78} etapas={etapasParaFlujo(P.st, p, true)} fases={FASES_FLUJO} onSelect={k => nav(`/pedidos?etapa=${encodeURIComponent(k)}`)} />
            : <p className="empty">Aún no se carga ninguna extracción de pedidos. <Link to="/cargas">Cargar ahora</Link></p>}
        </article>
      </div>
    </>
  );
}
