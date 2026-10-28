// Participación de la venta por CD (archivo de pedidos/despachos): unidades y % por CD y por depto, filtro por tipo
// de picking (TAREA / ETIQUETA) y simulación de los SKU aptos para OSR que habría que ingresar para llegar al target.
import React, { useState } from 'react';
import { api, qs, urlApi, fmt, pct, fFecha } from './api.js';
import { Subir, toast } from './ui.jsx';

const tono = (m) => 'm-' + ('ABC'.indexOf(m[0]) + 'XYZ'.indexOf(m[1]));
const TIPOS = [['TAREA', 'Tarea'], ['ETIQUETA', 'Etiqueta'], ['TODOS', 'Ambos']];
const LECTURA_ESTADO = {
  'APTO SIN OSR': 'Logística OSR = "Y", sin stock ni venta desde OSR: son los candidatos a ingresar.',
  'YA EN OSR': 'Ya están en OSR pero parte de su venta sale de otros CD: subir más stock al OSR también sube la participación.',
  'NO APTO OSR': 'Venden desde otros CD y no están habilitados (Logística OSR N o REVISION): habilitarlos amplía el máximo alcanzable.',
  'NO ESTÁ EN LA BASE': 'Tienen venta pero no aparecen en la Base de stock cargada (sin stock hoy).',
  'SIN VALIDAR (sin Base)': 'No hay Base de stock cargada: no se puede validar si son aptos ni si ya están en OSR.',
};

