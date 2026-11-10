// Dashboard de inventario (Gestión de inventario): resultado de la toma en Qty SKU y Qty unidades, comportamiento histórico
// de ERI y ERU por CD, resultado neto (financiero) y absoluto (gestión logística), top de SKU y la categoría ABC / XYZ más afectada.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { N, pctf, dmy, dm, css } from '../../lib/fmt.js';
import { TablaOrden } from '../control/Recepcion.jsx';
import { Indicador, Carita, nivelDe, descargar } from './Inventario.jsx';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sumar = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etqPeriodo = (p, per) => (per === 'mes' ? `${MESES[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}` : per === 'semana' ? `Sem. ${dm(p)}` : dm(p));
const $ = (v) => (v === null || v === undefined ? '—' : `${v < 0 ? '−' : ''}$${N(Math.abs(v))}`);
const signo = (v) => (v > 0 ? `+${N(v)}` : v < 0 ? `−${N(-v)}` : '0');
const div = (a, b) => (b > 0 ? a / b : null);
const ABC = { A: 'Alto', B: 'Medio', C: 'Bajo' };
const XYZ = { rotacion: { X: 'Alta rotación', Y: 'Baja rotación', Z: 'Sin venta o sin stock' }, historia: { X: 'Estable', Y: 'Variable', Z: 'Muy variable' } };
const SERIE = ['--blue', '--teal', '--violet', '--yellow', '--slate', '--green', '--red'];

