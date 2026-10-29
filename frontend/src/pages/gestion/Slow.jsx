import React, { useEffect, useState } from 'react';
import { api, fmt, fFecha, urlApi } from './api.js';
import { toast, useCarga, IrACarga } from './ui.jsx';

/** Desplegable que se cierra al hacer clic fuera o con Escape. */
function Desplegable({ titulo, resumen, activo, ancho = 280, children }) {
  const [abierto, setAbierto] = useState(false);
  const ref = React.useRef(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e) => { if (ref.current && !ref.current.contains(e.target)) setAbierto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);
  return (
    <div className="flt-dd" ref={ref}>
      <button type="button" className={'flt-btn' + (activo ? ' on' : '')} aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        <span className="flt-t">{titulo}</span><span className="flt-r">{resumen}</span><span className="flt-c" aria-hidden="true">▾</span>
      </button>
      {abierto && <div className="flt-pop" style={{ width: ancho }}>{children}</div>}
    </div>
  );
}

const resumenDe = (valor, opciones, etiqueta) => (!valor.length ? 'Todos' : valor.length <= 2 ? valor.map(etiqueta).join(', ') : `${valor.length} de ${opciones.length}`);

/** Filtro de selección múltiple: lista con casillas, buscador si la lista es larga, Todos / Ninguno. Vacío = todos. */
function FiltroMulti({ titulo, opciones, valor, onCambio, etiqueta = (x) => String(x), ancho }) {
  const [buscar, setBuscar] = useState('');
  const b = buscar.trim().toUpperCase();
  const lista = b ? opciones.filter((x) => etiqueta(x).toUpperCase().includes(b)) : opciones;
  const alt = (x) => onCambio(valor.includes(x) ? valor.filter((y) => y !== x) : [...valor, x]);
  return (
    <Desplegable titulo={titulo} resumen={resumenDe(valor, opciones, etiqueta)} activo={valor.length > 0} ancho={ancho}>
      {opciones.length > 8 && <input type="text" className="flt-buscar" placeholder="Buscar…" value={buscar} onChange={(e) => setBuscar(e.target.value)} autoFocus />}
      <div className="flt-acc">
        <button type="button" className="link" onClick={() => onCambio(b ? [...new Set([...valor, ...lista])] : [])}>{b ? 'Marcar los filtrados' : 'Todos'}</button>
        {valor.length > 0 && <button type="button" className="link" onClick={() => onCambio([])}>Quitar selección</button>}
      </div>
      <div className="flt-lista">
        {lista.map((x) => <label key={x} className="flt-op"><input type="checkbox" checked={valor.includes(x)} onChange={() => alt(x)} /> {etiqueta(x)}</label>)}
        {!lista.length && <p className="note">Sin coincidencias.</p>}
      </div>
    </Desplegable>
  );
}

/** Meses de almacenamiento agrupados por año (clic en el año marca o desmarca sus meses) y rango desde / hasta. */
function FiltroMeses({ meses, valor, onCambio }) {
  const conFecha = meses.filter((m) => m !== '(sin fecha)');
  const [d, setD] = useState(''), [h, setH] = useState('');
  const aplicar = (a, z) => { setD(a); setH(z); if (a && z) onCambio(conFecha.filter((m) => m >= (a < z ? a : z) && m <= (a < z ? z : a))); };
  const anios = [...new Set(conFecha.map((m) => m.slice(0, 4)))];
  const alt = (x) => onCambio(valor.includes(x) ? valor.filter((y) => y !== x) : [...valor, x]);
  const altAnio = (a) => {
    const del = conFecha.filter((m) => m.startsWith(a));
    onCambio(del.every((m) => valor.includes(m)) ? valor.filter((m) => !del.includes(m)) : [...new Set([...valor, ...del])]);
  };
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return (
    <Desplegable titulo="Mes almac." resumen={resumenDe(valor, meses, (x) => x)} activo={valor.length > 0} ancho={330}>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}><label className="lbl" htmlFor="m-d">Desde</label><select id="m-d" style={{ width: '100%' }} value={d} onChange={(e) => aplicar(e.target.value, h)}><option value="">—</option>{conFecha.map((m) => <option key={m}>{m}</option>)}</select></div>
        <div style={{ flex: 1 }}><label className="lbl" htmlFor="m-h">Hasta</label><select id="m-h" style={{ width: '100%' }} value={h} onChange={(e) => aplicar(d, e.target.value)}><option value="">—</option>{conFecha.map((m) => <option key={m}>{m}</option>)}</select></div>
      </div>
      <div className="flt-acc">
        {valor.length > 0 && <button type="button" className="link" onClick={() => { onCambio([]); setD(''); setH(''); }}>Quitar selección</button>}
      </div>
      <div className="flt-lista">
        {anios.map((a) => {
          const del = conFecha.filter((m) => m.startsWith(a));
          return (
            <div key={a} className="flt-anio">
              <button type="button" className={'flt-a' + (del.every((m) => valor.includes(m)) ? ' on' : '')} onClick={() => altAnio(a)}>{a}</button>
              <div className="flt-meses">{del.map((m) => <button key={m} type="button" className={'flt-m' + (valor.includes(m) ? ' on' : '')} onClick={() => alt(m)}>{MES[Number(m.slice(5, 7)) - 1]}</button>)}</div>
            </div>
          );
        })}
        {meses.includes('(sin fecha)') && <label className="flt-op" style={{ marginTop: 6 }}><input type="checkbox" checked={valor.includes('(sin fecha)')} onChange={() => alt('(sin fecha)')} /> Sin fecha</label>}
      </div>
    </Desplegable>
  );
}