export default function ParticipacionCd() {
  const [f, setF] = useState({ tipo: 'TAREA', desde: '', hasta: '', cd: '', target: '', modo: 'total', excluir: [], soloOsr: false, depto: '', estado: '' });
  const [lista, setLista] = useState('sel');
  const [rec, setRec] = useState(0);
  const [subiendo, setSubiendo] = useState(false);
  const [r, setR] = useState(null);
  const [cargando, setCargando] = useState(false);
  const cuerpo = { ...f, target: f.target === '' ? '' : Number(f.target) / 100 };
  React.useEffect(() => {
    setCargando(true);
    const t = setTimeout(() => api.post('/api/participacion/simular', cuerpo).then(setR).catch((e) => toast(e.message, true)).finally(() => setCargando(false)), 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(f), rec]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const alt = (k, v) => set(k)(f[k] === v ? '' : v);

  const subir = async (archivo) => {
    setSubiendo(true);
    try {
      const fd = new FormData(); fd.append('archivo', archivo);
      const x = await api.post('/api/participacion/venta', fd);
      toast(`Venta cargada: ${fmt(x.filas)} líneas (${x.dias} días${x.desde ? `, ${fFecha(x.desde)} al ${fFecha(x.hasta)}` : ''}). Unidades desde ${x.unidades}.`);
      setRec(rec + 1);
    } catch (e) { toast(e.message, true); } finally { setSubiendo(false); }
  };
  const borrar = async () => {
    if (!window.confirm('¿Borrar toda la venta cargada?')) return;
    try { await api.post('/api/participacion/venta/borrar'); setRec(rec + 1); } catch (e) { toast(e.message, true); }
  };

  const obj = r?.cdObj || 'OSR';
  const s = r?.sim;
  const excel = urlApi('/api/participacion/excel' + qs({ ...cuerpo, excluir: f.excluir.join(','), soloOsr: f.soloOsr ? '1' : '', estado: '' }));
  const altCd = (c) => setF({ ...f, excluir: f.excluir.includes(c) ? f.excluir.filter((x) => x !== c) : [...f.excluir, c], cd: f.cd === c ? '' : f.cd });
  const tile = (k, v, cls = '', n = '') => <div className={'kpi ' + cls}><div className="k">{k}</div><div className="v">{v}</div>{n && <div className="n">{n}</div>}</div>;
  const colorPct = (x) => (x >= r.target - 1e-9 ? 'var(--good)' : x >= r.target * 0.85 ? 'var(--warn)' : 'var(--bad)');
  const nomDep = r?.deptos?.find((d) => d.key === f.depto)?.nom || f.depto;
  const filasLista = lista === 'sel' ? r?.seleccion : r?.lista;

  return (
    <>
      <div className="top">
        <h1>Participación por CD</h1>
        {r && !r.sinDatos && <a className="btn primary" href={excel}>Exportar a Excel</a>}
      </div>
      <div className="sec">
        <div className="row" style={{ alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="lbl">Venta por CD</legend>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <Subir etiqueta={r?.info?.registros ? 'Agregar / reemplazar venta' : 'Cargar venta'} onArchivo={subir} cargando={subiendo} />
              {r?.info?.registros > 0 && <button className="btn sm" onClick={borrar}>Borrar todo</button>}
            </div>
          </fieldset>
          {r?.info?.registros > 0 && (
            <>
              <div>
                <div className="lbl">Tipo de picking</div>
                <div className="chips">{TIPOS.map(([k, t]) => <button key={k} className="chip" aria-pressed={f.tipo === k} onClick={() => set('tipo')(k)}>{t}</button>)}</div>
              </div>
              <div><label className="lbl" htmlFor="pc-desde">Desde</label><input id="pc-desde" type="date" value={f.desde} min={r.info.desde || undefined} max={r.info.hasta || undefined} onChange={(e) => set('desde')(e.target.value)} /></div>
              <div><label className="lbl" htmlFor="pc-hasta">Hasta</label><input id="pc-hasta" type="date" value={f.hasta} min={r.info.desde || undefined} max={r.info.hasta || undefined} onChange={(e) => set('hasta')(e.target.value)} /></div>
              {r.cds && <div><label className="lbl" htmlFor="pc-cd">CD objetivo</label>
                <select id="pc-cd" value={f.cd || r.cdObj} onChange={(e) => set('cd')(e.target.value)}>{r.cds.map((c) => <option key={c}>{c}</option>)}</select></div>}
              <div><label className="lbl" htmlFor="pc-target">Target {obj} %</label><input id="pc-target" type="number" className="w90" min="0" max="100" step="1" placeholder={fmt(r.target * 100, 0)} value={f.target} onChange={(e) => set('target')(e.target.value)} /></div>
              <div>
                <div className="lbl">Cumplir el target</div>
                <div className="chips">{[['total', 'En el total'], ['depto', 'En cada depto']].map(([k, t]) => <button key={k} className="chip" aria-pressed={f.modo === k} onClick={() => set('modo')(k)}>{t}</button>)}</div>
              </div>
              <label className="inline" style={{ fontSize: 13 }}><input type="checkbox" checked={f.soloOsr} onChange={(e) => setF({ ...f, soloOsr: e.target.checked, depto: '' })} /> Solo deptos OSR</label>
            </>
          )}
          {cargando && <span className="note">Calculando…</span>}
        </div>
        {r?.info?.registros > 0 && (
          <div className="row" style={{ alignItems: 'center', gap: 8, marginTop: 10 }}>
            <span className="lbl" style={{ margin: 0 }}>CD que entran en el total</span>
            <div className="chips">{r.info.cds.map((c) => <button key={c} className="chip" aria-pressed={!f.excluir.includes(c)} onClick={() => altCd(c)}>{c}</button>)}</div>
          </div>
        )}
        {r?.info?.registros > 0 && <p className="note">Cargado: {fFecha(r.info.desde)} al {fFecha(r.info.hasta)} · {r.info.dias} días · {fmt(r.info.unidades)} unidades · tipos {r.info.tipos.join(', ')}. Fecha = FECHA_SALIDA; unidades = QTY_PICKING; se excluyen las líneas CANCELLED. Al cargar un archivo se reemplazan solo los días que trae.</p>}

        {r?.sinDatos && <div className="alert">Carga el archivo de pedidos con las columnas <b>SKU</b>, <b>DESCRIPCION</b>, <b>QTY</b> / <b>QTY_PICKING</b>, <b>DPTO</b>, <b>CD_PICKING</b>, <b>TIPO_PICKING</b> y <b>FECHA_SALIDA</b>, en una hoja o como origen de una tabla dinámica (se lee su caché). Se suma QTY_PICKING.</div>}
        {r && !r.sinDatos && (
          <>
            {!r.hayBase && <div className="alert warn">No hay Base de stock cargada: no se puede validar Logística OSR ni el stock en {obj}. Se consideran candidatos todos los SKU sin venta desde {obj}.</div>}
            {r.hayBase && r.hayColOsr === false && <div className="alert warn">La Base no trae la columna "Logística OSR": todos los SKU cuentan como aptos.</div>}
            {r.tipo !== 'TODOS' && !r.tipos.includes(r.tipo) && <div className="alert warn">El archivo no trae TIPO_PICKING = {r.tipo}. Tipos cargados: {r.tipos.join(', ')}.</div>}

            <div className="grid-kpi" style={{ marginTop: 12 }}>
              {tile(`Participación ${obj} hoy`, pct(s.pct), s.pct >= r.target - 1e-9 ? 'good' : 'bad', `${fmt(s.obj)} de ${fmt(s.u)} u.${f.depto ? ` · ${nomDep}` : ''} · target ${pct(r.target)}`)}
              {tile('Faltan para el target', `${fmt(s.brecha)} u.`, s.brecha > 0 ? 'warn' : 'good', s.brecha > 0 ? `${pct(s.u ? s.brecha / s.u : 0)} de la venta tiene que pasar a ${obj}` : 'el target ya se cumple')}
              {tile('SKU aptos a ingresar', fmt(s.nSel), '', `${fmt(s.cub)} u. de venta que hoy salen de otros CD`)}
              {tile(`${obj} con el ingreso`, pct(s.pctRes), s.alcanza ? 'good' : 'bad', s.alcanza ? `${r.modo === 'depto' ? 'cumpliendo en cada depto' : 'cumple el target'}` : `no alcanza: el máximo con aptos es ${pct(s.pctMax)}`)}
              {tile('Máximo alcanzable', `${pct(s.pctMax)} → ${pct(s.pctMaxNo)}`, '', `con todos los aptos → habilitando además no aptos · ${fmt(s.potEn)} u. de SKU ya en ${obj} salen de otros CD`)}
            </div>

            <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,3fr)' }}>
              <div>
                <h3 style={{ margin: '0 0 8px' }}>Participación por CD{f.depto ? ` · ${nomDep}` : ''}</h3>
                <table>
                  <thead><tr><th>CD</th><th className="num">Unidades</th><th className="num">%</th><th className="num">SKU</th><th style={{ width: '35%' }} /></tr></thead>
                  <tbody>
                    {r.porCd.map((c) => (
                      <tr key={c.cd} className={c.obj ? 'sel' : ''}>
                        <td>{c.obj ? <b>{c.cd}</b> : c.cd}</td><td className="num">{fmt(c.u)}</td><td className="num">{pct(c.pct)}</td><td className="num">{fmt(c.skus)}</td>
                        <td><div className="bar" style={{ marginTop: 0 }}><i style={{ width: `${c.pct * 100}%`, background: c.obj ? 'var(--accent)' : 'var(--muted)' }} />
                          {c.obj && <span title={`Target ${pct(r.target)}`} style={{ position: 'absolute', left: `${Math.min(100, r.target * 100)}%`, top: -4, bottom: -4, width: 2, background: 'var(--ink)' }} />}</div></td>
                      </tr>
                    ))}
                    <tr className="tot"><td>Total</td><td className="num">{fmt(r.total.u)}</td><td className="num">100%</td><td className="num">{fmt(r.total.skus)}</td><td /></tr>
                  </tbody>
                </table>
                <p className="note">La línea negra en la barra de {obj} marca el target.</p>
              </div>
              <div>
                <h3 style={{ margin: '0 0 8px' }}>Participación {obj} por día de salida</h3>
                <div className="tbl" style={{ maxHeight: 300 }}>
                  <table>
                    <thead><tr><th>Fecha salida</th><th className="num">Unidades</th>{r.cdsCol.map((c) => <th key={c} className="num">{c}</th>)}<th className="num">% {obj}</th></tr></thead>
                    <tbody>{r.porDia.map((d) => (
                      <tr key={d.fecha || 'x'}><td>{d.fecha ? fFecha(d.fecha) : '(sin fecha)'}</td><td className="num">{fmt(d.u)}</td>{r.cdsCol.map((c) => <td key={c} className="num">{fmt(d.porCd[c] || 0)}</td>)}
                        <td className="num"><b style={{ color: colorPct(d.pct) }}>{pct(d.pct)}</b></td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="row spread" style={{ margin: '18px 0 8px' }}>
              <h3 style={{ margin: 0 }}>Apertura por departamento</h3>
              {f.depto && <button className="chip" aria-pressed onClick={() => set('depto')('')}>{nomDep} ✕</button>}
            </div>
            <div className="tbl" style={{ maxHeight: 420 }}>
              <table>
                <thead><tr><th>Depto</th><th className="num">Unidades</th>{r.cdsCol.map((c) => <th key={c} className="num">% {c}</th>)}
                  <th className="num">Faltan p/ target</th><th className="num">SKU aptos sin {obj}</th><th className="num">SKU a ingresar</th><th className="num">{obj} con ingreso</th><th className="num">Máx. aptos</th><th className="num">Máx. con no aptos</th></tr></thead>
                <tbody>
                  {r.deptos.map((d) => (
                    <tr key={d.key} className={f.depto === d.key ? 'sel' : ''} style={{ cursor: 'pointer' }} onClick={() => alt('depto', d.key)} title="Filtrar por este depto">
                      <td>{d.nom}{d.enLista && <span className="tag" style={{ marginLeft: 6 }}>OSR</span>}</td><td className="num">{fmt(d.u)}</td>
                      {r.cdsCol.map((c) => {
                        const v = d.u ? (d.porCd[c] || 0) / d.u : 0;
                        return <td key={c} className="num" title={`${fmt(d.porCd[c] || 0)} u.`}>{c === r.cdObj ? <b style={{ color: colorPct(v) }}>{pct(v)}</b> : v ? pct(v) : '—'}</td>;
                      })}
                      <td className="num">{d.brecha > 0 ? fmt(d.brecha) : '—'}</td><td className="num">{fmt(d.nCand)}</td><td className="num">{d.nSel ? <b>{fmt(d.nSel)}</b> : '—'}</td>
                      <td className="num" style={{ color: d.brecha > 0 ? colorPct(d.pctRes) : undefined }}>{pct(d.pctRes)}</td><td className="num">{pct(d.pctMax)}</td><td className="num">{pct(d.pctMaxNo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">Cada depto se simula contra el mismo target, con sus propios SKU. "SKU a ingresar" del depto es lo que necesita para llegar solo; con "En el total" la lista de abajo prioriza los SKU de mayor venta de todos los deptos. Clic en un depto para filtrar.</p>

            <div className="row spread" style={{ margin: '18px 0 8px' }}>
              <div className="chips">
                <button className="chip" aria-pressed={lista === 'sel'} onClick={() => setLista('sel')}>SKU a ingresar · {fmt(s.nSel)}</button>
                {r.estados.map((e) => <button key={e.estado} className="chip" aria-pressed={lista === 'est' && r.estado === e.estado} onClick={() => { setLista('est'); set('estado')(e.estado); }}>{e.estado} · {fmt(e.skus)} SKU · {fmt(e.u)} u.</button>)}
              </div>
            </div>
            <p className="note" style={{ marginTop: 0 }}>{lista === 'sel'
              ? `SKU aptos para ${obj} que hoy no están en ${obj}, de mayor a menor venta en otros CD, hasta cubrir lo que falta para el target. Al ingresarlos se supone que ${obj} despacha toda su venta.`
              : LECTURA_ESTADO[r.estado]}</p>
            <div className="tbl" style={{ maxHeight: 440 }}>
              <table>
                <thead><tr><th>Clase</th><th>SKU</th><th>Descripción</th><th className="num">Vendidas</th><th className="num">En {obj}</th><th className="num">Otros CD</th><th>CD principal</th>
                  <th>Log. OSR</th><th className="num">Stock {obj}</th><th className="num">Stock fuera</th>{lista === 'sel' && <th className="num">% {obj} acum.</th>}</tr></thead>
                <tbody>{(filasLista || []).map((x) => (
                  <tr key={x.sku}><td>{x.matriz ? <span className={'pill ' + tono(x.matriz)}>{x.matriz}</span> : '—'}</td><td className="mono">{x.sku}</td>
                    <td className="wrap">{x.desc}<div className="note" style={{ margin: 0 }}>{x.deptoNom}</div></td>
                    <td className="num">{fmt(x.u)}</td><td className="num">{x.uObj ? fmt(x.uObj) : '—'}</td><td className="num"><b>{fmt(x.otros)}</b></td><td>{x.cdPrincipal}</td>
                    <td>{x.log || '—'}</td><td className="num">{x.stockOsr === null ? '—' : fmt(x.stockOsr)}</td>
                    <td className="num">{x.stockFuera === null ? '—' : x.stockFuera > 0 ? fmt(x.stockFuera) : <span style={{ color: 'var(--bad)' }}>sin stock</span>}</td>
                    {lista === 'sel' && <td className="num">{pct(x.pctAcum)}</td>}</tr>
                ))}</tbody>
              </table>
            </div>
            {lista === 'sel' && s.nSel > (r.seleccion || []).length && <p className="note">Se muestran {fmt(r.seleccion.length)} de {fmt(s.nSel)} SKU. El Excel trae todos.</p>}
            {lista === 'est' && r.nLista > r.lista.length && <p className="note">Se muestran {fmt(r.lista.length)} de {fmt(r.nLista)} SKU. El Excel trae todos.</p>}
            {!(filasLista || []).length && <p className="note">Sin SKU para este filtro.</p>}
          </>
        )}
      </div>
    </>
  );
}