// Indicadores en tarjetas: el rango elegido frente al mismo rango del año anterior (YTD).
// La variación se mide en la tasa de cada indicador (puntos porcentuales).
function Tarjetas({ r, enValor }) {
  const P = r.param, { ant } = r.comp, anio = +r.hasta.slice(0, 4);
  const pp = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 1000) / 10).toString().replace('.', ',')} pp`;
  const base = (x) => (enValor ? x.sisVal : x.unidSis);
  const M = [
    { t: 'ERI', d: 'Exactitud de registro de inventario', tasa: (x) => x.eri, mejor: 1, carita: [P.eriSano, P.eriCritico],
      v: (x) => pctf(x.eri), sub: (x) => `${N(x.unidCorr)} de ${N(x.unidSis)} u. correctas` },
    { t: 'ERU', d: 'Exactitud de registro de ubicación', tasa: (x) => x.eru, mejor: 1, carita: [P.eruSano, P.eruCritico],
      v: (x) => pctf(x.eru), sub: (x) => `${N(x.ubicOk)} de ${N(x.ubicaciones)} ubic. correctas` },
    { t: 'Qty SKU', d: 'SKU contados', tasa: (x) => div(x.skusDif, x.skus), mejor: -1, tTasa: '% con diferencia',
      v: (x) => N(x.skus), sub: (x) => `${N(x.skusDif)} con diferencia (${pctf(div(x.skusDif, x.skus))})` },
    { t: 'Qty unidades', d: 'Unidades en sistema', tasa: (x) => div(x.abs, x.unidSis), mejor: -1, tTasa: '% con diferencia',
      v: (x) => N(x.unidSis), sub: (x) => `${N(x.unidCont)} contadas · ${N(x.abs)} con dif. (${pctf(div(x.abs, x.unidSis))})` },
    { t: 'Resultado neto', d: 'Financiero: sobrante − faltante', tasa: (x) => div(enValor ? x.netoVal : x.neto, base(x)), mejor: 1, tTasa: '% del inventario',
      v: (x) => (enValor ? $(x.netoVal) : signo(x.neto)), sub: (x) => `${pctf(div(enValor ? x.netoVal : x.neto, base(x)))} del inventario en sistema`, rojo: (x) => (enValor ? x.netoVal : x.neto) < 0 },
    { t: 'Resultado absoluto', d: 'Gestión logística: sobrante + faltante', tasa: (x) => div(enValor ? x.absVal : x.abs, base(x)), mejor: -1, tTasa: '% del inventario',
      v: (x) => (enValor ? $(x.absVal) : N(x.abs)), sub: (x) => `${pctf(div(enValor ? x.absVal : x.abs, base(x)))} del inventario en sistema` }
  ];
  // fila de referencia (x) con la variación "de" frente a "contra"
  const fila = (m, etq, x, titulo, de, contra, tDelta) => {
    if (!x.lineas) return <div className="dash-cmp"><span title={titulo}>{etq}</span><b className="muted">Sin tomas</b></div>;
    const a = de.lineas ? m.tasa(de) : null, b = m.tasa(contra);
    const dlt = a !== null && b !== null ? a - b : null;
    return (
      <div className="dash-cmp"><span title={titulo}>{etq}</span><b>{m.v(x)}</b>
        {m.tTasa && <small>{pctf(m.tasa(x))} {m.tTasa}</small>}
        {dlt !== null && <em className={Math.abs(dlt) < 0.0005 ? '' : dlt * m.mejor > 0 ? 'ok' : 'warn'} title={tDelta}>{Math.abs(dlt) < 0.0005 ? '= 0 pp' : pp(dlt)}</em>}
      </div>
    );
  };
  return (
    <div className="dash-tarjetas">
      {M.map((m) => (
        <section key={m.t} className="card dash-tarjeta">
          <div className="dash-t-h"><h3>{m.t}</h3><span>{m.d}</span></div>
          <div className={`dash-t-v${m.rojo?.(r.tot) ? ' warn' : ''}`}>
            {m.carita && r.tot[m.t.toLowerCase()] !== null && <Carita nivel={nivelDe(r.tot[m.t.toLowerCase()], ...m.carita)} size={30} />}{m.v(r.tot)}
          </div>
          <p className="dash-t-sub">{m.sub(r.tot)} · {dm(r.desde)} al {dm(r.hasta)}</p>
          {fila(m, `YTD ${anio - 1}`, ant, `${dmy(ant.desde)} al ${dmy(ant.hasta)}`, r.tot, ant, `${dm(r.desde)} al ${dm(r.hasta)}: ${anio} frente a ${anio - 1}`)}
          <small className="dash-t-rango">{dmy(ant.desde)} al {dmy(ant.hasta)}</small>
        </section>
      ))}
    </div>
  );
}

function Seg({ valor, opciones, onChange, label }) {
  return (
    <div className="seg-inv" role="group" aria-label={label}>
      {opciones.map(([v, t]) => <button key={v} type="button" aria-pressed={valor === v} onClick={() => onChange(v)}>{t}</button>)}
    </div>
  );
}

// Precisión de la programación de CE: la toma real de CE contra la fecha programada original y la vigente (re-programada)
const COLOR_PROG = { original: '--green', reprog: '--teal', adelantada: '--blue', atrasada: '--yellow', noTomada: '--red' };
function PrecisionProgramacion({ desde, hasta, cd, periodo }) {
  const d = useCarga(() => api.get(`/continuidad/inventario/dashboard/programacion?${new URLSearchParams({ desde, hasta, cd, periodo })}`), [desde, hasta, cd, periodo]);
  const r = d.data;
  const titulo = 'Precisión de la programación de CE';
  if (!r) return <Card title={titulo}><Cargando error={d.error} /></Card>;
  if (!r.ce) return <Card title={titulo}><p className="empty">Carga la toma de CE (Datos, Cargas de archivos, tarjeta Inventario) para medir la programación contra la toma real.</p></Card>;
  const t = r.tot, E = r.estados;
  if (!t.prog) return <Card title={titulo}><p className="empty">Sin ubicaciones programadas en el rango.</p></Card>;
  const est = Object.keys(COLOR_PROG);
  const serie = {
    labels: r.serie.map((x) => etqPeriodo(x.p, r.periodo)),
    datasets: est.map((k) => ({ label: E[k], data: r.serie.map((x) => x.est[k]), backgroundColor: css(COLOR_PROG[k]), borderRadius: 3, borderSkipped: false, maxBarThickness: 38 }))
  };
  const desf = {
    labels: r.desfase.map((x) => (x.d === 0 ? 'En fecha' : `${x.d <= -3 ? '≤ ' : x.d >= 3 ? '≥ ' : ''}${x.d > 0 ? '+' : ''}${x.d} d`)),
    datasets: [{ label: 'Ubicaciones', data: r.desfase.map((x) => x.n), backgroundColor: r.desfase.map((x) => css(x.d === 0 ? '--green' : x.d < 0 ? '--blue' : '--yellow')), borderRadius: 4, borderSkipped: false, maxBarThickness: 40 }]
  };
  const kpi = (k, v, n, cls = '') => <div className="kpi"><dt>{k}</dt><dd className={cls}>{v}</dd>{n && <small className="muted" style={{ display: 'block', fontSize: 12 }}>{n}</small>}</div>;
  return (
    <Card title={titulo} hint={`Cada ubicación programada (por su fecha programada original) contra la toma real de CE más cercana a su fecha vigente. Se evalúan las que tienen la toma de CE de su fecha cargada (${N(r.ce.dias)} ${r.ce.dias === 1 ? 'día' : 'días'} de toma de CE, del ${dmy(r.ce.desde)} al ${dmy(r.ce.hasta)}); el resto queda sin evaluar.`}>
      <dl className="kpis" style={{ marginTop: 0 }}>
        {kpi('Accuracy programación original', pctf(t.accOrig), `${N(t.enOrig)} de ${N(t.evaluables)} tomadas en la fecha programada`)}
        {kpi('Accuracy con re-programación', pctf(t.accVig), `${N(t.enVig)} tomadas en la fecha vigente`)}
        {kpi('Cumplimiento', pctf(t.cumpl), `tomadas en cualquier fecha (±30 d)`)}
        {kpi('Re-programadas', pctf(t.pReprog), `${N(t.reprog)} de ${N(t.prog)} · ${t.diasReprog === null ? '—' : t.diasReprog.toFixed(1).replace('.', ',')} d en promedio`)}
        {kpi('Efectividad re-programación', pctf(t.efReprog), `${N(t.reprogEnNueva)} de ${N(t.reprogEval)} tomadas en la nueva fecha`)}
        {kpi('No tomadas', N(t.est.noTomada), `${N(r.noProg)} tomas de CE sin programar`, t.est.noTomada ? 'warn' : '')}
      </dl>
      <div className="grid" style={{ marginTop: 12 }}>
        <div className="s8">
          <h4 className="dash-sub">Ubicaciones por {r.periodo === 'dia' ? 'día' : r.periodo} programado</h4>
          <Grafico apilado alto={260} label="Resultado de la programación por período" datos={serie}
            opciones={{ plugins: { tooltip: { callbacks: { footer: (it) => { const x = r.serie[it[0].dataIndex]; return `Accuracy original ${pctf(x.accOrig)} · con re-programación ${pctf(x.accVig)}${x.est.pendiente ? ` · ${N(x.est.pendiente)} sin toma de CE cargada` : ''}`; } } } } }} />
        </div>
        <div className="s4">
          <h4 className="dash-sub">Desfase de la toma real vs la fecha vigente</h4>
          <Grafico alto={260} leyenda={false} label="Desfase en días de la toma real de CE" datos={desf} />
        </div>
      </div>
      <h4 className="dash-sub" style={{ marginTop: 12 }}>Por zona</h4>
      <TablaOrden filas={r.porZona.map((z) => ({ ...z, noTomadas: z.est.noTomada }))} inicial={['prog', -1]} clave={(x) => x.zona} cols={[
        ['zona', 'Zona'], ['prog', 'Programadas', true, N], ['evaluables', 'Evaluadas', true, N], ['accOrig', 'Accuracy original', true, pctf], ['accVig', 'Accuracy con re-prog.', true, pctf],
        ['cumpl', 'Cumplimiento', true, pctf], ['pReprog', '% re-programadas', true, pctf], ['efReprog', 'Efectividad re-prog.', true, pctf],
        ['noTomadas', 'No tomadas', true, (v) => <span className={v ? 'warn' : ''}>{N(v)}</span>]]} />
    </Card>
  );
}

// Comportamiento histórico de ERI o ERU: una línea por CD, el total punteado y los umbrales del semáforo
function Historico({ r }) {
  const [ind, setInd] = useState('eri');
  const { periodos, total, cds } = r.serie;
  const sano = r.param[`${ind}Sano`], critico = r.param[`${ind}Critico`];
  const pct = (p) => (p && p[ind] !== null ? Math.round(p[ind] * 1000) / 10 : null);
  const umbral = (v, c, l) => ({ type: 'line', label: l, data: periodos.map(() => v * 100), borderColor: css(c), borderDash: [2, 4], borderWidth: 1.5, pointRadius: 0, fill: false });
  const datos = {
    labels: periodos.map((p) => etqPeriodo(p, r.periodo)),
    datasets: [
      ...Object.keys(cds).map((c, i) => ({ type: 'line', label: c, data: cds[c].map(pct), borderColor: css(SERIE[i % SERIE.length]), backgroundColor: css(SERIE[i % SERIE.length]), tension: 0.25, spanGaps: true, pointRadius: 3 })),
      ...(Object.keys(cds).length > 1 ? [{ type: 'line', label: 'Total', data: total.map(pct), borderColor: css('--ink'), backgroundColor: css('--ink'), borderDash: [6, 4], tension: 0.25, spanGaps: true, pointRadius: 2 }] : []),
      umbral(sano, '--green', `Sano (${pctf(sano)})`), umbral(critico, '--red', `Crítico (${pctf(critico)})`)
    ]
  };
  const minimo = Math.min(critico * 100, ...Object.values(cds).flat().map(pct).filter((v) => v !== null));
  return (
    <Card title="Comportamiento histórico ERI · ERU por CD" hint={`Por ${r.periodo === 'dia' ? 'día' : r.periodo} de toma. Sobre la línea verde, sano; entre las líneas, atención; bajo la roja, crítico.`}
      actions={<Seg label="Indicador" valor={ind} onChange={setInd} opciones={[['eri', 'ERI'], ['eru', 'ERU']]} />}>
      {periodos.length ? <Grafico alto={280} label={`Histórico de ${ind.toUpperCase()} por CD`} datos={datos}
        opciones={{ scales: { y: { beginAtZero: false, min: Math.max(0, Math.floor(minimo / 5) * 5 - 5), max: 100, ticks: { callback: (v) => `${v}%` } } },
          plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y === null ? '—' : `${String(c.parsed.y).replace('.', ',')}%`}` } } } }} />
        : <p className="empty">Sin tomas en el rango.</p>}
      {periodos.length > 0 && <div className="tscroll" style={{ marginTop: 8 }}><table>
        <thead><tr><th>CD</th>{periodos.map((p) => <th key={p} className="num">{etqPeriodo(p, r.periodo)}</th>)}</tr></thead>
        <tbody>{[...Object.entries(cds), ...(Object.keys(cds).length > 1 ? [['Total', total]] : [])].map(([c, s]) => (
          <tr key={c}><td><b>{c}</b></td>{s.map((p, i) => <td key={i} className="num">{p ? <Indicador v={p[ind]} sano={sano} critico={critico} /> : <span className="muted">—</span>}</td>)}</tr>))}</tbody>
      </table></div>}
    </Card>
  );
}