const TONO_VAL = { 'Cuadra': 'm-0', 'Sistema mayor': 'm-2', 'Sistema menor': 'm-3', 'Sin stock en la Base': 'm-4' };

/** Validación de un listado slow moving (SKU | QTY): stock y ubicaciones por CD según la Base vigente. */
function ValidarListado() {
  const [f, setF] = useState({ estado: '', cd: '', buscar: '' });
  const [r, setR] = useState(null);
  const [rec, setRec] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => api.post('/api/slow/validar/resultado', f).then(setR).catch((e) => toast(e.message, true)), 200);
    return () => clearTimeout(t);
  }, [JSON.stringify(f), rec]);
  const alt = (k, v) => setF({ ...f, [k]: f[k] === v ? '' : v });
  const quitar = async () => { try { await api.post('/api/slow/validar/borrar'); setRec(rec + 1); } catch (e) { toast(e.message, true); } };
  const hay = r && !r.sinListado;
  const cdsVer = hay ? r.cds.filter((cd) => r.detalle.some((x) => x.unidades[cd])) : [];
  const t = r?.tot;
  return (
    <div className="sec">
      <div className="row spread" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Validar listado de SKU{hay ? ` · ${r.archivo}` : ''}</h2>
        <div className="row" style={{ gap: 8 }}>
          <IrACarga id="slow" etiqueta={hay ? 'Reemplazar listado (en Datos)' : 'Cargar listado (en Datos)'} />
          {hay && <button className="btn sm" onClick={quitar}>Quitar</button>}
          {hay && <a className="btn primary" href={urlApi('/api/slow/validar/excel')}>Exportar a Excel</a>}
        </div>
      </div>
      <p className="note" style={{ marginTop: -2 }}>Carga un Excel con las columnas <b>SKU</b> y <b>QTY</b> (si no tiene encabezados: columna A = SKU, B = QTY; los SKU repetidos se suman). Se cruza con la Base de stock vigente{hay ? ` (${fFecha(String(r.carga.fecha).slice(0, 10))})` : ''}: stock por CD, ubicaciones y diferencia contra el QTY del listado.</p>
      {hay && (
        <>
          <div className="grid-kpi">
            <div className="kpi"><div className="k">SKU del listado</div><div className="v">{fmt(t.skus)}</div><div className="n">{fmt(t.conStock)} con stock en la Base · {fmt(t.skus - t.conStock)} sin stock</div></div>
            <div className="kpi"><div className="k">QTY listado / stock Base</div><div className="v">{fmt(t.qty)} / {fmt(t.stock)}</div><div className="n">unidades</div></div>
            <div className={'kpi ' + (t.stock - t.qty ? 'warn' : 'good')}><div className="k">Diferencia (Base − listado)</div><div className="v">{t.stock - t.qty > 0 ? '+' : ''}{fmt(t.stock - t.qty)}</div><div className="n">unidades</div></div>
            <div className="kpi"><div className="k">Ubicaciones</div><div className="v">{fmt(t.ubic)}</div><div className="n">donde está el stock · valor ${fmt(t.valor / 1e6, 1)} M</div></div>
          </div>
          <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
            <table>
              <thead><tr><th>Estado</th><th className="num">SKU</th><th className="num">QTY listado</th><th className="num">Stock Base</th></tr></thead>
              <tbody>{r.porEstado.filter((e) => e.skus).map((e) => (
                <tr key={e.estado} className={f.estado === e.estado ? 'sel' : ''} style={{ cursor: 'pointer' }} onClick={() => alt('estado', e.estado)}>
                  <td><span className={'pill ' + TONO_VAL[e.estado]}>{e.estado}</span></td><td className="num">{fmt(e.skus)}</td><td className="num">{fmt(e.qty)}</td><td className="num">{fmt(e.stock)}</td></tr>
              ))}</tbody>
            </table>
            <table>
              <thead><tr><th>CD</th><th className="num">SKU</th><th className="num">Unidades</th><th className="num">Ubicaciones</th></tr></thead>
              <tbody>{r.porCd.map((c) => (
                <tr key={c.cd} className={f.cd === c.cd ? 'sel' : ''} style={{ cursor: 'pointer' }} onClick={() => alt('cd', c.cd)}>
                  <td><b>{c.cd}</b></td><td className="num">{fmt(c.skus)}</td><td className="num">{fmt(c.unidades)}</td><td className="num">{fmt(c.ubicaciones)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="row spread" style={{ margin: '14px 0 8px' }}>
            <input type="search" placeholder="Buscar SKU o descripción" value={f.buscar} onChange={(e) => setF({ ...f, buscar: e.target.value })} style={{ maxWidth: 280 }} />
            <div className="chips">
              {f.estado && <button className="chip" aria-pressed onClick={() => alt('estado', f.estado)}>{f.estado} ✕</button>}
              {f.cd && <button className="chip" aria-pressed onClick={() => alt('cd', f.cd)}>{f.cd} ✕</button>}
            </div>
          </div>
          <div className="tbl" style={{ maxHeight: 460 }}>
            <table>
              <thead>
                <tr><th colSpan={3} /><th colSpan={cdsVer.length + 1} className="grp">Stock en la Base por CD</th><th colSpan={4} /></tr>
                <tr><th>SKU</th><th>Descripción</th><th className="num">QTY listado</th>{cdsVer.map((cd) => <th key={cd} className="num">{cd}</th>)}<th className="num">Total</th>
                  <th className="num">Diferencia</th><th>Estado</th><th>Ubicaciones</th><th>Tramo</th></tr>
              </thead>
              <tbody>{r.detalle.map((x) => (
                <tr key={x.sku}>
                  <td className="mono">{x.sku}</td>
                  <td className="wrap">{x.desc || <span className="muted">—</span>}{x.depto && <div className="note" style={{ margin: 0 }}>{x.depto}</div>}</td>
                  <td className="num">{fmt(x.qty)}</td>
                  {cdsVer.map((cd) => <td key={cd} className="num">{x.unidades[cd] ? fmt(x.unidades[cd]) : <span className="muted">—</span>}</td>)}
                  <td className="num"><b>{fmt(x.stock)}</b></td>
                  <td className="num" style={{ color: x.dif ? (x.dif < 0 ? 'var(--bad)' : 'var(--warn)') : 'var(--good)' }}>{x.dif > 0 ? '+' : ''}{fmt(x.dif)}</td>
                  <td><span className={'pill ' + TONO_VAL[x.estado]}>{x.estado}</span></td>
                  <td className="mono note">{x.ubicaciones.slice(0, 4).map((u) => `${u.cd} ${u.ubic} (${fmt(u.qty)})`).join(' · ')}{x.nUb > 4 ? ` · +${x.nUb - 4}` : ''}</td>
                  <td className="note">{x.tramo}{x.dias !== null && <div>{fmt(x.dias)} d</div>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {r.filtrados > r.detalle.length && <p className="note">Se muestran {fmt(r.detalle.length)} de {fmt(r.filtrados)} SKU (mayor diferencia primero). El Excel trae todos con cada ubicación.</p>}
          {!r.filtrados && <p className="note">Sin SKU para este filtro.</p>}
        </>
      )}
    </div>
  );
}

const PESTANAS_SM = [['sim', 'Simulador'], ['val', 'Validar listado']];

/** Vista Slow moving: simulador de extracción y validación de listados de SKU. */
export default function SlowVista() {
  const [vista, setVista] = useState('sim');
  return (
    <>
      <div className="chips" style={{ marginBottom: 10 }}>{PESTANAS_SM.map(([k, t]) => <button key={k} className="chip" aria-pressed={vista === k} onClick={() => setVista(k)}>{t}</button>)}</div>
      {vista === 'sim' ? <Slow /> : <><div className="top"><h1>Slow moving · validar listado</h1></div><ValidarListado /></>}
    </>
  );
}

function Slow() {
  const [op, err] = useCarga(() => api.get('/api/slow/opciones'), []);
  const [f, setF] = useState({ cds: [], deptos: [], temporadas: [], meses: [], tramos: [], ventas: '=0', unidades: { min: '', max: '' } });
  const [r, setR] = useState(null);
  const [destino, setDestino] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [cola, , recCola] = useCarga(() => api.get('/api/slow/cola'), []);
  useEffect(() => { if (op && !destino) setDestino(op.destino); }, [op]);
  useEffect(() => {
    setConfirmar(false);
    if (!op) return;
    const t = setTimeout(() => api.post('/api/slow/simular', f).then(setR).catch((e) => toast(e.message, true)), 200);
    return () => clearTimeout(t);
  }, [op, JSON.stringify(f)]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const generar = async () => {
    if (r.total.ubicaciones > 300 && !confirmar) { setConfirmar(true); return; }
    setConfirmar(false);
    try {
      const x = await api.post('/api/slow/generar', { filtros: f, destino });
      toast(`${x.tareas} tareas en cola (${x.skus} SKU). Entran a la próxima asignación diaria en el turno configurado de cada CD.`);
      recCola();
    } catch (e) { toast(e.message, true); }
  };
  const vaciar = async () => { await api.del('/api/slow/cola'); recCola(); toast('Cola de slow moving vaciada.'); };
  if (err) return <><div className="top"><h1>Simulador slow moving</h1></div><div className="alert warn">{err}</div></>;
  if (!op) return <p className="muted">Calculando slow moving…</p>;
  const t = op.tramos;
  const TR = { 1: `Activo (0-${t[0]} d)`, 2: `Lento (${t[0] + 1}-${t[1]} d)`, 3: `Muy lento (${t[1] + 1}-${t[2]} d)`, 4: `Sin movimiento (> ${t[2]} d)`, 5: 'Sin dato' };
  return (
    <>
      <div className="top"><div><h1>Simulador slow moving</h1><div className="sub">Base del {fFecha(op.carga.fecha)} · ventas &gt; 0 = activo; sin venta, el tramo sale de los días desde la fecha de último almacenamiento. Valor = unidades × costo.</div></div></div>
      <div className="sec flt-bar">
        <FiltroMulti titulo="CD" opciones={op.cds} valor={f.cds} onCambio={set('cds')} ancho={200} />
        <FiltroMulti titulo="Temporada" opciones={op.temporadas} valor={f.temporadas} onCambio={set('temporadas')} ancho={240} />
        <FiltroMulti titulo="Depto" opciones={op.deptos} valor={f.deptos} onCambio={set('deptos')} ancho={320} />
        <FiltroMeses meses={op.meses} valor={f.meses} onCambio={set('meses')} />
        <FiltroMulti titulo="Tramo" opciones={[1, 2, 3, 4, 5]} valor={f.tramos} onCambio={set('tramos')} etiqueta={(x) => TR[x]} ancho={240} />
        <label className="flt-campo">Ventas
          <select value={typeof f.ventas === 'string' ? f.ventas : '*'} onChange={(e) => set('ventas')(e.target.value)}><option value="=0">= 0 (sin venta)</option><option value=">0">&gt; 0 (con venta)</option><option value="*">Todas</option></select></label>
        <label className="flt-campo">Unidades
          <input className="w70" type="number" min="0" placeholder="mín." value={f.unidades.min} onChange={(e) => set('unidades')({ ...f.unidades, min: e.target.value })} />
          <input className="w70" type="number" min="0" placeholder="máx." value={f.unidades.max} onChange={(e) => set('unidades')({ ...f.unidades, max: e.target.value })} /></label>
        {(f.cds.length + f.temporadas.length + f.deptos.length + f.meses.length + f.tramos.length > 0 || f.unidades.min !== '' || f.unidades.max !== '' || f.ventas !== '=0') && (
          <button type="button" className="btn sm" onClick={() => setF({ cds: [], deptos: [], temporadas: [], meses: [], tramos: [], ventas: '=0', unidades: { min: '', max: '' } })}>Limpiar filtros</button>)}
      </div>
      {r && (
        <>
          <div className="grid-kpi">
            <div className="kpi"><div className="k">SKU</div><div className="v">{fmt(r.total.skus)}</div><div className="n">cumplen los criterios</div></div>
            <div className="kpi"><div className="k">Unidades</div><div className="v">{fmt(r.total.unidades)}</div><div className="n">a extraer</div></div>
            <div className="kpi"><div className="k">Valor a costo</div><div className="v">${fmt(r.total.valor / 1e6, 1)} M</div><div className="n">{op.hayCosto ? 'unidades × costo unitario' : 'la Base no trae COSTO'}</div></div>
            <div className="kpi good"><div className="k">Ubicaciones que libera</div><div className="v">{fmt(r.total.libera)}</div><div className="n">de {fmt(r.total.ubicaciones)} ocupadas</div></div>
          </div>
          <div className="sec">
            <h2>Por CD</h2>
            <table><thead><tr><th>CD</th><th className="num">SKU</th><th className="num">Unidades</th><th className="num">Valor</th><th className="num">Ubicaciones</th><th className="num">Libera</th></tr></thead>
              <tbody>{r.porCD.map((c) => <tr key={c.cd}><td>{c.cd}</td><td className="num">{fmt(c.skus)}</td><td className="num">{fmt(c.unidades)}</td><td className="num">${fmt(c.valor)}</td><td className="num">{fmt(c.ubicaciones)}</td><td className="num">{fmt(c.libera)}</td></tr>)}</tbody></table>
          </div>
          <div className="sec">
            <div className="row spread" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>Detalle por SKU</h2>
              <div className="row">
                <div><label className="lbl" htmlFor="s-d">Destino</label><input id="s-d" type="text" value={destino} onChange={(e) => setDestino(e.target.value)} /></div>
                <button className={'btn primary' + (confirmar ? ' danger' : '')} disabled={!r.filas} onClick={generar}>{confirmar ? `Confirmar ${fmt(r.total.ubicaciones)} tareas` : `Generar tareas (${fmt(r.total.ubicaciones)} ubicaciones)`}</button>
                {confirmar && <button className="btn" onClick={() => setConfirmar(false)}>Cancelar</button>}
              </div>
            </div>
            {confirmar && <div className="alert warn">Vas a dejar {fmt(r.total.ubicaciones)} tareas de extracción en cola para la próxima asignación. Acota los criterios si es demasiado para un turno.</div>}
            <div className="tbl" style={{ maxHeight: 460 }}>
              <table>
                <thead><tr><th>Mes almac.</th><th>CD</th><th>SKU</th><th>Descripción</th><th>Depto</th><th>Temporada</th><th className="num">Unid.</th><th className="num">Ventas</th><th className="num">Días</th><th className="num">Valor</th><th>Tramo</th><th className="num">Libera</th><th>Ubicaciones</th></tr></thead>
                <tbody>{r.detalle.map((x) => (
                  <tr key={x.cd + x.sku}><td className="mono">{x.mes}</td><td>{x.cd}</td><td className="mono">{x.sku}</td><td className="wrap">{x.desc}</td><td>{x.depto}</td><td>{x.temporada}</td>
                    <td className="num">{fmt(x.uni)}</td><td className="num">{fmt(x.ventas)}</td><td className="num">{x.dias ?? '—'}</td><td className="num">${fmt(x.valor)}</td><td>{TR[x.tramo]}</td><td className="num">{x.libera}</td><td className="mono note">{x.ubic.slice(0, 4).join(', ')}{x.ubic.length > 4 ? '…' : ''}</td></tr>
                ))}</tbody>
              </table>
            </div>
            {r.filas > r.detalle.length && <p className="note">Se muestran {fmt(r.detalle.length)} de {fmt(r.filas)} SKU (ordenados por mes y valor).</p>}
          </div>
        </>
      )}
      <div className="sec">
        <div className="row spread"><h2 style={{ margin: 0 }}>Cola para la próxima asignación ({cola?.length || 0} tareas)</h2>{cola?.length > 0 && <button className="btn sm danger" onClick={vaciar}>Vaciar cola</button>}</div>
        <p className="note">{Object.entries((cola || []).reduce((a, x) => ({ ...a, [x.cd]: (a[x.cd] || 0) + 1 }), {})).map(([c, n]) => `${c}: ${n}`).join(' · ') || 'Sin tareas en cola.'}</p>
      </div>
    </>
  );
}
