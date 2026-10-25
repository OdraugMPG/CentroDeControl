import React, { useState } from 'react';
import { api, fmt, fFecha } from './api.js';
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

const CLASES_OSR = ['AX', 'AY', 'BX', 'BY'];
const LECTURA_ESTADO = {
  REVISION: 'Están en OSR pero falta confirmar si son aptos. Confirmar primero los de clase A (más venta): si pasan a "Y", ya suman al automático.',
  N: 'Están en OSR aunque no son aptos. Los de clase C (poca o ninguna venta) son los primeros a retirar: liberan espacio de OSR para SKU "Y" de alta rotación.',
};

/** SKU que hoy están almacenados en OSR sin Logística OSR = Y (REVISION, N u otro valor). */
function NoAptosOsr({ grupos, osr }) {
  const [sel, setSel] = useState(grupos[0]?.estado);
  const g = grupos.find((x) => x.estado === sel) || grupos[0];
  if (!g) return <p className="note">Todos los SKU con stock en {osr} tienen Logística OSR = "Y".</p>;
  return (
    <>
      <div className="row spread" style={{ alignItems: 'center', margin: '18px 0 8px' }}>
        <h3 style={{ margin: 0 }}>En {osr} sin Logística OSR = "Y"</h3>
        <div className="chips">{grupos.map((x) => <button key={x.estado} className="chip" aria-pressed={x.estado === g.estado} onClick={() => setSel(x.estado)}>{x.estado} · {fmt(x.skus)} SKU</button>)}</div>
      </div>
      <p className="note" style={{ marginTop: 0 }}>{LECTURA_ESTADO[g.estado] || 'Valor de Logística OSR distinto de Y: revisar si corresponde que estén en OSR.'}</p>
      <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,3fr)' }}>
        <table>
          <thead><tr><th>Clase</th><th className="num">SKU</th><th className="num">Unid. en {osr}</th><th className="num">Ubic. en {osr}</th></tr></thead>
          <tbody>
            {['A', 'B', 'C'].map((a) => (
              <tr key={a}><td><span className={'pill ' + TONO[a]}>{a}</span></td><td className="num">{fmt(g.abc[a].skus)}</td><td className="num">{fmt(g.abc[a].uni)}</td><td className="num">{fmt(g.abc[a].ubic)}</td></tr>
            ))}
            <tr className="tot"><td>Total</td><td className="num">{fmt(g.skus)}</td><td className="num">{fmt(g.uni)}</td><td className="num">{fmt(g.ubic)}</td></tr>
          </tbody>
        </table>
        <div className="grid-kpi" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginBottom: 0 }}>
          <div className="kpi"><div className="k">Ubicaciones de {osr}</div><div className="v">{fmt(g.ubic)}</div><div className="n">ocupadas por SKU {g.estado}</div></div>
          <div className={'kpi ' + (g.estado === 'N' ? 'warn' : '')}><div className="k">{g.estado === 'N' ? 'Liberables (clase C)' : 'Por confirmar (clase A)'}</div><div className="v">{fmt(g.estado === 'N' ? g.abc.C.ubic : g.abc.A.skus)}</div><div className="n">{g.estado === 'N' ? `ubicaciones de ${fmt(g.abc.C.skus)} SKU de baja venta` : `SKU de alta venta · todo el grupo ${g.estado} vende ${fmt(g.ventaDia, 0)} u./día`}</div></div>
        </div>
      </div>
      <div className="tbl" style={{ maxHeight: 360, marginTop: 10 }}>
        <table>
          <thead><tr><th>Clase</th><th>SKU</th><th>Descripción</th><th>Depto</th><th className="num">Venta/día</th><th className="num">Stock {osr}</th><th className="num">Ubic. {osr}</th><th className="num">Cobertura</th><th className="num">Stock otros CD</th></tr></thead>
          <tbody>{g.lista.map((x) => (
            <tr key={x.sku}><td><span className={'pill ' + tono(x.matriz)}>{x.matriz}</span></td><td className="mono">{x.sku}</td><td className="wrap">{x.desc}</td><td>{x.depto}</td>
              <td className="num">{fmt(x.ventaDia, 1)}</td><td className="num">{fmt(x.osr)}</td><td className="num">{fmt(x.ubOsr)}</td><td className="num">{x.cob === null ? 'sin venta' : `${fmt(x.cob, 0)} d`}</td><td className="num">{fmt(x.otros)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {g.skus > g.lista.length && <p className="note">Se muestran {fmt(g.lista.length)} de {fmt(g.skus)} SKU (ordenados por venta diaria).</p>}
    </>
  );
}

/** Simulador de ingreso de alta rotación a OSR por días de cobertura. */
function IngresoOsr({ onCola }) {
  const [f, setF] = useState({ dias: 7, clases: ['AX', 'AY'], incluirSinOsr: false, skus: '' });
  const [r, setR] = useState(null);
  const [cargando, setCargando] = useState(false);
  React.useEffect(() => {
    setCargando(true);
    const t = setTimeout(() => api.post('/api/optimizacion/osr/simular', f).then(setR).catch((e) => toast(e.message, true)).finally(() => setCargando(false)), 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(f)]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const alt = (c) => set('clases')(f.clases.includes(c) ? f.clases.filter((x) => x !== c) : [...f.clases, c]);
  const generar = async () => {
    try {
      const x = await api.post('/api/optimizacion/osr/generar', f);
      toast(`${fmt(x.tareas)} tareas en cola (${fmt(x.skus)} SKU) hacia ${x.destino}. Entran a la próxima asignación diaria.`);
      onCola();
    } catch (e) { toast(e.message, true); }
  };
  const pp = (x) => fmt(x * 100, 1) + '%';
  return (
    <div className="sec">
      <h2>Ingreso de alta rotación a {r?.osr || 'OSR'}</h2>
      <p className="note" style={{ marginTop: -4 }}>SKU con Logística OSR = "Y" que ya tienen almacenamiento en {r?.osr || 'OSR'}: se sugiere ingresar desde los otros CD lo necesario para cubrir N días de venta (venta diaria = ventas de 2 meses / 60). Más clase A en OSR = más venta atendida por el automático y menos picking manual.</p>
      {r && !r.hayCol && <div className="alert warn">La Base cargada no trae la columna "Logística OSR": por ahora se consideran todos los SKU como aptos. Vuelve a cargar la Base en Asignación del día para filtrar por "Y".</div>}
      {r && !r.existeOsr && <div className="alert warn">No hay stock en {r.osr} en la Base. Revisa el parámetro "CD del OSR" en Configuración.</div>}
      <div className="row" style={{ margin: '10px 0 14px' }}>
        <div><label className="lbl" htmlFor="o-d">Días de cobertura</label><input id="o-d" type="number" className="w90" min="1" value={f.dias} onChange={(e) => set('dias')(e.target.value)} /></div>
        <div><span className="lbl">Clases</span><div className="chips">{CLASES_OSR.map((c) => <button key={c} className="chip" aria-pressed={f.clases.includes(c)} onClick={() => alt(c)}>{c}</button>)}</div></div>
        <div><label className="lbl" htmlFor="o-s">Máx. SKU</label><input id="o-s" type="number" className="w90" min="1" placeholder="todos" value={f.skus} onChange={(e) => set('skus')(e.target.value)} /></div>
        <label className="inline" style={{ fontSize: 13 }}><input type="checkbox" checked={f.incluirSinOsr} onChange={(e) => set('incluirSinOsr')(e.target.checked)} /> Incluir aptos que aún no están en OSR</label>
        {cargando && <span className="note">Simulando…</span>}
      </div>
      {r && (
        <>
          <div className="grid-kpi">
            <div className="kpi good"><div className="k">Clase A dentro de {r.osr} (unidades)</div><div className="v">{pp(r.pctA.antes)} → {pp(r.pctA.despues)}</div><div className="n">participación de la clase A en el stock de {r.osr}</div></div>
            <div className="kpi good"><div className="k">Venta A atendible desde {r.osr}</div><div className="v">{pp(r.atendidaA.antes / (r.atendidaA.ventaA || 1))} → {pp(r.atendidaA.despues / (r.atendidaA.ventaA || 1))}</div><div className="n">{fmt(r.atendidaA.antes)} → {fmt(r.atendidaA.despues)} u./día de {fmt(r.atendidaA.ventaA)} u./día de venta A</div></div>
            <div className="kpi"><div className="k">A ingresar</div><div className="v">{fmt(r.unidades)} u.</div><div className="n">{fmt(r.skus)} SKU desde {fmt(r.ubicaciones)} ubicaciones · {r.porCd.map((c) => `${c.cd} ${fmt(c.unidades)}`).join(' · ') || '—'}</div></div>
            <div className="kpi"><div className="k">Picking manual que se evita</div><div className="v">{fmt(r.ahorro.operarios, 1)}</div><div className="n">operarios-turno/día · {fmt(r.ahorro.unidadesDia)} u./día ÷ {fmt(r.ahorro.pickUnHH)} u./HH (estimación)</div></div>
          </div>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <p className="note" style={{ margin: 0 }}>{fmt(r.aptos)} SKU aptos para OSR, {fmt(r.aptosEnOsr)} ya con stock en {r.osr}. {fmt(r.candidatos)} necesitan ingreso para cubrir {r.dias} días.</p>
            <button className="btn primary" disabled={!r.skus} onClick={generar}>Generar ingreso a {r.osr} ({fmt(r.ubicaciones)} tareas)</button>
          </div>
          <div className="tbl" style={{ maxHeight: 400 }}>
            <table>
              <thead><tr><th>Clase</th><th>SKU</th><th>Descripción</th><th className="num">Venta/día</th><th className="num">Stock {r.osr}</th><th className="num">Cobertura hoy</th><th className="num">Ingresar</th><th className="num">Cobertura después</th><th className="num">Stock otros CD</th><th>Desde (CD · ubicación · unidades a extraer)</th></tr></thead>
              <tbody>{r.detalle.map((x) => (
                <tr key={x.sku}><td><span className={'pill ' + tono(x.matriz)}>{x.matriz}</span></td><td className="mono">{x.sku}</td><td className="wrap">{x.desc}</td>
                  <td className="num">{fmt(x.ventaDia, 1)}</td><td className="num">{fmt(x.osr)}</td><td className="num">{fmt(x.cobAntes, 1)} d</td>
                  <td className="num"><b>{fmt(x.unidades)}</b></td><td className="num">{fmt(x.cobDespues, 1)} d</td><td className="num">{fmt(x.otros)}</td>
                  <td className="desde">{x.desde.map((t) => <div key={t.cd + t.ubic}><span className="muted">{t.cd}</span> <span className="mono">{t.ubic}</span> <b>{fmt(t.qty)} u.</b></div>)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {r.skus > r.detalle.length && <p className="note">Se muestran {fmt(r.detalle.length)} de {fmt(r.skus)} SKU (ordenados por venta diaria).</p>}
          {r.hayCol && <NoAptosOsr grupos={r.noAptos} osr={r.osr} />}
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

      <IngresoOsr onCola={rec} />

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
