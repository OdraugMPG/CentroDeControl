// Optimización ABC → Dispersión de stock entre CD: SKU con stock en 2 o más CD, cómo se reparte su stock en cada CD y qué
// participación tiene cada CD en su venta (archivo de picking por CD). Muestra si el stock está donde se vende.
import React, { useEffect, useState } from 'react';
import { api, qs, urlApi, fmt, fFecha } from './api.js';
import { toast } from './ui.jsx';

const pct1 = (v) => `${fmt(v * 100, 1)}%`;
const ORDENES = [['sinVentaU', 'Stock en CD sin venta'], ['sTot', 'Stock total'], ['vTot', 'Venta'], ['calce', 'Peor calce stock / venta'], ['ubTot', 'Ubicaciones'], ['n', 'N° de CD']];

/** Dos barras: % del stock y % de la venta del CD. */
function Par({ s, v }) {
  return (
    <div className="dp-par">
      <div><i className="dp-s" style={{ width: `${Math.min(100, s * 100)}%` }} /><span>{pct1(s)}</span></div>
      <div><i className="dp-v" style={{ width: `${Math.min(100, v * 100)}%` }} /><span>{pct1(v)}</span></div>
    </div>
  );
}

export default function DispersionCds() {
  const [f, setF] = useState({ desde: '', hasta: '', n: '', cd: '', depto: '', buscar: '', sinVenta: false, orden: 'sinVentaU' });
  const [r, setR] = useState(null);
  const [cargando, setCargando] = useState(false);
  useEffect(() => {
    setCargando(true);
    const t = setTimeout(() => api.post('/api/optimizacion/dispersion', f).then(setR).catch((e) => toast(e.message, true)).finally(() => setCargando(false)), 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(f)]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const alt = (k, v) => set(k)(f[k] === v ? '' : v);
  if (!r) return <div className="sec"><h2 style={{ marginTop: 0 }}>Dispersión de stock y venta por CD</h2><p className="note">{cargando ? 'Cruzando la Base con el picking por CD…' : ''}</p></div>;
  if (r.sinBase) return <div className="sec"><h2 style={{ marginTop: 0 }}>Dispersión de stock y venta por CD</h2><div className="alert warn">No hay Base de stock cargada.</div></div>;
  const t = r.tot;
  const excel = urlApi('/api/optimizacion/dispersion/excel' + qs({ ...f, sinVenta: f.sinVenta ? '1' : '' }));
  return (
    <div className="sec">
      <div className="row spread" style={{ alignItems: 'flex-start', marginBottom: 6, gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Dispersión de stock y venta por CD</h2>
          <p className="note" style={{ margin: '2px 0 0' }}>Base del {fFecha(r.carga.fecha)} · venta del archivo de picking por CD{r.venta.hay ? ` del ${fFecha(r.venta.desde)} al ${fFecha(r.venta.hasta)} (${fmt(r.venta.dias)} días)` : ': sin datos en el período'}{cargando ? ' · calculando…' : ''}</p>
        </div>
        <a className="btn primary" href={excel}>Exportar a Excel</a>
      </div>
      <p className="note" style={{ marginTop: 0 }}>SKU con stock en 2 o más CD: cuánto de su stock está en cada CD y cuánto de su venta sale de cada CD. Si un CD tiene stock del SKU pero no lo vende, ese stock está inmovilizado y conviene consolidarlo en el CD que lo vende (simúlalo arriba, en Consolidación de SKU entre CD).</p>

      {!r.venta.hay && <div className="alert warn">No hay picking por CD en el período elegido: la participación de venta queda en 0. Carga el archivo de picking en Datos o cambia las fechas.</div>}

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', margin: '8px 0' }}>
        <div><label className="lbl" htmlFor="dp-d">Venta desde</label><input id="dp-d" type="date" value={f.desde} onChange={(e) => set('desde')(e.target.value)} /></div>
        <div><label className="lbl" htmlFor="dp-h">Venta hasta</label><input id="dp-h" type="date" value={f.hasta} onChange={(e) => set('hasta')(e.target.value)} /></div>
        <div><span className="lbl">N° de CD con stock</span>
          <div className="chips">{[['', 'Todos'], ['2', '2 CD'], ['3', '3 CD'], ['4', '4 o más']].map(([k, x]) => <button key={k} className="chip" aria-pressed={f.n === k} onClick={() => set('n')(k)}>{x}</button>)}</div></div>
        <div><span className="lbl">Con stock en</span>
          <div className="chips">{r.cds.map((c) => <button key={c} className="chip" aria-pressed={f.cd === c} onClick={() => alt('cd', c)}>{c}</button>)}</div></div>
        <div><label className="lbl" htmlFor="dp-dep">Depto</label>
          <select id="dp-dep" value={f.depto} style={{ maxWidth: 230 }} onChange={(e) => set('depto')(e.target.value)}><option value="">Todos</option>{r.deptos.map((d) => <option key={d}>{d}</option>)}</select></div>
        <div><label className="lbl" htmlFor="dp-b">Buscar SKU o descripción</label><input id="dp-b" type="search" value={f.buscar} onChange={(e) => set('buscar')(e.target.value)} /></div>
        <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <input type="checkbox" checked={f.sinVenta} onChange={(e) => set('sinVenta')(e.target.checked)} />Solo con stock en un CD sin venta</label>
      </div>

      <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,3fr)', alignItems: 'start' }}>
        <div className="tbl">
          <table>
            <thead><tr><th>SKU con stock</th><th className="num">SKU</th><th className="num">Stock</th><th className="num">Ubic.</th><th className="num">Venta</th></tr></thead>
            <tbody>
              <tr><td>En un solo CD</td><td className="num">{fmt(t.unCd)}</td><td className="num">{fmt(t.sTot - t.sDisp)}</td><td /><td className="num">{fmt(t.vTot - t.vDisp)}</td></tr>
              {r.porN.filter((x) => x.skus).map((x) => (
                <tr key={x.n} className={f.n === String(x.n) ? 'sel' : ''}><td><a href="#" onClick={(e) => { e.preventDefault(); alt('n', String(x.n)); }}>En {x.n === 4 ? '4 o más' : x.n} CD</a></td>
                  <td className="num">{fmt(x.skus)}</td><td className="num">{fmt(x.s)}</td><td className="num">{fmt(x.ub)}</td><td className="num">{fmt(x.v)}</td></tr>))}
              <tr className="tot"><td>En 2 o más CD</td><td className="num">{fmt(t.disp)} <span className="muted">({pct1(t.skus ? t.disp / t.skus : 0)})</span></td><td className="num">{fmt(t.sDisp)}</td><td className="num">{fmt(t.ubDisp)}</td><td className="num">{fmt(t.vDisp)}</td></tr>
            </tbody>
          </table>
          <p className="note" style={{ margin: '6px 0 0' }}>De los SKU en 2 o más CD, <b>{fmt(t.sinVentaSkus)}</b> tienen stock en algún CD que no los vendió en el período: <b>{fmt(t.sinVentaU)} u.</b> ({pct1(t.sDisp ? t.sinVentaU / t.sDisp : 0)} de su stock).</p>
        </div>
        <div className="tbl">
          <table className="dp-cd">
            <thead><tr><th>CD</th><th className="num">SKU con stock</th><th className="num">Stock</th><th style={{ minWidth: 190 }}><span className="dp-ley"><i className="dp-s" />% del stock <i className="dp-v" />% de la venta</span></th>
              <th className="num" title="Puntos de venta menos puntos de stock: positivo = vende más de lo que guarda">Venta − stock</th><th className="num">SKU sin venta en el CD</th><th className="num">Stock sin venta</th><th className="num" title="SKU en los que es el CD que más vende">Principal en venta</th></tr></thead>
            <tbody>{r.porCd.map((c) => {
              const d = c.pctV - c.pctS;
              return (
                <tr key={c.cd} className={f.cd === c.cd ? 'sel' : ''}>
                  <td><a href="#" onClick={(e) => { e.preventDefault(); alt('cd', c.cd); }}><b>{c.cd}</b></a></td>
                  <td className="num">{fmt(c.skus)}</td><td className="num">{fmt(c.s)}</td><td><Par s={c.pctS} v={c.pctV} /></td>
                  <td className="num"><span className={'dp-d ' + (d > 0.0005 ? 'up' : d < -0.0005 ? 'dn' : '')}>{d > 0 ? '+' : d < 0 ? '−' : ''}{fmt(Math.abs(d) * 100, 1)} pts</span></td>
                  <td className="num">{fmt(c.sinVentaSkus)}</td><td className="num">{fmt(c.sinVentaU)}</td><td className="num">{fmt(c.principalVenta)}</td>
                </tr>);
            })}</tbody>
          </table>
          <p className="note" style={{ margin: '6px 0 0' }}>Sobre los SKU en 2 o más CD con los filtros elegidos ({fmt(r.filtrados)} SKU, {fmt(r.sSel)} u. de stock, {fmt(r.vSel)} u. vendidas). Un CD con más % de stock que de venta guarda stock que se vende desde otro CD.</p>
        </div>
      </div>

      <h4 style={{ margin: '14px 0 6px' }}>Combinaciones de CD más frecuentes</h4>
      <div className="tbl" style={{ maxHeight: 260 }}>
        <table>
          <thead><tr><th>CD con stock</th><th className="num">SKU</th><th className="num">Stock</th><th className="num">Venta</th><th className="num">Stock en CD sin venta</th></tr></thead>
          <tbody>{r.combos.map((x) => <tr key={x.combo}><td>{x.combo}</td><td className="num">{fmt(x.skus)}</td><td className="num">{fmt(x.s)}</td><td className="num">{fmt(x.v)}</td><td className="num">{fmt(x.sinVentaU)}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="row spread" style={{ alignItems: 'flex-end', margin: '14px 0 6px', gap: 10 }}>
        <h4 style={{ margin: 0 }}>Por SKU · {fmt(r.filtrados)}</h4>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          {r.filtrados > r.lista.length && <span className="note">Se muestran los primeros {fmt(r.lista.length)}; el Excel trae todos.</span>}
          <div><label className="lbl" htmlFor="dp-o">Ordenar por</label>
            <select id="dp-o" value={f.orden} onChange={(e) => set('orden')(e.target.value)}>{ORDENES.map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></div>
        </div>
      </div>
      <div className="tbl">
        <table className="dp-sku">
          <thead>
            <tr><th>SKU</th><th>Descripción</th><th className="num">CD</th><th className="num">Stock</th><th className="num">Venta</th>
              {r.cds.map((c) => <th key={c} className="num">{c}<div className="note" style={{ margin: 0, fontWeight: 400 }}>stock (u.) · % venta</div></th>)}
              <th className="num">Stock en CD sin venta</th><th className="num" title="Qué parte del stock está en los CD en la misma proporción en que se vende (100% = calza)">Calce</th><th className="num">Días de cobertura</th></tr>
          </thead>
          <tbody>{r.lista.map((x) => (
            <tr key={x.sku}>
              <td><b>{x.sku}</b></td><td className="wrap">{x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></td>
              <td className="num">{x.n}</td><td className="num">{fmt(x.sTot)}</td><td className="num">{fmt(x.vTot)}</td>
              {r.cds.map((c) => {
                const s = x.s[c] || 0, v = x.v[c] || 0;
                if (!s && !v) return <td key={c} className="num muted">—</td>;
                const mal = s > 0 && !v && x.vTot > 0;
                return (
                  <td key={c} className={'num' + (mal ? ' dp-mal' : '')} title={`${c}: ${fmt(s)} u. de stock · ${fmt(v)} u. vendidas`}>
                    {s ? fmt(s) : '—'} · <b>{x.vTot ? (v ? pct1(v / x.vTot) : '0%') : '—'}</b>
                  </td>);
              })}
              <td className="num">{x.sinVentaU ? <b>{fmt(x.sinVentaU)}</b> : '—'}{x.sinVentaCds.length ? <div className="note" style={{ margin: 0 }}>{x.sinVentaCds.join(', ')}</div> : null}</td>
              <td className="num">{x.calce === null ? <span className="muted">sin venta</span> : pct1(x.calce)}</td>
              <td className="num">{x.cobertura === null ? '—' : fmt(x.cobertura)}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <p className="note">En cada CD: unidades de stock del SKU que hay ahí · % de su venta que salió de ahí. En rojo, CD con stock que no vendió el SKU (aunque sí se vendió en otro CD). Calce = suma, por CD, del menor entre su % de stock y su % de venta: 100% si el stock está repartido igual que la venta. Días de cobertura = stock total ÷ venta por día del período.</p>
    </div>
  );
}
