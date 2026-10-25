import React, { useEffect, useState } from 'react';
import { api, fmt, fFecha } from './api.js';
import { toast, useCarga } from './ui.jsx';

function Chips({ titulo, opciones, valor, onCambio, etiqueta = (x) => x }) {
  const alt = (x) => onCambio(valor.includes(x) ? valor.filter((y) => y !== x) : [...valor, x]);
  return (
    <div>
      <div className="row spread" style={{ alignItems: 'center', marginBottom: 6 }}>
        <span className="lbl" style={{ margin: 0 }}>{titulo}{valor.length ? ` · ${valor.length}` : ' · todos'}</span>
        {valor.length > 0 && <button className="btn sm" onClick={() => onCambio([])}>Quitar</button>}
      </div>
      <div className="chips">{opciones.map((x) => <button key={x} className="chip" aria-pressed={valor.includes(x)} onClick={() => alt(x)}>{etiqueta(x)}</button>)}</div>
    </div>
  );
}

/** Rango de meses "desde - hasta" sobre la lista ordenada de meses. */
function Meses({ meses, valor, onCambio }) {
  const conFecha = meses.filter((m) => m !== '(sin fecha)');
  const [d, setD] = useState(''), [h, setH] = useState('');
  const aplicar = (a, b) => { setD(a); setH(b); if (a && b) onCambio(conFecha.filter((m) => m >= (a < b ? a : b) && m <= (a < b ? b : a))); };
  return (
    <div>
      <Chips titulo="Mes de almacenamiento" opciones={meses} valor={valor} onCambio={onCambio} />
      <div className="row" style={{ marginTop: 8 }}>
        <div><label className="lbl" htmlFor="m-d">Rango desde</label><select id="m-d" value={d} onChange={(e) => aplicar(e.target.value, h)}><option value="">—</option>{conFecha.map((m) => <option key={m}>{m}</option>)}</select></div>
        <div><label className="lbl" htmlFor="m-h">hasta</label><select id="m-h" value={h} onChange={(e) => aplicar(d, e.target.value)}><option value="">—</option>{conFecha.map((m) => <option key={m}>{m}</option>)}</select></div>
      </div>
    </div>
  );
}

export default function Slow() {
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
      <div className="sec flt">
        <Chips titulo="CD" opciones={op.cds} valor={f.cds} onCambio={set('cds')} />
        <Chips titulo="Temporada" opciones={op.temporadas} valor={f.temporadas} onCambio={set('temporadas')} />
        <Chips titulo="Departamento" opciones={op.deptos} valor={f.deptos} onCambio={set('deptos')} />
        <Meses meses={op.meses} valor={f.meses} onCambio={set('meses')} />
        <Chips titulo="Tramo" opciones={[1, 2, 3, 4, 5]} valor={f.tramos} onCambio={set('tramos')} etiqueta={(x) => TR[x]} />
        <div className="row">
          <div><label className="lbl" htmlFor="s-v">Ventas</label><select id="s-v" value={typeof f.ventas === 'string' ? f.ventas : '*'} onChange={(e) => set('ventas')(e.target.value)}><option value="=0">= 0 (sin venta)</option><option value=">0">&gt; 0 (con venta)</option><option value="*">Todas</option></select></div>
          <div><label className="lbl" htmlFor="s-u1">Unidades mín.</label><input id="s-u1" className="w90" type="number" min="0" value={f.unidades.min} onChange={(e) => set('unidades')({ ...f.unidades, min: e.target.value })} /></div>
          <div><label className="lbl" htmlFor="s-u2">máx.</label><input id="s-u2" className="w90" type="number" min="0" value={f.unidades.max} onChange={(e) => set('unidades')({ ...f.unidades, max: e.target.value })} /></div>
        </div>
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
