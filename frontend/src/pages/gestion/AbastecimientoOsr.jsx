// Abastecimiento OSR (libro AnalisisABC_SegunEvento): simulador de eventos (pasos 2 a 4), reabasto según la
// proyección del evento (paso 5) con la lista de traslado al OSR (paso 6), e ingreso de alta rotación por días de cobertura.
import React, { useState } from 'react';
import { api, qs, urlApi, fmt, fFecha } from './api.js';
import { IrACarga, toast } from './ui.jsx';

const tono = (m) => 'm-' + ('ABC'.indexOf(m[0]) + 'XYZ'.indexOf(m[1]));

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
function IngresoOsr({ onCola = () => {} }) {
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

const pct = (v, d = 0) => (v === null || v === undefined || v === '' ? '—' : fmt(v * 100, d) + '%');
const ESCENARIOS = ['Conservador', 'Base', 'Optimista'];
const TONO_RIESGO = { QUIEBRE: 'm-4', AJUSTADO: 'm-2', OK: 'm-0', 'SIN VENTA': '', 'SIN STOCK': 'm-4' };
const TONO_RP = { 'SUBIR ANTES DEL EVENTO': 'm-2', 'REPONER DURANTE EVENTO': 'm-1', 'STOCK INSUFICIENTE': 'm-4', 'SIN STOCK': 'm-4', OK: 'm-0', 'OK (excedente en OSR)': 'm-0',
  'NO ALCANZA META': 'm-4', 'SIN SKU APTOS OSR': 'm-4', 'DEPTO NO OSR': '', ALTO: 'm-4', MEDIO: 'm-2', BAJO: '', 'SIN VENTA': '' };
const TONO_AB = { 'ABASTECER COMPLETO': 'm-0', 'PARCIAL - FALTA STOCK': 'm-2', 'SIN STOCK FUERA OSR': 'm-4' };
const LECTURA_AB = { 'ABASTECER COMPLETO': 'Completo', 'PARCIAL - FALTA STOCK': 'Parcial · falta stock', 'SIN STOCK FUERA OSR': 'Sin stock fuera de OSR' };

/** Simulación diferida (espera 250 ms a que el usuario termine de escribir). */
function useSimulacion(url, cuerpo, deps) {
  const [r, setR] = useState(null);
  const [cargando, setCargando] = useState(false);
  React.useEffect(() => {
    setCargando(true);
    const t = setTimeout(() => (cuerpo ? api.post(url, cuerpo) : api.get(url)).then(setR).catch((e) => toast(e.message, true)).finally(() => setCargando(false)), 250);
    return () => clearTimeout(t);
  }, deps);
  return [r, cargando];
}

// =============================================================================================
// Pasos 2 a 4: simulador de eventos
// =============================================================================================
function SimuladorEventos() {
  const [rec, setRec] = useState(0);
  const [todo, cargandoTodo] = useSimulacion('/api/optimizacion/eventos/todos', null, [rec]);
  const [f, setF] = useState({ clave: '', escenario: 'Base', riesgo: '', categoria: '', soloTop: false });
  const [d, cargando] = useSimulacion('/api/optimizacion/eventos/simular', f, [JSON.stringify(f), rec]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const alt = (k, v) => set(k)(f[k] === v ? '' : v);
  const eventos = todo ? [...new Map(todo.filas.map((x) => [x.clave, x])).values()] : [];
  const fila = (clave, esc) => todo?.filas.find((x) => x.clave === clave && x.escenario === esc);
  return (
    <>
      <div className="sec">
        <div className="row spread" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Eventos del calendario · 3 escenarios</h2>
          <a className="btn" href={urlApi('/api/optimizacion/eventos/todos/excel')}>Exportar resumen</a>
        </div>
        <p className="note" style={{ marginTop: -2 }}>Demanda del evento = venta diaria (ventas de 2 meses / 60) x factor de la categoría del depto en ese evento x escenario, durante los días del evento más la cobertura. Se priorizan los primeros {todo?.topN || 300} SKU elegibles para OSR por demanda x confianza XYZ. Clic en un evento para ver su detalle.</p>
        {cargandoTodo && !todo && <p className="note">Simulando todos los eventos…</p>}
        {todo && (
          <div className="tbl">
            <table>
              <thead>
                <tr><th colSpan={4} /><th colSpan={3} className="grp">Unid. sugeridas OSR (top)</th><th colSpan={3} className="grp">Faltante a subir OSR (top)</th><th colSpan={2} className="grp">Escenario base</th></tr>
                <tr><th>Evento</th><th>Ventana</th><th>Iniciar preparación</th><th className="num">Días</th>
                  {ESCENARIOS.map((e) => <th key={'s' + e} className="num">{e}</th>)}{ESCENARIOS.map((e) => <th key={'f' + e} className="num">{e}</th>)}
                  <th className="num">SKU elegibles</th><th className="num">Top en quiebre</th></tr>
              </thead>
              <tbody>{eventos.map((ev) => {
                const b = fila(ev.clave, 'Base');
                return (
                  <tr key={ev.clave} className={(d?.clave || f.clave) === ev.clave ? 'sel' : ''} style={{ cursor: 'pointer' }} onClick={() => setF({ ...f, clave: ev.clave, riesgo: '', categoria: '' })}>
                    <td><b>{ev.evento}</b></td><td className="note">{fFecha(ev.inicio)} a {fFecha(ev.fin)}</td><td>{fFecha(ev.inicioPrep)}</td>
                    <td className="num">{ev.diasAPrep <= 7 ? <span className="pill m-4">{ev.diasAPrep}</span> : ev.diasAPrep}</td>
                    {ESCENARIOS.map((e) => <td key={'s' + e} className="num">{fmt(fila(ev.clave, e)?.sugTop)}</td>)}
                    {ESCENARIOS.map((e) => <td key={'f' + e} className="num">{fmt(fila(ev.clave, e)?.faltTop)}</td>)}
                    <td className="num">{fmt(b?.elegibles)}</td><td className="num">{fmt(b?.quiebreTop)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        <p className="note">Días a preparación en rojo = 7 días o menos: empezar ya.</p>
      </div>

      {d && (
        <div className="sec">
          <div className="row spread" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>{d.evento} · {d.escenario}</h2>
            <a className="btn primary" href={urlApi('/api/optimizacion/eventos/excel' + qs({ clave: d.clave, escenario: d.escenario }))}>Exportar a Excel</a>
          </div>
          <div className="row" style={{ margin: '4px 0 12px', alignItems: 'center' }}>
            <div className="chips">{ESCENARIOS.map((e) => <button key={e} className="chip" aria-pressed={f.escenario === e} onClick={() => set('escenario')(e)}>{e}</button>)}</div>
            <span className="note">Ventana {fFecha(d.inicio)} a {fFecha(d.fin)} · horizonte {d.horizonte} días · iniciar preparación {fFecha(d.inicioPrep)}</span>
            {cargando && <span className="note">Simulando…</span>}
          </div>
          <div className="grid-kpi">
            <div className="kpi"><div className="k">SKU elegibles OSR con venta</div><div className="v">{fmt(d.elegibles)}</div><div className="n">de {fmt(d.analizados)} SKU analizados</div></div>
            <div className={'kpi ' + (d.quiebreTop ? 'warn' : 'good')}><div className="k">Top {d.topN} en riesgo de quiebre</div><div className="v">{fmt(d.quiebreTop)}</div><div className="n">stock total menor que la demanda del periodo</div></div>
            <div className="kpi good"><div className="k">Unidades sugeridas en OSR (top)</div><div className="v">{fmt(d.sugTop)}</div><div className="n">demanda del periodo (top): {fmt(d.demTop)} u.</div></div>
            <div className={'kpi ' + (d.faltTop ? 'warn' : '')}><div className="k">Faltante por subir al OSR (top)</div><div className="v">{fmt(d.faltTop)}</div><div className="n">sugerencia menos stock actual en OSR</div></div>
          </div>
          <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,3fr)' }}>
            <table>
              <thead><tr><th>Riesgo</th><th className="num">SKU</th><th className="num">En el top</th></tr></thead>
              <tbody>{d.porRiesgo.map((x) => <tr key={x.riesgo}><td><span className={'pill ' + TONO_RIESGO[x.riesgo]}>{x.riesgo}</span></td><td className="num">{fmt(x.skus)}</td><td className="num">{fmt(x.top)}</td></tr>)}</tbody>
            </table>
            <table>
              <thead><tr><th>Categoría</th><th className="num">Factor</th><th className="num">SKU</th><th className="num">En el top</th><th className="num">Sugerido (top)</th><th className="num">Faltante (top)</th></tr></thead>
              <tbody>{d.categorias.map((c) => (
                <tr key={c.categoria} className={f.categoria === c.categoria ? 'sel' : ''} style={{ cursor: 'pointer' }} onClick={() => alt('categoria', c.categoria)}>
                  <td>{c.categoria}</td><td className="num">{fmt(c.fEv, 2)}</td><td className="num">{fmt(c.skus)}</td><td className="num">{fmt(c.top)}</td><td className="num">{fmt(c.sug)}</td><td className="num">{fmt(c.falt)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="row spread" style={{ margin: '14px 0 8px' }}>
            <div className="chips">{d.porRiesgo.filter((x) => x.skus).map((x) => <button key={x.riesgo} className="chip" aria-pressed={f.riesgo === x.riesgo} onClick={() => alt('riesgo', x.riesgo)}>{x.riesgo} · {fmt(x.skus)}</button>)}</div>
            <div className="row" style={{ alignItems: 'center' }}>
              {f.categoria && <button className="chip" aria-pressed onClick={() => set('categoria')('')}>{f.categoria} ✕</button>}
              <label className="inline" style={{ fontSize: 13 }}><input type="checkbox" checked={f.soloTop} onChange={(e) => set('soloTop')(e.target.checked)} /> Solo el top {d.topN}</label>
            </div>
          </div>
          <div className="tbl" style={{ maxHeight: 440 }}>
            <table>
              <thead><tr><th className="num">Rank</th><th>Clase</th><th>SKU</th><th>Descripción</th><th>Categoría</th><th className="num">Venta/día</th><th className="num">Factor</th><th className="num">Demanda/día evento</th>
                <th className="num">Demanda periodo</th><th className="num">Stock</th><th className="num">En OSR</th><th className="num">Cobertura</th><th>Riesgo</th><th>OSR</th><th className="num">Sugerencia</th><th className="num">Faltante</th><th className="num">Prioridad</th></tr></thead>
              <tbody>{d.detalle.map((x) => (
                <tr key={x.sku}><td className="num">{x.rank}</td><td><span className={'pill ' + tono(x.matriz)}>{x.matriz}</span></td><td className="mono">{x.sku}</td><td className="wrap">{x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></td>
                  <td className="note">{x.categoria}</td><td className="num">{fmt(x.dBase, 2)}</td><td className="num">{fmt(x.fEv, 2)}</td><td className="num">{fmt(x.dDia, 2)}</td><td className="num">{fmt(x.dPer, 1)}</td>
                  <td className="num">{fmt(x.stock)}</td><td className="num">{fmt(x.osr)}</td><td className="num">{x.cob === null ? '—' : `${fmt(x.cob, 1)} d`}</td>
                  <td><span className={'pill ' + TONO_RIESGO[x.riesgo]}>{x.riesgo}</span></td>
                  <td className="note">{x.eleg ? 'Elegible' : 'No'}{x.prior ? ' · prioritario' : ''}</td>
                  <td className="num">{x.sug ? <b>{fmt(x.sug)}</b> : '—'}</td><td className="num">{x.falt ? fmt(x.falt) : '—'}</td><td className="num">{x.prioridad || ''}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {d.filtrados > d.detalle.length && <p className="note">Se muestran {fmt(d.detalle.length)} de {fmt(d.filtrados)} SKU (por demanda x confianza XYZ). El Excel trae todos.</p>}
        </div>
      )}

      <ConfigEventos onGuardar={() => setRec(rec + 1)} />
    </>
  );
}

/** Calendario de eventos, factores por categoría y categoría de cada depto (hojas MKT_Eventos, MKT_Categorias y MKT_Deptos del libro). */
function ConfigEventos({ onGuardar }) {
  const [abierto, setAbierto] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [dep, setDep] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const cargar = () => Promise.all([api.get('/api/optimizacion/eventos/config'), api.get('/api/optimizacion/eventos/deptos')])
    .then(([c, d]) => { setCfg(c); setDep(d); }).catch((e) => toast(e.message, true));
  React.useEffect(() => { if (abierto && !cfg) cargar(); }, [abierto]);
  const guardar = async (cuerpo, msg) => {
    setGuardando(true);
    try { setCfg(await api.post('/api/optimizacion/eventos/config', cuerpo)); setDep(await api.get('/api/optimizacion/eventos/deptos')); toast(msg); onGuardar(); }
    catch (e) { toast(e.message, true); } finally { setGuardando(false); }
  };
  const restablecer = async () => {
    if (!window.confirm('¿Volver el calendario y las categorías a los valores del libro? La categoría asignada a cada depto se mantiene.')) return;
    try { setCfg(await api.post('/api/optimizacion/eventos/config/restablecer')); toast('Calendario y categorías restablecidos.'); onGuardar(); } catch (e) { toast(e.message, true); }
  };
  const setEv = (i, k, v) => setCfg({ ...cfg, eventos: cfg.eventos.map((e, j) => (j === i ? { ...e, [k]: v } : e)) });
  const setCat = (i, k, v) => setCfg({ ...cfg, categorias: cfg.categorias.map((c, j) => (j === i ? (k === 'palabras' ? { ...c, palabras: v } : { ...c, factores: { ...c.factores, [k]: v } }) : c)) });
  const claves = cfg ? [...new Set(cfg.eventos.map((e) => e.clave))] : [];
  return (
    <div className="sec">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Calendario, categorías y deptos</h2>
        <button className="btn sm" onClick={() => setAbierto(!abierto)}>{abierto ? 'Ocultar' : 'Configurar'}</button>
      </div>
      {abierto && !cfg && <p className="note">Cargando…</p>}
      {abierto && cfg && (
        <>
          <h3>Eventos</h3>
          <div className="tbl">
            <table>
              <thead><tr><th>Evento</th><th>Clave</th><th>Inicio</th><th>Fin</th><th className="num">Días preparación</th><th className="num">Días cobertura post</th><th>Fecha</th><th>Nota / fuente</th><th /></tr></thead>
              <tbody>{cfg.eventos.map((e, i) => (
                <tr key={i}>
                  <td><input value={e.evento} onChange={(x) => setEv(i, 'evento', x.target.value)} /></td>
                  <td><input className="w90" value={e.clave} onChange={(x) => setEv(i, 'clave', x.target.value.toUpperCase())} /></td>
                  <td><input type="date" value={e.inicio} onChange={(x) => setEv(i, 'inicio', x.target.value)} /></td>
                  <td><input type="date" value={e.fin} onChange={(x) => setEv(i, 'fin', x.target.value)} /></td>
                  <td><input type="number" className="w90" min="0" value={e.prep} onChange={(x) => setEv(i, 'prep', x.target.value)} /></td>
                  <td><input type="number" className="w90" min="0" value={e.cob} onChange={(x) => setEv(i, 'cob', x.target.value)} /></td>
                  <td><input value={e.fecha} onChange={(x) => setEv(i, 'fecha', x.target.value)} /></td>
                  <td><input value={e.nota} onChange={(x) => setEv(i, 'nota', x.target.value)} /></td>
                  <td><button className="btn sm danger" onClick={() => setCfg({ ...cfg, eventos: cfg.eventos.filter((_, j) => j !== i) })}>Quitar</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="row" style={{ margin: '8px 0 18px' }}>
            <button className="btn sm" onClick={() => setCfg({ ...cfg, eventos: [...cfg.eventos, { evento: '', clave: '', inicio: '', fin: '', prep: 21, cob: 0, fecha: '', nota: '' }] })}>Agregar evento</button>
            <button className="btn primary sm" disabled={guardando} onClick={() => guardar({ eventos: cfg.eventos }, 'Calendario guardado.')}>Guardar calendario</button>
          </div>

          <h3>Factor por categoría y evento</h3>
          <p className="note" style={{ marginTop: -4 }}>1,00 = venta normal; 2,50 = 2,5 veces la venta diaria normal durante el evento. Un evento nuevo necesita su columna: se usa su clave. Las palabras clave sugieren la categoría desde el nombre del depto. Recalibra después de cada evento con la salida real.</p>
          <div className="tbl">
            <table>
              <thead><tr><th>Categoría</th>{claves.map((k) => <th key={k} className="num">{k}</th>)}<th>Palabras clave (separadas por |)</th></tr></thead>
              <tbody>{cfg.categorias.map((c, i) => (
                <tr key={c.categoria}><td><b>{c.categoria}</b></td>
                  {claves.map((k) => <td key={k}><input type="number" step="0.05" min="0" style={{ width: 70 }} value={c.factores?.[k] ?? ''} placeholder="1" onChange={(x) => setCat(i, k, x.target.value)} /></td>)}
                  <td><input style={{ minWidth: 260 }} value={c.palabras} onChange={(x) => setCat(i, 'palabras', x.target.value)} /></td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="row" style={{ margin: '8px 0 18px' }}>
            <button className="btn primary sm" disabled={guardando} onClick={() => guardar({ categorias: cfg.categorias }, 'Categorías guardadas.')}>Guardar categorías</button>
            <button className="btn sm" onClick={restablecer}>Restablecer valores del libro</button>
          </div>

          <h3>Categoría de cada depto</h3>
          <p className="note" style={{ marginTop: -4 }}>Revisa los "SIN MATCH": quedan en GENERAL. Depto OSR = está en la lista de deptos que se trabajan en OSR (Configuración).</p>
          {dep && (
            <div className="tbl" style={{ maxHeight: 380 }}>
              <table>
                <thead><tr><th>Depto</th><th className="num">SKU en base</th><th>Categoría</th><th>Origen</th><th>Depto OSR</th></tr></thead>
                <tbody>{dep.deptos.map((x) => (
                  <tr key={x.depto}><td>{x.depto}</td><td className="num">{fmt(x.skus)}</td>
                    <td><select value={cfg.deptos[x.depto] || x.sugerida} onChange={(e) => setCfg({ ...cfg, deptos: { ...cfg.deptos, [x.depto]: e.target.value === x.sugerida ? '' : e.target.value } })}>
                      {dep.categorias.map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
                    <td>{cfg.deptos[x.depto] ? <span className="tag">MANUAL</span> : x.origen.startsWith('SIN') ? <span className="pill m-2">{x.origen}</span> : <span className="note">AUTO</span>}</td>
                    <td>{x.osr ? 'SI' : ''}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary sm" disabled={guardando} onClick={() => guardar({ deptos: cfg.deptos }, 'Categorías de los deptos guardadas.')}>Guardar deptos</button>
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================================================
// Pasos 5 y 6: reabasto por proyección y abastecimiento
// =============================================================================================
const VISTAS_RP = [['det', 'Plan por SKU (RP_Detalle)'], ['no', 'SKU no aptos (RP_NoAptos)'], ['ab', 'Abastecimiento (AB_Resumen)'], ['pick', 'Lista de traslado (AB_Picking)']];

function ReabastoProyeccion() {
  const [f, setF] = useState({ pctOsr: '', colchon: '', olas: '', minimo: '', incluirNoAptos: false, estado: '', depto: '' });
  const [rec, setRec] = useState(0);
  const [vista, setVista] = useState('det');
  const cuerpo = { ...f, pctOsr: f.pctOsr === '' ? '' : Number(f.pctOsr) / 100, colchon: f.colchon === '' ? '' : Number(f.colchon) / 100 };
  const [r, cargando] = useSimulacion('/api/optimizacion/abastecimiento/simular', cuerpo, [JSON.stringify(f), rec]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const alt = (k, v) => set(k)(f[k] === v ? '' : v);
  const quitar = async () => { try { await api.post('/api/optimizacion/abastecimiento/proyeccion/borrar'); setRec(rec + 1); } catch (e) { toast(e.message, true); } };
  const osr = r?.osr || 'OSR';
  const g = r?.g, c = r?.conf;
  const excel = urlApi('/api/optimizacion/abastecimiento/excel' + qs({ pctOsr: cuerpo.pctOsr, colchon: cuerpo.colchon, olas: f.olas, minimo: f.minimo, incluirNoAptos: f.incluirNoAptos ? '1' : '' }));
  const estados = !r?.proy ? [] : vista === 'det' ? r.estadosDet.map((x) => [x.e, x.n]) : vista === 'no' ? r.estadosNo.map((x) => [x.e, x.n]) : r.ab.porEstado.filter((x) => x.skus).map((x) => [x.estado, x.skus]);
  const cambiarVista = (v) => { setVista(v); if (f.estado) setF({ ...f, estado: '' }); };
  const tile = (k, v, cls = '', n = '') => <div className={'kpi ' + cls}><div className="k">{k}</div><div className="v">{v}</div>{n && <div className="n">{n}</div>}</div>;
  return (
    <div className="sec">
      <div className="row spread" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Reabasto {osr} según proyección del evento{r?.proy ? ` · ${r.proy.evento}` : ''}</h2>
        {r?.proy && <a className="btn primary" href={excel}>Exportar a Excel</a>}
      </div>
      <p className="note" style={{ marginTop: -2 }}>Meta {osr} del depto = unidades proyectadas (hoja Pro_Evt) x % {osr} x (1 + colchón), solo en los deptos que se trabajan en {osr}. Participan los SKU del depto con Logística OSR = "Y" o con stock en {osr}, de las clases configuradas. La meta se reparte según venta x confianza XYZ (X {c?.pesos.X}, Y {c?.pesos.Y}, Z {c?.pesos.Z}), con tope en el stock del SKU: lo que no cabe pasa a los demás. Cada SKU con meta recibe al menos {c?.minPri} u. Luego se arma la lista de traslado desde las ubicaciones fuera de {osr}, primero la que tiene más unidades del SKU.</p>

      <div className="row cons-ctrl" style={{ margin: '10px 0 14px', alignItems: 'flex-end' }}>
        <fieldset className="cons-ruta">
          <legend className="lbl">Proyección del evento (Pro_Evt)</legend>
          <div className="row" style={{ alignItems: 'center' }}>
            {r?.proy ? <span><b>{r.proy.evento}</b> <span className="note">· {r.proy.archivo} · {r.proy.filas} filas · cargada {fFecha(r.proy.cargado)}</span></span> : <span className="note">Sin proyección cargada</span>}
            <IrACarga id="proevt" etiqueta={r?.proy ? 'Reemplazar Pro_Evt (en Datos)' : 'Cargar Pro_Evt (en Datos)'} />
            {r?.proy && <button className="btn sm" onClick={quitar}>Quitar</button>}
          </div>
        </fieldset>
        {r?.proy && c && (
          <>
            <div><label className="lbl" htmlFor="rp-pct">% {osr}</label><input id="rp-pct" type="number" className="w90" min="0" max="100" placeholder={fmt(c.pctG * 100, 0)} value={f.pctOsr} onChange={(e) => set('pctOsr')(e.target.value)} /></div>
            <div><label className="lbl" htmlFor="rp-col">Colchón %</label><input id="rp-col" type="number" className="w90" min="0" placeholder={fmt(c.colchon * 100, 0)} value={f.colchon} onChange={(e) => set('colchon')(e.target.value)} /></div>
            <div><label className="lbl" htmlFor="rp-olas">Olas de carga</label><input id="rp-olas" type="number" className="w90" min="1" max="10" placeholder={c.olas} value={f.olas} onChange={(e) => set('olas')(e.target.value)} /></div>
            <div><label className="lbl" htmlFor="rp-min">Mínimo por SKU</label><input id="rp-min" type="number" className="w90" min="0" placeholder={c.minPri} value={f.minimo} onChange={(e) => set('minimo')(e.target.value)} /></div>
          </>
        )}
        {cargando && <span className="note">Calculando…</span>}
      </div>

      {r && !r.proy && <div className="alert">Carga la proyección del evento: un Excel con <b>Departamento</b>, <b>Desc Dpto</b> y <b>Unidades proyectadas</b> (opcional <b>% OSR</b> por depto). Puedes partir del archivo de ejemplo.</div>}
      {r?.proy && g && (
        <>
          {!r.hayCol && <div className="alert warn">La Base no trae la columna "Logística OSR": todos los SKU cuentan como aptos.</div>}
          {r.noEnc.length > 0 && <div className="alert warn">Deptos de la proyección sin SKU en la Base: {r.noEnc.join(' · ')}</div>}
          <div className="grid-kpi">
            {tile('Unidades proyectadas', fmt(g.tP), '', `${fmt(g.tPO)} (${pct(g.tP ? g.tPO / g.tP : 0)}) en ${g.nDO} deptos ${osr}`)}
            {tile(`Meta ${osr}`, fmt(g.tM), '', `${pct(c.pctG)} de lo proyectado en deptos ${osr}${c.colchon ? ` + colchón ${pct(c.colchon)}` : ''}`)}
            {tile('Meta cubierta con stock actual', pct(g.cob, 1), g.cob >= 0.9995 ? 'good' : g.cob >= 0.85 ? 'warn' : 'bad', g.brecha > 0 ? `brecha ${fmt(g.brecha)} u.` : 'sin brecha')}
            {tile(`Subir al ${osr} antes del evento`, fmt(g.tAn), 'warn', c.olas > 1 ? `reponer durante: ${fmt(g.tD)} u. (${c.olas} cargas)` : `stock actual en ${osr}: ${fmt(g.tOsr)} u.`)}
            {tile(`Pickeable desde ${osr}`, `${pct(g.pHoy, 1)} → ${pct(g.pPot, 1)}`, '', `del total del evento, hoy → habilitando no aptos · ${fmt(g.tNoV)} SKU no aptos con venta`)}
          </div>
          <ul className="lista-lectura">{r.lectura.map((l, i) => <li key={i}>{l}</li>)}</ul>

          <div className="tbl" style={{ maxHeight: 380, marginTop: 12 }}>
            <table>
              <thead><tr><th>Depto</th><th className="num">Proyectadas</th><th className="num">% {osr}</th><th className="num">Meta</th><th className="num">% en no aptos</th><th className="num">Stock en {osr}</th>
                <th className="num">Cubierta</th><th className="num">Cobertura</th><th className="num">Habilitando no aptos</th><th className="num">Brecha</th><th className="num">Subir antes</th><th className="num">Reponer durante</th><th>Estado</th></tr></thead>
              <tbody>
                {r.deptos.map((x) => (
                  <tr key={x.nom} className={f.depto === x.nom ? 'sel' : ''} style={{ cursor: 'pointer' }} onClick={() => alt('depto', x.nom)} title="Filtrar por este depto">
                    <td>{x.nom}</td><td className="num">{fmt(x.proy)}</td><td className="num">{pct(x.pct)}</td><td className="num">{fmt(x.meta)}</td><td className="num">{pct(x.pctNo)}</td>
                    <td className="num">{fmt(x.osrStock)}</td><td className="num">{fmt(x.asig)}</td><td className="num">{pct(x.cob, 1)}</td><td className="num">{pct(x.pot, 1)}</td>
                    <td className="num">{x.brecha ? <b style={{ color: 'var(--bad)' }}>{fmt(x.brecha)}</b> : '—'}</td><td className="num">{fmt(x.antes)}</td><td className="num">{fmt(x.durante)}</td>
                    <td><span className={'pill ' + TONO_RP[x.estado]}>{x.estado}</span></td></tr>
                ))}
                <tr className="tot"><td>Total</td><td className="num">{fmt(g.tP)}</td><td /><td className="num">{fmt(g.tM)}</td><td /><td className="num">{fmt(r.deptos.reduce((s, x) => s + x.osrStock, 0))}</td>
                  <td className="num">{fmt(g.tA)}</td><td className="num">{pct(g.cob, 1)}</td><td className="num">{pct(g.tM ? g.tPot / g.tM : 0, 1)}</td><td className="num">{fmt(g.brecha)}</td><td className="num">{fmt(g.tAn)}</td><td className="num">{fmt(g.tD)}</td><td /></tr>
              </tbody>
            </table>
          </div>
          <p className="note">Cobertura baja con mucho proyectado en SKU no aptos = la palanca es habilitar esos SKU en Logística OSR, no comprar más. Clic en un depto para filtrar.</p>

          <div className="row spread" style={{ margin: '14px 0 8px' }}>
            <div className="chips">{VISTAS_RP.map(([k, t]) => <button key={k} className="chip" aria-pressed={vista === k} onClick={() => cambiarVista(k)}>{t}</button>)}</div>
            {(vista === 'ab' || vista === 'pick') && <label className="inline" style={{ fontSize: 13 }}><input type="checkbox" checked={f.incluirNoAptos} onChange={(e) => setF({ ...f, incluirNoAptos: e.target.checked, estado: '' })} /> Incluir no aptos (requieren habilitar {osr})</label>}
          </div>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <div className="chips">{estados.map(([e, n]) => <button key={e} className="chip" aria-pressed={f.estado === e} onClick={() => alt('estado', e)}>{LECTURA_AB[e] || e} · {fmt(n)}</button>)}</div>
            {f.depto && <button className="chip" aria-pressed onClick={() => set('depto')('')}>{f.depto} ✕</button>}
          </div>

          {(vista === 'ab' || vista === 'pick') && (
            <div className="grid-kpi">
              {tile(`A trasladar a ${osr}`, `${fmt(r.ab.tot.total)} u.`, 'good', `${fmt(r.ab.tot.skus)} SKU · antes ${fmt(r.ab.tot.antes)} · durante ${fmt(r.ab.tot.durante)}`)}
              {tile('Lista de traslado', `${fmt(r.ab.tot.lineas)} líneas`, '', `${fmt(r.ab.tot.ubicaciones)} ubicaciones de origen`)}
              {tile(`Faltante sin stock fuera de ${osr}`, `${fmt(r.ab.tot.faltante)} u.`, r.ab.tot.faltante ? 'warn' : '', 'requiere compra, tránsito o redistribución')}
              {tile('Por CD de origen', r.ab.porCd.map((x) => x.cd).join(' · ') || '—', '', r.ab.porCd.map((x) => `${x.cd} ${fmt(x.total)}`).join(' · '))}
            </div>
          )}

          {vista === 'det' && (
            <Tabla total={r.detalle.total} n={r.detalle.filas.length}
              enc={['Prior.', 'Clase', 'SKU', 'Descripción', 'Ventas', 'Sell-through', 'Particip.', 'Motivo apto', `En ${osr}`, `Fuera ${osr}`, 'Meta ideal', `Meta ${osr}`, 'Carga previa', 'Subir antes', 'Reponer durante', 'Excedente', 'Estado']}
              num={[0, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15]}
              filas={r.detalle.filas.map((x) => [x.prioridad, <span className={'pill ' + tono(x.matriz)}>{x.matriz}</span>, <span className="mono">{x.sku}</span>, <>{x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></>,
                fmt(x.vta), pct(x.st), pct(x.partic, 1), <span className="note">{x.motivo}</span>, fmt(x.osr), fmt(x.fuera), fmt(x.ideal, 1), <b>{fmt(x.meta)}</b>, fmt(x.previa),
                x.antes ? <b>{fmt(x.antes)}</b> : '—', x.durante ? fmt(x.durante) : '—', x.exced ? fmt(x.exced) : '—', <span className={'pill ' + TONO_RP[x.estado]}>{x.estado}</span>])} />
          )}
          {vista === 'no' && (
            <Tabla total={r.noAptos.total} n={r.noAptos.filas.length}
              enc={['Prior.', 'Clase', 'SKU', 'Descripción', 'Ventas', '% venta depto', 'Unid. atribuibles', 'Stock', `En ${osr}`, 'Logística OSR', 'Aporte potencial', 'Impacto', 'Recomendación']}
              num={[0, 4, 5, 6, 7, 8, 10]}
              filas={r.noAptos.filas.map((x) => [x.prioridad, <span className={'pill ' + tono(x.matriz)}>{x.matriz}</span>, <span className="mono">{x.sku}</span>, <>{x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></>,
                fmt(x.vta), pct(x.pctVenta, 1), fmt(x.unAtr), fmt(x.qty), fmt(x.osr), x.log, x.potAl ? <b>{fmt(x.potAl)}</b> : '—', <span className={'pill ' + TONO_RP[x.impacto]}>{x.impacto}</span>, <span className="note">{x.recomendacion}</span>])} />
          )}
          {vista === 'ab' && (
            <Tabla total={r.ab.total} n={r.ab.filas.length}
              enc={['Prior.', 'Clase', 'SKU', 'Descripción', 'Tipo', `Meta ${osr}`, `En ${osr}`, 'Subir antes', 'Reponer durante', 'Total', `Fuera ${osr}`, 'Asignado', 'Faltante', 'Ubic.', 'Estado']}
              num={[0, 5, 6, 7, 8, 9, 10, 11, 12, 13]}
              filas={r.ab.filas.map((x) => [x.prioridad, <span className={'pill ' + tono(x.matriz)}>{x.matriz}</span>, <span className="mono">{x.sku}</span>, <>{x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></>,
                x.tipo === 'APTO OSR' ? <span className="note">Apto</span> : <span className="tag">requiere habilitar</span>, fmt(x.meta), fmt(x.osr), fmt(x.antes), fmt(x.durante), <b>{fmt(x.total)}</b>, fmt(x.fuera), fmt(x.asignado),
                x.faltante ? <b style={{ color: 'var(--bad)' }}>{fmt(x.faltante)}</b> : '—', x.nUb || '—', <span className={'pill ' + TONO_AB[x.estado]}>{LECTURA_AB[x.estado]}</span>])} />
          )}
          {vista === 'pick' && (
            <Tabla total={r.ab.lineas} n={r.ab.picking.length}
              enc={['Nro', 'Ola', 'CD origen', 'Ubicación', 'SKU', 'Descripción', 'Unid. a mover', 'Stock al retirar', 'Saldo', 'Prior. SKU']}
              num={[0, 6, 7, 8, 9]}
              filas={r.ab.picking.map((l) => [l.nro, <span className={'pill ' + (l.ola[0] === '1' ? 'm-2' : 'm-1')}>{l.ola[0] === '1' ? 'Antes' : 'Durante'}</span>, l.cd, <span className="mono">{l.ubic}</span>,
                <span className="mono">{l.sku}</span>, <>{l.desc}{l.tipo !== 'APTO OSR' && <div><span className="tag">requiere habilitar {osr}</span></div>}</>, <b>{fmt(l.unidades)}</b>, fmt(l.stockAntes), fmt(l.saldo), l.prioridad])} />
          )}
        </>
      )}
    </div>
  );
}

function Tabla({ enc, num, filas, total, n }) {
  return (
    <>
      <div className="tbl" style={{ maxHeight: 440 }}>
        <table>
          <thead><tr>{enc.map((e, j) => <th key={j} className={num.includes(j) ? 'num' : ''}>{e}</th>)}</tr></thead>
          <tbody>{filas.map((f, i) => <tr key={i}>{f.map((v, j) => <td key={j} className={num.includes(j) ? 'num' : j === 3 ? 'wrap' : ''}>{v}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {total > n && <p className="note">Se muestran {fmt(n)} de {fmt(total)} filas. El Excel trae todas.</p>}
      {!total && <p className="note">Sin filas para este filtro.</p>}
    </>
  );
}

const PESTANAS = [['eventos', 'Simulador de eventos'], ['reabasto', 'Reabasto por proyección'], ['rotacion', 'Ingreso de alta rotación']];

export default function AbastecimientoOsrVista() {
  const [vista, setVista] = useState('reabasto');
  return (
    <>
      <div className="top">
        <h1>Abastecimiento OSR</h1>
        <div className="chips">{PESTANAS.map(([k, t]) => <button key={k} className="chip" aria-pressed={vista === k} onClick={() => setVista(k)}>{t}</button>)}</div>
      </div>
      {vista === 'eventos' && <SimuladorEventos />}
      {vista === 'reabasto' && <ReabastoProyeccion />}
      {vista === 'rotacion' && <IngresoOsr />}
    </>
  );
}
