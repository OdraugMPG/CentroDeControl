// Dashboard gerencial: los indicadores principales de todos los módulos en una vista, para un rango de fechas,
// contra su meta y contra el período anterior de igual largo. Se actualiza solo cada 5 minutos y tiene modo pantalla completa.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCarga } from '../../lib/contexto.jsx';
import { api, qs } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { N, dm, dmy, hhmm, ymd, css } from '../../lib/fmt.js';

const div = (a, b) => (b > 0 ? a / b : null);
const pct1 = (v) => (v === null || v === undefined ? '—' : `${(Math.round(v * 1000) / 10).toLocaleString('es-CL', { minimumFractionDigits: 1 })}%`);
const $M = (v) => (v === null || v === undefined ? '—' : v >= 1e9 ? `$${(v / 1e9).toLocaleString('es-CL', { maximumFractionDigits: 1 })} mil M` : v >= 1e6 ? `$${(v / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 })} M` : `$${N(v)}`);
const sumar = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const COLOR_CD = ['--blue', '--violet', '--teal', '--yellow', '--slate', '--green'];
const ESTADO = { ok: ['✓', 'En meta'], mid: ['!', 'Bajo meta'], bad: ['✕', 'Crítico'] };

// rangos rápidos
const RANGOS = {
  d7: ['Últimos 7 días', (h) => [sumar(h, -6), h]],
  d30: ['Últimos 30 días', (h) => [sumar(h, -29), h]],
  mes: ['Mes actual', (h) => [`${h.slice(0, 8)}01`, h]],
  mesAnt: ['Mes anterior', (h) => { const fin = sumar(`${h.slice(0, 8)}01`, -1); return [`${fin.slice(0, 8)}01`, fin]; }],
  otro: ['Otro rango', null]
};

// variación contra el período anterior: en puntos porcentuales (tasas) o en % (cantidades); más es mejor
function Delta({ v, ant, tasa }) {
  if (v === null || v === undefined || ant === null || ant === undefined) return <div className="ger-delta muted">Sin datos del período anterior</div>;
  const d = tasa ? (v - ant) * 100 : div(v - ant, Math.abs(ant)) * 100;
  if (d === null || !Number.isFinite(d)) return <div className="ger-delta muted">Sin datos del período anterior</div>;
  const r = Math.round(d * 10) / 10;
  const txt = `${r > 0 ? '▲ +' : r < 0 ? '▼ −' : '= '}${Math.abs(r).toLocaleString('es-CL')} ${tasa ? 'pp' : '%'}`;
  return <div className="ger-delta"><b className={r > 0 ? 'ok' : r < 0 ? 'warn' : ''}>{txt}</b> <span className="muted">vs período anterior</span></div>;
}

/** Tarjeta de indicador: valor, estado contra la meta (ícono y texto, no solo color), barra hacia la meta y variación */
function Kpi({ titulo, valor, estado, avance, meta, metaTxt, sub, delta, to }) {
  const e = ESTADO[estado];
  return (
    <div className={`ger-kpi ${estado || ''}`}>
      <div className="ger-kpi-h"><span>{titulo}</span>{e && <span className={`ger-chip ${estado}`}><b aria-hidden="true">{e[0]}</b> {e[1]}</span>}</div>
      <div className="ger-kpi-v">{valor}</div>
      {avance !== undefined && avance !== null && (
        <div className="ger-bar" role="img" aria-label={`${pct1(avance)}${meta !== undefined ? ` · meta ${pct1(meta)}` : ''}`}>
          <i style={{ width: `${Math.min(100, Math.max(0, avance * 100))}%` }} />
          {meta !== undefined && <b style={{ left: `${Math.min(100, meta * 100)}%` }} title={`Meta ${pct1(meta)}`} />}
        </div>
      )}
      {metaTxt && <div className="ger-kpi-m">{metaTxt}</div>}
      {sub && <div className="ger-kpi-s">{sub}</div>}
      {delta}
      {to && <Link className="ger-kpi-l" to={to}>Ver detalle</Link>}
    </div>
  );
}

