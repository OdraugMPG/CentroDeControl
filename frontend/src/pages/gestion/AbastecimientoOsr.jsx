// Abastecimiento OSR (libro AnalisisABC_SegunEvento): simulador de eventos (pasos 2 a 4), reabasto según la
// proyección del evento (paso 5) con la lista de traslado al OSR (paso 6), potencial de SKU fuera de OSR por clase ABC/XYZ
// e ingreso de alta rotación por días de cobertura.
import React, { useState } from 'react';
import { api, qs, urlApi, fmt, fFecha } from './api.js';
import { IrACarga, toast } from './ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { css } from '../../lib/fmt.js';

const tono = (m) => 'm-' + ('ABC'.indexOf(m[0]) + 'XYZ'.indexOf(m[1]));

const TONO = { A: 'm-0', B: 'm-2', C: 'm-4' };
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
  'NO ALCANZA META': 'm-4', 'SIN SKU APTOS OSR': 'm-4', 'DEPTO NO OSR': '', ALTO: 'm-4', MEDIO: 'm-2', BAJO: '', 'SIN VENTA': '', 'MARCA N': '' };
const TONO_AB = { 'ABASTECER COMPLETO': 'm-0', 'PARCIAL - FALTA STOCK': 'm-2', 'LIMITADO POR STOCK DE SEGURIDAD': 'm-1', 'BAJO EL MINIMO A TRASLADAR': 'm-1', 'SIN STOCK FUERA OSR': 'm-4' };
const LECTURA_AB = { 'ABASTECER COMPLETO': 'Completo', 'PARCIAL - FALTA STOCK': 'Parcial · falta stock', 'LIMITADO POR STOCK DE SEGURIDAD': 'Limitado por stock de seguridad', 'BAJO EL MINIMO A TRASLADAR': 'Bajo el mínimo a trasladar', 'SIN STOCK FUERA OSR': 'Sin stock fuera de OSR' };

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
const VISTAS_RP = [['det', 'Plan por SKU (RP_Detalle)'], ['no', 'SKU no aptos (RP_NoAptos)'], ['ab', 'Abastecimiento (AB_Resumen)'], ['pick', 'Lista de traslado (AB_Picking)'], ['esp', 'Espacio que se libera (AB_Espacio)']];

const ALCANCE_VER = { OSR: 'OSR', 'OTROS CD': 'Otros CD', 'SIN BASE': 'Sin SKU en Base' };
const ESTADO_VER = { SUBE: ['Sube', 'ok'], BAJA: ['Baja', 'mid'], NUEVO: ['Nuevo', 'ok'], QUITADO: ['Quitado', 'bad'], IGUAL: ['Igual', ''] };

