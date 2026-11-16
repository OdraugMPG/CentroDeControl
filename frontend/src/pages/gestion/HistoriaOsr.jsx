// Sloting → Evolución OSR: variación histórica del OSR con cada Base de stock cargada (una foto por día): SKU, unidades y
// ubicaciones en el OSR, su peso sobre el stock de todos los CD, SKU que entran y salen del OSR, y comparación entre dos
// Bases por depto y por SKU.
import React, { useState } from 'react';
import { api, qs, fmt, pct, fFecha } from './api.js';
import { toast } from './ui.jsx';

const DSEM = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'];
const diaCorto = (iso) => `${DSEM[new Date(iso + 'T12:00:00').getDay()]} ${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
const signo = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d);
const colorVar = (v) => (v > 0 ? 'var(--good)' : v < 0 ? 'var(--bad)' : undefined);
const varPct = (a, b) => (a ? (b - a) / a : null);
const GRUPOS = [
  ['entraron', 'Entraron al OSR', 'Sin stock en el OSR en la primera Base y con stock en la segunda.'],
  ['salieron', 'Salieron del OSR', 'Con stock en el OSR en la primera Base y sin stock en la segunda. "Stock fuera" dice si siguen en otro CD.'],
  ['subieron', 'Subieron unidades', 'Estaban en las dos Bases y tienen más unidades en la segunda.'],
  ['bajaron', 'Bajaron unidades', 'Estaban en las dos Bases y tienen menos unidades en la segunda.'],
];

const SERIES = [['skusOsr', 'SKU en el OSR', '--s1', 'SKU'], ['uOsr', 'Unidades en el OSR', '--s3', 'u.']];
const DIA_MS = 86400000;
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / DIA_MS);

/** Recta de mínimos cuadrados sobre (días desde la primera Base, valor): pendiente por día, valor inicial y R². */
function tendencia(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, v) => a + v, 0) / n, my = ys.reduce((a, v) => a + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (!sxx) return null;
  const m = sxy / sxx, b = my - m * mx;
  return { m, b, r2: syy ? (sxy * sxy) / (sxx * syy) : 1, en: (x) => b + m * x };
}

/** SKU y unidades en un solo gráfico: variación % respecto de la primera Base (misma escala para las dos), con su tendencia. */
function Combinada({ dias, h, setH }) {
  if (!dias.length) return null;
  const f0 = dias[0].fecha;
  const xs = dias.map((d) => diasEntre(f0, d.fecha));
  const span = Math.max(1, xs[xs.length - 1]);
  const ser = SERIES.map(([k, nom, color, unid]) => {
    const v0 = dias[0][k] || 1;
    const ys = dias.map((d) => (d[k] / v0 - 1) * 100);
    const t = tendencia(xs, dias.map((d) => d[k]));
    return { k, nom, color, unid, v0, ys, t, tys: t ? [t.en(0), t.en(span)].map((v) => (v / v0 - 1) * 100) : null };
  });
  const todos = ser.flatMap((s) => [...s.ys, ...(s.tys || [])]);
  const lo = Math.min(0, ...todos), hi = Math.max(0, ...todos);
  const pad = Math.max((hi - lo) * 0.1, 0.5);
  const y0 = lo - pad, y1 = hi + pad;
  const W = 1000, H = 220;
  const X = (x) => (span ? (0.02 + 0.96 * (x / span)) : 0.5) * W;
  const Y = (v) => H - ((v - y0) / (y1 - y0)) * H;
  const left = (x) => `${(X(x) / W) * 100}%`;
  const bottom = (v) => `${((v - y0) / (y1 - y0)) * 100}%`;
  const paso = (y1 - y0) > 12 ? 5 : (y1 - y0) > 5 ? 2 : 1;
  const ticks = [];
  for (let t = Math.ceil(y0 / paso) * paso; t <= y1; t += paso) ticks.push(t);
  const pasoX = Math.max(1, Math.ceil(dias.length / 10));
  const sel = h !== null ? h : dias.length - 1;
  const d = dias[sel];
  const pctTxt = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), 1)}%`;
  return (
    <div className="eo-graf">
      <div className="row spread" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <h4 style={{ margin: 0 }}>SKU y unidades en el OSR · variación desde el {diaCorto(f0)}</h4>
        <div className="legend eo-ley">
          {ser.map((s) => <span key={s.k}><i style={{ background: `var(${s.color})` }} />{s.nom}</span>)}
          <span><i className="eo-ley-t" />Tendencia</span>
        </div>
      </div>
      <div className="eo-lee" aria-live="polite">
        <b>{diaCorto(d.fecha)}</b>{ser.map((s) => <span key={s.k}> · <span style={{ color: `var(${s.color})` }}>●</span> {fmt(d[s.k])} {s.unid} ({pctTxt(s.ys[sel])})</span>)}
      </div>
      <div className="ho-plot eo-plot">
        <div className="ho-y">{ticks.map((t) => <span key={t} style={{ bottom: bottom(t) }}>{t > 0 ? '+' : ''}{t}%</span>)}</div>
        <div className="ho-area" onMouseLeave={() => setH(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Variación % de SKU y unidades en el OSR por Base, con tendencia">
            {ticks.map((t) => <line key={t} x1="0" x2={W} y1={Y(t)} y2={Y(t)} className={t === 0 ? 'eo-cero' : 'ho-grid'} />)}
            {h !== null && <line x1={X(xs[h])} x2={X(xs[h])} y1="0" y2={H} className="ho-cruz" />}
            {ser.map((s) => s.tys && <line key={'t' + s.k} x1={X(0)} x2={X(span)} y1={Y(s.tys[0])} y2={Y(s.tys[1])} className="eo-tend" style={{ stroke: `var(${s.color})` }} />)}
            {ser.map((s) => <path key={s.k} d={s.ys.map((v, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`).join('')} className="ho-l" style={{ stroke: `var(${s.color})` }} />)}
            {dias.map((dd, i) => {
              const a = i ? (X(xs[i - 1]) + X(xs[i])) / 2 : 0, b = i < dias.length - 1 ? (X(xs[i]) + X(xs[i + 1])) / 2 : W;
              return <rect key={dd.fecha} x={a} y="0" width={b - a} height={H} fill="transparent" onMouseEnter={() => setH(i)} />;
            })}
          </svg>
          {ser.map((s) => dias.map((dd, i) => <i key={s.k + dd.fecha} className="ho-pt" data-on={h === i || undefined}
            style={{ left: left(xs[i]), bottom: bottom(s.ys[i]), background: `var(${s.color})` }} />))}
        </div>
        <div className="ho-x">{dias.map((dd, i) => (i % pasoX === 0 || i === h) &&
          <span key={dd.fecha} style={{ left: left(xs[i]) }} className={i === h ? 'on' : ''}>{diaCorto(dd.fecha)}</span>)}</div>
      </div>
      <table className="ho-res" style={{ marginTop: 10 }}>
        <thead><tr><th>Tendencia</th><th className="num">Por día</th><th className="num">Por semana</th><th className="num">% por semana</th><th className="num" title="Qué tan bien explica la recta los datos: 1 = todos los puntos sobre la recta">Ajuste (R²)</th></tr></thead>
        <tbody>{ser.map((s) => s.t && (
          <tr key={s.k}><td><span style={{ color: `var(${s.color})` }}>●</span> {s.nom}</td>
            <td className="num" style={{ color: colorVar(s.t.m) }}><b>{signo(s.t.m, Math.abs(s.t.m) < 10 ? 1 : 0)}</b> {s.unid}</td>
            <td className="num">{signo(s.t.m * 7)} {s.unid}</td>
            <td className="num">{pctTxt((s.t.m * 7 / s.v0) * 100)}</td>
            <td className="num">{fmt(s.t.r2, 2)}</td></tr>))}</tbody>
      </table>
      <p className="note">Variación % = valor de cada Base ÷ valor de la primera Base del rango − 1: así SKU y unidades comparten escala. La tendencia es una recta de mínimos cuadrados sobre los días calendario (los días sin Base, como los fines de semana, quedan como espacio). Un R² bajo indica que la serie sube y baja y la recta la resume poco.</p>
    </div>
  );
}

export default function HistoriaOsr() {
  const [f, setF] = useState({ desde: '', hasta: '', depto: '', a: '', b: '' });
  const [r, setR] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [h, setH] = useState(null);
  const [grupo, setGrupo] = useState('entraron');
  React.useEffect(() => {
    setCargando(true);
    const t = setTimeout(() => api.get('/api/osr/historia' + qs(f)).then(setR).catch((e) => toast(e.message, true)).finally(() => setCargando(false)), 200);
    return () => clearTimeout(t);
  }, [JSON.stringify(f)]);
  const set = (k) => (v) => setF({ ...f, [k]: v });

  if (r?.sinDatos) return <><div className="top"><h1>Evolución OSR</h1></div><div className="sec"><div className="alert">No hay Bases de stock cargadas.</div></div></>;
  const dias = r?.dias || [];
  const A = r?.a, B = r?.b;
  const fila = (nom, k, d = 0, esPct = false, nota = '') => {
    const va = A[k], vb = B[k], dv = vb - va, vp = esPct ? null : varPct(va, vb);
    return (
      <tr>
        <td>{nom}{nota && <div className="note" style={{ margin: 0 }}>{nota}</div>}</td>
        <td className="num">{esPct ? pct(va) : fmt(va, d)}</td><td className="num"><b>{esPct ? pct(vb) : fmt(vb, d)}</b></td>
        <td className="num" style={{ color: colorVar(dv) }}><b>{esPct ? `${dv >= 0 ? '+' : '−'}${fmt(Math.abs(dv) * 100, 1)} pts` : signo(dv, d)}</b></td>
        <td className="num" style={{ color: colorVar(dv) }}>{vp === null ? '' : `${vp >= 0 ? '+' : '−'}${fmt(Math.abs(vp) * 100, 1)}%`}</td>
      </tr>);
  };
  const enRango = dias.map((d) => ({ id: d.id, fecha: d.fecha }));
  const g = r?.skus?.[grupo];

  return (
    <>
      <div className="eo-fijo">
        <h1>Evolución OSR</h1>
          <div><label className="lbl" htmlFor="eo-desde">Desde</label><input id="eo-desde" type="date" value={f.desde} min={r?.bases?.[0]?.fecha} max={r?.bases?.at(-1)?.fecha} onChange={(e) => setF({ ...f, desde: e.target.value, a: '', b: '' })} /></div>
          <div><label className="lbl" htmlFor="eo-hasta">Hasta</label><input id="eo-hasta" type="date" value={f.hasta} min={r?.bases?.[0]?.fecha} max={r?.bases?.at(-1)?.fecha} onChange={(e) => setF({ ...f, hasta: e.target.value, a: '', b: '' })} /></div>
          <div><label className="lbl" htmlFor="eo-dep">Depto</label>
            <select id="eo-dep" value={f.depto} onChange={(e) => set('depto')(e.target.value)}><option value="">Todos</option>{(r?.deptos || []).map((d) => <option key={d}>{d}</option>)}</select></div>
          <div><label className="lbl" htmlFor="eo-a">Comparar la Base del</label>
            <select id="eo-a" value={f.a || A?.id || ''} onChange={(e) => set('a')(e.target.value)}>{enRango.map((x) => <option key={x.id} value={x.id}>{diaCorto(x.fecha)}</option>)}</select></div>
          <div><label className="lbl" htmlFor="eo-b">con la del</label>
            <select id="eo-b" value={f.b || B?.id || ''} onChange={(e) => set('b')(e.target.value)}>{enRango.map((x) => <option key={x.id} value={x.id}>{diaCorto(x.fecha)}</option>)}</select></div>
          {(f.desde || f.hasta || f.depto || f.a || f.b) && <button className="btn sm" onClick={() => setF({ desde: '', hasta: '', depto: '', a: '', b: '' })}>Limpiar</button>}
          {cargando && <span className="note">{r ? 'Calculando…' : 'Preparando la historia (la primera vez resume cada Base)…'}</span>}
      </div>
      <div className="sec">
        {r && <p className="note" style={{ marginTop: 0 }}>{dias.length} Bases de stock{f.depto ? ` · depto ${f.depto}` : ''} · stock con cantidad mayor a 0 en el CD {r.cdOsr} (una foto por día de carga; si un día se cargó dos veces, cuenta la última).</p>}

        {A && B && (
          <>
            <h3 style={{ margin: '14px 0 8px' }}>Variación entre el {diaCorto(A.fecha)} y el {diaCorto(B.fecha)}</h3>
            <table className="ho-res">
              <thead><tr><th /><th className="num">{fFecha(A.fecha)}</th><th className="num">{fFecha(B.fecha)}</th><th className="num">Variación</th><th className="num">Var. %</th></tr></thead>
              <tbody>
                {fila('SKU en el OSR', 'skusOsr')}
                {fila('Unidades en el OSR', 'uOsr')}
                {fila('% de los SKU de todos los CD', 'pctSku', 0, true, `SKU en OSR ÷ SKU con stock en todos los CD (${fmt(B.skus)} el ${fFecha(B.fecha)})`)}
                {fila('% de las unidades de todos los CD', 'pctU', 0, true, `unidades en OSR ÷ stock de todos los CD (${fmt(B.u)} el ${fFecha(B.fecha)})`)}
              </tbody>
            </table>

            <div style={{ marginTop: 16 }}><Combinada dias={dias} h={h} setH={setH} /></div>

            <h3 style={{ margin: '18px 0 8px' }}>Por Base</h3>
            <div className="tbl" style={{ maxHeight: 380 }}>
              <table>
                <thead><tr><th>Base</th><th className="num">SKU en OSR</th><th className="num">Var.</th><th className="num">Entraron</th><th className="num">Salieron</th>
                  <th className="num">Unidades en OSR</th><th className="num">Var.</th><th className="num">% SKU todos los CD</th><th className="num">% unid. todos los CD</th></tr></thead>
                <tbody>{[...dias].reverse().map((d) => {
                  const i = dias.indexOf(d), p = dias[i - 1];
                  return (
                    <tr key={d.id} className={d.id === A.id || d.id === B.id ? 'sel' : ''}>
                      <td>{diaCorto(d.fecha)}</td><td className="num"><b>{fmt(d.skusOsr)}</b></td>
                      <td className="num" style={{ color: p ? colorVar(d.skusOsr - p.skusOsr) : undefined }}>{p ? signo(d.skusOsr - p.skusOsr) : ''}</td>
                      <td className="num">{d.altas === null ? '' : fmt(d.altas)}</td><td className="num">{d.bajas === null ? '' : fmt(d.bajas)}</td>
                      <td className="num"><b>{fmt(d.uOsr)}</b></td><td className="num" style={{ color: p ? colorVar(d.uOsr - p.uOsr) : undefined }}>{p ? signo(d.uOsr - p.uOsr) : ''}</td>
                      <td className="num">{pct(d.pctSku)}</td><td className="num">{pct(d.pctU)}</td>
                    </tr>);
                })}</tbody>
              </table>
            </div>
            <p className="note">Entraron / Salieron = SKU que aparecen o desaparecen del OSR respecto de la Base anterior. La variación neta de SKU = entraron − salieron.</p>

            {!f.depto && <>
              <h3 style={{ margin: '18px 0 8px' }}>Por depto · {diaCorto(A.fecha)} → {diaCorto(B.fecha)}</h3>
              <div className="tbl" style={{ maxHeight: 400 }}>
                <table>
                  <thead><tr><th>Depto</th><th className="num">SKU {fFecha(A.fecha)}</th><th className="num">SKU {fFecha(B.fecha)}</th><th className="num">Var. SKU</th>
                    <th className="num">Unid. {fFecha(A.fecha)}</th><th className="num">Unid. {fFecha(B.fecha)}</th><th className="num">Var. unid.</th><th className="num">% unid. del depto en OSR</th></tr></thead>
                  <tbody>{r.porDepto.map((d) => (
                    <tr key={d.depto} style={{ cursor: 'pointer' }} onClick={() => set('depto')(d.depto)} title="Ver la evolución de este depto">
                      <td>{d.depto}</td><td className="num">{fmt(d.skusA)}</td><td className="num">{fmt(d.skusB)}</td><td className="num" style={{ color: colorVar(d.dSkus) }}><b>{signo(d.dSkus)}</b></td>
                      <td className="num">{fmt(d.uA)}</td><td className="num">{fmt(d.uB)}</td><td className="num" style={{ color: colorVar(d.dU) }}><b>{signo(d.dU)}</b></td><td className="num">{pct(d.pctUB)}</td>
                    </tr>))}</tbody>
                </table>
              </div>
              <p className="note">Ordenado por la variación de unidades. Clic en un depto para ver solo su evolución.</p>
            </>}

            <div className="row spread" style={{ margin: '18px 0 8px', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>SKU · {diaCorto(A.fecha)} → {diaCorto(B.fecha)}</h3>
              <div className="chips">{GRUPOS.map(([k, t]) => <button key={k} className="chip" aria-pressed={grupo === k} onClick={() => setGrupo(k)}>{t} · {fmt(r.skus[k].n)}</button>)}</div>
            </div>
            <p className="note" style={{ marginTop: 0 }}>{GRUPOS.find((x) => x[0] === grupo)[2]} Variación total: <b style={{ color: colorVar(g.u) }}>{signo(g.u)} u.</b>
              {grupo === 'salieron' && r.skus.salieron.n > 0 ? ` ${fmt(r.salieronSigue)} de los ${fmt(r.skus.salieron.n)} siguen con stock en otro CD; el resto ya no tiene stock.` : ''}</p>
            <div className="tbl" style={{ maxHeight: 420 }}>
              <table>
                <thead><tr><th>SKU</th><th>Descripción</th><th className="num">Unid. OSR {fFecha(A.fecha)}</th><th className="num">Unid. OSR {fFecha(B.fecha)}</th><th className="num">Variación</th>
                  <th className="num">Stock fuera {fFecha(B.fecha)}</th><th>Log. OSR</th></tr></thead>
                <tbody>{g.filas.map((x) => (
                  <tr key={x.sku}><td className="mono">{x.sku}</td><td className="wrap">{x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></td>
                    <td className="num">{x.uA ? fmt(x.uA) : '—'}</td><td className="num">{x.uB ? fmt(x.uB) : '—'}</td><td className="num" style={{ color: colorVar(x.d) }}><b>{signo(x.d)}</b></td>
                    <td className="num">{x.fueraB ? fmt(x.fueraB) : '—'}</td><td>{x.log || '—'}</td></tr>))}</tbody>
              </table>
            </div>
            {g.n > g.filas.length && <p className="note">Se muestran los {fmt(g.filas.length)} SKU con más variación de {fmt(g.n)}.</p>}
            {!g.n && <p className="note">Sin SKU en este grupo.</p>}
          </>
        )}
      </div>
    </>
  );
}
