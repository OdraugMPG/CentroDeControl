import React, { useState } from 'react';
import { api, qs, fmt, fFecha, hora } from './api.js';
import { Subir, toast, useCarga } from './ui.jsx';

const TODOS = 'TODOS';
const ABC = { A: 'Alto', B: 'Medio', C: 'Bajo' };
const CLASES = ['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ'];
// Interpretación de cada celda según cómo se calculó XYZ: [significado, comportamiento esperado]
const LECTURA = {
  rotacion: {
    eje: 'Rotación (ventas / stock)', X: 'Alta', Y: 'Baja', Z: 'Sin venta o sin stock',
    AX: ['Alta demanda, alta rotación', 'Stock gira rápido: ubicar cerca del despacho'],
    AY: ['Alta demanda, rotación baja', 'Mucho stock para su venta: revisar cobertura'],
    AZ: ['Alta demanda, sin stock', 'Riesgo de quiebre: reponer'],
    BX: ['Demanda media, alta rotación', 'Volumen medio, stock ajustado'],
    BY: ['Demanda media, rotación baja', 'Volumen medio, sobrestock moderado'],
    BZ: ['Demanda media, sin stock', 'Revisar reposición'],
    CX: ['Baja demanda, alta rotación', 'Poco stock y poca venta'],
    CY: ['Baja demanda, rotación baja', 'Candidato a consolidar'],
    CZ: ['Sin venta o sin stock', 'Candidato a slow moving'],
  },
  historia: {
    eje: 'Variabilidad de la demanda', X: 'Estable', Y: 'Media', Z: 'Alta',
    AX: ['Alta demanda y estable', 'Alto volumen, predecible'],
    AY: ['Alta demanda y variable', 'Alto volumen, con variaciones'],
    AZ: ['Alta demanda y muy variable', 'Alto volumen, impredecible'],
    BX: ['Demanda media y estable', 'Volumen medio, predecible'],
    BY: ['Demanda media y variable', 'Volumen medio, con variaciones'],
    BZ: ['Demanda media y muy variable', 'Volumen medio, impredecible'],
    CX: ['Baja demanda y estable', 'Bajo volumen, predecible'],
    CY: ['Baja demanda y variable', 'Bajo volumen, con variaciones'],
    CZ: ['Baja demanda y muy variable', 'Bajo volumen, impredecible'],
  },
};
// Degradado diagonal: AX en verde, CZ en rojo (como la matriz del libro).
const tono = (m) => (m[1] === '-' ? 'm-n' : 'm-' + ('ABC'.indexOf(m[0]) + 'XYZ'.indexOf(m[1])));
const pc = (x, d = 1) => (Number.isFinite(x) ? fmt(x * 100, d) + '%' : '—');
const div = (a, b) => (b > 0 ? a / b : 0);

/** Tooltip flotante dentro de un contenedor con position: relative. */
function Tip({ t }) {
  if (!t) return null;
  return (
    <div className="viz-tip" style={{ left: t.x, top: t.y }} role="status">
      {t.filas.map(([v, l], i) => <div key={i}><b>{v}</b> <span>{l}</span></div>)}
    </div>
  );
}