// variación por depto entre dos versiones cargadas de la proyección del evento; permite dejar activa otra versión
function VariacionProyeccion({ rec, onActivar }) {
  const [sel, setSel] = useState({ a: '', b: '' });
  const [filtro, setFiltro] = useState('');
  const [r] = useSimulacion('/api/optimizacion/abastecimiento/proyeccion/versiones', sel, [JSON.stringify(sel), rec]);
  if (!r) return null;
  if (r.versiones.length < 2 || !r.comp) {
    return <p className="note">Variación entre versiones: aún hay {r.versiones.length} versión cargada. Al cargar una nueva proyección (o un libro con varias hojas Pro_Evt con fecha) se compara aquí contra la anterior.</p>;
  }
  const { a, b, tot, deptos, analisis: an } = r.comp;
  const hora = (v) => (v.en ? new Date(v.en).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '');
  const nom = (v) => `${v.evento}${v.activa ? ' (activa)' : ''} · ${fmt(v.unidades)} u. · ${fFecha(v.cargado)} ${hora(v)}`;
  const activar = async (id) => { try { await api.post('/api/optimizacion/abastecimiento/proyeccion/activar', { id }); toast('Versión activada: el reabasto usa esta proyección.'); onActivar(); } catch (e) { toast(e.message, true); } };
  const pct = (x) => (x === null ? '—' : `${x > 0 ? '+' : ''}${fmt(x * 100, 1)}%`);
  const l = deptos.filter((d) => !filtro || d.estado === filtro);
  return (
    <div className="sec" style={{ marginTop: 18 }}>
      <div className="row spread" style={{ alignItems: 'flex-end', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Variación de la proyección por departamento</h3>
        <div className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
          <div><label className="lbl" htmlFor="vp-a">Versión anterior</label>
            <select id="vp-a" value={a.id} onChange={(e) => setSel({ ...sel, a: e.target.value, b: b.id })}>{r.versiones.filter((v) => v.id !== b.id).map((v) => <option key={v.id} value={v.id}>{nom(v)}</option>)}</select></div>
          <div><label className="lbl" htmlFor="vp-b">Versión nueva</label>
            <select id="vp-b" value={b.id} onChange={(e) => setSel({ a: e.target.value === a.id ? '' : a.id, b: e.target.value })}>{r.versiones.map((v) => <option key={v.id} value={v.id}>{nom(v)}</option>)}</select></div>
          {!b.activa && <button className="btn sm" onClick={() => activar(b.id)}>Usar la versión nueva en el reabasto</button>}
        </div>
      </div>
      <div className="grid-kpi">
        <div className="kpi"><div className="k">Unidades anterior</div><div className="v">{fmt(tot.a)}</div><div className="n">{a.deptos} deptos · {a.hoja || a.archivo}</div></div>
        <div className="kpi"><div className="k">Unidades nueva</div><div className="v">{fmt(tot.b)}</div><div className="n">{b.deptos} deptos · {b.hoja || b.archivo}</div></div>
        <div className={'kpi ' + (tot.dif >= 0 ? 'good' : 'warn')}><div className="k">Variación</div><div className="v">{tot.dif > 0 ? '+' : ''}{fmt(tot.dif)}</div><div className="n">{pct(tot.var)} sobre la anterior</div></div>
        <div className="kpi"><div className="k">Deptos</div><div className="v">{fmt(tot.sube)} ↑ · {fmt(tot.baja)} ↓</div><div className="n">{fmt(tot.nuevo)} nuevos · {fmt(tot.quitado)} quitados · {fmt(tot.igual)} sin cambio</div></div>
      </div>
      <div className="chips" style={{ margin: '4px 0 8px' }}>
        <button className="chip" aria-pressed={!filtro} onClick={() => setFiltro('')}>Todos · {deptos.length}</button>
        {Object.entries(ESTADO_VER).map(([k, [t]]) => tot[k.toLowerCase()] > 0 && <button key={k} className="chip" aria-pressed={filtro === k} onClick={() => setFiltro(filtro === k ? '' : k)}>{t} · {tot[k.toLowerCase()]}</button>)}
      </div>
      <div className="tbl" style={{ maxHeight: 460 }}>
        <table>
          <thead><tr><th>Depto</th><th>Descripción</th><th className="num">Anterior</th><th className="num">Nueva</th><th className="num">Variación u.</th><th className="num">Variación %</th>
            <th className="num">Part. anterior</th><th className="num">Part. nueva</th><th>Alcance</th><th className="num">Var. meta OSR</th><th>Estado</th></tr></thead>
          <tbody>
            {l.map((d) => (
              <tr key={d.cod + d.nom}>
                <td className="mono">{d.cod}</td><td>{d.nom}</td><td className="num">{fmt(d.a)}</td><td className="num">{fmt(d.b)}</td>
                <td className="num"><b>{d.dif > 0 ? '+' : ''}{fmt(d.dif)}</b></td><td className="num">{pct(d.var)}</td>
                <td className="num">{fmt(d.partA * 100, 1)}%</td><td className="num">{fmt(d.partB * 100, 1)}%</td>
                <td className="note">{ALCANCE_VER[d.alcance]}</td><td className="num">{d.alcance === 'OSR' && Math.round(d.difMeta) ? `${d.difMeta > 0 ? '+' : ''}${fmt(d.difMeta, 0)}` : <span className="muted">—</span>}</td>
                <td><span className={'pill ' + ESTADO_VER[d.estado][1]}>{ESTADO_VER[d.estado][0]}</span></td>
              </tr>
            ))}
            <tr><td colSpan={2}><b>Total</b></td><td className="num"><b>{fmt(tot.a)}</b></td><td className="num"><b>{fmt(tot.b)}</b></td><td className="num"><b>{tot.dif > 0 ? '+' : ''}{fmt(tot.dif)}</b></td><td className="num"><b>{pct(tot.var)}</b></td><td colSpan={3} /><td className="num"><b>{an.meta.dif > 0 ? '+' : ''}{fmt(an.meta.dif, 0)}</b></td><td /></tr>
          </tbody>
        </table>
      </div>

      <h3 style={{ margin: '18px 0 6px' }}>Análisis de la variación</h3>
      <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', alignItems: 'start' }}>
        <ul className="lectura" style={{ margin: 0, paddingLeft: 18 }}>{an.lectura.map((t, i) => <li key={i} style={{ marginBottom: 4 }}>{t}</li>)}</ul>
        <div>
          <div className="tbl">
            <table>
              <thead><tr><th>Alcance</th><th className="num">Deptos</th><th className="num">Anterior</th><th className="num">Nueva</th><th className="num">Variación</th><th className="num">%</th></tr></thead>
              <tbody>
                {an.porAlcance.map((x) => (
                  <tr key={x.alcance}><td>{ALCANCE_VER[x.alcance]}</td><td className="num">{x.deptos}</td><td className="num">{fmt(x.a)}</td><td className="num">{fmt(x.b)}</td>
                    <td className="num"><b>{x.dif > 0 ? '+' : ''}{fmt(x.dif)}</b></td><td className="num">{pct(x.var)}</td></tr>
                ))}
                <tr><td><b>Total evento</b></td><td className="num">{deptos.length}</td><td className="num"><b>{fmt(tot.a)}</b></td><td className="num"><b>{fmt(tot.b)}</b></td><td className="num"><b>{tot.dif > 0 ? '+' : ''}{fmt(tot.dif)}</b></td><td className="num"><b>{pct(tot.var)}</b></td></tr>
                <tr><td>Meta OSR</td><td /><td className="num">{fmt(an.meta.a, 0)}</td><td className="num">{fmt(an.meta.b, 0)}</td><td className="num"><b>{an.meta.dif > 0 ? '+' : ''}{fmt(an.meta.dif, 0)}</b></td><td className="num">{pct(an.meta.var)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="note">Movimiento bruto entre deptos: {fmt(an.bruto)} unid. · los 5 deptos con más cambio explican el {fmt(an.concentracion * 100, 0)}%.</p>
        </div>
      </div>
    </div>
  );
}

// orden por columna de una tabla: clic ordena (texto A-Z, números de mayor a menor), segundo clic invierte
function useOrden(inicial = { k: '', dir: 1 }) {
  const [ord, setOrd] = useState(inicial);
  const th = (k, txt, cls = 'num') => (
    <th key={k} className={cls} aria-sort={ord.k === k ? (ord.dir > 0 ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="th-ord" title="Ordenar" onClick={() => setOrd(ord.k === k ? { k, dir: -ord.dir } : { k, dir: cls === 'num' ? -1 : 1 })}>
        {txt}<span className="flecha" aria-hidden="true">{ord.k === k ? (ord.dir > 0 ? '▲' : '▼') : '↕'}</span></button></th>
  );
  const ordenar = (l) => (!ord.k ? l : [...l].sort((a, b) => {
    const va = a[ord.k], vb = b[ord.k];
    if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1; // vacíos al final
    if (vb === null || vb === undefined) return -1;
    return ord.dir * (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), 'es', { numeric: true }));
  }));
  return [th, ordenar];
}

function ReabastoProyeccion() {
  const [f, setF] = useState({ pctOsr: '', colchon: '', olas: '', minimo: '', logOsr: '', ssFuera: '', minTras: '', umbralRecall: '', incluirNoAptos: false, estado: '', depto: '' });
  const [rec, setRec] = useState(0);
  const [vista, setVista] = useState('det');
  const [thD, ordenarD] = useOrden();
  const cuerpo = { ...f, umbralRecall: f.umbralRecall === '' ? '' : Number(f.umbralRecall) / 100, pctOsr: f.pctOsr === '' ? '' : Number(f.pctOsr) / 100, colchon: f.colchon === '' ? '' : Number(f.colchon) / 100 };
  const [r, cargando] = useSimulacion('/api/optimizacion/abastecimiento/simular', cuerpo, [JSON.stringify(f), rec]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const alt = (k, v) => set(k)(f[k] === v ? '' : v);
  const quitar = async () => { try { await api.post('/api/optimizacion/abastecimiento/proyeccion/borrar'); setRec(rec + 1); } catch (e) { toast(e.message, true); } };
  const osr = r?.osr || 'OSR';
  const g = r?.g, c = r?.conf;
  const excel = urlApi('/api/optimizacion/abastecimiento/excel' + qs({ pctOsr: cuerpo.pctOsr, colchon: cuerpo.colchon, olas: f.olas, minimo: f.minimo, logOsr: f.logOsr, ssFuera: f.ssFuera, minTras: f.minTras, umbralRecall: f.umbralRecall === '' ? '' : Number(f.umbralRecall) / 100, incluirNoAptos: f.incluirNoAptos ? '1' : '' }));
  const estados = !r?.proy ? [] : vista === 'det' ? r.estadosDet.map((x) => [x.e, x.n]) : vista === 'no' ? r.estadosNo.map((x) => [x.e, x.n]) : vista === 'esp' ? [] : r.ab.porEstado.filter((x) => x.skus).map((x) => [x.estado, x.skus]);
  const cambiarVista = (v) => { setVista(v); if (f.estado) setF({ ...f, estado: '' }); };
  // participación del depto en la proyección total y en el stock actual del OSR (de los deptos proyectados)
  const totOsrDep = (r?.deptos || []).reduce((t, x) => t + x.osrStock, 0);
  const depPart = (r?.deptos || []).map((x) => ({ ...x, partProy: r.g.tP ? x.proy / r.g.tP : 0, partOsr: totOsrDep ? x.osrStock / totOsrDep : 0 }));
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
            {r?.proy ? <span><b>{r.proy.evento}</b> <span className="note">· {r.proy.archivo}{r.proy.hoja ? ` · hoja ${r.proy.hoja}` : ''} · {r.proy.filas} filas · cargada {fFecha(r.proy.cargado)}</span></span> : <span className="note">Sin proyección cargada</span>}
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
            <div><label className="lbl" htmlFor="rp-log">Logística OSR</label>
              <select id="rp-log" value={f.logOsr} onChange={(e) => setF({ ...f, logOsr: e.target.value, estado: '' })}>
                <option value="">Y o con stock en {osr}</option><option value="SOLO_Y">Solo con marca Y</option></select></div>
          </>
        )}
        {cargando && <span className="note">Calculando…</span>}
      </div>

      {r && !r.proy && <div className="alert">Carga la proyección del evento: un Excel con <b>Departamento</b>, <b>Desc Dpto</b> y <b>Unidades proyectadas</b> (opcional <b>% OSR</b> por depto). Puedes partir del archivo de ejemplo.</div>}
      {r?.proy && g && (
        <>
          {!r.hayCol && <div className="alert warn">La Base no trae la columna "Logística OSR": todos los SKU cuentan como aptos.</div>}
          {r.noEnc.length > 0 && <div className="alert warn">Deptos de la proyección sin SKU en la Base ({fmt(g.tNoEnc)} u. que no entran al cálculo: el archivo trae {fmt(g.tArch)} u. y se trabajan {fmt(g.tP)}): {r.noEnc.join(" · ")}</div>}
          <div className="grid-kpi kpi-fila">
            {tile('Unidades proyectadas', fmt(g.tP), '', `todo el evento · ${g.nDO + g.nDF} deptos${g.tNoEnc ? ` · ${fmt(g.tNoEnc)} u. del archivo sin SKU en la Base` : ''}`)}
            {tile(`Deptos ${osr}`, fmt(g.tPO), '', `${pct(g.tP ? g.tPO / g.tP : 0)} del evento · ${g.nDO} deptos`)}
            {tile('Deptos otros CD', fmt(g.tPF), '', `${pct(g.tP ? g.tPF / g.tP : 0)} del evento · ${g.nDF} deptos fuera de ${osr}`)}
            {tile(`Meta ${osr}`, fmt(g.tM), '', `${pct(c.pctG)}${c.colchon ? ` + colchón ${pct(c.colchon)}` : ''} de deptos ${osr}: lo que debe despachar`)}
            {tile('Meta cubierta', pct(g.cob, 1), g.cob >= 0.9995 ? 'good' : g.cob >= 0.85 ? 'warn' : 'bad', g.brecha > 0 ? `brecha ${fmt(g.brecha)} u.: SKU con venta sin stock suficiente` : 'sin brecha')}
            {tile(`Subir al ${osr} antes`, fmt(g.tAn), 'warn', `meta en SKU ${fmt(g.metaSku)} = ${fmt(g.osrUsa)} ya en ${osr} + ${fmt(g.tAn)} a subir${c.olas > 1 ? ` + ${fmt(g.tD)} durante` : ''}`)}
          </div>
          <ul className="lista-lectura">{r.lectura.map((l, i) => <li key={i}>{l}</li>)}</ul>

          <div className="tbl" style={{ maxHeight: 380, marginTop: 12 }}>
            <table>
              <thead><tr>{thD('nom', 'Depto', '')}{thD('proy', 'Unidades proyectadas')}{thD('partProy', '% participación')}{thD('osrStock', `Stock en ${osr}`)}{thD('partOsr', `% del stock ${osr}`)}
                {thD('meta', 'Meta')}
                {thD('antes', 'Subir antes')}{thD('asig', 'Cubierta con stock total')}{thD('cob', 'Cobertura')}{thD('brecha', 'Brecha')}{c.olas > 1 && thD('durante', 'Reponer durante')}{thD('estado', 'Estado', '')}</tr></thead>
              <tbody>
                {ordenarD(depPart).map((x) => (
                  <tr key={x.nom} className={f.depto === x.nom ? 'sel' : ''} style={{ cursor: 'pointer' }} onClick={() => alt('depto', x.nom)} title="Filtrar por este depto">
                    <td>{x.nom}</td><td className="num">{fmt(x.proy)}</td><td className="num"><b>{pct(x.partProy, 1)}</b></td><td className="num">{fmt(x.osrStock)}</td><td className="num"><b>{pct(x.partOsr, 1)}</b></td>
                    <td className="num">{fmt(x.meta)}</td>                    <td className="num">{fmt(x.antes)}</td><td className="num">{fmt(x.asig)}</td><td className="num">{pct(x.cob, 1)}</td>
                    <td className="num">{x.brecha ? <b style={{ color: 'var(--bad)' }}>{fmt(x.brecha)}</b> : '—'}</td>{c.olas > 1 && <td className="num">{fmt(x.durante)}</td>}
                    <td><span className={'pill ' + TONO_RP[x.estado]}>{x.estado}</span></td></tr>
                ))}
                <tr className="tot"><td>Total</td><td className="num">{fmt(g.tP)}</td><td className="num">100%</td><td className="num">{fmt(totOsrDep)}</td><td className="num">100%</td><td className="num">{fmt(g.tM)}</td>
                  <td className="num">{fmt(g.tAn)}</td><td className="num">{fmt(g.tA)}</td><td className="num">{pct(g.cob, 1)}</td><td className="num">{fmt(g.brecha)}</td>{c.olas > 1 && <td className="num">{fmt(g.tD)}</td>}<td /></tr>
              </tbody>
            </table>
          </div>
          <p className="note">% participación = peso del depto en el total proyectado del evento. % del stock {osr} = peso del depto en el stock actual del {osr} de los deptos proyectados. Cubierta con stock total = meta que se cubre con el stock de esos SKU en todos los CD (lo que ya está en {osr} + lo que se puede trasladar); Brecha = lo que no alcanza ni con todo el stock. Subir antes = lo que hay que trasladar para cubrir su meta. Clic en un depto para filtrar.</p>

          <div className="row spread" style={{ margin: '14px 0 8px' }}>
            <div className="chips">{VISTAS_RP.map(([k, t]) => <button key={k} className="chip" aria-pressed={vista === k} onClick={() => cambiarVista(k)}>{t}</button>)}</div>
            {(vista === 'ab' || vista === 'pick' || vista === 'esp') && <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
              <div><label className="lbl" htmlFor="rp-ss">Stock de seguridad fuera de {osr} (u. por SKU)</label>
                <input id="rp-ss" type="number" className="w90" min="0" placeholder={fmt(r.ab.tot.ss)} value={f.ssFuera} onChange={(e) => setF({ ...f, ssFuera: e.target.value, estado: '' })} /></div>
              {vista !== 'esp' && <div><label className="lbl" htmlFor="rp-mt">Mínimo a trasladar por SKU (u.)</label>
                <input id="rp-mt" type="number" className="w90" min="0" placeholder="sin mínimo" value={f.minTras} onChange={(e) => setF({ ...f, minTras: e.target.value, estado: '' })} /></div>}
              {vista === 'esp' && <div><label className="lbl" htmlFor="rp-um">Extracción mínima %</label>
                <input id="rp-um" type="number" className="w90" min="1" max="100" placeholder={fmt(r.recall.umbral * 100, 0)} value={f.umbralRecall} onChange={(e) => set('umbralRecall')(e.target.value)} /></div>}
              {vista !== 'esp' && <label className="inline" style={{ fontSize: 13 }}><input type="checkbox" checked={f.incluirNoAptos} onChange={(e) => setF({ ...f, incluirNoAptos: e.target.checked, estado: '' })} /> Incluir no aptos (requieren habilitar {osr})</label>}
            </div>}
          </div>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <div className="chips">{estados.map(([e, n]) => <button key={e} className="chip" aria-pressed={f.estado === e} onClick={() => alt('estado', e)}>{LECTURA_AB[e] || e} · {fmt(n)}</button>)}</div>
            {f.depto && <button className="chip" aria-pressed onClick={() => set('depto')('')}>{f.depto} ✕</button>}
          </div>

          {(vista === 'ab' || vista === 'pick') && (
            <div className="grid-kpi">
              {tile(`Requerido para el ${osr}`, `${fmt(r.ab.tot.total)} u.`, '', `${fmt(r.ab.tot.skus)} SKU · antes ${fmt(r.ab.tot.antes)} · durante ${fmt(r.ab.tot.durante)}`)}
              {tile('Sugerido efectivo a trasladar', `${fmt(r.ab.tot.asignado)} u.`, 'good', `${fmt(r.ab.tot.skusEfectivos)} SKU que se mueven${r.ab.tot.total ? ` · ${fmt((r.ab.tot.asignado / r.ab.tot.total) * 100, 0)}% de lo requerido` : ''}${r.ab.tot.minTras ? ` · ${fmt(r.ab.tot.skusDescartados)} SKU (${fmt(r.ab.tot.descartado)} u.) bajo el mínimo de ${fmt(r.ab.tot.minTras)} u.` : ''}`)}
              {tile('Lista de traslado', `${fmt(r.ab.tot.lineas)} líneas`, '', `${fmt(r.ab.tot.ubicaciones)} ubicaciones de origen`)}
              {tile('Retenido por stock de seguridad', `${fmt(r.ab.tot.retenido)} u.`, r.ab.tot.retenido ? 'warn' : '', `se dejan al menos ${fmt(r.ab.tot.ss)} u. de cada SKU fuera de ${osr}`)}
              {tile(`Faltante sin stock fuera de ${osr}`, `${fmt(r.ab.tot.faltante)} u.`, r.ab.tot.faltante ? 'warn' : '', 'requiere compra, tránsito o redistribución')}
              {tile('Por CD de origen', r.ab.porCd.map((x) => x.cd).join(' · ') || '—', '', r.ab.porCd.map((x) => `${x.cd} ${fmt(x.total)}`).join(' · '))}
            </div>
          )}

          {vista === 'det' && (() => {
            // tabla compacta: SKU con su descripción, venta con sell-through y participación, meta con la ideal;
            // carga previa y reponer durante solo con más de una ola (con una, carga previa = meta y no hay reposición)
            const olas = c.olas > 1;
            const sub = (t) => <div className="note" style={{ margin: 0 }}>{t}</div>;
            return (
              <Tabla compacta total={r.detalle.total} n={r.detalle.filas.length}
                enc={['Prior.', 'Clase', 'SKU / descripción', 'Ventas', 'Apto', `En ${osr}`, `Fuera ${osr}`, `Meta ${osr}`, ...(olas ? ['Carga previa'] : []), 'Subir antes', ...(olas ? ['Reponer durante'] : []), 'Excedente', 'Estado']}
                num={olas ? [0, 3, 5, 6, 7, 8, 9, 10, 11] : [0, 3, 5, 6, 7, 8, 9]}
                filas={r.detalle.filas.map((x) => [x.prioridad, <span className={'pill ' + tono(x.matriz)}>{x.matriz}</span>,
                  <><span className="mono">{x.sku}</span> {x.desc}{sub(x.depto)}</>,
                  <>{fmt(x.vta)}{sub(`ST ${pct(x.st)} · ${pct(x.partic, 1)}`)}</>,
                  <span className="note" title={x.motivo}>{MOTIVO_CORTO[x.motivo] || x.motivo}</span>, fmt(x.osr), fmt(x.fuera),
                  <><b>{fmt(x.meta)}</b>{sub(`ideal ${fmt(x.ideal, 0)}`)}</>, ...(olas ? [fmt(x.previa)] : []),
                  x.antes ? <b>{fmt(x.antes)}</b> : '—', ...(olas ? [x.durante ? fmt(x.durante) : '—'] : []), x.exced ? fmt(x.exced) : '—',
                  <span className={'pill ' + TONO_RP[x.estado]}>{x.estado}</span>])} />
            );
          })()}
          {vista === 'no' && (
            <Tabla total={r.noAptos.total} n={r.noAptos.filas.length}
              enc={['Prior.', 'Clase', 'SKU', 'Descripción', 'Ventas', '% venta depto', 'Unid. atribuibles', 'Stock', `En ${osr}`, 'Logística OSR', 'Aporte potencial', 'Impacto', 'Recomendación']}
              num={[0, 4, 5, 6, 7, 8, 10]}
              filas={r.noAptos.filas.map((x) => [x.prioridad, <span className={'pill ' + tono(x.matriz)}>{x.matriz}</span>, <span className="mono">{x.sku}</span>, <>{x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></>,
                fmt(x.vta), pct(x.pctVenta, 1), fmt(x.unAtr), fmt(x.qty), fmt(x.osr), x.log, x.potAl ? <b>{fmt(x.potAl)}</b> : '—', <span className={'pill ' + TONO_RP[x.impacto]}>{x.impacto}</span>, <span className="note">{x.recomendacion}</span>])} />
          )}
          {vista === 'ab' && (
            <Tabla total={r.ab.total} n={r.ab.filas.length}
              enc={['Prior.', 'Clase', 'SKU', 'Descripción', 'Tipo', `Meta ${osr}`, `En ${osr}`, 'Subir antes', 'Reponer durante', 'Total', `Fuera ${osr}`, 'Asignado', 'Bajo mínimo', 'Retenido (stock seg.)', 'Faltante', 'Ubic.', 'Estado']}
              num={[0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]}
              filas={r.ab.filas.map((x) => [x.prioridad, <span className={'pill ' + tono(x.matriz)}>{x.matriz}</span>, <span className="mono">{x.sku}</span>, <>{x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></>,
                x.tipo === 'APTO OSR' ? <span className="note">Apto</span> : <span className="tag">requiere habilitar</span>, fmt(x.meta), fmt(x.osr), fmt(x.antes), fmt(x.durante), <b>{fmt(x.total)}</b>, fmt(x.fuera), x.asignado ? fmt(x.asignado) : '—', x.descartado ? fmt(x.descartado) : '—', x.retenido ? fmt(x.retenido) : '—',
                x.faltante ? <b style={{ color: 'var(--bad)' }}>{fmt(x.faltante)}</b> : '—', x.nUb || '—', <span className={'pill ' + TONO_AB[x.estado]}>{LECTURA_AB[x.estado]}</span>])} />
          )}
          {vista === 'esp' && (() => {
            const e = r.recall;
            return (
              <>
                <div className="grid-kpi">
                  {tile('SKU que liberan espacio', fmt(e.skus), 'good', `el evento extrae al menos el ${fmt(e.umbral * 100, 0)}% de su stock en ${osr}`)}
                  {tile(`Stock en ${osr} tras el traslado`, `${fmt(e.post)} u.`, '', 'de estos SKU (stock actual + traslado)')}
                  {tile('Unidades que se extraen', `${fmt(e.libera)} u.`, 'good', `${fmt(e.post ? (e.libera / e.post) * 100 : 0, 0)}% de su stock en ${osr}`)}
                  {tile('Totes que se desocupan', e.totes === null ? '—' : fmt(e.totes, 0), e.totes ? 'good' : '', e.totes === null ? 'carga la distribución de totes en Datos para estimarlos' : `estimado con la distribución de totes (${fmt(e.conTotes)} SKU)`)}
                </div>
                <p className="note" style={{ marginTop: -6 }}>Estos SKU vacían buena parte de su espacio durante el evento: ese espacio puede reservarse para reponer o ingresar más stock sin arriesgar la capacidad del {osr}. Totes que se desocupan = unidades extraídas / unidades por tote del SKU en la distribución cargada.</p>
                <Tabla compacta total={e.total} n={e.filas.length}
                  enc={['Clase', 'SKU / descripción', `En ${osr} hoy`, 'Traslado', `En ${osr} tras traslado`, 'Extracción proyectada', '% extracción', 'Queda al final', 'U. por tote', 'Totes que se desocupan']}
                  num={[2, 3, 4, 5, 6, 7, 8, 9]}
                  filas={e.filas.map((x) => [<span className={'pill ' + tono(x.matriz)}>{x.matriz}</span>,
                    <><span className="mono">{x.sku}</span> {x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></>,
                    fmt(x.osr), x.traslado ? fmt(x.traslado) : '—', fmt(x.post), <b>{fmt(x.meta)}</b>, <b>{fmt(x.ext * 100, 0)}%</b>, x.queda ? fmt(x.queda) : '—',
                    x.porTote ? fmt(x.porTote, 1) : '—', x.totes !== null ? fmt(x.totes, 1) : '—'])} />
              </>
            );
          })()}
          {vista === 'pick' && (
            <Tabla total={r.ab.lineas} n={r.ab.picking.length}
              enc={['Nro', 'Ola', 'CD origen', 'Ubicación', 'SKU', 'Descripción', 'Unid. a mover', 'Stock al retirar', 'Saldo', 'Prior. SKU']}
              num={[0, 6, 7, 8, 9]}
              filas={r.ab.picking.map((l) => [l.nro, <span className={'pill ' + (l.ola[0] === '1' ? 'm-2' : 'm-1')}>{l.ola[0] === '1' ? 'Antes' : 'Durante'}</span>, l.cd, <span className="mono">{l.ubic}</span>,
                <span className="mono">{l.sku}</span>, <>{l.desc}{l.tipo !== 'APTO OSR' && <div><span className="tag">requiere habilitar {osr}</span></div>}</>, <b>{fmt(l.unidades)}</b>, fmt(l.stockAntes), fmt(l.saldo), l.prioridad])} />
          )}
        </>
      )}
      <VariacionProyeccion rec={rec} onActivar={() => setRec(rec + 1)} />
    </div>
  );
}

const MOTIVO_CORTO = { 'APTO (LOGISTICA_OSR=Y)': 'Y', 'CON STOCK EN OSR': 'Stock en OSR' };

function Tabla({ enc, num, filas, total, n, compacta = false }) {
  return (
    <>
      <div className={'tbl' + (compacta ? ' tbl-compacta' : '')} style={{ maxHeight: 440 }}>
        <table>
          <thead><tr>{enc.map((e, j) => <th key={j} className={num.includes(j) ? 'num' : ''}>{e}</th>)}</tr></thead>
          <tbody>{filas.map((f, i) => <tr key={i}>{f.map((v, j) => <td key={j} className={num.includes(j) ? 'num' : j === (compacta ? 2 : 3) ? 'wrap' : ''}>{v}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {total > n && <p className="note">Se muestran {fmt(n)} de {fmt(total)} filas. El Excel trae todas.</p>}
      {!total && <p className="note">Sin filas para este filtro.</p>}
    </>
  );
}

// =============================================================================================
// Potencial fuera de OSR: SKU con stock en otros CD que por su clase ABC/XYZ conviene ingresar al OSR (escenarios)
// =============================================================================================
const CLASES9 = ['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ'];
const ORDEN_POT = [['', 'Clase y venta'], ['ingresar', 'A ingresar'], ['fuera', 'Stock fuera'], ['ventaDia', 'Venta/día'], ['factor', 'Factor del evento'], ['cob', 'Días de cobertura'], ['queda', 'Queda fuera'], ['nUb', 'Ubicaciones a tomar'], ['totes', 'Totes OSR']];

function PotencialOsr() {
  const [f, setF] = useState({ clases: ['AX', 'AY', 'BX', 'BY'], aptitud: 'Y', enOsr: 'SIN', cds: [], minFuera: '', minVenta: '', dias: '', soloDeptosOsr: false, depto: '', buscar: '', orden: '', dir: 'desc', top: '', ssDias: '', ssMin: '', maxSkus: '', evento: '', evtModo: 'PRIORIZAR', evtMin: '', tote: 'AUTO', capTote: '',
    noYModo: 'VER', noYEstados: [], noYClases: [] });
  const [vista, setVista] = useState('sku');
  const [r, cargando] = useSimulacion('/api/optimizacion/osr/potencial', f, [JSON.stringify(f)]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const alt = (k, v) => set(k)(f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);
  const osr = r?.osr || 'OSR';
  const t = r?.tot;
  const cdsVer = r ? r.cds.filter((cd) => r.porCd.some((c) => c.cd === cd)) : [];
  const excel = urlApi('/api/optimizacion/osr/potencial/excel' + qs({ ...f, clases: f.clases.join(','), cds: f.cds.join(','), noYEstados: f.noYEstados.join(','), noYClases: f.noYClases.join(','), soloDeptosOsr: f.soloDeptosOsr ? '1' : '', depto: '', orden: '', top: '' }));
  const tile = (k, v, cls = '', n = '') => <div className={'kpi ' + cls}><div className="k">{k}</div><div className="v">{v}</div>{n && <div className="n">{n}</div>}</div>;
  return (
    <div className="sec">
      <div className="row spread" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Potencial fuera de {osr}</h2>
        {r && <a className="btn primary" href={excel}>Exportar a Excel</a>}
      </div>
      <p className="note" style={{ marginTop: -2 }}>SKU con stock en los demás CD que, por su clase ABC / XYZ, conviene llevar a {osr}. Elige las clases en la matriz y acota el escenario con los filtros: aptitud, stock fuera mínimo, venta diaria, CD de origen y días de cobertura (tope de lo que se ingresa = venta diaria x días; vacío = todo lo disponible). Siempre queda fuera de {osr} un stock de seguridad (días de venta, con un mínimo de unidades): solo se ingresa lo que sobra, tomado de las ubicaciones con más unidades. Con un máximo de SKU entran los de mayor prioridad (clase A y más venta). Con un evento del simulador, los deptos con mayor factor del evento van primero y la cobertura usa la venta del evento. No se considera el stock de {r?.buffer?.join(' / ') || 'RCI'} (buffer de reabastecimiento). Cada ubicación de {osr} es un tote de un SKU; en half o quarter el tote se divide en 2 o 4 compartimentos. La capacidad de un tote entero se estima por depto con el percentil 90 de sus totes actuales en {osr} (o la que escribas). Venta diaria = ventas de 2 meses / 60.</p>
      {r && !r.hayCol && <div className="alert warn">La Base no trae la columna "Logística OSR": todos los SKU cuentan como aptos.</div>}

      <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,auto) minmax(0,1fr)', alignItems: 'start' }}>
        <div>
          <span className="lbl">Clases a ingresar (clic en la celda)</span>
          <table className="pot-matriz">
            <thead><tr><th />{['X', 'Y', 'Z'].map((z) => <th key={z} className="num">{z}</th>)}</tr></thead>
            <tbody>{['A', 'B', 'C'].map((a) => (
              <tr key={a}><th>{a}</th>{['X', 'Y', 'Z'].map((z) => {
                const k = a + z, m = r?.matriz?.[k];
                return (
                  <td key={k}><button type="button" className={'pot-celda ' + tono(k) + (f.clases.includes(k) ? ' on' : '')} aria-pressed={f.clases.includes(k)} onClick={() => alt('clases', k)}>
                    <b>{k}</b><span>{m ? `${fmt(m.skus)} SKU` : '—'}</span><span>{m ? `${fmt(m.fuera)} u.` : ''}</span></button></td>
                );
              })}</tr>
            ))}</tbody>
          </table>
          <p className="note" style={{ margin: '6px 0 0' }}>{r ? `Universo con los filtros: ${fmt(r.universo.skus)} SKU y ${fmt(r.universo.fuera)} u. fuera de ${osr}.` : ''}</p>
        </div>
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div><label className="lbl" htmlFor="po-apt">Logística OSR</label>
            <select id="po-apt" value={f.aptitud} onChange={(e) => set('aptitud')(e.target.value)}>
              <option value="Y">Solo aptos (Y)</option><option value="REV">Aptos y en REVISION</option><option value="TODOS">Todos (incluye N)</option></select></div>
          <div><label className="lbl" htmlFor="po-osr">Stock en {osr}</label>
            <select id="po-osr" value={f.enOsr} onChange={(e) => set('enOsr')(e.target.value)}>
              <option value="SIN">Solo SKU que no están en {osr}</option><option value="TODOS">Incluir los que ya tienen stock en {osr}</option></select></div>
          <div><label className="lbl" htmlFor="po-min">Stock fuera mayor que</label><input id="po-min" type="number" className="w90" min="0" placeholder="0" value={f.minFuera} onChange={(e) => set('minFuera')(e.target.value)} /></div>
          <div><label className="lbl" htmlFor="po-vta">Venta/día mínima</label><input id="po-vta" type="number" className="w90" min="0" step="0.1" placeholder="0" value={f.minVenta} onChange={(e) => set('minVenta')(e.target.value)} /></div>
          <div><label className="lbl" htmlFor="po-ss">Stock seg. fuera (días)</label><input id="po-ss" type="number" className="w90" min="0" placeholder="7" value={f.ssDias} onChange={(e) => set('ssDias')(e.target.value)} /></div>
          <div><label className="lbl" htmlFor="po-ssm">Mínimo u. fuera</label><input id="po-ssm" type="number" className="w90" min="0" placeholder="0" value={f.ssMin} onChange={(e) => set('ssMin')(e.target.value)} /></div>
          <div><label className="lbl" htmlFor="po-max">Máximo de SKU</label><input id="po-max" type="number" className="w90" min="0" placeholder="sin tope" value={f.maxSkus} onChange={(e) => set('maxSkus')(e.target.value)} /></div>
          <div><label className="lbl" htmlFor="po-dias">Días de cobertura</label><input id="po-dias" type="number" className="w90" min="0" placeholder="todo" value={f.dias} onChange={(e) => set('dias')(e.target.value)} /></div>
          <div><label className="lbl" htmlFor="po-tote">Almacenamiento en {osr}</label>
            <select id="po-tote" value={f.tote} onChange={(e) => set('tote')(e.target.value)}>
              <option value="AUTO">Automático (enteros + quarter / half)</option><option value="QUARTER">Quarter (4 por tote)</option><option value="HALF">Half (2 por tote)</option><option value="ENTERO">Tote entero</option></select></div>
          <div><label className="lbl" htmlFor="po-cap">Capacidad tote (u.)</label><input id="po-cap" type="number" className="w90" min="1" placeholder="por depto" value={f.capTote} onChange={(e) => set('capTote')(e.target.value)} /></div>
          {r && <div><label className="lbl" htmlFor="po-evt">Evento (simulador)</label>
            <select id="po-evt" value={f.evento} onChange={(e) => setF({ ...f, evento: e.target.value, depto: '' })}>
              <option value="">Sin evento</option>{r.eventos.map((e) => <option key={e.clave} value={e.clave}>{e.evento} · {fFecha(e.inicio)}</option>)}</select></div>}
          {f.evento && <div><label className="lbl" htmlFor="po-evm">Deptos del evento</label>
            <select id="po-evm" value={f.evtModo} onChange={(e) => set('evtModo')(e.target.value)}><option value="PRIORIZAR">Priorizar (mayor factor primero)</option><option value="SOLO">Solo los potenciados</option></select></div>}
          {f.evento && f.evtModo === 'SOLO' && <div><label className="lbl" htmlFor="po-evx">Factor mínimo</label>
            <input id="po-evx" type="number" className="w90" min="0" step="0.1" placeholder={r?.evtGeneral ? `> ${fmt(r.evtGeneral, 2)}` : ''} value={f.evtMin} onChange={(e) => set('evtMin')(e.target.value)} /></div>}
          <label className="inline" style={{ fontSize: 13 }}><input type="checkbox" checked={f.soloDeptosOsr} onChange={(e) => setF({ ...f, soloDeptosOsr: e.target.checked, depto: '' })} /> Solo deptos {osr}</label>
          {r && <div>
            <span className="lbl">CD de origen</span>
            <div className="chips">{r.cds.map((cd) => <button key={cd} className="chip" aria-pressed={f.cds.includes(cd)} onClick={() => alt('cds', cd)}>{cd}</button>)}
              {f.cds.length > 0 && <button className="chip" onClick={() => set('cds')([])}>Todos ✕</button>}</div>
          </div>}
          {cargando && <span className="note">Calculando…</span>}
        </div>
      </div>

      {r && t && (
        <>
          <div className="grid-kpi" style={{ marginTop: 14 }}>
            {tile('SKU a ingresar', fmt(t.skus), 'good', `${r.conf.maxSkus && t.fueraTope ? `máximo ${fmt(r.conf.maxSkus)} de ${fmt(t.candidatos)} candidatos (${fmt(t.ingresarTope)} u. quedan fuera del tope) · ` : ''}clases ${r.conf.clases.join(', ')}${t.porSS ? ` · ${fmt(t.porSS)} SKU sin disponible sobre el stock de seguridad` : ''}`)}
            {tile(`A ingresar a ${osr}`, `${fmt(t.ingresar)} u.`, 'good', `de ${fmt(t.fuera)} u. fuera · quedan fuera ${fmt(t.queda)} u. (stock de seguridad ${fmt(t.ss)} u.)${r.conf.dias ? ` · tope ${r.conf.dias} días de venta` : ''}`)}
            {tile('Ubicaciones de origen', fmt(t.ubic), '', r.porCd.map((c) => `${c.cd} ${fmt(c.unidades)} u.`).join(' · ') || '—')}
            {tile(`Totes de ${osr} necesarios`, fmt(t.totes), 'good', `${t.ahorroTotes > 0 ? `${fmt(t.ahorroTotes)} totes menos que en tote entero (${fmt(t.totesEntero)})` : `igual que en tote entero (${fmt(t.totesEntero)})`} · ${fmt(t.mix.ENTERO)} enteros, ${fmt(t.mix.HALF)} half, ${fmt(t.mix.QUARTER)} quarter`)}
            {tile('Venta que pasaría a OSR', `${fmt(t.ventaDia, 0)} u./día`, '', `${fmt(t.pctVenta * 100, 1)}% de la venta diaria de la Base${r.evento ? ` · ${fmt(t.ventaEvt, 0)} u./día en ${r.evento.evento}` : ''}`)}
            {r.evento && tile(`Potenciados por ${r.evento.evento}`, fmt(t.potenciados), 'good', `SKU de deptos con factor ${r.conf.evtMin ? `≥ ${fmt(r.conf.evtMin, 2)}` : `sobre GENERAL (${fmt(r.evtGeneral, 2)})`} · ${fFecha(r.evento.inicio)} al ${fFecha(r.evento.fin)}`)}
            {tile('Cobertura del ingreso', t.cob === null ? '—' : `${fmt(t.cob, 0)} días`, '', 'unidades a ingresar / venta diaria')}
            {tile(`Participación de ${osr} en la venta`, `${fmt(r.balance.partAntes * 100, 1)}% → ${fmt(r.balance.partDespues * 100, 1)}%`, 'good', `hoy → con el escenario${r.noY.modo === 'RETIRAR' ? ' y el retiro de SKU sin Y' : ''}`)}
          </div>

          <fieldset className="pot-noy">
            <legend>SKU en {osr} sin Logística OSR = "Y"</legend>
            <p className="note" style={{ marginTop: 0 }}>Ocupan ubicaciones de {osr} sin estar habilitados. Elige qué estados y clases mirar y simula retirarlos: se liberan sus ubicaciones y se compara con lo que ingresa el escenario.</p>
            <div className="row" style={{ alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
              <div>
                <span className="lbl">Logística OSR</span>
                <div className="chips">{Object.entries(r.noY.porEstado).map(([e, n]) => <button key={e} className="chip" aria-pressed={f.noYEstados.includes(e)} onClick={() => alt('noYEstados', e)}>{e} · {fmt(n)}</button>)}
                  {!Object.keys(r.noY.porEstado).length && <span className="note">Todos los SKU en {osr} tienen "Y".</span>}</div>
              </div>
              <div>
                <span className="lbl">Clases</span>
                <div className="chips">{CLASES9.filter((k) => r.noY.matriz[k]).map((k) => <button key={k} className="chip" aria-pressed={f.noYClases.includes(k)} onClick={() => alt('noYClases', k)}>{k} · {fmt(r.noY.matriz[k])}</button>)}</div>
              </div>
              <div><label className="lbl" htmlFor="po-noy">Simulación</label>
                <select id="po-noy" value={f.noYModo} onChange={(e) => set('noYModo')(e.target.value)}><option value="VER">Solo ver su impacto</option><option value="RETIRAR">Retirarlos de {osr}</option></select></div>
            </div>
            <p className="note" style={{ marginBottom: 6 }}>Sin chips marcados se consideran todos. {fmt(r.noY.tot.skus)} SKU · {fmt(r.noY.tot.osr)} u. en {osr} · {fmt(r.noY.tot.ubic)} ubicaciones ({fmt(r.noY.tot.libera)} quedan vacías al retirarlos) · venden {fmt(r.noY.tot.ventaDia, 1)} u./día ({fmt(r.noY.tot.pctVenta * 100, 2)}% de la venta).</p>
            <table className="pot-balance">
              <thead><tr><th>Balance del escenario en {osr}</th><th className="num">Entra</th><th className="num">Sale (sin Y)</th><th className="num">Neto</th></tr></thead>
              <tbody>
                <tr><td>Venta diaria</td><td className="num">{fmt(r.balance.ventaEntra, 1)}</td><td className="num">{fmt(r.balance.ventaSale, 1)}</td><td className="num"><b>{fmt(r.balance.ventaNeta, 1)}</b></td></tr>
                <tr><td>Unidades</td><td className="num">{fmt(r.balance.unidEntra)}</td><td className="num">{fmt(r.balance.unidSale)}</td><td className="num"><b>{fmt(r.balance.unidNeta)}</b></td></tr>
                <tr><td>Totes de {osr} (necesarios · se liberan)</td><td className="num">{fmt(r.balance.totesNecesarios)}</td><td className="num">{fmt(r.balance.ubicLibera)}</td>
                  <td className="num" style={{ color: r.balance.ubicNeta < 0 ? 'var(--bad)' : 'var(--good)' }}><b>{r.balance.ubicNeta > 0 ? '+' : ''}{fmt(r.balance.ubicNeta)}</b></td></tr>
              </tbody>
            </table>
            {r.noY.modo === 'VER' && <p className="note" style={{ marginBottom: 0 }}>Elige "Retirarlos de {osr}" para restar su venta y su ocupación en el balance.</p>}
          </fieldset>

          <div className="row spread" style={{ margin: '6px 0 8px' }}>
            <div className="row" style={{ alignItems: 'center', gap: 12 }}>
              <div className="chips">
                <button className="chip" aria-pressed={vista === 'sku'} onClick={() => setVista('sku')}>Por SKU · {fmt(r.filtrados)}</button>
                <button className="chip" aria-pressed={vista === 'depto'} onClick={() => setVista('depto')}>Por departamento · {fmt(r.deptos.length)}</button>
                <button className="chip" aria-pressed={vista === 'noy'} onClick={() => setVista('noy')}>En {osr} sin Y · {fmt(r.noY.filtrados)}</button>
              </div>
              {vista === 'sku' && <>
                <input type="search" placeholder="Buscar SKU o descripción" value={f.buscar} onChange={(e) => set('buscar')(e.target.value)} style={{ width: 210 }} aria-label="Buscar SKU o descripción" />
                <label className="inline" style={{ fontSize: 13 }}>Ordenar por
                  <select value={f.orden} onChange={(e) => set('orden')(e.target.value)} style={{ width: 'auto', marginLeft: 6 }}>{ORDEN_POT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                {f.orden && <button className="btn sm" onClick={() => set('dir')(f.dir === 'asc' ? 'desc' : 'asc')}>{f.dir === 'asc' ? '▲ menor a mayor' : '▼ mayor a menor'}</button>}
                <label className="inline" style={{ fontSize: 13 }}>Mostrar
                  <select value={f.top} onChange={(e) => set('top')(e.target.value)} style={{ width: 'auto', marginLeft: 6 }}><option value="">Todos</option>{[10, 20, 50, 100].map((n) => <option key={n} value={n}>Top {n}</option>)}</select></label>
              </>}
            </div>
            {f.depto && vista === 'sku' && <button className="chip" aria-pressed onClick={() => set('depto')('')}>{f.depto} ✕</button>}
          </div>

          {vista === 'noy' ? (
            <>
              <div className="tbl" style={{ maxHeight: 460 }}>
                <table>
                  <thead><tr><th>Clase</th><th>SKU</th><th>Descripción</th><th>Log. OSR</th><th className="num">Stock {osr}</th><th className="num">Ubic. {osr}</th><th className="num">Se liberan</th><th className="num">Stock fuera</th><th className="num">Venta/día</th></tr></thead>
                  <tbody>{r.noY.detalle.map((x) => (
                    <tr key={x.sku}><td><span className={'pill ' + tono(x.matriz)}>{x.matriz}</span></td><td className="mono">{x.sku}</td>
                      <td className="wrap">{x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></td><td>{x.aptitud}</td>
                      <td className="num">{fmt(x.osr)}</td><td className="num">{fmt(x.ubic)}</td><td className="num">{fmt(x.libera)}</td>
                      <td className="num">{x.fuera ? fmt(x.fuera) : <span className="muted">—</span>}</td><td className="num">{fmt(x.ventaDia, 1)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <p className="note">Ordenados para retirar primero: clase C y menor venta. {r.noY.filtrados > r.noY.detalle.length ? `Se muestran ${fmt(r.noY.detalle.length)} de ${fmt(r.noY.filtrados)}; el Excel trae todos.` : ''}</p>
            </>
          ) : vista === 'depto' ? (
            <>
              <div className="tbl" style={{ maxHeight: 460 }}>
                <table>
                  <thead><tr><th>Depto</th>{r.evento && <><th>Categoría</th><th className="num">Factor</th></>}<th className="num">SKU</th><th className="num">Venta/día</th>{cdsVer.map((cd) => <th key={cd} className="num">Fuera {cd}</th>)}
                    <th className="num">Stock fuera</th><th className="num">Stock seg.</th><th className="num">A ingresar</th><th className="num">Ubic.</th><th className="num">Totes {osr}</th><th>Clases</th></tr></thead>
                  <tbody>
                    {r.deptos.map((d) => (
                      <tr key={d.depto} style={{ cursor: 'pointer' }} onClick={() => { setF({ ...f, depto: d.depto }); setVista('sku'); }} title="Ver los SKU de este depto">
                        <td>{d.depto}{d.enLista && <span className="tag" style={{ marginLeft: 6 }}>{osr}</span>}</td>
                        {r.evento && <><td className="note">{d.categoria}</td><td className="num"><b>×{fmt(d.factor, 2)}</b></td></>}<td className="num">{fmt(d.skus)}</td><td className="num">{fmt(d.ventaDia, 1)}</td>
                        {cdsVer.map((cd) => <td key={cd} className="num">{d.porCd[cd] ? fmt(d.porCd[cd]) : <span className="muted">—</span>}</td>)}
                        <td className="num">{fmt(d.fuera)}</td><td className="num">{fmt(d.ss)}</td><td className="num"><b>{fmt(d.ingresar)}</b></td><td className="num">{fmt(d.ubic)}</td><td className="num" title={`En tote entero: ${fmt(d.totesEntero)}`}>{fmt(d.totes, 1)}</td>
                        <td>{CLASES9.filter((k) => d.clases[k]).map((k) => <span key={k} className={'pill ' + tono(k)} style={{ marginRight: 4 }}>{k} {fmt(d.clases[k])}</span>)}</td>
                      </tr>
                    ))}
                    <tr className="tot"><td>Total</td>{r.evento && <><td /><td /></>}<td className="num">{fmt(t.skus)}</td><td className="num">{fmt(t.ventaDia, 1)}</td>
                      {cdsVer.map((cd) => <td key={cd} className="num">{fmt(r.porCd.find((c) => c.cd === cd)?.unidades || 0)}</td>)}
                      <td className="num">{fmt(t.fuera)}</td><td className="num">{fmt(t.ss)}</td><td className="num">{fmt(t.ingresar)}</td><td className="num">{fmt(t.ubic)}</td><td className="num">{fmt(t.totes)}</td><td /></tr>
                  </tbody>
                </table>
              </div>
              <p className="note">Departamentos ordenados por unidades a ingresar. Clic en un depto para ver sus SKU.</p>
            </>
          ) : (
            <>
              <div className="tbl" style={{ maxHeight: 460 }}>
                <table>
                  <thead><tr><th>Clase</th><th>SKU</th><th>Descripción</th><th>Log. OSR</th><th className="num">En {osr}</th>{cdsVer.map((cd) => <th key={cd} className="num">{cd}</th>)}
                    <th className="num">Stock fuera</th><th className="num">Stock seg.</th><th className="num">A ingresar</th><th className="num">Queda fuera</th><th className="num">Ubic. a tomar</th><th className="num">Venta/día</th>{r.evento && <th className="num">Factor</th>}<th className="num">Cobertura</th><th>Almacenamiento {osr}</th><th className="num">Totes</th></tr></thead>
                  <tbody>{r.detalle.map((x) => (
                    <tr key={x.sku}><td><span className={'pill ' + tono(x.matriz)}>{x.matriz}</span></td><td className="mono">{x.sku}</td>
                      <td className="wrap">{x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></td><td>{x.aptitud}</td>
                      <td className="num">{x.osr ? fmt(x.osr) : <span className="muted">—</span>}</td>
                      {cdsVer.map((cd) => <td key={cd} className="num">{x.porCd[cd] ? fmt(x.porCd[cd]) : <span className="muted">—</span>}</td>)}
                      <td className="num">{fmt(x.fuera)}</td><td className="num">{fmt(x.ss)}</td><td className="num"><b>{fmt(x.ingresar)}</b></td><td className="num">{fmt(x.queda)}</td><td className="num">{fmt(x.nUb)}</td>
                      <td className="num">{fmt(x.ventaDia, 1)}</td>{r.evento && <td className="num" title={x.categoria}>×{fmt(x.factor, 2)}</td>}<td className="num">{x.cob === null ? 'sin venta' : `${fmt(x.cob, 0)} d`}</td>
                      <td className="note" title={`Capacidad tote entero: ${fmt(x.cap)} u.`}>{x.almac}</td><td className="num">{fmt(x.totes, 2)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              {r.filtrados > r.detalle.length && <p className="note">Se muestran {fmt(r.detalle.length)} de {fmt(r.filtrados)} SKU. El Excel trae todos, con cada ubicación de origen.</p>}
              {!r.filtrados && <p className="note">Ningún SKU cumple el escenario. Prueba con más clases o filtros menos exigentes.</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================================
// Optimización de totes: ocupación actual de OSR, reempaque en quarter / half, tope de días en OSR y uso de lo liberado
// =============================================================================================
const ORDEN_TOT = [['', 'Totes liberados'], ['totesHoy', 'Totes hoy (más totes)'], ['ubic', 'Compartimentos'], ['unid', 'Unidades'], ['llenado', 'Utilización'], ['devolver', 'Vuelven a otro CD'], ['cobOsr', 'Días de cobertura en OSR'], ['ventaDia', 'Venta/día']];

const NOM_TIPO = { ENTERO: 'Full', HALF: 'Half', QUARTER: 'Quarter' };

function BarraUtil({ v }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, minWidth: 50, height: 8, borderRadius: 4, background: 'var(--empty)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, v * 100)}%`, height: '100%', background: v < 0.6 ? 'var(--yellow)' : 'var(--green)' }} /></div>
      <b style={{ minWidth: 38, textAlign: 'right' }}>{fmt(v * 100, 0)}%</b>
    </div>
  );
}

// utilización por tipo de tote de cada depto; clic en el encabezado ordena, clic en el depto filtra la vista por SKU
function TipoPorDepto({ deptos, ord, setOrd, onDepto }) {
  const val = (d, k) => {
    if (k === 'depto') return d.depto;
    if (k === 'bajo50') return d.porTipo.reduce((s, p) => s + p.rangos[0] + p.rangos[1], 0);
    const [t, c] = k.split('.');
    return c ? d.porTipo.find((p) => p.tipo === t)[c] : d[k];
  };
  const l = [...deptos].sort((a, b) => {
    const va = val(a, ord.k), vb = val(b, ord.k);
    return ord.dir * (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb)));
  });
  const th = (k, txt, cls = 'num', extra = {}) => (
    <th key={k} className={cls} style={{ whiteSpace: 'nowrap', ...extra }} aria-sort={ord.k === k ? (ord.dir > 0 ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="th-ord" onClick={() => setOrd({ k, dir: ord.k === k ? -ord.dir : k === 'depto' ? 1 : -1 })} title="Ordenar">
        {txt}<span className="flecha" aria-hidden="true">{ord.k === k ? (ord.dir > 0 ? '▲' : '▼') : '↕'}</span></button></th>
  );
  return (
    <div className="tbl tipo-dep" style={{ marginBottom: 6, maxHeight: 460 }}>
      <table>
        <thead>
          <tr className="th-g"><th colSpan={4} className="grp">Departamento</th>{Object.keys(NOM_TIPO).map((t) => <th key={t} colSpan={2} className="grp sep">{NOM_TIPO[t]}</th>)}<th colSpan={2} className="grp sep">Optimización</th></tr>
          <tr className="th-2">{th('depto', 'Departamento', '')}{th('skus', 'SKU')}{th('totesHoy', 'Totes')}{th('llenado', 'Utilización', '', { minWidth: 130 })}
            {Object.keys(NOM_TIPO).flatMap((t) => [th(`${t}.comps`, 'Compart.', 'num sep'), th(`${t}.utilizacion`, 'Utiliz.', '', { minWidth: 110 })])}
            {th('bajo50', 'Compart. < 50%', 'num sep')}{th('totesOpt', 'Totes reempaque')}</tr>
        </thead>
        <tbody>
          {l.map((d) => (
            <tr key={d.depto}>
              <td className="wrap"><a href="#" onClick={(e) => { e.preventDefault(); onDepto(d.depto); }} title="Ver los SKU del depto">{d.depto}</a></td>
              <td className="num">{fmt(d.skus)}</td><td className="num">{fmt(d.totesHoy, 0)}</td><td><BarraUtil v={d.llenado} /></td>
              {d.porTipo.map((p) => [
                <td key={p.tipo + 'c'} className="num sep">{p.comps ? fmt(p.comps) : <span className="muted">—</span>}</td>,
                <td key={p.tipo + 'u'}>{p.comps ? <BarraUtil v={p.utilizacion} /> : <span className="muted">—</span>}</td>])}
              <td className="num sep">{fmt(val(d, 'bajo50'))}</td><td className="num">{fmt(d.totesOpt, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================================
// Warehouse capacity del OSR por rack line (la 6 es de seguridad de la máquina y no cuenta) con target de ocupación
// =============================================================================================
const CLAVE_TARGET = 'osrTargetCapacidad';
const leerTarget = () => { try { return localStorage.getItem(CLAVE_TARGET) || ''; } catch { return ''; } };
const CLAVE_AVISO = 'osrAvisoCapacidad';
const leerAviso = () => { try { return localStorage.getItem(CLAVE_AVISO) || ''; } catch { return ''; } };
// Semáforo de ocupación: sobre el target (rojo, parpadeo rápido), a menos de "aviso" puntos del target (amarillo, parpadeo lento) o bajo (verde)
const SEMAFORO = { sobre: ['Sobre el target', '--red'], cerca: ['Cerca del target', '--yellow'], ok: ['Bajo el target', '--teal'] };
const estadoCap = (ocup, target, aviso) => (ocup > target ? 'sobre' : ocup >= target - aviso ? 'cerca' : 'ok');
const Luz = ({ e, titulo }) => <span className={`sem sem-${e}`} role="img" aria-label={titulo || SEMAFORO[e][0]} title={titulo || SEMAFORO[e][0]} />;

function CapacidadOsr() {
  const [target, setTarget] = useState(leerTarget);
  const [aviso, setAviso] = useState(leerAviso);
  const cambiarAviso = (v) => { setAviso(v); try { localStorage.setItem(CLAVE_AVISO, v); } catch { /* sin almacenamiento */ } };
  const [r] = useSimulacion('/api/optimizacion/osr/capacidad', { target: target === '' ? 85 : Number(target) }, [target]);
  const cambiar = (v) => { setTarget(v); try { localStorage.setItem(CLAVE_TARGET, v); } catch { /* sin almacenamiento */ } };
  if (!r) return null;
  if (!r.cargada) return <div className="alert warn" style={{ marginBottom: 12 }}>Sin capacidad del OSR por línea de rack. <IrACarga id="osrcap" etiqueta="Cargar capacidad (en Datos)" /></div>;
  const t = r.tot, l = r.lineas.filter((x) => x.cuenta);
  const tile = (k, v, cls = '', n = '') => <div className={'kpi ' + cls}><div className="k">{k}</div><div className="v">{v}</div>{n && <div className="n">{n}</div>}</div>;
  const sobre = t.occupied > t.meta;
  const av = (aviso === '' ? 3 : Math.max(0, Number(aviso) || 0)) / 100;
  const est = (x) => estadoCap(x.ocup, r.target, av);
  const eTot = est(t);
  const alertas = l.filter((x) => est(x) !== 'ok').sort((a, b) => b.ocup - a.ocup);
  return (
    <div className="sec" style={{ marginBottom: 16 }}>
      <div className="row spread" style={{ alignItems: 'flex-end', marginBottom: 6 }}>
        <div>
          <h2 style={{ margin: 0 }}>Capacidad de almacenamiento del OSR</h2>
          <p className="note" style={{ margin: '2px 0 0' }}>{r.archivo} · cargada {fFecha(r.cargado)} · líneas de rack 1 a {l.length ? l[l.length - 1].linea : 5}{r.fuera.length ? ` (línea ${r.fuera.join(', ')}: seguridad de la máquina, no cuenta)` : ''} <IrACarga id="osrcap" etiqueta="Reemplazar (en Datos)" /></p>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div><label className="lbl" htmlFor="cap-tg">Target de ocupación %</label>
            <input id="cap-tg" type="number" className="w90" min="1" max="100" placeholder="85" value={target} onChange={(e) => cambiar(e.target.value)} /></div>
          <div><label className="lbl" htmlFor="cap-av">Avisar a (puntos bajo el target)</label>
            <input id="cap-av" type="number" className="w90" min="0" max="50" step="0.5" placeholder="3" value={aviso} onChange={(e) => cambiarAviso(e.target.value)} /></div>
        </div>
      </div>
      <div className={`semaforo sem-borde-${alertas.some((x) => est(x) === 'sobre') ? 'sobre' : alertas.length ? 'cerca' : 'ok'}`} role="status" aria-live="polite">
        <div className="sem-luces">
          {l.map((x) => <span key={x.linea} className="sem-linea"><Luz e={est(x)} titulo={`Línea ${x.linea}: ${fmt(x.ocup * 100, 1)}% · ${SEMAFORO[est(x)][0]}`} />Línea {x.linea} <b>{fmt(x.ocup * 100, 1)}%</b></span>)}
          <span className="sem-linea sem-total"><Luz e={eTot} />Total <b>{fmt(t.ocup * 100, 1)}%</b></span>
        </div>
        <p className="sem-texto">{alertas.length
          ? alertas.map((x) => `Línea ${x.linea} ${est(x) === 'sobre' ? `sobre el target (${fmt(x.ocup * 100, 1)}%, ${fmt(-x.hastaTarget)} posiciones de más)` : `cerca del target (${fmt(x.ocup * 100, 1)}%, quedan ${fmt(x.hastaTarget)} posiciones)`}`).join(' · ')
          : `Todas las líneas bajo el target, a más de ${fmt(av * 100, 1)} puntos.`}</p>
      </div>
      <div className="grid-kpi kpi-fila">
        {tile('Posiciones', fmt(t.positions), '', `capacidad de ${l.length} líneas de rack`)}
        {tile('Ocupadas', fmt(t.occupied), '', `posiciones ocupadas${t.locked ? ` · ${fmt(t.locked)} bloqueadas` : ''}`)}
        {tile('% de ocupación', `${fmt(t.ocup * 100, 1)}%`, sobre ? 'bad' : t.ocup >= r.target - 0.05 ? 'warn' : 'good', `target ${fmt(r.target * 100, 0)}%`)}
        {tile(`Target ${fmt(r.target * 100, 0)}%`, fmt(t.meta), '', 'posiciones máximas a ocupar')}
        {tile(sobre ? 'Sobre el target' : 'Margen hasta el target', `${sobre ? '+' : ''}${fmt(Math.abs(t.hastaTarget))}`, sobre ? 'bad' : 'good', sobre ? 'posiciones por liberar para volver al target' : 'posiciones que se pueden ocupar sin pasar el target')}
        {tile('Libres', fmt(t.libre), '', `${fmt(t.positions ? (t.libre / t.positions) * 100 : 0, 1)}% de las posiciones`)}
      </div>
      <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', alignItems: 'start' }}>
        <Grafico alto={280} label="Ocupación y target por línea de rack, en % de sus posiciones" datos={{
          // todo en % de las posiciones de cada línea: la barra gris es el 100% (capacidad), la de ocupadas va dentro de ella
          // y el target es una línea recta a la misma altura en todas
          labels: l.map((x) => `Línea ${x.linea}`),
          datasets: [
            { type: 'line', label: `Target ${fmt(r.target * 100, 0)}%`, data: l.map(() => r.target * 100), borderColor: css('--red'), backgroundColor: css('--red'), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 0, tension: 0, order: 0 },
            { label: 'Posiciones (100%)', data: l.map(() => 100), backgroundColor: css('--empty'), borderRadius: 4, grouped: false, barPercentage: 0.7, order: 2 },
            { label: 'Ocupadas', data: l.map((x) => x.ocup * 100), backgroundColor: l.map((x) => css(SEMAFORO[est(x)][1])), borderRadius: 4, grouped: false, barPercentage: 0.7, order: 1 },
          ] }} opciones={{
            scales: { y: { min: 0, max: 100, ticks: { stepSize: 20, callback: (v) => `${v}%` } } },
            plugins: { tooltip: { callbacks: {
              label: (c) => {
                const x = l[c.dataIndex];
                if (c.datasetIndex === 0) return c.dataset.label;
                return c.datasetIndex === 1 ? `Posiciones: ${fmt(x.positions)}` : `Ocupadas: ${fmt(x.occupied)} (${fmt(x.ocup * 100, 1)}%)`;
              } } } } }} />
        <div className="tbl">
          <table>
            <thead><tr><th>Línea de rack</th><th className="num">Posiciones</th><th className="num">Ocupadas</th><th className="num">% ocupación</th><th className="num">Bloqueadas</th><th className="num">Libres</th><th className="num">Vs target</th></tr></thead>
            <tbody>
              {r.lineas.map((x) => (
                <tr key={x.linea} className={x.cuenta ? '' : 'muted'}>
                  <td>{x.cuenta && <Luz e={est(x)} />}{x.linea}{!x.cuenta && <span className="note"> · seguridad</span>}</td><td className="num">{fmt(x.positions)}</td><td className="num">{fmt(x.occupied)}</td>
                  <td className="num"><b style={{ color: x.cuenta ? { sobre: 'var(--red)', cerca: 'var(--yellow)' }[est(x)] : undefined }}>{fmt(x.ocup * 100, 1)}%</b></td>
                  <td className="num">{x.locked ? fmt(x.locked) : '—'}</td><td className="num">{fmt(x.libre)}</td>
                  <td className="num">{x.cuenta ? <span style={{ color: x.hastaTarget < 0 ? 'var(--bad)' : undefined }}>{x.hastaTarget > 0 ? '+' : ''}{fmt(x.hastaTarget)}</span> : <span className="muted">—</span>}</td>
                </tr>
              ))}
              <tr className="tot"><td><Luz e={eTot} />Total 1-{l.length ? l[l.length - 1].linea : 5}</td><td className="num">{fmt(t.positions)}</td><td className="num">{fmt(t.occupied)}</td><td className="num">{fmt(t.ocup * 100, 1)}%</td><td className="num">{fmt(t.locked)}</td><td className="num">{fmt(t.libre)}</td><td className="num">{t.hastaTarget > 0 ? '+' : ''}{fmt(t.hastaTarget)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="note">Vs target = posiciones que se pueden ocupar hasta el target (positivo) o que sobran sobre el target (negativo). Gráfico en % de las posiciones de cada línea: la barra gris es su capacidad (100%), la de ocupadas va dentro y la línea roja es el target. Semáforo y color de las barras: verde bajo el target, amarillo a menos de {fmt(av * 100, 1)} puntos del target y rojo sobre el target (en la tabla, las luces amarilla y roja parpadean).</p>
    </div>
  );
}

function TotesOsr() {
  const [f, setF] = useState({ tote: 'AUTO', capTote: '', maxDias: '', minOsr: '', minTotes: '', clases: [], aptitud: '', potClases: ['AX', 'AY', 'BX', 'BY'], depto: '', buscar: '', orden: '', dir: 'desc', top: '',
    temporadas: [], evento: 'NINGUNO', evtMin: '', filtroEvento: '', proteger: false, tempProteger: [] });
  const [vista, setVista] = useState('sku');
  const [vTipo, setVTipo] = useState('total');
  const [ordTipo, setOrdTipo] = useState({ k: 'totesHoy', dir: -1 });
  const cuerpo = { ...f, pot: { clases: f.potClases } };
  const [r, cargando] = useSimulacion('/api/optimizacion/osr/totes', cuerpo, [JSON.stringify(f)]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const alt = (k, v) => set(k)(f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);
  const osr = r?.osr || 'OSR';
  const t = r?.tot, u = r?.uso;
  const excel = urlApi('/api/optimizacion/osr/totes/excel' + qs({ tote: f.tote, capTote: f.capTote, maxDias: f.maxDias, minOsr: f.minOsr, minTotes: f.minTotes, clases: f.clases.join(','), aptitud: f.aptitud,
    temporadas: f.temporadas.join('|'), evento: f.evento, evtMin: f.evtMin, filtroEvento: f.filtroEvento, proteger: f.proteger ? '1' : '', tempProteger: f.tempProteger.join('|'), pot: JSON.stringify({ clases: f.potClases }) }));
  const tile = (k, v, cls = '', n = '') => <div className={'kpi ' + cls}><div className="k">{k}</div><div className="v">{v}</div>{n && <div className="n">{n}</div>}</div>;
  return (
    <>
    <CapacidadOsr />
    <div className="sec">
      <div className="row spread" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Optimización de totes de {osr}</h2>
        {r && <a className="btn primary" href={excel}>Exportar a Excel</a>}
      </div>
      {r?.fuente && (r.fuente.tipo === 'DISTRIBUCION'
        ? <div className="alert good">Ocupación real del {osr}: distribución de totes {r.fuente.archivo} cargada el {fFecha(r.fuente.cargado)} ({fmt(r.fuente.skus)} SKU).{r.tot.sinBase ? ` ${fmt(r.tot.sinBase)} SKU no están en la Base de stock (sin clase ni venta).` : ''} <IrACarga id="osrtotes" etiqueta="Reemplazar (en Datos)" /></div>
        : <div className="alert warn">Sin distribución de totes: se asume que cada ubicación de {osr} de la Base es un tote entero. <IrACarga id="osrtotes" etiqueta="Cargar distribución de totes (en Datos)" /></div>)}
      <p className="note" style={{ marginTop: -2 }}>Con la distribución de totes cargada se usan los compartimentos reales de cada SKU (full, half = ½ tote, quarter = ¼ tote); si no, cada ubicación de {osr} es un tote entero. Se simula reempacar cada SKU en quarter / half (los compartimentos de distintos SKU comparten tote) y, si se indica, dejar en {osr} solo N días de venta: el resto vuelve a otro CD. Los totes que se liberan se ofrecen a los SKU de afuera de las clases elegidas, con los criterios del Potencial fuera de {osr} (stock de seguridad 7 días, sin RCI).</p>

      <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,auto) minmax(0,1fr)', alignItems: 'start' }}>
        <div>
          <span className="lbl">SKU de {osr} a analizar (clic; vacío = todos)</span>
          <table className="pot-matriz">
            <thead><tr><th />{['X', 'Y', 'Z'].map((z) => <th key={z} className="num">{z}</th>)}</tr></thead>
            <tbody>{['A', 'B', 'C'].map((a) => (
              <tr key={a}><th>{a}</th>{['X', 'Y', 'Z'].map((z) => {
                const k = a + z, m = r?.matriz?.[k];
                const on = !f.clases.length || f.clases.includes(k);
                return (
                  <td key={k}><button type="button" className={'pot-celda ' + tono(k) + (on ? ' on' : '')} aria-pressed={f.clases.includes(k)} onClick={() => alt('clases', k)}>
                    <b>{k}</b><span>{m ? `${fmt(m.skus)} SKU` : '—'}</span><span>{m ? `${fmt(m.totes)} totes` : ''}</span></button></td>
                );
              })}</tr>
            ))}</tbody>
          </table>
        </div>
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div><label className="lbl" htmlFor="to-tote">Reempacar en</label>
            <select id="to-tote" value={f.tote} onChange={(e) => set('tote')(e.target.value)}>
              <option value="AUTO">Automático (enteros + quarter / half)</option><option value="QUARTER">Quarter (4 por tote)</option><option value="HALF">Half (2 por tote)</option><option value="ENTERO">Tote entero</option></select></div>
          <div><label className="lbl" htmlFor="to-cap">Capacidad tote (u.)</label><input id="to-cap" type="number" className="w90" min="1" placeholder="por depto" value={f.capTote} onChange={(e) => set('capTote')(e.target.value)} /></div>
          <div><label className="lbl" htmlFor="to-dias">Tope en {osr} (días de venta)</label><input id="to-dias" type="number" className="w90" min="0" placeholder="sin tope" value={f.maxDias} onChange={(e) => set('maxDias')(e.target.value)} /></div>
          {f.maxDias !== '' && <div><label className="lbl" htmlFor="to-min">Mínimo u. en {osr}</label><input id="to-min" type="number" className="w90" min="0" placeholder="0" value={f.minOsr} onChange={(e) => set('minOsr')(e.target.value)} /></div>}
          <div><label className="lbl" htmlFor="to-apt">Logística OSR</label>
            <select id="to-apt" value={f.aptitud} onChange={(e) => set('aptitud')(e.target.value)}><option value="">Todos</option><option value="Y">Solo Y</option><option value="NOY">Sin Y (N, REVISION…)</option></select></div>
          <div><label className="lbl" htmlFor="to-mt">SKU con más de N totes</label><input id="to-mt" type="number" className="w90" min="0" placeholder="0" value={f.minTotes} onChange={(e) => set('minTotes')(e.target.value)} /></div>
          <div>
            <span className="lbl">Ingresar con lo liberado</span>
            <div className="chips">{CLASES9.map((k) => <button key={k} className="chip" aria-pressed={f.potClases.includes(k)} onClick={() => alt('potClases', k)}>{k}</button>)}</div>
          </div>
          {r && <div>
            <span className="lbl">Temporada (vacío = todas)</span>
            <div className="chips">{r.temporadas.map((x) => <button key={x.temporada} className="chip" aria-pressed={f.temporadas.includes(x.temporada)} onClick={() => alt('temporadas', x.temporada)}>{x.temporada} · {fmt(x.skus)}</button>)}</div>
          </div>}
          {r && <div><label className="lbl" htmlFor="to-evt">Evento (simulador)</label>
            <select id="to-evt" value={f.evento} onChange={(e) => setF({ ...f, evento: e.target.value, filtroEvento: e.target.value === 'NINGUNO' ? '' : f.filtroEvento, proteger: e.target.value === 'NINGUNO' ? false : f.proteger })}>
              <option value="NINGUNO">Ninguno (sin evento ni Pro_Evt)</option><option value="">{r.proy ? `Proyección Pro_Evt: ${r.proy.evento}` : "Sin evento del simulador"}</option>{r.eventos.map((e) => <option key={e.clave} value={e.clave}>{e.evento} · {fFecha(e.inicio)}</option>)}</select></div>}
          {f.evento && f.evento !== 'NINGUNO' && <div><label className="lbl" htmlFor="to-evx">Factor mínimo</label>
            <input id="to-evx" type="number" className="w90" min="0" step="0.1" placeholder={r?.evtGeneral ? `> ${fmt(r.evtGeneral, 2)}` : ''} value={f.evtMin} onChange={(e) => set('evtMin')(e.target.value)} /></div>}
          {(r?.evento || r?.proy) && <div><label className="lbl" htmlFor="to-fe">SKU del evento</label>
            <select id="to-fe" value={f.filtroEvento} onChange={(e) => set('filtroEvento')(e.target.value)}><option value="">Todos</option><option value="EVENTO">Solo los del evento</option><option value="NO">Solo los que no son del evento</option></select></div>}
          {f.maxDias !== '' && <div>
            <span className="lbl">No reducir con el tope</span>
            <div className="chips">
              {(r?.evento || r?.proy) && <button className="chip" aria-pressed={f.proteger} onClick={() => set('proteger')(!f.proteger)}>SKU del evento</button>}
              {(r?.temporadas || []).map((x) => <button key={x.temporada} className="chip" aria-pressed={f.tempProteger.includes(x.temporada)} onClick={() => alt('tempProteger', x.temporada)}>{x.temporada}</button>)}
            </div>
          </div>}
          {cargando && <span className="note">Calculando…</span>}
        </div>
      </div>

      {r && t && u && (
        <>
          <div className="grid-kpi" style={{ marginTop: 14 }}>
            {tile(`Stock en ${osr}`, `${fmt(t.unid)} u.`, '', `${fmt(t.skus)} SKU analizados · ${fmt(t.unidOsr)} u. en todo ${osr}`)}
            {tile(`Totes ocupados en ${osr}`, fmt(t.totesHoy), '', `${fmt(t.hoyTipos.ENTERO)} full · ${fmt(t.hoyTipos.HALF)} half · ${fmt(t.hoyTipos.QUARTER)} quarter · ${fmt(t.totesOsr)} totes en todo ${osr}`)}
            {tile('% de utilización', `${fmt(t.llenado * 100, 0)}%`, t.llenado < 0.6 ? 'warn' : 'good', `unidades / capacidad de los totes que ocupan · mediana ${fmt(t.medianaUnid)} u. por tote`)}
            {tile('Totes optimizados', fmt(t.totesOpt), 'good', `${fmt(t.mix.ENTERO)} enteros, ${fmt(t.mix.HALF)} half, ${fmt(t.mix.QUARTER)} quarter${t.devolver ? ` · ${fmt(t.devolver)} u. vuelven a otro CD` : ''}`)}
            {tile('Totes que se liberan', fmt(t.libera), 'good', `${fmt(t.totesHoy ? (t.libera / t.totesHoy) * 100 : 0, 0)}% de los totes analizados`)}
            {tile(`SKU de afuera que entran`, `${fmt(u.entran)} de ${fmt(u.candidatos)}`, u.faltan ? 'warn' : 'good',
              `${u.clases.join(', ')} · usan ${fmt(u.totesUsados)} totes, ${fmt(u.unid)} u., ${fmt(u.ventaDia, 0)} u./día${u.faltan ? ` · faltan ${fmt(u.faltan)} totes para todos` : ` · sobran ${fmt(u.sobran)} totes`}`)}
          </div>
          <p className="note" style={{ marginTop: -6 }}>Entran: {CLASES9.filter((k) => u.porClase[k]).map((k) => `${k} ${fmt(u.porClase[k])}`).join(' · ') || '—'}.</p>
          <div className="row" style={{ alignItems: 'center', gap: 12, margin: '4px 0 6px' }}>
            <h3 style={{ margin: 0 }}>Utilización por tipo de tote</h3>
            <div className="chips">
              <button className="chip" aria-pressed={vTipo === 'total'} onClick={() => setVTipo('total')}>Total</button>
              <button className="chip" aria-pressed={vTipo === 'depto'} onClick={() => setVTipo('depto')}>Por departamento · {fmt(r.deptos.length)}</button>
            </div>
          </div>
          {vTipo === 'depto' ? <TipoPorDepto deptos={r.deptos} ord={ordTipo} setOrd={setOrdTipo} onDepto={(d) => { set('depto')(d); setVista('sku'); }} /> : <div className="tbl" style={{ marginBottom: 6 }}>
            <table>
              <thead><tr><th>Tipo</th><th className="num">Compartimentos</th><th className="num">Equiv. totes</th><th className="num">% de los totes</th><th className="num">SKU</th><th className="num">Solo este tipo</th>
                <th className="num">Unidades</th><th className="num">U. por compart.</th><th style={{ minWidth: 150 }}>Utilización</th>
                <th className="num">&lt; 25%</th><th className="num">25-50%</th><th className="num">50-80%</th><th className="num">≥ 80%</th><th className="num">Tras reempaque</th></tr></thead>
              <tbody>
                {t.porTipo.map((p) => (
                  <tr key={p.tipo}>
                    <td><b>{{ ENTERO: 'Full (1 tote)', HALF: 'Half (½ tote)', QUARTER: 'Quarter (¼ tote)' }[p.tipo]}</b></td>
                    <td className="num">{fmt(p.comps)}</td><td className="num">{fmt(p.totes)}</td><td className="num">{fmt(t.totesHoy ? (p.totes / t.totesHoy) * 100 : 0, 0)}%</td>
                    <td className="num">{fmt(p.skus)}</td><td className="num">{fmt(p.soloTipo)}</td><td className="num">{fmt(p.unid)}</td><td className="num">{fmt(p.comps ? p.unid / p.comps : 0, 1)}</td>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--empty)', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, p.utilizacion * 100)}%`, height: '100%', background: p.utilizacion < 0.6 ? 'var(--yellow)' : 'var(--green)' }} /></div>
                      <b style={{ minWidth: 38, textAlign: 'right' }}>{fmt(p.utilizacion * 100, 0)}%</b></div></td>
                    {p.rangos.map((n, i) => <td key={i} className="num">{n ? fmt(n) : <span className="muted">—</span>}</td>)}
                    <td className="num">{fmt(p.opt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
          <p className="note" style={{ marginTop: 0 }}>Las unidades de cada SKU se reparten entre sus compartimentos según el tamaño (full 1, half ½, quarter ¼); la utilización compara esas unidades con la capacidad del espacio. Los rangos cuentan compartimentos según el llenado de su SKU. «Tras reempaque» = compartimentos de ese tipo con el almacenamiento simulado.</p>
          <div className="alert" style={{ marginTop: 0 }}>
            <b>Fuera de AX · AY · BX · BY:</b> {fmt(t.fuera4.skus)} SKU en {fmt(t.fuera4.totes)} totes ({fmt(t.fuera4.unid)} u.; {fmt(t.fuera4.sinVenta)} sin venta).{' '}
            {(r.evento || r.proy)
              ? <>De ellos, <b>{fmt(t.fuera4.evento)} SKU ({fmt(t.fuera4.totesEvento)} totes) son del {r.evento ? `evento ${r.evento.evento}` : `Pro_Evt ${r.proy.evento}`}</b>{r.evento ? ` (deptos con factor ${r.conf.evtMin ? `≥ ${fmt(r.conf.evtMin, 2)}` : `sobre GENERAL ${fmt(r.evtGeneral, 2)}`})` : ''}: conviene mantenerlos para el evento; los otros {fmt(t.fuera4.skus - t.fuera4.evento)} ({fmt(t.fuera4.totes - t.fuera4.totesEvento)} totes) son los candidatos a liberar.</>
              : 'Elige un evento (o carga la proyección Pro_Evt) para ver cuáles corresponden al evento.'}
            {t.protegidos > 0 && ` · ${fmt(t.protegidos)} SKU protegidos del tope.`}
          </div>

          <div className="row spread" style={{ margin: '6px 0 8px' }}>
            <div className="row" style={{ alignItems: 'center', gap: 12 }}>
              <div className="chips">
                <button className="chip" aria-pressed={vista === 'sku'} onClick={() => setVista('sku')}>SKU en {osr} · {fmt(r.filtrados)}</button>
                <button className="chip" aria-pressed={vista === 'depto'} onClick={() => setVista('depto')}>Por departamento · {fmt(r.deptos.length)}</button>
                <button className="chip" aria-pressed={vista === 'entran'} onClick={() => setVista('entran')}>SKU que entran · {fmt(u.entran)}</button>
              </div>
              {vista === 'sku' && <>
                <input type="search" placeholder="Buscar SKU o descripción" value={f.buscar} onChange={(e) => set('buscar')(e.target.value)} style={{ width: 210 }} aria-label="Buscar SKU o descripción" />
                <label className="inline" style={{ fontSize: 13 }}>Ordenar por
                  <select value={f.orden} onChange={(e) => set('orden')(e.target.value)} style={{ width: 'auto', marginLeft: 6 }}>{ORDEN_TOT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                {f.orden && <button className="btn sm" onClick={() => set('dir')(f.dir === 'asc' ? 'desc' : 'asc')}>{f.dir === 'asc' ? '▲ menor a mayor' : '▼ mayor a menor'}</button>}
                <label className="inline" style={{ fontSize: 13 }}>Mostrar
                  <select value={f.top} onChange={(e) => set('top')(e.target.value)} style={{ width: 'auto', marginLeft: 6 }}><option value="">Todos</option>{[10, 20, 50, 100].map((n) => <option key={n} value={n}>Top {n}</option>)}</select></label>
              </>}
            </div>
            {f.depto && vista === 'sku' && <button className="chip" aria-pressed onClick={() => set('depto')('')}>{f.depto} ✕</button>}
          </div>

          {vista === 'depto' && (
            <div className="tbl" style={{ maxHeight: 460 }}>
              <table>
                <thead><tr><th>Depto</th><th className="num">SKU</th><th className="num">Totes hoy</th><th className="num">Unidades</th><th className="num">Vuelven a otro CD</th><th className="num">Totes optimizados</th><th className="num">Se liberan</th></tr></thead>
                <tbody>{r.deptos.map((d) => (
                  <tr key={d.depto} style={{ cursor: 'pointer' }} onClick={() => { setF({ ...f, depto: d.depto }); setVista('sku'); }} title="Ver los SKU de este depto">
                    <td>{d.depto}</td><td className="num">{fmt(d.skus)}</td><td className="num">{fmt(d.totesHoy)}</td><td className="num">{fmt(d.unid)}</td>
                    <td className="num">{d.devolver ? fmt(d.devolver) : <span className="muted">—</span>}</td><td className="num">{fmt(d.totesOpt, 1)}</td><td className="num"><b>{fmt(d.libera, 1)}</b></td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {vista === 'sku' && (
            <>
              <div className="tbl" style={{ maxHeight: 460 }}>
                <table>
                  <thead><tr><th>Clase</th><th>SKU</th><th>Descripción</th><th>Temporada</th>{(r.evento || r.proy) && <th>Evento</th>}<th>Log. OSR</th><th className="num">Full</th><th className="num">Half</th><th className="num">Quarter</th><th className="num">Totes hoy</th><th className="num">Unidades</th><th className="num">Capacidad</th><th className="num">Utilización</th>
                    <th className="num">Venta/día</th><th className="num">Cobertura</th>{t.devolver > 0 && <><th className="num">Quedan</th><th className="num">Vuelven</th></>}<th>Reempaque</th><th className="num">Totes</th><th className="num">Libera</th></tr></thead>
                  <tbody>{r.detalle.map((x) => (
                    <tr key={x.sku}><td>{x.matriz ? <span className={'pill ' + tono(x.matriz)}>{x.matriz}</span> : <span className="muted">—</span>}</td><td className="mono">{x.sku}</td>
                      <td className="wrap">{x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></td><td className="note">{x.temporada}</td>
                      {(r.evento || r.proy) && <td>{x.esEvento ? <span className="pill m-0" title={x.categoria}>{r.evento ? `Sí ×${fmt(x.factor, 2)}` : 'Pro_Evt'}</span> : <span className="muted">No</span>}{x.protegido && <div className="note" style={{ margin: 0 }}>protegido</div>}</td>}
                      <td>{x.log}</td>
                      <td className="num">{x.hoy.ENTERO || <span className="muted">—</span>}</td><td className="num">{x.hoy.HALF || <span className="muted">—</span>}</td><td className="num">{x.hoy.QUARTER || <span className="muted">—</span>}</td>
                      <td className="num">{fmt(x.totesHoy, 2)}</td><td className="num">{fmt(x.unid)}</td><td className="num">{fmt(x.cap)}</td>
                      <td className="num" style={{ color: x.llenado < 0.25 ? 'var(--bad)' : x.llenado < 0.5 ? 'var(--warn)' : undefined }}>{fmt(x.llenado * 100, 0)}%</td>
                      <td className="num">{fmt(x.ventaDia, 1)}</td><td className="num">{x.cobOsr === null ? 'sin venta' : `${fmt(x.cobOsr, 0)} d`}</td>
                      {t.devolver > 0 && <><td className="num">{fmt(x.queda)}</td><td className="num">{x.devolver ? fmt(x.devolver) : <span className="muted">—</span>}</td></>}
                      <td className="note">{x.almac || 'sale de OSR'}</td><td className="num">{fmt(x.totesOpt, 2)}</td><td className="num"><b>{fmt(x.libera, 2)}</b></td></tr>
                  ))}</tbody>
                </table>
              </div>
              {r.filtrados > r.detalle.length && <p className="note">Se muestran {fmt(r.detalle.length)} de {fmt(r.filtrados)} SKU. El Excel trae todos.</p>}
            </>
          )}
          {vista === 'entran' && (
            <>
              <div className="tbl" style={{ maxHeight: 460 }}>
                <table>
                  <thead><tr><th>Clase</th><th>SKU</th><th>Descripción</th><th className="num">Stock fuera</th><th className="num">A ingresar</th><th>Almacenamiento</th><th className="num">Totes</th><th className="num">Venta/día</th></tr></thead>
                  <tbody>{r.entran.map((x) => (
                    <tr key={x.sku}><td><span className={'pill ' + tono(x.matriz)}>{x.matriz}</span></td><td className="mono">{x.sku}</td>
                      <td className="wrap">{x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></td><td className="num">{fmt(x.fuera)}</td>
                      <td className="num"><b>{fmt(x.ingresar)}</b></td><td className="note">{x.almac}</td><td className="num">{fmt(x.totes, 2)}</td><td className="num">{fmt(x.ventaDia, 1)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <p className="note">SKU de afuera en el orden del Potencial fuera de {osr} (clase A y más venta) que caben en los totes liberados. Para ajustar stock de seguridad, evento o máximo de SKU usa esa pestaña.</p>
            </>
          )}
        </>
      )}
    </div>
    </>
  );
}

const PESTANAS = [['eventos', 'Simulador de eventos'], ['reabasto', 'Reabasto por proyección'], ['potencial', 'Potencial fuera de OSR'], ['totes', 'Optimización de totes'], ['rotacion', 'Ingreso de alta rotación']];

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
      {vista === 'potencial' && <PotencialOsr />}
      {vista === 'totes' && <TotesOsr />}
      {vista === 'rotacion' && <IngresoOsr />}
    </>
  );
}