// Etiqueta de valor en el extremo de cada barra (solo los datasets de barras indicados)
const etiquetas = (fmt, ids = [0]) => ({
  id: 'etiquetas',
  afterDatasetsDraw(chart) {
    const { ctx } = chart, horiz = chart.options.indexAxis === 'y';
    ctx.save(); ctx.fillStyle = css('--ink'); ctx.font = `600 12px ${css('--body')}`;
    for (const i of ids) {
      const meta = chart.getDatasetMeta(i); if (meta.hidden) continue;
      meta.data.forEach((el, j) => {
        const raw = chart.data.datasets[i].data[j], v = Array.isArray(raw) ? raw[1] - raw[0] : raw;
        if (v === null || v === undefined) return;
        const neg = v < 0, txt = fmt(v, j);
        if (horiz) { ctx.textAlign = neg ? 'right' : 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, el.x + (neg ? -6 : 6), el.y); }
        else { ctx.textAlign = 'center'; ctx.textBaseline = neg ? 'top' : 'bottom'; ctx.fillText(txt, el.x, el.y + (neg ? 4 : -4)); }
      });
    }
    ctx.restore();
  }
});

// Resultado neto (financiero: faltantes y sobrantes se compensan) y absoluto (gestión logística: todo el error de registro).
// Pensado como reporte gerencial: cada resultado con su cifra destacada, de dónde sale y su peso sobre el inventario.
const corto = (v, enValor = true) => {
  const a = Math.abs(v), s = v < 0 ? '−' : '', m = enValor ? '$' : '';
  const n = (x, d) => x.toLocaleString('es-CL', { maximumFractionDigits: d });
  return a >= 1e6 ? `${s}${m}${n(a / 1e6, 1)}M` : a >= 1e4 ? `${s}${m}${n(a / 1e3, 0)}k` : `${s}${m}${n(a, 0)}`;
};
function Resultado({ r, enValor, setEnValor }) {
  const [esc, setEsc] = useState('dia');
  const t = r.tot, k = (b) => (enValor ? `${b}Val` : b), f = enValor ? $ : N;
  const fs = (v) => (enValor ? $(v) : signo(v));
  const ev = r.evolucion[esc];
  const base = (x) => (enValor ? x.sisVal : x.unidSis);
  const F = t[k('falt')], S = t[k('sobr')], Ne = t[k('neto')], A = t[k('abs')];
  const sinEje = { scales: { x: { display: false, beginAtZero: true, grace: '25%' }, y: { grid: { display: false }, border: { display: false } } } };
  // neto: sobrante contra faltante, cada uno desde cero, con su valor al final de la barra
  const comp = {
    labels: ['Sobrante', 'Faltante'],
    datasets: [{ label: enValor ? 'Valor' : 'Unidades', data: [S, F], backgroundColor: [css('--teal'), css('--red')], borderRadius: 4, borderSkipped: false, barPercentage: 0.7 }]
  };
  // por CD: neto y absoluto lado a lado
  const cds = r.porCd;
  const porCd = {
    labels: cds.map((x) => x.v),
    datasets: [
      { label: 'Neto (financiero)', data: cds.map((x) => x[k('neto')]), backgroundColor: css('--blue'), borderRadius: 4, borderSkipped: false, maxBarThickness: 22 },
      { label: 'Absoluto (gestión logística)', data: cds.map((x) => x[k('abs')]), backgroundColor: css('--yellow'), borderRadius: 4, borderSkipped: false, maxBarThickness: 22 }
    ]
  };
  // evolución: neto (azul si suma, rojo si resta) y absoluto por día, semana o mes
  const serie = {
    labels: ev.map((x) => etqPeriodo(x.p, esc)),
    datasets: [
      { label: 'Neto (financiero)', data: ev.map((x) => x[k('neto')]), backgroundColor: ev.map((x) => css(x[k('neto')] < 0 ? '--red' : '--blue')), borderRadius: 4, borderSkipped: false, maxBarThickness: 30 },
      { label: 'Absoluto (gestión logística)', data: ev.map((x) => x[k('abs')]), backgroundColor: css('--yellow'), borderRadius: 4, borderSkipped: false, maxBarThickness: 30 }
    ]
  };
  const optSerie = {
    layout: { padding: { top: 20 } },
    plugins: {
      legend: { labels: { generateLabels: () => [
        { text: 'Neto (financiero): azul suma, rojo resta', fillStyle: css('--blue'), strokeStyle: 'transparent', datasetIndex: 0 },
        { text: 'Absoluto (gestión logística)', fillStyle: css('--yellow'), strokeStyle: 'transparent', datasetIndex: 1 }] } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fs(c.parsed.y)}`, afterBody: (c) => { const x = ev[c[0].dataIndex]; return [`Faltante ${f(x[k('falt')])} · sobrante ${f(x[k('sobr')])}`, `Absoluto ${pctf(div(x[k('abs')], base(x)))} del inventario en sistema`]; } } }
    },
    scales: { y: { ticks: { callback: (v) => corto(v, enValor) } } }
  };
  const tipX = { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fs(c.parsed.x)}` } } } };
  const pF = div(F, A), pS = div(S, A);
  return (
    <Card title="Resultado neto y absoluto"
      actions={<Seg label="Medida" valor={enValor ? 'v' : 'u'} onChange={(v) => setEnValor(v === 'v')} opciones={[['v', 'Valor ($)'], ['u', 'Unidades']]} />}>
      <div className="grid2">
        <div className="dash-r dash-r-neto">
          <span className="dash-r-t">Resultado neto · financiero</span>
          <b className={Ne < 0 ? 'warn' : ''}>{fs(Ne)}</b>
          <small>{Ne < 0 ? 'Pérdida' : Ne > 0 ? 'Ganancia' : 'Sin efecto'} de {pctf(div(Math.abs(Ne), base(t)))} del inventario en sistema. Es el sobrante menos el faltante: lo que el conteo cambia el valor del inventario.</small>
          <Grafico key={`n${enValor}`} horizontal alto={110} leyenda={false} label="Sobrante y faltante" datos={comp}
            opciones={{ ...sinEje, plugins: { tooltip: { callbacks: { label: (c) => `${c.label}: ${f(c.parsed.x)}` } } } }} plugins={[etiquetas((v) => f(v))]} />
          <p className="dash-r-formula">{f(S)} sobrante − {f(F)} faltante = <b>{fs(Ne)}</b></p>
        </div>
        <div className="dash-r dash-r-abs">
          <span className="dash-r-t">Resultado absoluto · gestión logística</span>
          <b>{f(A)}</b>
          <small>{pctf(div(A, base(t)))} del inventario en sistema quedó mal registrado. Suma el sobrante y el faltante: cada diferencia cuenta aunque se compense.</small>
          <div className="dash-r-barra" role="img" aria-label={`Faltante ${pctf(pF)}, sobrante ${pctf(pS)} del absoluto`}>
            {F > 0 && <span style={{ flexGrow: F, background: 'var(--red)' }}>{pF >= 0.12 && `Faltante ${pctf(pF)}`}</span>}
            {S > 0 && <span style={{ flexGrow: S, background: 'var(--teal)' }}>{pS >= 0.12 && `Sobrante ${pctf(pS)}`}</span>}
          </div>
          <p className="dash-r-formula">{f(S)} sobrante + {f(F)} faltante = <b>{f(A)}</b></p>
        </div>
      </div>
      {enValor && t.sinCosto > 0 && <p className="hint">{N(t.sinCosto)} {t.sinCosto === 1 ? 'línea no tiene' : 'líneas no tienen'} costo en la Base: {t.sinCosto === 1 ? 'queda' : 'quedan'} fuera del valor.</p>}
      <div className="row spread" style={{ marginTop: 16, alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h4 className="dash-sub" style={{ margin: 0 }}>Resultado por {esc === 'dia' ? 'día' : esc} <small>{dmy(r.desde)} al {dmy(r.hasta)}</small></h4>
        <Seg label="Escala" valor={esc} onChange={setEsc} opciones={[['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes']]} />
      </div>
      {ev.length ? <Grafico key={esc + enValor} alto={300} label="Resultado neto y absoluto por período" datos={serie} opciones={optSerie}
        plugins={ev.length <= 16 ? [etiquetas((v) => corto(v, enValor), [0, 1])] : []} />
        : <p className="empty">Sin tomas en el rango.</p>}
      <div style={{ marginTop: 14 }}>
        <div>
          <h4 className="dash-sub">Por CD</h4>
          <Grafico key={`c${enValor}`} horizontal alto={Math.max(130, 60 + cds.length * 56)} label="Resultado neto y absoluto por CD" datos={porCd}
            opciones={{ ...sinEje, ...tipX }} plugins={[etiquetas((v) => (v < 0 ? fs(v) : f(v)), [0, 1])]} />
        </div>
      </div>
      <details className="dash-tabla"><summary>Ver tabla por CD</summary>
        <TablaOrden key={enValor ? 'v' : 'u'} filas={cds.map((x) => ({ ...x, pAbs: div(x[k('abs')], base(x)) }))} inicial={[k('abs'), -1]} clave={(x) => x.v} cols={[
          ['v', 'CD'], [enValor ? 'sisVal' : 'unidSis', enValor ? 'Valor en sistema' : 'Unid. sistema', true, f],
          [k('falt'), 'Faltante', true, (v) => <span className={v ? 'warn' : ''}>{f(-v)}</span>], [k('sobr'), 'Sobrante', true, f],
          [k('neto'), 'Neto', true, (v) => <b className={v < 0 ? 'warn' : ''}>{f(v)}</b>], [k('abs'), 'Absoluto', true, (v) => <b>{f(v)}</b>],
          ['pAbs', '% absoluto', true, pctf]]} />
      </details>
    </Card>
  );
}

// Resultado por conteo (VALIDACION) y por turno de ejecución (TURNO)
const NOMBRE_CONTEO = { 1: '1er conteo', 2: '2do conteo', 3: '3er conteo' };
function ConteosTurnos({ r, enValor }) {
  const P = r.param, f = enValor ? $ : N, kAbs = enValor ? 'absVal' : 'abs';
  const C = r.porConteo, T = r.porTurno;
  const datosC = {
    labels: C.map((x) => NOMBRE_CONTEO[x.conteo] || `Conteo ${x.conteo}`),
    datasets: [
      { label: 'Líneas contadas', data: C.map((x) => x.lineas), backgroundColor: css('--slate'), borderRadius: 4, borderSkipped: false, maxBarThickness: 46 },
      { label: 'Líneas con diferencia', data: C.map((x) => x.lineasDif), backgroundColor: css('--red'), borderRadius: 4, borderSkipped: false, maxBarThickness: 46 }
    ]
  };
  const datosT = {
    labels: T.map((x) => x.v),
    datasets: [{ label: enValor ? 'Absoluto ($)' : 'Absoluto (unid.)', data: T.map((x) => x[kAbs]), backgroundColor: css('--yellow'), borderRadius: 4, borderSkipped: false, maxBarThickness: 46 }]
  };
  const optC = { layout: { padding: { top: 20 } }, plugins: { tooltip: { callbacks: { afterBody: (c) => { const x = C[c[0].dataIndex]; return [`ERI ${pctf(x.eri)} · ERU ${pctf(x.eru)}`, x.recontadas ? `${N(x.corregidas)} de ${N(x.recontadas)} recontadas quedaron sin diferencia en el siguiente` : '']; } } } } };
  const optT = { layout: { padding: { top: 20 } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `Absoluto: ${f(c.parsed.y)}`, afterBody: (c) => { const x = T[c[0].dataIndex]; return [`${N(x.lineas)} líneas · ${N(x.skusDif)} SKU con dif.`, `ERI ${pctf(x.eri)} · ERU ${pctf(x.eru)}`]; } } } }, scales: { y: { ticks: { callback: (v) => corto(v, enValor) } } } };
  const sig = C.filter((x) => x.recontadas);
  return (
    <Card title="Resultado por conteo y por turno" hint="Conteo según la columna VALIDACION (primer, segundo o tercer conteo); turno según la columna TURNO. El resultado final de cada ubicación y SKU es su último conteo.">
      <div className="grid2">
        <div>
          <h4 className="dash-sub">Por conteo</h4>
          <Grafico alto={250} label="Líneas contadas y con diferencia por conteo" datos={datosC} opciones={optC} plugins={[etiquetas((v) => N(v), [0, 1])]} />
          <div className="dash-mini">{C.map((x) => <div key={x.conteo}><span>{NOMBRE_CONTEO[x.conteo] || `Conteo ${x.conteo}`}</span>
            <Indicador v={x.eri} sano={P.eriSano} critico={P.eriCritico} /><small>ERI</small></div>)}</div>
          <p className="hint">{sig.length ? sig.map((x) => `${NOMBRE_CONTEO[x.conteo + 1] || 'El siguiente'} corrigió ${N(x.corregidas)} de ${N(x.recontadas)} diferencias del ${NOMBRE_CONTEO[x.conteo] || `conteo ${x.conteo}`} (${pctf(div(x.corregidas, x.recontadas))})`).join(' · ')
            : C.length <= 1 ? 'Aún no hay segundos ni terceros conteos en el rango.' : 'Los conteos siguientes no repiten ubicaciones y SKU del anterior.'}</p>
        </div>
        <div>
          <h4 className="dash-sub">Por turno de ejecución <small>resultado absoluto</small></h4>
          {T.length ? <Grafico key={String(enValor)} alto={250} label="Resultado absoluto por turno" datos={datosT} opciones={optT} plugins={[etiquetas((v) => corto(v, enValor))]} /> : <p className="empty">Sin tomas.</p>}
          <div className="dash-mini">{T.map((x) => <div key={x.v}><span>{x.v}</span>
            <Indicador v={x.eri} sano={P.eriSano} critico={P.eriCritico} /><small>ERI · {N(x.lineas)} líneas</small></div>)}</div>
        </div>
      </div>
    </Card>
  );
}