/** Curva de Pareto: % de SKU (ordenados por venta) contra % de venta acumulada, con las zonas A, B y C. */
function Pareto({ puntos, abc, total, u }) {
  const [t, setT] = useState(null);
  const W = 560, H = 270, m = { l: 44, r: 22, t: 26, b: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const X = (v) => m.l + v * iw, Y = (v) => m.t + (1 - v) * ih;
  if (!puntos.length) return <p className="muted">Sin ventas para dibujar la curva.</p>;
  const fA = div(abc.A.skus, total.skus), fB = div(abc.B.skus, total.skus);
  const zonas = [['A', 0, fA, 'm-0', `0–${u.a}%`], ['B', fA, fA + fB, 'm-2', `${u.a}–${u.b}%`], ['C', fA + fB, 1, 'm-4', `> ${u.b}%`]];
  const d = puntos.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('');
  const mover = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, ((e.clientX - r.left) * (W / r.width) - m.l) / iw));
    const p = puntos.reduce((a, b) => (Math.abs(b[0] - fx) < Math.abs(a[0] - fx) ? b : a));
    setT({ p, x: (X(p[0]) / W) * r.width, y: (Y(p[1]) / H) * r.height, filas: [[pc(p[1]), 'de la venta acumulada'], [pc(p[0]), `de los SKU (${fmt(p[0] * total.skus)})`]] });
  };
  return (
    <div className="viz">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Curva de Pareto: el ${pc(fA)} de los SKU genera el ${pc(div(abc.A.metrica, total.metrica))} de la venta`}
        onPointerMove={mover} onPointerLeave={() => setT(null)}>
        {zonas.map(([k, a, b, cl, txt]) => b > a && (
          <g key={k}>
            <rect className={'zona ' + cl} x={X(a)} y={m.t} width={Math.max(0, X(b) - X(a))} height={ih} />
            {X(b) - X(a) > 12 && <text className="zona-t" x={(X(a) + X(b)) / 2} y={m.t - 8} textAnchor="middle"><tspan fontWeight="700">{k}</tspan> {X(b) - X(a) > 90 ? txt : ''}</text>}
          </g>
        ))}
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
          <g key={v}>
            <line className="grid" x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} />
            <text className="eje" x={m.l - 6} y={Y(v) + 4} textAnchor="end">{v * 100}%</text>
            <text className="eje" x={X(v)} y={H - m.b + 16} textAnchor="middle">{v * 100}%</text>
          </g>
        ))}
        <text className="eje" x={m.l + iw / 2} y={H - 4} textAnchor="middle">% de SKU (ordenados por venta)</text>
        <path d={d} fill="none" className="serie-1" strokeWidth="2" strokeLinejoin="round" />
        {t && <><line className="cruz" x1={X(t.p[0])} x2={X(t.p[0])} y1={m.t} y2={m.t + ih} /><circle className="serie-1-f punto" cx={X(t.p[0])} cy={Y(t.p[1])} r="4" /></>}
      </svg>
      <Tip t={t} />
    </div>
  );
}

/** Barras agrupadas por clase ABC: % de SKU, % de unidades almacenadas y % de venta. */
function BarrasClase({ abc, total, criterio }) {
  const [t, setT] = useState(null);
  const series = [['% SKU', 'skus', 'serie-1-f'], ['% unidades', 'stock', 'serie-2-f'], [criterio === 'valor' ? '% venta ($)' : '% venta', 'metrica', 'serie-3-f']];
  const W = 380, H = 270, m = { l: 12, r: 12, t: 22, b: 40 };
  const ih = H - m.t - m.b, gw = (W - m.l - m.r) / 3, bw = 26, gap = 2;
  const max = Math.max(0.0001, ...['A', 'B', 'C'].flatMap((k) => series.map(([, c]) => div(abc[k][c], total[c]))));
  return (
    <div className="viz">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Representación por clase ABC" onPointerLeave={() => setT(null)}>
        <line className="grid" x1={m.l} x2={W - m.r} y1={m.t + ih} y2={m.t + ih} />
        {['A', 'B', 'C'].map((k, i) => {
          const x0 = m.l + i * gw + (gw - (bw * 3 + gap * 2)) / 2;
          return (
            <g key={k}>
              {series.map(([nom, c, cl], j) => {
                const v = div(abc[k][c], total[c]), h = (v / max) * ih, x = x0 + j * (bw + gap), y = m.t + ih - h;
                return (
                  <g key={c} onPointerMove={(e) => { const r = e.currentTarget.ownerSVGElement.getBoundingClientRect(); setT({ x: ((x + bw / 2) / W) * r.width, y: (y / H) * r.height, filas: [[pc(v), `${nom} · clase ${k}`]] }); }}>
                    <rect x={x - 3} y={m.t} width={bw + 6} height={ih} fill="transparent" />
                    <path className={cl} d={`M${x},${m.t + ih}V${y + Math.min(4, h)}q0,-${Math.min(4, h)} ${Math.min(4, h)},-${Math.min(4, h)}h${bw - 2 * Math.min(4, h)}q${Math.min(4, h)},0 ${Math.min(4, h)},${Math.min(4, h)}V${m.t + ih}Z`} />
                    <text className="val" x={x + bw / 2} y={y - 5} textAnchor="middle">{fmt(v * 100, 0)}%</text>
                  </g>
                );
              })}
              <text className="eje-k" x={x0 + (bw * 3 + gap * 2) / 2} y={H - m.b + 18} textAnchor="middle">{k}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend">{series.map(([nom, , cl]) => <span key={nom} className={'lg ' + cl}>{nom}</span>)}</div>
      <Tip t={t} />
    </div>
  );
}

/** Matriz 3x3 con ejes ABC (columnas) y XYZ (filas), como la del libro. */
function Matriz({ celdas, total, lectura, celda, setCelda, metodo }) {
  const sinHist = ['A-', 'B-', 'C-'].some((k) => celdas[k].skus);
  return (
    <div className="mtx-wrap">
      <div className="mtx-eje-y">{lectura.eje} (XYZ)</div>
      <div>
        <div className="mtx" style={{ gridTemplateColumns: '84px repeat(3, minmax(0, 1fr))' }}>
          {['X', 'Y', 'Z', ...(sinHist ? ['-'] : [])].map((z) => (
            <React.Fragment key={z}>
              <div className="mtx-h"><b>{z === '-' ? '—' : z}</b><small>{z === '-' ? 'Sin historia' : lectura[z]}</small></div>
              {['A', 'B', 'C'].map((a) => {
                const k = a + z, c = celdas[k];
                return (
                  <button key={k} className={'mtx-c ' + tono(k)} aria-pressed={celda === k} title={lectura[k] ? `${lectura[k][0]} · ${lectura[k][1]}` : `Clase ${a} sin historia de ventas`} onClick={() => setCelda(celda === k ? '' : k)}>
                    <b>{z === '-' ? a + ' —' : k}</b>
                    <span>{fmt(c.skus)} SKU</span>
                    <small>{pc(div(c.skus, total.skus))} SKU · {pc(div(c.stock, total.stock))} unid.</small>
                    <small>{pc(div(c.metrica, total.metrica))} venta</small>
                  </button>
                );
              })}
            </React.Fragment>
          ))}
          <div />
          {['A', 'B', 'C'].map((a) => <div key={a} className="mtx-h"><b>{a}</b><small>({ABC[a]})</small></div>)}
        </div>
        <div className="mtx-eje-x">Volumen de demanda (ABC)</div>
        {metodo === 'historia' && sinHist && <p className="note">La fila "—" son SKU que no están en el archivo de ventas mensuales.</p>}
      </div>
    </div>
  );
}

/** Clase ABC-XYZ por CD (vista consolidada): composición de cada CD y dónde se almacena cada clase. */
function PorCd({ porCd, cds }) {
  const [modo, setModo] = useState('comp');
  const tot = (cd) => CLASES.reduce((s, k) => s + (porCd[cd]?.[k]?.stock || 0), 0);
  const totClase = (k) => cds.reduce((s, cd) => s + (porCd[cd]?.[k]?.stock || 0), 0);
  const totGeneral = cds.reduce((s, cd) => s + tot(cd), 0);
  const val = (cd, k) => {
    const c = porCd[cd]?.[k] || { skus: 0, stock: 0 };
    if (modo === 'comp') return pc(div(c.stock, tot(cd)));
    if (modo === 'donde') return pc(div(c.stock, totClase(k)));
    return <>{fmt(c.skus)} <span className="muted">/ {fmt(c.stock)}</span></>;
  };
  // intensidad de la celda (escala de un solo tono, como el formato condicional del libro)
  const fondo = (cd, k) => {
    if (modo === 'abs') return undefined;
    const c = porCd[cd]?.[k]?.stock || 0;
    const v = modo === 'comp' ? div(c, tot(cd)) : div(c, totClase(k));
    return { background: `color-mix(in srgb, var(--accent) ${Math.round(v * 55)}%, transparent)` };
  };
  return (
    <div className="sec">
      <div className="row spread" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Clases ABC-XYZ por CD</h2>
        <div className="chips">
          <button className="chip" aria-pressed={modo === 'comp'} onClick={() => setModo('comp')}>% de las unidades del CD</button>
          <button className="chip" aria-pressed={modo === 'donde'} onClick={() => setModo('donde')}>Dónde se almacena cada clase</button>
          <button className="chip" aria-pressed={modo === 'abs'} onClick={() => setModo('abs')}>SKU / unidades</button>
        </div>
      </div>
      <div className="tbl">
        <table>
          <thead><tr><th>Clase</th>{cds.map((cd) => <th key={cd} className="num">{cd}</th>)}{modo !== 'comp' && <th className="num">Unidades de la clase</th>}</tr></thead>
          <tbody>
            {CLASES.map((k) => (
              <tr key={k}><td><span className={'pill ' + tono(k)}>{k}</span></td>
                {cds.map((cd) => <td key={cd} className="num" style={fondo(cd, k)}>{val(cd, k)}</td>)}
                {modo !== 'comp' && <td className="num">{fmt(totClase(k))}</td>}</tr>
            ))}
            <tr className="tot"><td>Total</td>{cds.map((cd) => <td key={cd} className="num">{modo === 'abs' ? fmt(tot(cd)) : modo === 'comp' ? '100%' : pc(div(tot(cd), totGeneral))}</td>)}{modo !== 'comp' && <td className="num">{fmt(totGeneral)}</td>}</tr>
          </tbody>
        </table>
      </div>
      <p className="note">
        {modo === 'comp' && 'Cada columna suma 100%: qué parte de las unidades almacenadas en el CD es de cada clase.'}
        {modo === 'donde' && 'Cada fila suma 100%: en qué CD están las unidades de cada clase. La fila Total es la participación de cada CD en el almacenamiento.'}
        {modo === 'abs' && 'SKU con stock en el CD / unidades almacenadas. Un SKU almacenado en varios CD cuenta en cada uno.'}
      </p>
    </div>
  );
}

export default function AbcXyz() {
  const [cd, setCd] = useState(TODOS);
  const [criterio, setCriterio] = useState('unidades');
  const [metodo, setMetodo] = useState('rotacion');
  const [celda, setCelda] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [d, err, rec] = useCarga(() => api.get('/api/abcxyz' + qs({ cd, criterio, metodo, celda })), [cd, criterio, metodo, celda]);

  const subirHist = async (f) => {
    setSubiendo(true);
    try {
      const fd = new FormData(); fd.append('archivo', f);
      const r = await api.post('/api/abcxyz/historia', fd);
      toast(`Historia cargada: ${fmt(r.skus)} SKU, ${r.meses.length} meses (${r.meses[0]} a ${r.meses[r.meses.length - 1]}).`);
      setMetodo('historia'); setCelda(''); rec();
    } catch (e) { toast(e.message, true); } finally { setSubiendo(false); }
  };
  const borrarHist = async () => { await api.del('/api/abcxyz/historia'); toast('Historia de ventas borrada.'); setMetodo('rotacion'); rec(); };
  const guardar = async () => {
    try { const r = await api.post('/api/abcxyz/guardar', { criterio, metodo }); toast(`Clasificación guardada: ${fmt(r.skus)} SKU en ${r.cds} CD (XYZ por ${r.metodo === 'historia' ? 'variabilidad' : 'rotación'}).`); rec(); } catch (e) { toast(e.message, true); }
  };

  if (err) return <><div className="top"><h1>Análisis ABC / XYZ</h1></div><div className="alert warn">{err}</div></>;
  if (!d) return <p className="muted">Calculando clasificación…</p>;
  const { celdas, abc, total, porCd } = d.resumen;
  const u = d.umbrales;
  const lectura = LECTURA[d.metodo];
  const ambito = d.cd === TODOS ? 'todos los CD' : d.cd;
  const met = (x) => (criterio === 'valor' ? '$' + fmt(x) : fmt(x) + ' u.');
  const xyzTxt = d.metodo === 'historia'
    ? `XYZ por variabilidad de la venta mensual (X ≤ ${u.x}, Y ≤ ${u.y} de coeficiente de variación)`
    : `XYZ por rotación ventas / stock (X ≥ ${u.r}, Y > 0, Z sin venta o sin stock)`;
  const cambiar = (f) => (v) => { f(v); setCelda(''); };

  return (
    <>
      <div className="top">
        <div>
          <h1>Análisis ABC / XYZ</h1>
          <div className="sub">Base del {fFecha(d.carga.fecha)} · ABC por {criterio === 'valor' ? 'valor (ventas × costo)' : 'unidades vendidas'} de los últimos 2 meses (A hasta {u.a}%, B hasta {u.b}%) · {xyzTxt}.</div>
        </div>
        <div className="row">
          {d.guardado && <span className="note">Guardada el {fFecha(d.guardado.en.slice(0, 10))} {hora(d.guardado.en)}</span>}
          <button className="btn primary" onClick={guardar}>Guardar clasificación</button>
        </div>
      </div>

      {!d.hayVentas && <div className="alert warn">La Base no trae columna VENTAS: todos los SKU quedan en C.</div>}

      <div className="sec flt">
        <div>
          <span className="lbl">Ámbito</span>
          <div className="chips">
            <button className="chip" aria-pressed={d.cd === TODOS} onClick={() => cambiar(setCd)(TODOS)}>Todos los CD</button>
            {d.cds.map((x) => <button key={x} className="chip" aria-pressed={x === d.cd} onClick={() => cambiar(setCd)(x)}>{x}</button>)}
          </div>
        </div>
        <div>
          <span className="lbl">ABC por</span>
          <div className="chips">
            <button className="chip" aria-pressed={criterio === 'unidades'} onClick={() => cambiar(setCriterio)('unidades')}>Unidades vendidas</button>
            <button className="chip" aria-pressed={criterio === 'valor'} disabled={!d.hayCosto} title={d.hayCosto ? '' : 'La Base no trae COSTO'} onClick={() => cambiar(setCriterio)('valor')}>Valor (ventas × costo)</button>
          </div>
        </div>
        <div>
          <span className="lbl">XYZ por</span>
          <div className="chips">
            <button className="chip" aria-pressed={d.metodo === 'rotacion'} onClick={() => cambiar(setMetodo)('rotacion')}>Rotación (ventas / stock)</button>
            <button className="chip" aria-pressed={d.metodo === 'historia'} disabled={!d.historia} title={d.historia ? '' : 'Carga primero las ventas mensuales'} onClick={() => cambiar(setMetodo)('historia')}>Variabilidad mensual</button>
          </div>
          <div className="row" style={{ alignItems: 'center', marginTop: 8 }}>
            <Subir etiqueta="Cargar ventas mensuales" onArchivo={subirHist} cargando={subiendo} />
            {d.historia && <button className="btn sm danger" onClick={borrarHist}>Borrar historia</button>}
          </div>
          <p className="note" style={{ marginBottom: 0 }}>
            {d.historia
              ? `${d.historia.meses} meses cargados (${d.historia.desde} a ${d.historia.hasta}), ${fmt(d.historia.skus)} SKU. Se analizan ${d.historia.ventana[0]} a ${d.historia.ventana[d.historia.ventana.length - 1]}.`
              : 'Opcional: con la venta por mes (SKU, CD, MES, UNIDADES o una columna por mes) XYZ mide la variabilidad de la demanda.'}
          </p>
        </div>
      </div>

      <div className="grid-kpi">
        <div className="kpi"><div className="k">SKU · {ambito}</div><div className="v">{fmt(total.skus)}</div><div className="n">{fmt(d.sinVenta)} sin venta en 2 meses</div></div>
        <div className="kpi"><div className="k">Unidades almacenadas</div><div className="v">{fmt(total.stock)}</div><div className="n">{met(total.metrica)} vendidos en 2 meses</div></div>
        <div className="kpi good"><div className="k">Clase A · % SKU / % venta</div><div className="v">{pc(div(abc.A.skus, total.skus), 0)} / {pc(div(abc.A.metrica, total.metrica), 0)}</div><div className="n">{fmt(abc.A.skus)} SKU</div></div>
        <div className="kpi"><div className="k">AX · % SKU / % unidades</div><div className="v">{pc(div(celdas.AX.skus, total.skus), 0)} / {pc(div(celdas.AX.stock, total.stock), 0)}</div><div className="n">{fmt(celdas.AX.skus)} SKU · {pc(div(celdas.AX.metrica, total.metrica), 0)} de la venta</div></div>
      </div>

      <div className="viz-row">
        <div className="sec">
          <h2>Curva ABC (Pareto)</h2>
          <p className="note" style={{ marginTop: -4 }}>El {pc(div(abc.A.skus, total.skus))} de los SKU genera el {pc(div(abc.A.metrica, total.metrica))} de la venta.</p>
          <Pareto puntos={d.pareto} abc={abc} total={total} u={u} />
        </div>
        <div className="sec">
          <h2>Representación por clase</h2>
          <p className="note" style={{ marginTop: -4 }}>Si una clase ocupa más % de unidades que % de venta, tiene más stock del que vende.</p>
          <BarrasClase abc={abc} total={total} criterio={criterio} />
        </div>
      </div>

      <div className="sec">
        <div className="row spread" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Matriz de clasificación ABC / XYZ · {ambito}</h2>
          {celda && <button className="btn sm" onClick={() => setCelda('')}>Ver todas las celdas</button>}
        </div>
        <div className="mtx-row">
          <Matriz celdas={celdas} total={total} lectura={lectura} celda={celda} setCelda={setCelda} metodo={d.metodo} />
          <div className="tbl">
            <table>
              <thead><tr><th>Clase</th><th>Significado</th><th>Comportamiento esperado</th></tr></thead>
              <tbody>{CLASES.map((k) => (
                <tr key={k} aria-selected={celda === k} onClick={() => setCelda(celda === k ? '' : k)} style={{ cursor: 'pointer' }}>
                  <td><span className={'pill ' + tono(k)}>{k}</span></td><td className="wrap">{lectura[k][0]}</td><td className="wrap muted">{lectura[k][1]}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
        <p className="note">Haz clic en una celda o una fila para filtrar el detalle.</p>
      </div>

      {d.cd === TODOS && <PorCd porCd={porCd} cds={d.cds} />}

      <div className="sec">
        <h2>Detalle {celda ? `· ${celda[1] === '-' ? 'clase ' + celda[0] + ' sin historia' : celda}` : ''}</h2>
        <div className="tbl" style={{ maxHeight: 520 }}>
          <table>
            <thead><tr><th className="num">#</th><th>SKU</th><th>Descripción</th><th>Depto</th><th className="num">Ventas 2m</th>{criterio === 'valor' && <th className="num">Valor</th>}<th className="num">% venta</th><th className="num">% acum.</th><th className="num">Stock</th><th className="num">Rotación</th>{d.historia && <><th className="num">Prom. mes</th><th className="num">CV</th></>}<th>Clase</th></tr></thead>
            <tbody>{d.detalle.map((x) => (
              <tr key={x.sku}>
                <td className="num">{x.posicion}</td><td className="mono">{x.sku}</td><td className="wrap">{x.desc}</td><td>{x.depto}</td>
                <td className="num">{fmt(x.ventas)}</td>{criterio === 'valor' && <td className="num">${fmt(x.metrica)}</td>}
                <td className="num">{fmt(x.pctMetrica, 2)}%</td><td className="num">{fmt(x.pctAcum, 1)}%</td>
                <td className="num">{fmt(x.stock)}</td><td className="num">{x.rot === null ? '—' : fmt(x.rot, 2)}</td>
                {d.historia && <><td className="num">{x.promMes === null ? '—' : fmt(x.promMes, 1)}</td><td className="num">{x.cv === null ? '—' : fmt(x.cv, 2)}</td></>}
                <td><span className={'pill ' + tono(x.matriz)}>{x.xyz ? x.matriz : x.abc + ' —'}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {d.filas > d.detalle.length && <p className="note">Se muestran {fmt(d.detalle.length)} de {fmt(d.filas)} SKU (ordenados por venta).</p>}
      </div>
    </>
  );
}