const estadoDe = (v, meta, critico) => (v === null || v === undefined ? null : v >= meta ? 'ok' : v >= critico ? 'mid' : 'bad');
const sinDatos = (txt) => <p className="empty">{txt}</p>;
const verDetalle = (to) => <Link className="muted" to={to}>Ver detalle</Link>;
const pctEje = { ticks: { callback: (v) => `${Math.round(v * 100)}%` } };
const tipPct = { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${pct1(c.parsed.y)}` } } } };

export default function Gerencial() {
  const hoy = ymd(new Date());
  const [rango, setRango] = useState('d30');
  const [fechas, setFechas] = useState(() => RANGOS.d30[1](hoy));
  const [desde, hasta] = fechas;
  const d = useCarga(() => api.get(`/gerencial?${qs({ desde, hasta })}`), [desde, hasta]);
  const caja = useRef(null);
  const [full, setFull] = useState(false);

  // se actualiza solo cada 5 minutos
  const { recargar } = d;
  useEffect(() => { const t = setInterval(recargar, 5 * 60000); return () => clearInterval(t); }, [recargar]);
  useEffect(() => {
    const f = () => setFull(document.fullscreenElement === caja.current);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  const pantalla = () => (document.fullscreenElement ? document.exitFullscreen() : caja.current?.requestFullscreen?.())?.catch?.(() => null);
  // recalcula en el servidor sin esperar los 5 minutos de la respuesta guardada
  const actualizar = async () => { d.setData(null); try { d.setData(await api.get(`/gerencial?${qs({ desde, hasta, fresco: 1 })}`)); } catch { recargar(); } };
  const elegir = (k) => { setRango(k); if (RANGOS[k][1]) setFechas(RANGOS[k][1](hoy)); };

  const r = d.data;
  return (
    <div ref={caja} className={`ger ${full ? 'ger-full' : ''}`}>
      <PageHead title="Dashboard gerencial" sub={r ? `Del ${dmy(r.desde)} al ${dmy(r.hasta)} · comparado con el ${dmy(r.ant.desde)} al ${dmy(r.ant.hasta)} · actualizado ${hhmm(r.calculado)}` : 'Producción, almacenamiento, inventario y stock en una vista'}>
        <label className="field"><span>Período</span>
          <select value={rango} onChange={(e) => elegir(e.target.value)}>{Object.entries(RANGOS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {rango === 'otro' && <>
          <label className="field"><span>Desde</span><input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setFechas([e.target.value, hasta])} /></label>
          <label className="field"><span>Hasta</span><input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setFechas([desde, e.target.value])} /></label>
        </>}
        <button className="btn" onClick={actualizar}>Actualizar</button>
        <button className="btn" onClick={pantalla}>{full ? 'Salir de pantalla completa' : 'Pantalla completa'}</button>
      </PageHead>
      {!r ? <Cargando error={d.error} /> : <Tablero r={r} />}
    </div>
  );
}

function Tablero({ r }) {
  const M = r.metas, A = r.ant, P = r.prod, I = r.inv, G = r.prog;
  const cdsAlm = [...new Set(r.alm.filas.map((x) => x.cd))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const colorCd = (cd, lista) => css(COLOR_CD[Math.max(0, lista.indexOf(cd)) % COLOR_CD.length]);
  const promDia = (u, dias) => div(u, dias);

  // ---------- gráficos ----------
  const tendProd = {
    labels: P.porDia.map((x) => dm(x.fecha)),
    datasets: [
      { type: 'line', label: `Meta ${pct1(M.cumplimiento)}`, data: P.porDia.map(() => M.cumplimiento), borderColor: css('--muted'), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, order: 0 },
      { label: 'Cumplimiento', data: P.porDia.map((x) => x.pct), backgroundColor: P.porDia.map((x) => css(x.pct >= M.cumplimiento ? '--green' : x.pct >= M.umbral ? '--yellow' : '--red')), borderRadius: 4, maxBarThickness: 36, order: 1 }
    ]
  };
  const fases = {
    labels: P.fases.map((x) => x.fase),
    datasets: [{ label: 'Cumplimiento', data: P.fases.map((x) => x.pct), backgroundColor: P.fases.map((x) => css(x.pct >= M.cumplimiento ? '--green' : x.pct >= M.umbral ? '--yellow' : '--red')), borderRadius: 4, maxBarThickness: 26 }]
  };
  const diasAlm = [...new Set(r.alm.filas.map((x) => x.fecha))];
  const alm = {
    labels: diasAlm.map(dm),
    datasets: cdsAlm.map((cd) => ({ label: cd, data: diasAlm.map((f) => r.alm.filas.find((x) => x.fecha === f && x.cd === cd)?.u || 0), backgroundColor: colorCd(cd, cdsAlm), borderRadius: 3, borderSkipped: false, maxBarThickness: 36 }))
  };
  const linea = (label, data, color, extra = {}) => ({ type: 'line', label, data, borderColor: css(color), backgroundColor: css(color), borderWidth: 2, pointRadius: 3, tension: 0.25, ...extra });
  const inv = {
    labels: I.porDia.map((x) => dm(x.fecha)),
    datasets: [linea('ERI', I.porDia.map((x) => x.eri), '--blue'), linea('ERU', I.porDia.map((x) => x.eru), '--teal'),
      linea(`Meta ERI ${pct1(M.eri)}`, I.porDia.map(() => M.eri), '--muted', { borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 })]
  };
  const minInv = Math.min(0.9, ...I.porDia.flatMap((x) => [x.eri, x.eru]).filter((v) => v !== null)) - 0.01;
  const stock = {
    labels: r.stock.serie.map((x) => dm(x.fecha)),
    datasets: [linea('Unidades en stock', r.stock.serie.map((x) => x.u), '--violet', { fill: true, backgroundColor: 'transparent' })]
  };
  const mov = {
    labels: r.mov.serie.map((x) => dm(x.fecha)),
    datasets: [
      { label: 'Dentro del mismo CD', data: r.mov.serie.map((x) => x.traslados - x.entre_cd), backgroundColor: css('--blue'), borderRadius: 3, borderSkipped: false, maxBarThickness: 32 },
      { label: 'Entre CD', data: r.mov.serie.map((x) => x.entre_cd), backgroundColor: css('--yellow'), borderRadius: 3, borderSkipped: false, maxBarThickness: 32 }
    ]
  };
  const causas = r.dev.causas.slice(0, 5), maxC = Math.max(1, ...causas.map((x) => x.brecha));

  return (
    <>
      {/* ---------- indicadores principales ---------- */}
      <div className="ger-kpis">
        <Kpi titulo="Cumplimiento productivo" valor={pct1(P.pct)} estado={estadoDe(P.pct, M.cumplimiento, M.umbral)} avance={P.pct} meta={M.cumplimiento}
          metaTxt={`Meta ${pct1(M.cumplimiento)} · ${N(P.u)} de ${N(P.meta)} u. de la meta por hora`}
          sub={P.dias ? `${N(P.dias)} ${P.dias === 1 ? 'día' : 'días'} con producción cargada` : 'Sin producción cargada en el período'}
          delta={<Delta v={P.pct} ant={A.prod.pct} tasa />} to="/control" />
        <Kpi titulo="Productividad" valor={P.prod === null ? '—' : <>{N(P.prod)} <small>u. / persona-hora</small></>}
          sub={P.personasHora ? `${N(P.u)} u. en ${N(P.personasHora)} personas-hora` : 'Sin producción cargada en el período'}
          delta={<Delta v={P.prod} ant={A.prod.prod} />} to="/control" />
        <Kpi titulo="Unidades almacenadas" valor={N(r.alm.u)}
          sub={r.alm.dias ? `${N(r.alm.lpn)} LPN · ${N(promDia(r.alm.u, r.alm.dias))} u. por día (${N(r.alm.dias)} ${r.alm.dias === 1 ? 'día' : 'días'} con datos)` : 'Sin almacenado cargado en el período'}
          delta={<Delta v={promDia(r.alm.u, r.alm.dias)} ant={promDia(A.alm.u, A.alm.dias)} />} to="/recepcion" />
        <Kpi titulo="ERI · exactitud de inventario" valor={pct1(I.eri)} estado={estadoDe(I.eri, M.eri, M.eriCritico)} avance={I.eri} meta={M.eri}
          metaTxt={`Meta ${pct1(M.eri)} · crítico bajo ${pct1(M.eriCritico)}`}
          sub={I.dias ? `${N(I.unidSis)} u. contadas en ${N(I.dias)} ${I.dias === 1 ? 'día' : 'días'} de toma` : 'Sin toma en el período'}
          delta={<Delta v={I.eri} ant={A.inv.eri} tasa />} to="/inventario/dashboard" />
        <Kpi titulo="ERU · exactitud de ubicación" valor={pct1(I.eru)} estado={estadoDe(I.eru, M.eru, M.eruCritico)} avance={I.eru} meta={M.eru}
          metaTxt={`Meta ${pct1(M.eru)} · crítico bajo ${pct1(M.eruCritico)}`}
          sub={I.dias ? `${N(I.ubicOk)} de ${N(I.ubicaciones)} ubicaciones correctas` : 'Sin toma en el período'}
          delta={<Delta v={I.eru} ant={A.inv.eru} tasa />} to="/inventario/dashboard" />
        <Kpi titulo="Accuracy programación CE" valor={pct1(G?.accOrig)} estado={G ? estadoDe(G.accOrig, M.programacion, M.programacion * 0.8) : null} avance={G?.accOrig} meta={M.programacion}
          metaTxt={`Meta ${pct1(M.programacion)}${G ? ` · con re-programación ${pct1(G.accVig)}` : ''}`}
          sub={G ? `${N(G.enOrig)} de ${N(G.evaluables)} ubicaciones tomadas en la fecha programada` : 'Sin toma de CE cargada en el período'}
          delta={<Delta v={G?.accOrig} ant={A.prog?.accOrig} tasa />} to="/inventario/dashboard" />
      </div>

      {/* ---------- producción y desvíos ---------- */}
      <div className="grid">
        <Card className="s5" title="Cumplimiento productivo por día" actions={verDetalle('/control')}>
          {P.porDia.length ? <Grafico alto={230} label="Cumplimiento productivo por día contra la meta" datos={tendProd}
            opciones={{ scales: { y: pctEje }, ...tipPct }} /> : sinDatos('Sin producción cargada en el período (Datos, Cargas de archivos: Pedidos).')}
        </Card>
        <Card className="s4" title="Top 5 causas de desvío" actions={verDetalle('/cierre')}>
          {causas.length ? <>
            <div className="ger-mini"><span><b>{N(r.dev.brecha)}</b> u. de brecha</span><span><b>{N(r.dev.desvios)}</b> desvíos</span><span><b>{N(r.dev.minutos)}</b> min detenidos</span><span><b>{N(r.dev.turnosCerrados)}</b> turnos cerrados</span></div>
            <ol className="ger-top">{causas.map((c) => (
              <li key={c.causa}><span className="ger-top-n">{c.causa}</span>
                <span className="ger-top-b"><i style={{ width: `${(c.brecha / maxC) * 100}%` }} /></span>
                <span className="num"><b>{N(c.brecha)} u.</b> <small className="muted">{pct1(div(c.brecha, r.dev.brecha))}</small></span></li>))}</ol>
          </> : sinDatos('Sin desvíos registrados en el cierre de turno del período.')}
        </Card>
        <Card className="s3" title="Por almacenar ahora" actions={verDetalle('/almacenamiento')}>
          {r.pend ? <div className="ger-stack">
            <div><small>LPN pendientes</small><b>{N(r.pend.lpn)}</b></div>
            <div><small>Unidades</small><b>{N(r.pend.u)}</b></div>
            <div><small>Valor</small><b>{$M(r.pend.valor)}</b></div>
            <div><small>Con más de {N(M.minUbicar ?? 90)} min</small><b className={r.pend.antiguos ? 'warn' : ''}>{N(r.pend.antiguos)}</b></div>
            {r.pend.corte && <p className="muted ger-nota">Última carga: {dmy(r.pend.corte.slice(0, 10))} {hhmm(r.pend.corte)}</p>}
          </div> : sinDatos('Sin carga de lo pendiente por almacenar.')}
        </Card>
      </div>

      {/* ---------- almacenado e inventario ---------- */}
      <div className="grid">
        <Card className="s4" title="Unidades almacenadas por día y CD" actions={verDetalle('/recepcion')}>
          {diasAlm.length ? <Grafico apilado alto={230} label="Unidades almacenadas por día y CD" datos={alm} /> : sinDatos('Sin almacenado cargado en el período.')}
        </Card>
        <Card className="s4" title="ERI y ERU por día de toma" actions={verDetalle('/inventario/dashboard')}>
          {I.porDia.length ? <Grafico alto={230} label="ERI y ERU por día de toma" datos={inv}
            opciones={{ scales: { y: { ...pctEje, beginAtZero: false, min: Math.max(0, Math.floor(minInv * 100) / 100), max: 1 } }, ...tipPct }} /> : sinDatos('Sin toma de inventario en el período.')}
        </Card>
        <Card className="s4" title="Cumplimiento por fase" actions={verDetalle('/control')}>
          {P.fases.length ? <Grafico horizontal alto={230} leyenda={false} label="Cumplimiento por fase contra la meta" datos={fases}
            opciones={{ scales: { x: pctEje }, plugins: { tooltip: { callbacks: { label: (c) => { const x = P.fases[c.dataIndex]; return `${pct1(x.pct)} · ${N(x.u)} de ${N(x.meta)} u.`; } } } } }} /> : sinDatos('Sin producción cargada en el período.')}
        </Card>
      </div>

      {/* ---------- inventario por CD, stock y movimientos ---------- */}
      <div className="grid">
        <Card className="s4" title="Inventario por CD" actions={verDetalle('/inventario/dashboard')}>
          {I.porCd.length ? (
            <table className="ger-tabla"><thead><tr><th>CD</th><th className="num">ERI</th><th className="num">ERU</th><th className="num" title="Sobrante − faltante">Neto u.</th><th className="num" title="Sobrante + faltante">Absoluto u.</th></tr></thead>
              <tbody>{I.porCd.map((x) => (
                <tr key={x.cd}><td>{x.cd}</td>
                  <td className={`num ${x.eri < M.eriCritico ? 'warn' : x.eri >= M.eri ? 'ok' : ''}`}>{pct1(x.eri)}</td>
                  <td className={`num ${x.eru < M.eruCritico ? 'warn' : x.eru >= M.eru ? 'ok' : ''}`}>{pct1(x.eru)}</td>
                  <td className={`num ${x.neto < 0 ? 'warn' : ''}`}>{x.neto > 0 ? '+' : x.neto < 0 ? '−' : ''}{N(Math.abs(x.neto))}</td>
                  <td className="num">{N(x.abs)}</td></tr>))}</tbody></table>
          ) : sinDatos('Sin toma de inventario en el período.')}
        </Card>
        <Card className="s4" title="Stock en la Base" actions={verDetalle('/inventario/movimientos')}>
          {r.stock.ultimo ? <>
            <div className="ger-mini"><span><b>{N(r.stock.ultimo.u)}</b> u.</span><span><b>{$M(r.stock.ultimo.valor)}</b></span><span><b>{N(r.stock.ultimo.skus)}</b> SKU</span><span className="muted">al {dm(r.stock.ultimo.fecha)}</span></div>
            <Grafico alto={190} leyenda={false} label="Unidades en stock por día" datos={stock} opciones={{ scales: { y: { beginAtZero: false } } }} />
          </> : sinDatos('Sin Base de stock cargada en el período (Gestión diaria).')}
        </Card>
        <Card className="s4" title="Movimientos internos por día" actions={verDetalle('/inventario/movimientos')}>
          {r.mov.serie.length ? <>
            <div className="ger-mini"><span><b>{N(r.mov.traslados)}</b> cambios de ubicación</span><span><b>{N(r.mov.entreCd)}</b> entre CD</span></div>
            <Grafico apilado alto={190} label="Cambios de ubicación por día (sin ventas)" datos={mov} />
          </> : sinDatos('Sin fotos de stock consecutivas en el período.')}
        </Card>
      </div>
    </>
  );
}
