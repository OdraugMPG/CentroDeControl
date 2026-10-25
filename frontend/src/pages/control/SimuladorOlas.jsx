// Simulador de olas: reemplaza la tabla dinámica (segmentadores, filas, columnas, valor y detalle por celda)
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Kpis, Card, Cargando, PageHead, Segmentador } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { N, css, fechaHora, REGIONES } from '../../lib/fmt.js';

// Mismos segmentadores que la planilla de Excel
const VISIBLES = ['fecha_eta_cliente', 'tipo_orden', 'especial', 'tipo_ola', 'cd', 'tipo_picking', 'region'];
const CONFIG = { filas: 'fecha_salida', columnas: 'tipo_picking', medida: 'qty', visibles: VISIBLES };
const PAL = ['--blue', '--yellow', '--teal', '--violet', '--red', '--slate', '--muted'];
const CLAVE = 'cc-olas';

const leer = () => { try { return { ...CONFIG, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') }; } catch { return CONFIG; } };
const etiqueta = k => v => k === 'region' && REGIONES[v] ? `${v} ${REGIONES[v]}` : v;
const aListas = f => Object.fromEntries(Object.entries(f).filter(([, s]) => s.size).map(([k, s]) => [k, [...s]]));

function descargarCSV(p, nombre) {
  const cols = p.columnas ? p.claveColumnas : [];
  const celda = v => /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  const filas = [[nombre(p.filas), ...cols, 'Total general'],
    ...p.claveFilas.map(f => [f, ...cols.map(c => p.valores[f]?.[c] ?? ''), p.totFila[f]]),
    ['Total general', ...cols.map(c => p.totCol[c]), p.total]];
  const blob = new Blob(['﻿' + filas.map(r => r.map(celda).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'simulador-olas.csv' });
  a.click(); URL.revokeObjectURL(a.href);
}

export default function SimuladorOlas() {
  const m = useCarga(() => api.get('/olas'), []);
  const [cfg, setCfg] = useState(leer);
  const [filtros, setFiltros] = useState({});
  const [piv, setPiv] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(null);
  const [det, setDet] = useState(null);
  const detalle = useRef(null);
  const cargaId = m.data?.carga?.id;

  useEffect(() => { try { localStorage.setItem(CLAVE, JSON.stringify(cfg)); } catch { /* sin almacenamiento */ } }, [cfg]);

  useEffect(() => {
    if (!cargaId) return;
    let vivo = true;
    api.post('/olas/pivot', { filtros: aListas(filtros), filas: cfg.filas, columnas: cfg.columnas || null, medida: cfg.medida })
      .then(d => { if (vivo) { setPiv(d); setErr(null); } }).catch(e => vivo && setErr(e.message));
    return () => { vivo = false; };
  }, [cargaId, filtros, cfg.filas, cfg.columnas, cfg.medida]);

  // Detalle de la celda seleccionada
  useEffect(() => {
    if (!sel || !cargaId) { setDet(null); return; }
    let vivo = true;
    const f = aListas(filtros);
    if (sel.f !== undefined) f[cfg.filas] = [sel.f];
    if (sel.c !== undefined && cfg.columnas) f[cfg.columnas] = [sel.c];
    api.post('/olas/detalle', { filtros: f, limite: 500 }).then(d => vivo && setDet(d)).catch(e => vivo && setDet({ error: e.message }));
    return () => { vivo = false; };
  }, [sel, cargaId, filtros, cfg.filas, cfg.columnas]);

  if (!m.data) return <Cargando error={m.error} />;
  const { carga, campos, medidas, valores } = m.data;
  if (!carga) return <><PageHead title="Simulador de olas" /><Card><p className="empty">Aún no se ha cargado el simulador de olas. <Link to="/cargas">Cárgalo en Datos</Link>.</p></Card></>;

  const nombre = k => campos.find(c => c.key === k)?.label || k;
  const lista = campos.filter(c => c.lista);
  const set = cambios => { setCfg({ ...cfg, ...cambios }); setSel(null); };
  const setFiltro = (k, s) => { setFiltros({ ...filtros, [k]: s }); setSel(null); };
  const nf = Object.values(filtros).reduce((s, x) => s + x.size, 0);
  const ir = s => { setSel(s); setTimeout(() => detalle.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const esSel = (f, c) => sel && sel.f === f && sel.c === c;

  const p = piv && piv.filas === cfg.filas && (piv.columnas || '') === (cfg.columnas || '') ? piv : null;
  const cols = p?.columnas ? p.claveColumnas : [];
  const max = p ? Math.max(1, ...p.claveFilas.flatMap(f => cols.length ? cols.map(c => p.valores[f]?.[c] || 0) : [p.totFila[f]])) : 1;
  const heat = v => ({ background: v ? `color-mix(in srgb, var(--blue) ${Math.round(12 + v / max * 78)}%, transparent)` : 'transparent',
    ...(v / max > 0.5 ? { color: '#fff', fontWeight: 600 } : {}) });
  const etF = etiqueta(cfg.filas), etC = etiqueta(cfg.columnas);
  const k = p?.kpis;

  return (
    <>
      <PageHead title="Simulador de olas" sub={`${carga.archivo}, cargado ${fechaHora(new Date(carga.cargado_en).getTime())}${carga.cargado_por ? ` por ${carga.cargado_por}` : ''}`} />

      <div className="filters" aria-label="Filtros del simulador">
        {cfg.visibles.filter(x => valores[x]).map(x => (
          <Segmentador key={x} label={nombre(x)} valores={valores[x]} sel={filtros[x] || new Set()} etiqueta={etiqueta(x)}
            conDatos={p?.disponibles?.[x] && new Set(p.disponibles[x])} onChange={s => setFiltro(x, s)} />))}
        <select aria-label="Agregar filtro" style={{ width: 'auto' }} value="" onChange={e => e.target.value && set({ visibles: [...cfg.visibles, e.target.value] })}>
          <option value="">+ Agregar filtro</option>
          {lista.filter(c => !cfg.visibles.includes(c.key)).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        {nf > 0 && <button type="button" className="ghost" onClick={() => { setFiltros({}); setSel(null); }}>Limpiar filtros</button>}
        {cfg.visibles.join() !== VISIBLES.join() && <button type="button" className="link" onClick={() => set({ visibles: VISIBLES })}>Filtros por defecto</button>}
      </div>

      <Kpis items={[
        ['Unidades', k ? N(k.unidades) : '…'], ['Líneas', k ? N(k.lineas) : '…'], ['OD', k ? N(k.ods) : '…'], ['SKU', k ? N(k.skus) : '…'],
        ['Fechas de salida', k?.desde ? (k.desde === k.hasta ? k.desde : `${k.desde} a ${k.hasta}`) : '—']]} />

      <Card title="Tabla dinámica" hint="Toca una celda o un total para ver las líneas que la componen."
        actions={p && <button type="button" className="ghost" onClick={() => descargarCSV(p, nombre)}>Descargar CSV</button>}>
        <div className="pivot-cfg">
          <label className="field"><span>Filas</span>
            <select value={cfg.filas} onChange={e => set({ filas: e.target.value, columnas: cfg.columnas === e.target.value ? '' : cfg.columnas })}>
              {campos.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select></label>
          <button type="button" className="ghost" title="Intercambiar filas y columnas" disabled={!cfg.columnas}
            onClick={() => set({ filas: cfg.columnas, columnas: cfg.filas })}>⇄</button>
          <label className="field"><span>Columnas</span>
            <select value={cfg.columnas || ''} onChange={e => set({ columnas: e.target.value })}>
              <option value="">(ninguna)</option>
              {campos.filter(c => c.key !== cfg.filas).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select></label>
          <label className="field"><span>Valor</span>
            <select value={cfg.medida} onChange={e => set({ medida: e.target.value })}>
              {medidas.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select></label>
        </div>
        {err && <p className="msg err" role="alert">{err}</p>}
        {!p ? <Cargando /> : p.claveFilas.length ? <div className="tscroll" style={{ marginTop: 12 }}><table className="heat">
          <thead><tr><th>{nombre(p.filas)}</th>{cols.map(c => <th key={c} className="c">{etC(c)}</th>)}<th className="num">Total general</th></tr></thead>
          <tbody>{p.claveFilas.map(f => (
            <tr key={f}><td>{etF(f)}</td>
              {cols.map(c => { const v = p.valores[f]?.[c] || 0; return <td key={c}>
                <button type="button" disabled={!v} className={esSel(f, c) ? 'sel' : ''} style={heat(v)} onClick={() => ir(esSel(f, c) ? null : { f, c })}>{v ? N(v) : '·'}</button></td>; })}
              <td><button type="button" className={`tot ${esSel(f, undefined) ? 'sel' : ''}`} style={cols.length ? {} : heat(p.totFila[f])}
                onClick={() => ir(esSel(f, undefined) ? null : { f })}>{N(p.totFila[f])}</button></td></tr>))}</tbody>
          <tfoot><tr><td>Total general</td>
            {cols.map(c => <td key={c}><button type="button" className={`tot ${esSel(undefined, c) ? 'sel' : ''}`} onClick={() => ir(esSel(undefined, c) ? null : { c })}>{N(p.totCol[c])}</button></td>)}
            <td><button type="button" className="tot" onClick={() => ir({})}>{N(p.total)}</button></td></tr></tfoot>
        </table></div> : <p className="empty">No hay líneas con estos filtros. Prueba quitando alguno.</p>}
      </Card>

      {p && p.claveFilas.length > 1 && p.claveFilas.length <= 120 && (
        <Card title={`${medidas.find(x => x.key === p.medida)?.label} por ${nombre(p.filas).toLowerCase()}`}>
          <Grafico apilado={!!cols.length} leyenda={!!cols.length} label="Gráfico de la tabla dinámica" datos={{ labels: p.claveFilas.map(etF),
            datasets: cols.length
              ? cols.map((c, i) => ({ label: etC(c), backgroundColor: css(PAL[i % PAL.length]), borderRadius: 2, data: p.claveFilas.map(f => p.valores[f]?.[c] || 0) }))
              : [{ label: 'Total', backgroundColor: css('--blue'), borderRadius: 2, data: p.claveFilas.map(f => p.totFila[f]) }] }} />
        </Card>)}

      {sel && (
        <section className="card" ref={detalle}>
          <div className="card-h">
            <h3>Detalle{sel.f !== undefined ? `: ${etF(sel.f)}` : ''}{sel.c !== undefined ? `, ${etC(sel.c)}` : ''}{det ? ` (${N(det.unidades)} un., ${N(det.total)} líneas)` : ''}</h3>
            <button type="button" className="ghost" onClick={() => setSel(null)}>Cerrar</button>
          </div>
          {!det || det.error ? <Cargando error={det?.error} /> : <div className="tscroll"><table>
            <thead><tr><th>OD</th><th>Solicitud</th><th>SKU</th><th>Descripción</th><th className="num">QTY</th><th>Estado</th><th>Tipo orden</th>
              <th>Tipo ola</th><th>Picking</th><th>CD</th><th>Región</th><th>Ciudad</th><th>Salida</th><th>ETA cliente</th><th>Ubicación</th></tr></thead>
            <tbody>{det.lineas.map((r, i) => <tr key={i}><td>{r.od}</td><td>{r.solicitud}</td><td>{r.sku}</td><td>{r.descripcion}</td><td className="num">{N(r.qty)}</td>
              <td title={r.desc_estado || ''}>{r.estado}</td><td>{r.tipo_orden}</td><td>{r.tipo_ola}</td><td>{r.tipo_picking}</td><td>{r.cd}</td>
              <td>{REGIONES[r.region] || r.region}</td><td>{r.city}</td><td>{r.fecha_salida}</td><td>{r.fecha_eta_cliente}</td><td>{r.location_id}</td></tr>)}</tbody>
            {det.total > det.lineas.length && <tfoot><tr><td colSpan={15} className="muted">Mostrando {N(det.lineas.length)} de {N(det.total)} líneas. Agrega filtros para acotar.</td></tr></tfoot>}
          </table></div>}
        </section>)}
    </>
  );
}
