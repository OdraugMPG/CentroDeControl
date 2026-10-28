import React, { useState } from 'react';
import { api, qs, urlApi, fmt, fFecha } from './api.js';
import { toast, useCarga } from './ui.jsx';

const pc = (a, b, d = 1) => (b > 0 ? fmt((100 * a) / b, d) + '%' : '—');
const TONO = { A: 'm-0', B: 'm-2', C: 'm-4' };
const tono = (m) => 'm-' + ('ABC'.indexOf(m[0]) + 'XYZ'.indexOf(m[1]));

/** Barra apilada A/B/C (participación de las ubicaciones del CD). */
function Apilada({ v }) {
  const tot = v.A + v.B + v.C;
  if (!tot) return <span className="muted">—</span>;
  return (
    <div className="apil" role="img" aria-label={`A ${pc(v.A, tot)}, B ${pc(v.B, tot)}, C ${pc(v.C, tot)}`}>
      {['A', 'B', 'C'].map((a) => v[a] > 0 && (
        <i key={a} className={TONO[a]} style={{ flexGrow: v[a] }} title={`Clase ${a}: ${fmt(v[a])} ubicaciones (${pc(v[a], tot)})`}>
          {v[a] / tot >= 0.09 ? `${a} ${pc(v[a], tot, 0)}` : ''}
        </i>
      ))}
    </div>
  );
}

function Generar({ etiqueta, total, onGenerar }) {
  const [n, setN] = useState(Math.min(200, total) || 0);
  return (
    <div className="row" style={{ alignItems: 'flex-end' }}>
      <div><label className="lbl">SKU (los primeros)</label><input type="number" className="w90" min="1" max={total} value={n} onChange={(e) => setN(e.target.value)} /></div>
      <button className="btn primary" disabled={!total} onClick={() => onGenerar(n)}>{etiqueta}</button>
    </div>
  );
}

const TONO_ESTADO = { 'Consolidar': '', 'Consolidar fuera de OSR': 'm-1', 'Sin stock de seguridad fuera de OSR': 'm-4', 'Stock de seguridad insuficiente': 'm-3',
  'Consolidar en destino': 'm-0', 'Nuevo en destino': 'm-2' };