// Match: el mismo SKU falta en una ubicación y sobra en otra del mismo CD. Lo que se compensa es mercadería mal ubicada
// (se corrige moviéndola), no una pérdida; lo que queda es la diferencia real.
function Match({ r, enValor }) {
  const [ver, setVer] = useState('');
  const m = r.match, t = r.tot, f = enValor ? $ : N;
  const absT = enValor ? t.absVal : t.abs, absM = enValor ? m.absMatchVal : m.absMatch, absR = absT - absM;
  const top = m.lista.slice(0, 10);
  const datos = {
    labels: top.map((x) => `${x.sku} · ${(x.desc || '').slice(0, 22)}`),
    datasets: [{ label: 'Compensado', data: top.map((x) => (enValor ? x.compVal : x.comp)), backgroundColor: top.map((x) => css(x.cubre === 'Total' ? '--teal' : '--blue')), borderRadius: 4, borderSkipped: false, maxBarThickness: 18 }]
  };
  const opt = { layout: { padding: { right: 60 } }, plugins: { legend: { display: false }, tooltip: { callbacks: {
    title: (c) => { const x = top[c[0].dataIndex]; return `${x.sku} ${x.desc} · ${x.cd}`; },
    label: (c) => { const x = top[c.dataIndex]; return `Compensa ${N(x.comp)} u. (${x.cubre === 'Total' ? 'cubre todo el faltante' : `faltan ${N(x.faltResto)} u.`})`; },
    afterBody: (c) => top[c[0].dataIndex].pares.slice(0, 6).map((p) => `${p.desde} → ${p.hacia}: ${N(p.cant)} u.`) } } },
    scales: { x: { display: false, grace: '20%' }, y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } } } };
  const csv = () => descargar([['CD', 'SKU', 'Descripción', 'Departamento', 'ABC/XYZ', 'Costo', 'Faltante', 'Sobrante', 'Compensado', 'Compensado $', 'Cubre', 'Faltante sin cubrir', 'Desde (sobrante)', 'Hacia (faltante)', 'Cantidad'],
    ...m.lista.flatMap((x) => x.pares.map((p) => [x.cd, x.sku, x.desc, x.depto, x.matriz, x.costo ?? '', x.falt, x.sobr, x.comp, Math.round(x.compVal), x.cubre, x.faltResto, p.desde, p.hacia, p.cant]))], `match_sku_${r.desde}_${r.hasta}.csv`);
  return (
    <Card title="Match de faltantes y sobrantes (mismo SKU)" hint="El mismo SKU que falta en una ubicación y sobra en otra del mismo CD: el sobrante cubre el faltante y esa diferencia queda en cero al mover la mercadería. Es un error de ubicación, no una pérdida."
      actions={m.skus > 0 && <button type="button" className="ghost" onClick={csv}>Descargar CSV</button>}>
      {!m.skus ? <p className="empty">No hay SKU que falten en una ubicación y sobren en otra del mismo CD.</p> : <>
        <div className="dash-match-k">
          <div><b>{N(m.skus)}</b><span>SKU con match</span><small>{N(m.total)} cubren todo su faltante</small></div>
          <div><b>{enValor ? $(m.val) : N(m.unid)}</b><span>{enValor ? 'Valor' : 'Unidades'} que se compensan</span><small>{N(m.unid)} u. a mover entre ubicaciones</small></div>
          <div><b>{pctf(div(absM, absT))}</b><span>del resultado absoluto es mal ubicado</span><small>la diferencia real baja a {f(absR)}</small></div>
        </div>
        <div className="dash-r-barra" role="img" aria-label={`Absoluto ${f(absT)}: ${f(absM)} por mal ubicado y ${f(absR)} de diferencia real`}>
          {absM > 0 && <span style={{ flexGrow: absM, background: 'var(--teal)' }}>{div(absM, absT) >= 0.15 && `Mal ubicado (match) ${f(absM)}`}</span>}
          {absR > 0 && <span style={{ flexGrow: absR, background: 'var(--red)' }}>{div(absR, absT) >= 0.15 && `Diferencia real ${f(absR)}`}</span>}
        </div>
        <p className="dash-r-formula">Resultado absoluto {f(absT)} = mal ubicado {f(absM)} (el faltante y el sobrante que se compensan) + diferencia real {f(absR)}</p>
        <h4 className="dash-sub" style={{ marginTop: 14 }}>SKU que más se compensan <small>verde: cubre todo el faltante · azul: cubre una parte</small></h4>
        <Grafico key={String(enValor)} horizontal alto={Math.max(140, 34 + top.length * 26)} leyenda={false} label="SKU con match" datos={datos} opciones={opt} plugins={[etiquetas((v) => f(v))]} />
        <details className="dash-tabla"><summary>Ver los movimientos ({N(m.lista.length)} SKU)</summary>
          <div className="tscroll" style={{ maxHeight: 420, overflow: 'auto' }}><table>
            <thead><tr><th>CD</th><th>SKU</th><th>Descripción</th><th>ABC/XYZ</th><th className="num">Faltante</th><th className="num">Sobrante</th><th className="num">Compensa</th><th>Cubre</th><th>Mover desde → hacia</th></tr></thead>
            <tbody>{m.lista.map((x) => { const k = `${x.cd}|${x.sku}`, abierto = ver === k; return (
              <tr key={k}><td>{x.cd}</td><td>{x.sku}</td><td>{x.desc || '—'}</td><td><span className="pill">{x.matriz}</span></td>
                <td className="num warn">{N(x.falt)}</td><td className="num">{N(x.sobr)}</td><td className="num"><b>{N(x.comp)}</b>{enValor && x.costo ? <span className="muted"> · {$(x.compVal)}</span> : null}</td>
                <td>{x.cubre === 'Total' ? <span className="st cerrada">Total</span> : <span className="st abierta" title={`Quedan ${N(x.faltResto)} u. de faltante sin cubrir`}>Parcial</span>}</td>
                <td style={{ fontSize: 12.5 }}>{(abierto ? x.pares : x.pares.slice(0, 2)).map((p, i) => <div key={i}>{p.desde} → {p.hacia}: <b>{N(p.cant)}</b></div>)}
                  {x.pares.length > 2 && <button type="button" className="link" onClick={() => setVer(abierto ? '' : k)}>{abierto ? 'ver menos' : `+${x.pares.length - 2} más`}</button>}</td></tr>); })}</tbody>
          </table></div>
        </details>
      </>}
    </Card>
  );
}

// Top de SKU por diferencia (todas las ubicaciones y CD del rango): gráfico de los 15 primeros y la tabla completa plegada
function TopSku({ r, enValor }) {
  const [crit, setCrit] = useState('abs');
  const [celda, setCelda] = useState('');
  const k = crit === 'neto' ? 'neto' : enValor ? 'absVal' : 'abs';
  const filas = useMemo(() => r.top[k].filter((s) => !celda || s.matriz === celda), [r, k, celda]);
  const celdas = [...new Set(r.top[k].map((s) => s.matriz))].sort();
  const f = enValor ? $ : N, fs = (v) => (enValor ? $(v) : signo(v));
  const top = filas.slice(0, 15);
  const cu = (s, c) => (enValor ? (s.costo || 0) * s[c] : s[c]);
  const kn = enValor ? 'netoVal' : 'neto';
  const datos = {
    labels: top.map((s) => `${s.sku} · ${(s.desc || '').slice(0, 24)}`),
    datasets: crit === 'neto'
      ? [{ label: 'Neto', data: top.map((s) => s[kn]), backgroundColor: top.map((s) => css(s[kn] < 0 ? '--red' : '--teal')), borderRadius: 4, maxBarThickness: 18 }]
      : [{ label: 'Faltante', data: top.map((s) => -cu(s, 'falt')), backgroundColor: css('--red'), borderRadius: 4, maxBarThickness: 18 },
        { label: 'Sobrante', data: top.map((s) => cu(s, 'sobr')), backgroundColor: css('--teal'), borderRadius: 4, maxBarThickness: 18 }]
  };
  const opciones = {
    plugins: { tooltip: { callbacks: {
      title: (c) => { const s = top[c[0].dataIndex]; return `${s.sku} ${s.desc}`; },
      label: (c) => `${c.dataset.label}: ${fs(c.parsed.x)}`,
      afterBody: (c) => { const s = top[c[0].dataIndex]; return [`Clase ${s.matriz} · ${s.cds} · ${N(s.ubicaciones)} ubic.`, `Neto ${fs(s[kn])} · absoluto ${f(s[enValor ? 'absVal' : 'abs'])}`]; }
    } } },
    scales: { x: { stacked: true, ticks: { callback: (v) => f(v) } }, y: { stacked: true, ticks: { autoSkip: false, font: { size: 11 } } } }
  };
  const csv = () => descargar([['SKU', 'Descripción', 'Departamento', 'ABC/XYZ', 'CD', 'Costo', 'Ubicaciones', 'Unid. sistema', 'Unid. contadas', 'Faltante', 'Sobrante', 'Neto', 'Absoluto', 'Neto $', 'Absoluto $'],
    ...filas.map((s) => [s.sku, s.desc, s.depto, s.matriz, s.cds, s.costo ?? '', s.ubicaciones, s.unidSis, s.unidCont, s.falt, s.sobr, s.neto, s.abs, Math.round(s.netoVal), Math.round(s.absVal)])], `top_sku_${r.desde}_${r.hasta}.csv`);
  return (
    <Card title="Top de SKU" hint={`${N(r.top.total)} SKU con diferencia en el rango; el gráfico muestra los 15 primeros. Mayor diferencia absoluta: dónde hay más error de registro (faltante a la izquierda, sobrante a la derecha); mayor pérdida neta: los que más restan al inventario.`}
      actions={<div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Seg label="Criterio" valor={crit} onChange={setCrit} opciones={[['abs', 'Mayor diferencia absoluta'], ['neto', 'Mayor pérdida neta']]} />
        <select aria-label="Celda ABC / XYZ" value={celda} onChange={(e) => setCelda(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Todas las clases</option>{celdas.map((c) => <option key={c} value={c}>{c === '—' ? 'Sin clasificar' : c}</option>)}</select>
        <button type="button" className="ghost" onClick={csv} disabled={!filas.length}>Descargar CSV</button></div>}>
      {filas.length ? <>
        <Grafico key={k + celda + enValor} horizontal alto={Math.max(160, 34 + top.length * 26)} leyenda={crit !== 'neto'} label="Top de SKU con diferencia" datos={datos} opciones={opciones} />
        <details className="dash-tabla"><summary>Ver tabla ({N(filas.length)} SKU)</summary>
          <TablaOrden key={k + celda} filas={filas} max={20} clave={(s) => s.sku}
            inicial={crit === 'neto' ? [kn, 1] : [k, -1]} cols={[
              ['sku', 'SKU'], ['desc', 'Descripción'], ['depto', 'Departamento'], ['matriz', 'ABC/XYZ', false, (v) => <span className="pill">{v}</span>], ['cds', 'CD'],
              ['ubicaciones', 'Ubic.', true, N], ['unidSis', 'Sistema', true, N], ['unidCont', 'Contado', true, N],
              [kn, 'Neto', true, (v) => <span className={v < 0 ? 'warn' : ''}>{fs(v)}</span>],
              [enValor ? 'absVal' : 'abs', 'Absoluto', true, (v) => <b>{f(v)}</b>]]} />
        </details>
      </> : <p className="empty">Sin SKU con diferencia{celda ? ' en esa clase' : ''}.</p>}
    </Card>
  );
}

// Matriz ABC / XYZ: dónde se concentra la diferencia; la celda más afectada queda marcada
function Matriz({ r, enValor }) {
  const [med, setMed] = useState('abs');
  const M = r.matriz, metodo = r.clasificacion?.metodo || 'rotacion';
  const val = (c) => (!c ? 0 : med === 'abs' ? c[enValor ? 'absVal' : 'abs'] : med === 'neto' ? Math.max(0, -c[enValor ? 'netoVal' : 'neto']) : med === 'skus' ? c.skusDif : c.eri === null ? 0 : 1 - c.eri);
  const claves = Object.keys(M).filter((k) => k !== '—');
  const total = claves.reduce((s, k) => s + val(M[k]), 0);
  const peor = claves.filter((k) => val(M[k]) > 0).sort((a, b) => val(M[b]) - val(M[a]))[0];
  const maxV = Math.max(0, ...claves.map((k) => val(M[k])));
  const f = enValor ? $ : N;
  const txtVal = (c) => (med === 'abs' ? f(c[enValor ? 'absVal' : 'abs']) : med === 'neto' ? (enValor ? $(c.netoVal) : signo(c.neto)) : med === 'skus' ? `${N(c.skusDif)} SKU` : `ERI ${pctf(c.eri)}`);
  const filasZ = ['X', 'Y', 'Z', ...(['A-', 'B-', 'C-'].some((k) => M[k]) ? ['-'] : [])];
  const cel = (k) => {
    const c = M[k];
    if (!c) return <div key={k} className="dash-mtx-c vacia"><b>{k[1] === '-' ? `${k[0]} —` : k}</b><small>Sin tomas</small></div>;
    const pesoMed = med === 'eri' ? val(c) : div(val(c), total) || 0;
    return (
      <div key={k} className={`dash-mtx-c${k === peor ? ' peor' : ''}`} style={{ '--a': maxV ? val(c) / maxV : 0 }}
        title={`${k}: ${N(c.skus)} SKU contados, ${N(c.skusDif)} con diferencia · neto ${enValor ? $(c.netoVal) : signo(c.neto)} · absoluto ${f(c[enValor ? 'absVal' : 'abs'])} · ERI ${pctf(c.eri)}`}>
        <b>{k[1] === '-' ? `${k[0]} —` : k}</b>
        <span>{txtVal(c)}</span>
        <small>{med === 'eri' ? `${N(c.unidSis)} unid. en sistema` : `${pctf(pesoMed)} del total`}</small>
        <small>{N(c.skusDif)} de {N(c.skus)} SKU con dif.</small>
        {k === peor && <em>Más afectada</em>}
      </div>
    );
  };
  const p = peor && M[peor];
  return (
    <Card title="Categoría más afectada en la matriz ABC / XYZ"
      hint={r.clasificacion ? `Clasificación vigente de Gestión diaria, ABC / XYZ (XYZ por ${metodo === 'historia' ? 'historia de ventas' : 'rotación'}${r.clasificacion.carga ? `, Base ${r.clasificacion.carga.archivo}` : ''}).` : r.aviso || 'Sin clasificación ABC / XYZ.'}
      actions={<Seg label="Medida" valor={med} onChange={setMed} opciones={[['abs', 'Absoluto'], ['neto', 'Pérdida neta'], ['skus', 'SKU con dif.'], ['eri', 'Peor ERI']]} />}>
      {!r.clasificacion ? <p className="empty">Carga una Base de stock en Gestión diaria para clasificar los SKU.</p> : <div className="dash-mtx-wrap">
        <div className="dash-mtx">
          {filasZ.map((z) => <div key={z} className="dash-mtx-fila">
            <div className="dash-mtx-h"><b>{z === '-' ? '—' : z}</b><small>{z === '-' ? 'Sin historia' : XYZ[metodo][z]}</small></div>
            {['A', 'B', 'C'].map((a) => cel(a + z))}
          </div>)}
          <div className="dash-mtx-fila"><div />{['A', 'B', 'C'].map((a) => <div key={a} className="dash-mtx-h"><b>{a}</b><small>{ABC[a]}</small></div>)}</div>
        </div>
        <div className="dash-mtx-lectura">
          {p ? <>
            <p><b style={{ fontSize: 22 }}>{peor}</b> es la categoría más afectada{med === 'eri' ? `: su ERI es ${pctf(p.eri)}` : `: concentra el ${pctf(div(val(p), total))} ${med === 'abs' ? 'de la diferencia absoluta' : med === 'neto' ? 'de la pérdida neta' : 'de los SKU con diferencia'}`}.</p>
            <ul>
              <li>{N(p.skusDif)} de {N(p.skus)} SKU con diferencia ({pctf(div(p.skusDif, p.skus))}).</li>
              <li>Neto {enValor ? $(p.netoVal) : signo(p.neto)} · absoluto {f(p[enValor ? 'absVal' : 'abs'])}.</li>
              <li>ERI {pctf(p.eri)} · ERU {pctf(p.eru)}.</li>
            </ul>
            {peor[0] === 'A' && <p className="hint">Clase A: SKU de alta demanda; una diferencia aquí afecta directo la disponibilidad para la venta.</p>}
          </> : <p className="empty">Sin diferencias en el rango.</p>}
          {M['—'] && <p className="hint">{N(M['—'].skus)} SKU contados no están en la Base vigente (sin clasificar): absoluto {f(M['—'][enValor ? 'absVal' : 'abs'])}.</p>}
        </div>
      </div>}
    </Card>
  );
}

export default function InventarioDashboard() {
  const { meta } = useApp();
  const hoy = meta?.fechaOperativa;
  const [rango, setRango] = useState(null);
  const [cd, setCd] = useState('');
  const [periodo, setPeriodo] = useState('semana');
  const [enValor, setEnValor] = useState(true);
  const hasta = rango?.hasta || hoy || '', desde = rango?.desde || (hoy ? sumar(hoy, -90) : '');
  const d = useCarga(() => (hoy ? api.get(`/continuidad/inventario/dashboard?${new URLSearchParams({ desde, hasta, cd, periodo })}`) : null), [hoy, desde, hasta, cd, periodo]);
  const r = d.data;
  if (!meta || !r) return <><PageHead title="Dashboard de inventario" /><Cargando error={d.error} /></>;
  const t = r.tot;
  const atajo = (n) => setRango(n === null ? { desde: r.datos?.desde || desde, hasta: r.datos?.hasta || hasta } : { desde: sumar(hoy, -n), hasta: hoy });

  return (
    <>
      <PageHead title="Dashboard de inventario" sub={r.datos ? `Resultado de la toma (última toma de cada ubicación y SKU por día). Hay tomas cargadas del ${dmy(r.datos.desde)} al ${dmy(r.datos.hasta)}.` : 'Aún no hay resultados de la toma cargados.'}>
        <Link className="btn" to="/inventario">Ir a Inventario CD</Link>
      </PageHead>

      <div className="filters" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 'auto' }}><span>Toma desde</span><input type="date" value={desde} onChange={(e) => e.target.value && setRango({ desde: e.target.value, hasta })} /></label>
        <label className="field" style={{ width: 'auto' }}><span>Hasta</span><input type="date" value={hasta} onChange={(e) => e.target.value && setRango({ desde, hasta: e.target.value })} /></label>
        <label className="field" style={{ width: 'auto' }}><span>CD</span><select value={cd} onChange={(e) => setCd(e.target.value)}><option value="">Todos</option>{r.cds.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field" style={{ width: 'auto' }}><span>Agrupar por</span><select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
          <option value="dia">Día</option><option value="semana">Semana</option><option value="mes">Mes</option></select></label>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="ghost" onClick={() => atajo(30)}>30 días</button>
          <button type="button" className="ghost" onClick={() => atajo(90)}>90 días</button>
          {r.datos && <button type="button" className="ghost" onClick={() => atajo(null)}>Todas las tomas</button>}
        </div>
      </div>

      {!t.lineas ? <p className="empty">Sin tomas entre el {dmy(r.desde)} y el {dmy(r.hasta)}{r.cd ? ` en ${r.cd}` : ''}.{r.datos && <> Prueba con <button type="button" className="link" onClick={() => atajo(null)}>todas las tomas</button>.</>}</p> : <>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <Seg label="Medida del resultado" valor={enValor ? 'v' : 'u'} onChange={(v) => setEnValor(v === 'v')} opciones={[['v', 'Valor ($)'], ['u', 'Unidades']]} />
        </div>
        <Tarjetas r={r} enValor={enValor} />
        <p className="hint" style={{ marginTop: 6 }}>YTD {+r.comp.ant.hasta.slice(0, 4)} = el mismo rango de fechas (toma desde – hasta) del año anterior, del {dmy(r.comp.ant.desde)} al {dmy(r.comp.ant.hasta)}. La variación es del rango de este año frente al del año anterior, en puntos porcentuales de la tasa (verde mejora, rojo empeora).</p>
        <div className="grid" style={{ marginTop: 12 }}>
          <div className="s12"><Historico r={r} /></div>
          <div className="s12"><PrecisionProgramacion desde={desde} hasta={hasta} cd={cd} periodo={periodo} /></div>
          <div className="s12"><Resultado r={r} enValor={enValor} setEnValor={setEnValor} /></div>
          <div className="s12"><Match r={r} enValor={enValor} /></div>
          <div className="s12"><ConteosTurnos r={r} enValor={enValor} /></div>
          <div className="s12"><Matriz r={r} enValor={enValor} /></div>
          <div className="s12"><TopSku r={r} enValor={enValor} /></div>
        </div>
      </>}
    </>
  );
}