/** SKU repartidos en varios CD: simulación para dejarlos en un solo CD, con stock de seguridad fuera de OSR, o de una ruta Desde → Hasta. */
function ConsolidacionCds() {
  const [f, setF] = useState({ criterio: 'unidades', diasSS: 7, estado: '', abc: '', desde: '', hasta: '', soloEnDestino: true });
  const [r, setR] = useState(null);
  const [cargando, setCargando] = useState(false);
  // la ruta se simula solo con los dos CD elegidos; mientras falte uno, sigue la consolidación general
  const enRuta = !!(f.desde && f.hasta && f.desde !== f.hasta);
  const cuerpo = { ...f, desde: enRuta ? f.desde : '', hasta: enRuta ? f.hasta : '' };
  React.useEffect(() => {
    setCargando(true);
    const t = setTimeout(() => api.post('/api/optimizacion/consolidacion/simular', cuerpo).then(setR).catch((e) => toast(e.message, true)).finally(() => setCargando(false)), 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(cuerpo)]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const alt = (k, v) => set(k)(f[k] === v ? '' : v);
  // al cambiar la ruta cambian los estados posibles: se limpia el filtro de estado
  const setRuta = (k) => (v) => setF({ ...f, [k]: v, estado: '', ...(k === 'desde' && v === f.hasta ? { hasta: '' } : {}) });
  const osr = r?.osr || 'OSR';
  const ruta = r?.ruta;
  return (
    <div className="sec">
      <div className="row spread" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Consolidación de SKU entre CD{ruta ? ` · ruta ${ruta.desde} → ${ruta.hasta}` : ''}</h2>
        <a className="btn primary" href={urlApi('/api/optimizacion/consolidacion/excel' + qs({ criterio: f.criterio, diasSS: f.diasSS, desde: cuerpo.desde, hasta: cuerpo.hasta, soloEnDestino: f.soloEnDestino }))}>Exportar a Excel</a>
      </div>
      <p className="note" style={{ marginTop: -2 }}>SKU con stock en 2 o más CD y simulación para dejarlos en un solo CD. El stock en {osr} se mantiene, pero cada SKU de {osr} debe tener stock de seguridad fuera de {osr} (días de venta) en un único CD; si no lo tiene, se propone extraer la diferencia desde {osr} (como máximo la mitad de su stock, para no vaciar el automático).{r?.primero?.length > 0 && ` Si el SKU tiene stock en ${r.primero.join(' o ')}, se consolida ahí directamente (parámetro en Configuración).`} El Excel trae todos los SKU, los movimientos por ubicación y el balance por CD.</p>
      <div className="row cons-ctrl" style={{ margin: '10px 0 14px', alignItems: 'flex-end' }}>
        <fieldset className="cons-ruta">
          <legend className="lbl">Simular ruta</legend>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div><label className="lbl" htmlFor="c-de">Desde</label>
              <select id="c-de" value={f.desde} onChange={(e) => setRuta('desde')(e.target.value)}>
                <option value="">Todos los CD</option>
                {(r?.cdsRuta || []).map((cd) => <option key={cd} value={cd}>{cd}</option>)}
              </select></div>
            <span className="cons-flecha" aria-hidden="true">→</span>
            <div><label className="lbl" htmlFor="c-a">Hasta</label>
              <select id="c-a" value={f.hasta} onChange={(e) => setRuta('hasta')(e.target.value)} disabled={!f.desde}>
                <option value="">{f.desde ? 'Elegir CD' : '—'}</option>
                {(r?.cdsRuta || []).filter((cd) => cd !== f.desde).map((cd) => <option key={cd} value={cd}>{cd}</option>)}
              </select></div>
            {enRuta && <label className="inline" style={{ fontSize: 13 }}><input type="checkbox" checked={f.soloEnDestino} onChange={(e) => set('soloEnDestino')(e.target.checked)} /> Solo SKU que ya tienen stock en {f.hasta}</label>}
            {f.desde && <button className="btn sm" onClick={() => setF({ ...f, desde: '', hasta: '', estado: '' })}>Quitar ruta</button>}
          </div>
        </fieldset>
        {!enRuta && <>
          <div><label className="lbl" htmlFor="c-cr">CD destino</label>
            <select id="c-cr" value={f.criterio} onChange={(e) => set('criterio')(e.target.value)}>
              {Object.entries(r?.criterios || { unidades: 'CD con más unidades (menos movimiento)' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label className="lbl" htmlFor="c-ss">Stock de seguridad fuera de {osr} (días)</label><input id="c-ss" type="number" className="w90" min="0" value={f.diasSS} onChange={(e) => set('diasSS')(e.target.value)} /></div>
        </>}
        {cargando && <span className="note">Simulando…</span>}
      </div>
      {f.desde && !enRuta && <p className="note" style={{ marginTop: -6 }}>Elige el CD de destino para simular la ruta. Mientras tanto se muestra la consolidación general.</p>}
      {ruta && <p className="note" style={{ marginTop: -6 }}>Ruta: todo el stock de cada SKU en {ruta.desde} se mueve a {ruta.hasta}{ruta.soloEnDestino ? `, solo para los SKU que ya tienen stock en ${ruta.hasta}` : `, incluidos los SKU que hoy no están en ${ruta.hasta}`}. Los demás CD no se tocan; no aplican el criterio de destino ni la regla de prioridad.</p>}
      {r && (
        <>
          <div className="grid-kpi">
            <div className="kpi"><div className="k">SKU en 2 o más CD</div><div className="v">{fmt(r.tot.dispersos)}</div><div className="n">de {fmt(r.tot.skus)} SKU con stock · {fmt(r.tot.unCd)} ya en un solo CD</div></div>
            <div className="kpi good"><div className="k">{ruta ? `A mover ${ruta.desde} → ${ruta.hasta}` : 'A consolidar'}</div><div className="v">{fmt(r.resumen.uniMover)} u.</div><div className="n">{fmt(r.resumen.skus)} SKU · {fmt(r.resumen.ubMover)} ubicaciones de origen</div></div>
            <div className="kpi good"><div className="k">Ubicaciones que se liberan{ruta ? ` en ${ruta.desde}` : ''}</div><div className="v">{fmt(r.resumen.ubLibera)}</div><div className="n">quedan vacías al sacar el SKU</div></div>
            {ruta
              ? <div className="kpi"><div className="k">Quedan en un solo CD</div><div className="v">{fmt(r.resumen.quedanUno)}</div><div className="n">de {fmt(r.resumen.skus)} SKU de la ruta · el resto sigue también en otros CD</div></div>
              : <div className={'kpi ' + (r.resumen.extraerOsr ? 'warn' : '')}><div className="k">Stock de seguridad desde {osr}</div><div className="v">{fmt(r.resumen.extraerOsr)} u.</div><div className="n">a mover al CD de respaldo · {fmt(r.resumen.noCubreSS)} SKU de {osr} siguen sin cubrir {r.diasSS} días fuera (falta reposición)</div></div>}
          </div>
          <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)' }}>
            <table>
              <thead><tr><th>CD</th><th className="num">SKU antes</th><th className="num">SKU después</th><th className="num">Unid. salen</th><th className="num">Unid. entran</th><th className="num">Ubic. liberadas</th></tr></thead>
              <tbody>{r.balance.map((b) => (
                <tr key={b.cd}><td><b>{b.cd}</b>{b.cd === r.osr && <span className="tag" style={{ marginLeft: 6 }}>OSR</span>}{b.cd === r.cdPri && <span className="tag" style={{ marginLeft: 6 }}>prioritario</span>}</td>
                  <td className="num">{fmt(b.skusAntes)}</td><td className="num">{fmt(b.skusDespues)}</td><td className="num">{fmt(b.sale)}</td><td className="num">{fmt(b.entra)}</td><td className="num">{fmt(b.ubLibera)}</td></tr>
              ))}</tbody>
            </table>
            <table>
              <thead><tr><th>Estado</th><th className="num">SKU</th><th className="num">Unid. a mover</th></tr></thead>
              <tbody>{r.porEstado.map((e) => (
                <tr key={e.estado}><td><span className={'pill ' + TONO_ESTADO[e.estado]}>{e.estado}</span></td><td className="num">{fmt(e.skus)}</td><td className="num">{fmt(e.uni)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="row spread" style={{ margin: '14px 0 8px' }}>
            <div className="chips">
              {r.porEstado.filter((e) => e.skus).map((e) => <button key={e.estado} className="chip" aria-pressed={f.estado === e.estado} onClick={() => alt('estado', e.estado)}>{e.estado} · {fmt(e.skus)}</button>)}
            </div>
            <div className="chips">{['A', 'B', 'C'].map((a) => <button key={a} className="chip" aria-pressed={f.abc === a} onClick={() => alt('abc', a)}>Clase {a}</button>)}</div>
          </div>
          <div className="tbl" style={{ maxHeight: 420 }}>
            <table>
              <thead>
                <tr><th colSpan={4} /><th colSpan={r.cds.length + 1} className="grp">Unidades por CD hoy</th><th colSpan={7} /></tr>
                <tr><th>Clase</th><th>SKU</th><th>Descripción</th><th className="num">Venta/día</th>{r.cds.map((cd) => <th key={cd} className="num">{cd}</th>)}<th className="num">Total</th><th>CD destino</th><th className="num">Mover</th><th className="num">Libera</th><th className="num">SS req.</th><th className="num">Extraer de {osr}</th><th className="num">Fuera de {osr} después</th><th>Estado</th></tr></thead>
              <tbody>{r.detalle.map((x) => (
                <tr key={x.sku}><td><span className={'pill ' + tono(x.matriz)}>{x.matriz}</span></td><td className="mono">{x.sku}</td><td className="wrap">{x.desc}</td>
                  <td className="num">{fmt(x.ventaDia, 1)}</td>
                  {r.cds.map((cd) => <td key={cd} className={'num' + (cd === x.destino ? ' cons-dest' : '')} title={cd === x.destino ? 'CD destino' : undefined}>{x.unidades[cd] ? fmt(x.unidades[cd]) : <span className="muted">—</span>}</td>)}
                  <td className="num">{fmt(x.total)}</td>
                  <td><b>{x.destino}</b>{x.osrDespues > 0 && <span className="muted"> + {osr}</span>}<div className="note" style={{ margin: 0 }}>{x.motivoDestino}</div></td>
                  <td className="num">{fmt(x.uniMover)}</td><td className="num">{fmt(x.ubLibera)}</td>
                  <td className="num">{x.ss === null ? '—' : fmt(x.ss)}</td><td className="num">{x.extraerOsr ? <b>{fmt(x.extraerOsr)}</b> : '—'}</td>
                  <td className="num" style={x.cubreSS === false ? { color: 'var(--bad)' } : undefined} title={x.cubreSS === false ? 'No alcanza el stock de seguridad' : undefined}>{x.ssDespues === null ? '—' : fmt(x.ssDespues)}</td>
                  <td><span className={'pill ' + TONO_ESTADO[x.estado]}>{x.estado}</span></td></tr>
              ))}</tbody>
            </table>
          </div>
          {r.filtrados > r.detalle.length && <p className="note">Se muestran {fmt(r.detalle.length)} de {fmt(r.filtrados)} SKU (clase A primero, por venta diaria). El Excel trae todos.</p>}
        </>
      )}
    </div>
  );
}

const TONO_INT = { 'Queda en 1 ubicación': 'm-0', 'Consolidación parcial': 'm-2', 'No consolidable': 'm-4' };

/** SKU repartidos en varias ubicaciones de un mismo CD: simulación con el mismo motor de la asignación diaria. */
function ConsolidacionInterna() {
  const [f, setF] = useState({ cd: '', piso: '', estado: '', abc: '' });
  const [r, setR] = useState(null);
  const [cargando, setCargando] = useState(false);
  React.useEffect(() => {
    setCargando(true);
    const t = setTimeout(() => api.post('/api/optimizacion/interna/simular', f).then(setR).catch((e) => toast(e.message, true)).finally(() => setCargando(false)), 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(f)]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const alt = (k, v) => set(k)(f[k] === v ? '' : v);
  const ambito = r ? `${r.cd}${r.piso ? ' · ' + r.piso : ''}` : '';
  return (
    <div className="sec">
      <div className="row spread" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Consolidación de SKU dentro del CD{r ? ` · ${ambito}` : ''}</h2>
        <a className="btn primary" href={urlApi('/api/optimizacion/interna/excel' + qs({ cd: r?.cd || f.cd, piso: f.piso }))}>Exportar a Excel</a>
      </div>
      <p className="note" style={{ marginTop: -2 }}>SKU con stock en 2 o más ubicaciones del mismo CD y simulación para juntarlos, con la misma regla de la asignación diaria: se mueve una ubicación completa que guarda un solo SKU a otra ubicación del mismo SKU, en la misma zona y con espacio (capacidad de referencia = la ubicación con más unidades). Cada movimiento libera una ubicación. Las ubicaciones reservadas{r ? ` (${fmt(r.reservadas)})` : ''} no se consideran. El Excel trae todos los SKU, los movimientos por ubicación y el balance por piso.</p>
      <div className="row cons-ctrl" style={{ margin: '10px 0 14px', alignItems: 'flex-end' }}>
        <fieldset className="cons-ruta">
          <legend className="lbl">Simular en</legend>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div><label className="lbl" htmlFor="i-cd">CD</label>
              <select id="i-cd" value={r?.cd || f.cd} onChange={(e) => setF({ ...f, cd: e.target.value, piso: '', estado: '' })}>
                {(r?.cds || []).map((cd) => <option key={cd} value={cd}>{cd}</option>)}
              </select></div>
            <span className="cons-flecha" aria-hidden="true">›</span>
            <div><label className="lbl" htmlFor="i-pi">Piso</label>
              <select id="i-pi" value={f.piso} onChange={(e) => setF({ ...f, piso: e.target.value, estado: '' })}>
                <option value="">Todos los pisos</option>
                {(r?.pisos || []).map((pi) => <option key={pi} value={pi}>{pi}</option>)}
              </select></div>
            {f.piso && <button className="btn sm" onClick={() => setF({ ...f, piso: '', estado: '' })}>Quitar piso</button>}
          </div>
        </fieldset>
        {cargando && <span className="note">Simulando…</span>}
      </div>
      {r && (
        <>
          <div className="grid-kpi">
            <div className="kpi"><div className="k">SKU en 2 o más ubicaciones</div><div className="v">{fmt(r.tot.repartidos)}</div><div className="n">de {fmt(r.tot.skus)} SKU con stock en {r.cd} · {fmt(r.tot.unaUb)} ya en una sola ubicación</div></div>
            <div className="kpi good"><div className="k">A consolidar en {ambito}</div><div className="v">{fmt(r.resumen.uniMover)} u.</div><div className="n">{fmt(r.porEstado.filter((e) => e.estado !== 'No consolidable').reduce((s, e) => s + e.skus, 0))} SKU · {fmt(r.resumen.movimientos)} movimientos</div></div>
            <div className="kpi good"><div className="k">Ubicaciones que se liberan</div><div className="v">{fmt(r.resumen.ubLibera)}</div><div className="n">una por movimiento: la ubicación de origen queda vacía</div></div>
            <div className="kpi"><div className="k">Quedan en 1 ubicación</div><div className="v">{fmt(r.resumen.quedanUna)}</div><div className="n">de {fmt(r.resumen.skus)} SKU repartidos · el resto queda en menos ubicaciones o no se puede juntar</div></div>
          </div>
          <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)' }}>
            <table>
              <thead><tr><th>Piso</th><th className="num">SKU repartidos</th><th className="num">Movimientos</th><th className="num">Unid. a mover</th><th className="num">Ubic. liberadas</th></tr></thead>
              <tbody>
                {r.balance.map((b) => (
                  <tr key={b.piso}><td><b>{b.piso}</b></td><td className="num">{fmt(b.skus)}</td><td className="num">{fmt(b.movimientos)}</td><td className="num">{fmt(b.uni)}</td><td className="num">{fmt(b.ubLibera)}</td></tr>
                ))}
                {r.balance.length > 1 && <tr className="tot"><td>Total</td><td /><td className="num">{fmt(r.resumen.movimientos)}</td><td className="num">{fmt(r.resumen.uniMover)}</td><td className="num">{fmt(r.resumen.ubLibera)}</td></tr>}
              </tbody>
            </table>
            <table>
              <thead><tr><th>Estado</th><th className="num">SKU</th><th className="num">Unid. a mover</th></tr></thead>
              <tbody>{r.porEstado.map((e) => (
                <tr key={e.estado}><td><span className={'pill ' + TONO_INT[e.estado]}>{e.estado}</span></td><td className="num">{fmt(e.skus)}</td><td className="num">{fmt(e.uni)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="row spread" style={{ margin: '14px 0 8px' }}>
            <div className="chips">
              {r.porEstado.filter((e) => e.skus).map((e) => <button key={e.estado} className="chip" aria-pressed={f.estado === e.estado} onClick={() => alt('estado', e.estado)}>{e.estado} · {fmt(e.skus)}</button>)}
            </div>
            <div className="chips">{['A', 'B', 'C'].map((a) => <button key={a} className="chip" aria-pressed={f.abc === a} onClick={() => alt('abc', a)}>Clase {a}</button>)}</div>
          </div>
          <div className="tbl" style={{ maxHeight: 420 }}>
            <table>
              <thead>
                <tr><th colSpan={4} /><th colSpan={r.pisos.length + 1} className="grp">Unidades por piso hoy</th><th colSpan={6} /></tr>
                <tr><th>Clase</th><th>SKU</th><th>Descripción</th><th className="num">Venta/día</th>{r.pisos.map((pi) => <th key={pi} className="num">{pi}</th>)}<th className="num">Total</th>
                  <th className="num">Ubic. antes</th><th className="num">Movim.</th><th className="num">Mover</th><th className="num">Ubic. después</th><th>Ubicaciones destino</th><th>Estado</th></tr>
              </thead>
              <tbody>{r.detalle.map((x) => (
                <tr key={x.sku}><td><span className={'pill ' + tono(x.matriz)}>{x.matriz}</span></td><td className="mono">{x.sku}</td><td className="wrap">{x.desc}</td>
                  <td className="num">{fmt(x.ventaDia, 1)}</td>
                  {r.pisos.map((pi) => <td key={pi} className={'num' + (r.piso === pi ? ' cons-dest' : '')}>{x.porPiso[pi] ? fmt(x.porPiso[pi]) : <span className="muted">—</span>}</td>)}
                  <td className="num">{fmt(x.total)}</td>
                  <td className="num">{fmt(x.nUb)}</td><td className="num">{x.nMov ? fmt(x.nMov) : '—'}</td><td className="num">{x.uniMover ? <b>{fmt(x.uniMover)}</b> : '—'}</td>
                  <td className="num">{fmt(x.ubDespues)}</td>
                  <td className="mono note">{x.destinos.slice(0, 3).join(', ')}{x.destinos.length > 3 ? ` +${x.destinos.length - 3}` : ''}</td>
                  <td><span className={'pill ' + TONO_INT[x.estado]}>{x.estado}</span>{x.motivo && <div className="note" style={{ margin: 0 }}>{x.motivo}</div>}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {r.filtrados > r.detalle.length && <p className="note">Se muestran {fmt(r.detalle.length)} de {fmt(r.filtrados)} SKU (clase A primero, por movimientos). El Excel trae todos.</p>}
        </>
      )}
    </div>
  );
}

export default function Optimizacion({ irA }) {
  const [d, err, rec] = useCarga(() => api.get('/api/optimizacion'), []);
  const [ver, setVer] = useState('traer');
  if (err) return <><div className="top"><h1>Optimización ABC</h1></div><div className="alert warn">{err}</div></>;
  if (!d) return <p className="muted">Cruzando la clasificación ABC/XYZ con la Base…</p>;
  const R = d.reasignacion;
  const pri = d.cdPri;
  const cPri = d.cds.find((c) => c.cd === pri);
  const tot = (k) => d.cds.reduce((s, c) => s + k(c), 0);
  const enCola = (tipo) => d.cola.filter((x) => x.tipo === tipo).reduce((s, x) => s + x.n, 0);
  const generar = async (tipo, limite) => {
    try {
      const r = await api.post('/api/optimizacion/reasignar', { tipo, limite });
      toast(`${fmt(r.tareas)} tareas en cola (${fmt(r.skus)} SKU) hacia ${r.destino}. Entran a la próxima asignación diaria.`);
      rec();
    } catch (e) { toast(e.message, true); }
  };
  const vaciarReu = async () => { await api.del('/api/slow/cola?tipo=REU'); toast('Reubicaciones en cola eliminadas.'); rec(); };
  const consLib = tot((c) => c.cons.A.libera + c.cons.B.libera + c.cons.C.libera);
  const suTot = tot((c) => c.su.A + c.su.B + c.su.C);
  const invDia = d.inventario.reduce((s, x) => s + x.porDia, 0);

  return (
    <>
      <div className="top">
        <div>
          <h1>Optimización con ABC / XYZ</h1>
          <div className="sub">Base del {fFecha(d.carga.fecha)} · clasificación consolidada por SKU (XYZ por {d.metodo === 'historia' ? 'variabilidad mensual' : 'rotación'}). Cruza la clase de cada SKU con dónde está almacenado para priorizar las tareas del día.</div>
        </div>
        <button className="btn" onClick={() => irA('abc')}>Ver matriz ABC / XYZ</button>
      </div>

      <div className="grid-kpi">
        <div className="kpi good"><div className="k">Alta rotación fuera de {pri}</div><div className="v">{fmt(R.traer.skus)}</div><div className="n">SKU {d.clasesTraer.join('/')} en {fmt(R.traer.ubic)} ubicaciones de otros CD</div></div>
        <div className="kpi warn"><div className="k">Espacio CZ en {pri}</div><div className="v">{fmt(R.liberar.libera)}</div><div className="n">ubicaciones que se liberan sacando {fmt(R.liberar.skus)} SKU sin venta</div></div>
        <div className="kpi"><div className="k">Consolidación</div><div className="v">{fmt(consLib)}</div><div className="n">ubicaciones liberables juntando SKU repartidos</div></div>
        <div className="kpi"><div className="k">Inventario cíclico</div><div className="v">{fmt(invDia)}</div><div className="n">ubicaciones por día (A cada {d.dias.A} d, B {d.dias.B} d, C {d.dias.C} d)</div></div>
      </div>

      <div className="sec">
        <h2>Cómo se reparten las clases en cada CD</h2>
        <div className="tbl">
          <table>
            <thead><tr><th>CD</th><th className="num">Ubicaciones</th><th style={{ minWidth: 260 }}>Ubicaciones por clase ABC</th><th className="num">Unid. clase A</th><th className="num">Ubic. solo CZ</th><th className="num">SKU</th><th className="num">Unidades</th></tr></thead>
            <tbody>{d.cds.map((c) => (
              <tr key={c.cd}>
                <td><b>{c.cd}</b>{c.cd === pri && <span className="tag" style={{ marginLeft: 6 }}>prioritario</span>}{d.excluidos.includes(c.cd) && <span className="tag" style={{ marginLeft: 6 }}>excluido</span>}</td>
                <td className="num">{fmt(c.ubic)}</td><td><Apilada v={c.ubicAbc} /></td>
                <td className="num">{pc(c.uniAbc.A, c.uni)}</td>
                <td className="num">{fmt(c.cz.ubic)} <span className="muted">({pc(c.cz.ubic, c.ubic)})</span></td>
                <td className="num">{fmt(c.skus)}</td><td className="num">{fmt(c.uni)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="note">La clase de una ubicación es la mejor clase de los SKU que guarda. "Ubic. solo CZ" = ubicaciones ocupadas únicamente por SKU sin venta en 2 meses: espacio recuperable vía slow moving.</p>
      </div>

      <div className="sec">
        <div className="row spread" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Reasignación de stock en {pri} (más cerca de OSR y empaque)</h2>
          <div className="chips">
            <button className="chip" aria-pressed={ver === 'traer'} onClick={() => setVer('traer')}>Traer alta rotación ({fmt(R.traer.skus)})</button>
            <button className="chip" aria-pressed={ver === 'liberar'} onClick={() => setVer('liberar')}>Liberar CZ de {pri} ({fmt(R.liberar.skus)})</button>
          </div>
        </div>
        {!d.existePri && <div className="alert warn">{pri} no aparece en la Base. Cambia el "CD prioritario" en Configuración.</div>}
        <div className="flujo">
          <div><b>1 · Liberar</b><span>Sacar de {pri} los {fmt(R.liberar.skus)} SKU CZ → libera {fmt(R.liberar.libera)} ubicaciones (tareas slow moving).</span></div>
          <div><b>2 · Traer</b><span>Mover a {pri} los {fmt(R.traer.skus)} SKU {d.clasesTraer.join('/')} de otros CD → requieren ~{fmt(R.traer.ubic)} ubicaciones (tareas de reubicación).</span></div>
          <div className={R.liberar.libera >= R.traer.ubic ? 'ok' : 'warn'}><b>Balance</b><span>{R.liberar.libera >= R.traer.ubic ? `Alcanza: sobran ${fmt(R.liberar.libera - R.traer.ubic)} ubicaciones.` : `Faltan ${fmt(R.traer.ubic - R.liberar.libera)} ubicaciones: priorizar AX y consolidar ${pri}.`}</span></div>
        </div>
        {ver === 'traer' ? (
          <>
            <div className="row spread" style={{ margin: '10px 0' }}>
              <p className="note" style={{ margin: 0 }}>Ordenados por venta. Cada ubicación de origen genera una tarea "Reubicación ABC" con destino {pri}, en el turno de slow moving del CD de origen.</p>
              <Generar etiqueta={`Generar reubicaciones a ${pri}`} total={R.traer.skus} onGenerar={(n) => generar('traer', n)} />
            </div>
            <div className="tbl" style={{ maxHeight: 380 }}>
              <table>
                <thead><tr><th>Clase</th><th>CD origen</th><th>SKU</th><th>Descripción</th><th className="num">Ventas 2m</th><th className="num">Unidades</th><th className="num">Ubic.</th><th className="num">Ya en {pri}</th><th>Ubicaciones</th></tr></thead>
                <tbody>{R.traer.detalle.map((x) => (
                  <tr key={x.cd + x.sku}><td><span className={'pill ' + tono(x.matriz)}>{x.matriz}</span></td><td>{x.cd}</td><td className="mono">{x.sku}</td><td className="wrap">{x.desc}</td>
                    <td className="num">{fmt(x.ventas)}</td><td className="num">{fmt(x.uni)}</td><td className="num">{x.nUb}</td><td className="num">{x.enPri ? fmt(x.enPri) : '—'}</td><td className="mono note">{x.ubic.join(', ')}{x.nUb > 4 ? '…' : ''}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="row spread" style={{ margin: '10px 0' }}>
              <p className="note" style={{ margin: 0 }}>Ordenados por ubicaciones que liberan. Cada ubicación genera una tarea de slow moving hacia la zona de slow moving.</p>
              <Generar etiqueta={`Generar extracción CZ de ${pri}`} total={R.liberar.skus} onGenerar={(n) => generar('liberar', n)} />
            </div>
            <div className="tbl" style={{ maxHeight: 380 }}>
              <table>
                <thead><tr><th>Clase</th><th>SKU</th><th>Descripción</th><th>Depto</th><th className="num">Unidades</th><th className="num">Ubic.</th><th className="num">Libera</th><th>Ubicaciones</th></tr></thead>
                <tbody>{R.liberar.detalle.map((x) => (
                  <tr key={x.sku}><td><span className={'pill ' + tono(x.matriz)}>{x.matriz}</span></td><td className="mono">{x.sku}</td><td className="wrap">{x.desc}</td><td>{x.depto}</td>
                    <td className="num">{fmt(x.uni)}</td><td className="num">{x.nUb}</td><td className="num">{x.libera}</td><td className="mono note">{x.ubic.join(', ')}{x.nUb > 4 ? '…' : ''}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}
        <div className="row spread" style={{ marginTop: 10 }}>
          <p className="note" style={{ margin: 0 }}>En cola para la próxima asignación: {fmt(enCola('REU'))} reubicaciones · {fmt(enCola('SM'))} slow moving.</p>
          {enCola('REU') > 0 && <button className="btn sm danger" onClick={vaciarReu}>Vaciar reubicaciones</button>}
        </div>
      </div>

      <ConsolidacionCds />

      <ConsolidacionInterna />

      <div className="viz-row">
        <div className="sec">
          <h2>Consolidación por clase</h2>
          <table>
            <thead><tr><th>CD</th>{['A', 'B', 'C'].map((a) => <th key={a} className="num">Clase {a}</th>)}</tr></thead>
            <tbody>{d.cds.map((c) => (
              <tr key={c.cd}><td>{c.cd}</td>{['A', 'B', 'C'].map((a) => <td key={a} className="num">{fmt(c.cons[a].libera)} <span className="muted">ubic · {fmt(c.cons[a].skus)} SKU</span></td>)}</tr>
            ))}</tbody>
          </table>
          <p className="note">Ubicaciones que se liberan juntando cada SKU en una sola ubicación del CD. La asignación diaria ahora consolida primero los SKU clase A (picking más frecuente y menos recorrido), y cada tarea lleva su clase en el detalle.</p>
        </div>
        <div className="sec">
          <h2>Stock unitario por clase</h2>
          <table>
            <thead><tr><th>CD</th>{['A', 'B', 'C'].map((a) => <th key={a} className="num">{a}</th>)}</tr></thead>
            <tbody>{d.cds.filter((c) => !d.excluidos.includes(c.cd)).map((c) => (
              <tr key={c.cd}><td>{c.cd}</td>{['A', 'B', 'C'].map((a) => <td key={a} className="num">{fmt(c.su[a])}</td>)}</tr>
            ))}</tbody>
          </table>
          <p className="note">{fmt(suTot)} SKU con 1 unidad en 1 ubicación. Clase C: llevarlos a las reservadas libera la ubicación completa. Clase A: la última unidad de un SKU que vende → alerta de reposición antes que reubicación.</p>
        </div>
      </div>

      <div className="viz-row">
        <div className="sec">
          <h2>Inventario cíclico por clase</h2>
          <table>
            <thead><tr><th>CD</th><th className="num">Ubic. A</th><th className="num">Ubic. B</th><th className="num">Ubic. C</th><th className="num">Ubic. / día</th></tr></thead>
            <tbody>{d.inventario.map((x) => (
              <tr key={x.cd}><td>{x.cd}</td><td className="num">{fmt(x.ubicAbc.A)}</td><td className="num">{fmt(x.ubicAbc.B)}</td><td className="num">{fmt(x.ubicAbc.C)}</td><td className="num"><b>{fmt(x.porDia)}</b></td></tr>
            ))}</tbody>
          </table>
          <p className="note">Contar más seguido lo que más se mueve: A cada {d.dias.A} días, B cada {d.dias.B}, C cada {d.dias.C} (Configuración). Hoy el ciclo recorre todas las zonas por igual.</p>
        </div>
        <div className="sec">
          <h2>Flujo del día con ABC / XYZ</h2>
          <ol className="steps">
            <li className="ok"><span className="n">1</span><div><b>Cargar Base y clasificar</b><div className="note">La matriz ABC/XYZ se recalcula con cada Base.</div></div></li>
            <li className="ok"><span className="n">2</span><div><b>Liberar espacio en {pri}</b><div className="note">CZ de {pri} a slow moving ({fmt(R.liberar.libera)} ubicaciones).</div></div></li>
            <li className="ok"><span className="n">3</span><div><b>Acercar la alta rotación</b><div className="note">AX/AY/BX de otros CD a {pri}, junto a OSR y empaque.</div></div></li>
            <li className="ok"><span className="n">4</span><div><b>Consolidar primero clase A</b><div className="note">Menos ubicaciones por SKU de alta venta = picking más corto.</div></div></li>
            <li className="ok"><span className="n">5</span><div><b>Stock unitario y conteo por clase</b><div className="note">C unitario a reservadas; A con conteo más frecuente.</div></div></li>
          </ol>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => irA('hoy')}>Ir a la asignación del día</button>
        </div>
      </div>
    </>
  );
}
