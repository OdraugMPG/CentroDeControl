// Movimientos de SKU (Gestión de inventario): cambios de ubicación detectados comparando la Base de stock de cada día con
// la del día anterior. Resumen por día y CD, SKU con más cambios, ubicaciones con más rotación y la historia de un SKU
// (en qué ubicaciones estuvo cada día).
import { useState } from 'react';
import { useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { N, dmy, dm, css } from '../../lib/fmt.js';
import { TablaOrden } from '../control/Recepcion.jsx';
import { descargar } from './Inventario.jsx';

const CLASE = {
  traslado: ['Cambios de ubicación', '--blue', 'El SKU sale de una ubicación y entra a otra, o se reparte / consolida sin que cambie su stock total.'],
  almacenamiento: ['Almacenamientos', '--teal', 'El SKU aparece en una ubicación nueva y su stock total sube (mercadería nueva o reposición).'],
  vaciada: ['Ubicaciones vaciadas', '--slate', 'El SKU sale de la ubicación y su stock total baja (venta o picking).']
};
const div = (a, b) => (b > 0 ? a / b : null);
// clase ABC / XYZ: color de AX (verde) a CZ (rojo), como la matriz de ABC / XYZ
const TONO_ABC = ['--green', '--teal', '--yellow', '--yellow', '--red'];
const ABC_T = { A: 'alta demanda', B: 'demanda media', C: 'baja demanda' };
const XYZ_T = { rotacion: { X: 'alta rotación', Y: 'rotación baja', Z: 'sin venta o sin stock' }, historia: { X: 'demanda estable', Y: 'demanda variable', Z: 'demanda muy variable' } };
function Abc({ m, metodo = 'rotacion' }) {
  if (!m) return <span className="muted" title="Sin clasificación ABC / XYZ">—</span>;
  const t = m[1] === '-' ? 'm-n' : 'ABC'.indexOf(m[0]) + 'XYZ'.indexOf(m[1]);
  return <span className="cmp-res" style={{ '--c': `var(${t === 'm-n' ? '--slate' : TONO_ABC[t]})`, fontWeight: 700 }}
    title={`${m[0]}: ${ABC_T[m[0]] || ''}${m[1] !== '-' ? ` · ${m[1]}: ${XYZ_T[metodo]?.[m[1]] || ''}` : ''}`}>{m[1] === '-' ? `${m[0]} —` : m}</span>;
}

const TIPO_FLUJO = { traslado: ['Traslado', '--blue'], entrada: ['Entrada', '--teal'], salida: ['Salida', '--slate'] };
const lugar = (x) => (x ? <><b>{x.ubicacion}</b> <span className="muted">{x.cd} · {N(x.antes)} → {N(x.despues)}</span></> : <span className="muted">—</span>);

// Trazabilidad del SKU: cada movimiento de un día de foto al siguiente, con origen, destino y cantidad
function Trazabilidad({ h }) {
  const [ver, setVer] = useState('traslado');
  const F = h.flujos || [];
  const sum = (t) => F.filter((f) => f.tipo === t).reduce((a, f) => a + f.qty, 0);
  const n = (t) => F.filter((f) => f.tipo === t).length;
  const sel = ver === 'todo' ? F : F.filter((f) => f.tipo === ver);
  const csv = () => descargar([['Desde', 'Hasta', 'Tipo', 'CD origen', 'Ubicación origen', 'Origen antes', 'Origen después', 'CD destino', 'Ubicación destino', 'Destino antes', 'Destino después', 'Cantidad', 'Entre CD'],
    ...F.map((f) => [f.desde, f.fecha, TIPO_FLUJO[f.tipo][0], f.origen?.cd ?? '', f.origen?.ubicacion ?? '', f.origen?.antes ?? '', f.origen?.despues ?? '',
      f.destino?.cd ?? '', f.destino?.ubicacion ?? '', f.destino?.antes ?? '', f.destino?.despues ?? '', f.qty, f.entreCd ? 'SI' : ''])], `trazabilidad_sku_${h.sku}.csv`);
  if (!F.length) return <p className="empty">El SKU no tuvo movimientos en el período.</p>;
  return (
    <>
      <div className="row spread" style={{ margin: '0 0 8px', gap: 8, flexWrap: 'wrap' }}>
        <p className="hint" style={{ margin: 0 }}>
          <b>{N(n('traslado'))} traslados</b> ({N(sum('traslado'))} u.{F.some((f) => f.entreCd) ? `, ${N(F.filter((f) => f.entreCd).length)} entre CD` : ''}) ·
          {' '}{N(n('entrada'))} entradas ({N(sum('entrada'))} u.) · {N(n('salida'))} salidas ({N(sum('salida'))} u.)
        </p>
        <div className="row" style={{ gap: 8 }}>
          <div className="seg-inv" role="group" aria-label="Tipo de movimiento">
            {[['todo', 'Todos'], ['traslado', 'Traslados'], ['entrada', 'Entradas'], ['salida', 'Salidas']].map(([v, t]) => <button key={v} type="button" aria-pressed={ver === v} onClick={() => setVer(v)}>{t}</button>)}
          </div>
          <button type="button" className="ghost" onClick={csv}>Descargar CSV</button>
        </div>
      </div>
      <div className="tscroll val-det" style={{ maxHeight: 380, overflow: 'auto' }}><table>
        <thead><tr><th>Día</th><th>Tipo</th><th>Origen (antes → después)</th><th /><th>Destino (antes → después)</th><th className="num">Cantidad</th></tr></thead>
        <tbody>{sel.map((f, i) => (
          <tr key={i}>
            <td title={`De la foto del ${dmy(f.desde)} a la del ${dmy(f.fecha)}`}>{dm(f.fecha)}{f.desde && f.fecha && (Date.parse(f.fecha) - Date.parse(f.desde)) > 864e5 * 1.5 ? <span className="muted"> (desde {dm(f.desde)})</span> : ''}</td>
            <td><span className="cmp-res" style={{ '--c': `var(${TIPO_FLUJO[f.tipo][1]})` }}>{TIPO_FLUJO[f.tipo][0]}{f.entreCd ? ' entre CD' : ''}</span></td>
            <td>{f.tipo === 'entrada' ? <span className="muted">Mercadería nueva o reposición</span> : lugar(f.origen)}</td>
            <td className="muted">→</td>
            <td>{f.tipo === 'salida' ? <span className="muted">Venta o picking</span> : lugar(f.destino)}</td>
            <td className="num"><b>{N(f.qty)}</b></td>
          </tr>))}</tbody>
      </table></div>
    </>
  );
}

// Flujo entre CD del SKU: los movimientos de la trazabilidad agrupados por CD de origen y de destino.
// La entrada (mercadería nueva o reposición) es un origen y la salida (venta o picking) un destino.
const ENTRADA = 'Entrada', SALIDA = 'Salida';
const COLOR_CD = ['--blue', '--violet', '--teal', '--yellow', '--green', '--red'];
const nodoO = (f) => (f.tipo === 'entrada' ? ENTRADA : f.origen.cd);
const nodoD = (f) => (f.tipo === 'salida' ? SALIDA : f.destino.cd);
function colorDe(cds) { return (n) => (n === ENTRADA ? '--teal' : n === SALIDA ? '--slate' : COLOR_CD[Math.max(0, cds.indexOf(n)) % COLOR_CD.length]); }

/** Diagrama de flujo (tipo Sankey) de origen a destino con el grosor proporcional a las unidades */
function Flujo({ F, cds }) {
  const col = colorDe(cds);
  const links = new Map();
  for (const f of F) {
    const k = `${nodoO(f)}|${nodoD(f)}`;
    const l = links.get(k) || { o: nodoO(f), d: nodoD(f), q: 0, n: 0 };
    l.q += f.qty; l.n++; links.set(k, l);
  }
  const L = [...links.values()].sort((a, b) => b.q - a.q);
  const orden = (lado) => [...new Set(L.map((l) => l[lado]))].sort((a, b) => (a === ENTRADA || a === SALIDA ? 1 : 0) - (b === ENTRADA || b === SALIDA ? 1 : 0) || cds.indexOf(a) - cds.indexOf(b));
  const izq = orden('o'), der = orden('d');
  const total = L.reduce((t, l) => t + l.q, 0);
  const W = 720, gap = 14, nodoW = 14, MIN = 34, n = Math.max(izq.length, der.length), H = Math.max(120, 20 + n * (MIN + gap) + 40 + n * 16);
  const esc = (H - 20 - (gap + MIN) * n) / total;
  const pos = (nodos, lado) => {
    let y = 10;
    // cada nodo ocupa al menos MIN de alto para que su nombre y sus unidades no se monten con el siguiente
    return new Map(nodos.map((x) => { const h = Math.max(4, L.filter((l) => l[lado] === x).reduce((t, l) => t + l.q, 0) * esc); const p = { y: y + Math.max(0, (MIN - h) / 2), h, usado: 0 }; y += Math.max(h, MIN) + gap; return [x, p]; }));
  };
  const pi = pos(izq, 'o'), pd = pos(der, 'd');
  const xi = 150, xd = W - 150;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Flujo del SKU entre CD" style={{ width: '100%', maxWidth: W, display: 'block' }}>
      {L.map((l) => {
        const a = pi.get(l.o), b = pd.get(l.d), h = Math.max(1.5, l.q * esc);
        const y1 = a.y + a.usado + h / 2, y2 = b.y + b.usado + h / 2; a.usado += h; b.usado += h;
        const m = (xi + nodoW + xd) / 2;
        return (
          <path key={`${l.o}|${l.d}`} d={`M${xi + nodoW},${y1} C${m},${y1} ${m},${y2} ${xd},${y2}`} fill="none" stroke={`var(${col(l.o === ENTRADA ? l.d : l.o)})`} strokeOpacity="0.35" strokeWidth={h}>
            <title>{`${l.o} → ${l.d}: ${N(l.q)} u. en ${N(l.n)} ${l.n === 1 ? 'movimiento' : 'movimientos'}`}</title>
          </path>);
      })}
      {[[izq, pi, xi, 'end', 'o'], [der, pd, xd, 'start', 'd']].map(([nodos, P, x, anc, lado]) => nodos.map((n) => {
        const p = P.get(n), q = L.filter((l) => l[lado] === n).reduce((t, l) => t + l.q, 0);
        const tx = anc === 'end' ? x - 8 : x + nodoW + 8;
        return (
          <g key={`${lado}${n}`}>
            <rect x={x} y={p.y} width={nodoW} height={p.h} rx="3" fill={`var(${col(n)})`} />
            <text x={tx} y={p.y + p.h / 2 - 2} textAnchor={anc} className="flujo-n">{n === SALIDA ? 'Salida' : n === ENTRADA ? 'Entrada' : n}</text>
            <text x={tx} y={p.y + p.h / 2 + 13} textAnchor={anc} className="flujo-q">{N(q)} u.</text>
          </g>);
      }))}
    </svg>
  );
}

/** Recorrido día a día: los flujos CD → CD de cada día y el stock con que quedó cada CD */
function Recorrido({ h, cds }) {
  const col = colorDe(cds);
  const dias = new Map();
  for (const f of h.flujos) {
    if (!dias.has(f.fecha)) dias.set(f.fecha, { desde: f.desde, l: new Map() });
    const g = dias.get(f.fecha).l, k = `${nodoO(f)}|${nodoD(f)}|${f.tipo}`;
    const x = g.get(k) || { o: nodoO(f), d: nodoD(f), tipo: f.tipo, q: 0, ub: new Set() };
    x.q += f.qty; x.ub.add((f.destino || f.origen).ubicacion); g.set(k, x);
  }
  const stockCd = (fecha) => {
    const i = h.fechas.indexOf(fecha), m = {};
    for (const u of h.ubicaciones) if (u.qty[i]) m[u.cd] = (m[u.cd] || 0) + u.qty[i];
    return m;
  };
  const chip = (n) => <span className="flujo-chip" style={{ '--c': `var(${col(n)})` }}>{n === SALIDA ? 'Salida' : n}</span>;
  const ini = stockCd(h.fechas[0]);
  return (
    <ol className="flujo-dias">
      <li><div className="flujo-f">{dm(h.fechas[0])}</div><div className="flujo-mov muted">Inicio del período</div>
        <div className="flujo-st">{Object.entries(ini).map(([c, q]) => <span key={c}>{chip(c)} {N(q)}</span>)}</div></li>
      {[...dias].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, g]) => {
        const st = stockCd(fecha);
        return (
          <li key={fecha}>
            <div className="flujo-f">{dm(fecha)}{(Date.parse(fecha) - Date.parse(g.desde)) > 864e5 * 1.5 && <small className="muted"> desde {dm(g.desde)}</small>}</div>
            <div className="flujo-mov">{[...g.l.values()].sort((a, b) => b.q - a.q).map((x, i) => (
              <div key={i}>{x.tipo === 'entrada' ? chip(ENTRADA) : chip(x.o)} <span className="muted">→</span> {x.tipo === 'salida' ? chip(SALIDA) : chip(x.d)}
                {' '}<b>{N(x.q)} u.</b> <span className="muted">· {N(x.ub.size)} {x.ub.size === 1 ? 'ubicación' : 'ubicaciones'}{x.tipo === 'traslado' && x.o === x.d ? ' · reubicación dentro del CD' : ''}</span></div>))}</div>
            <div className="flujo-st" title="Stock del SKU en cada CD después de los movimientos del día">{Object.keys(st).length ? Object.entries(st).sort(([a], [b]) => cds.indexOf(a) - cds.indexOf(b)).map(([c, q]) => <span key={c}>{chip(c)} {N(q)}</span>) : <span className="muted">sin stock</span>}</div>
          </li>);
      })}
    </ol>
  );
}

// Historia de un SKU: trazabilidad (origen, destino y cantidad) y ubicaciones (filas) por día de foto (columnas)
function Historia({ sku, desde, hasta, cerrar }) {
  const d = useCarga(() => api.get(`/continuidad/inventario/movimientos/sku?${new URLSearchParams({ sku, desde, hasta })}`), [sku, desde, hasta]);
  const h = d.data;
  return (
    <Card title={`Historia del SKU ${sku}`} hint={h ? `${h.desc || ''}${h.depto ? ` · ${h.depto}` : ''} · ${N(h.ubicaciones.length)} ubicaciones en el período · ${N(h.cambios)} cambios de ubicación. ` : ''}
      actions={<div className="row" style={{ gap: 8 }}>
        {h && h.fechas.length > 0 && <button type="button" className="ghost" onClick={() => descargar([['CD', 'Ubicación', ...h.fechas], ...h.ubicaciones.map((u) => [u.cd, u.ubicacion, ...u.qty.map((v) => v ?? '')]), ['', 'Total', ...h.total]], `historia_sku_${sku}.csv`)}>Descargar CSV</button>}
        <button type="button" className="ghost" onClick={cerrar}>Cerrar</button></div>}>
      {!h ? <Cargando error={d.error} /> : !h.fechas.length ? <p className="empty">Sin fotos de stock en el período.</p> : <>
        {h.abc && <p className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '0 0 10px' }}>
          <b>Clasificación ABC / XYZ:</b> <Abc m={h.abc.total} metodo={h.abc.metodo} /> <span className="muted">todos los CD</span>
          {Object.entries(h.abc.porCd).map(([c, m]) => <span key={c} style={{ whiteSpace: 'nowrap' }}><span className="muted">· {c}</span> <Abc m={m} metodo={h.abc.metodo} /></span>)}
          <span className="hint" style={{ margin: 0 }}>· XYZ por {h.abc.metodo === 'historia' ? 'variabilidad mensual' : 'rotación (ventas / stock)'}; la clasificación vigente de Sloting, ABC / XYZ</span>
        </p>}
        {h.flujos.length > 0 && (() => {
          const cds = [...new Set(h.ubicaciones.map((u) => u.cd))].sort();
          // sin ventas ni entradas: solo lo que se movió de una ubicación a otra
          const traslados = h.flujos.filter((f) => f.tipo === 'traslado');
          return <>
            <h4 className="dash-sub">Flujo entre CD <small>solo movimientos internos (traslados): de dónde a dónde y cuántas unidades en el período; pasa el mouse por cada banda</small></h4>
            {traslados.length ? <Flujo F={traslados} cds={cds} /> : <p className="empty">El SKU no tuvo traslados en el período (solo entradas o salidas).</p>}
            <h4 className="dash-sub" style={{ marginTop: 14 }}>Recorrido día a día <small>traslados CD → CD de cada día y el stock con que quedó cada CD</small></h4>
            <Recorrido h={{ ...h, flujos: traslados }} cds={cds} />
          </>;
        })()}
        <h4 className="dash-sub" style={{ marginTop: 14 }}>Trazabilidad por ubicación: de dónde a dónde y cuánto</h4>
        <Trazabilidad h={h} />
        <h4 className="dash-sub" style={{ marginTop: 14 }}>Ubicaciones por día</h4>
        <p className="hint" style={{ marginTop: -4 }}>Cada celda es la cantidad del SKU en la ubicación ese día; vacía, no estaba.</p>
        <div className="tscroll val-det mov-hist" style={{ maxHeight: 480, overflow: 'auto' }}><table>
          <thead><tr><th>CD</th><th>Ubicación</th>{h.fechas.map((f) => <th key={f} className="num">{dm(f)}</th>)}</tr></thead>
          <tbody>
            {h.ubicaciones.map((u) => (
              <tr key={`${u.cd}|${u.ubicacion}`}><td>{u.cd}</td><td>{u.ubicacion}</td>
                {u.qty.map((v, i) => <td key={i} className={`num ${v === null ? '' : 'mov-si'}`}>{v === null ? '' : N(v)}</td>)}</tr>))}
            <tr className="tot"><td /><td><b>Total</b></td>{h.total.map((v, i) => <td key={i} className="num"><b>{N(v)}</b></td>)}</tr>
          </tbody>
        </table></div>
        <p className="hint">De una foto a la siguiente, lo que baja en una ubicación se empareja con lo que sube en otra: primero cantidades iguales (también traslados parciales), luego las ubicaciones que quedaron vacías. Una baja sin destino es salida (venta o picking); lo que sube sin origen es entrada.</p>
      </>}
    </Card>
  );
}

export default function InventarioMovimientos() {
  const [filtro, setFiltro] = useState({ desde: '', hasta: '', cd: '', zona: '', depto: '', buscar: '' });
  const [busca, setBusca] = useState('');
  const [sku, setSku] = useState('');
  const d = useCarga(() => api.get(`/continuidad/inventario/movimientos?${new URLSearchParams(filtro)}`), [filtro]);
  const r = d.data;
  if (!r) return <><PageHead title="Movimientos de SKU" /><Cargando error={d.error} />{!d.error && <p className="hint">La primera vez se comparan todas las fotos de stock; puede tardar unos segundos.</p>}</>;
  const set = (k) => (e) => setFiltro({ ...filtro, desde: filtro.desde || r.desde || '', hasta: filtro.hasta || r.hasta || '', [k]: e.target.value });
  const T = r.tot;
  const ver = (s) => { setSku(s); setTimeout(() => document.getElementById('mov-historia')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const linkSku = (v) => <button type="button" className="link mono" onClick={() => ver(v)} title="Ver la historia del SKU">{v}</button>;

  const porDia = T && {
    labels: r.porDia.map((x) => dm(x.fecha)),
    datasets: Object.entries(CLASE).map(([k, [t, c]]) => ({ label: t, data: r.porDia.map((x) => x[k]), backgroundColor: css(c), borderRadius: 3, borderSkipped: false, maxBarThickness: 38 }))
  };
  const frec = T && {
    labels: r.frec.map((x) => (x.n === 5 ? '5 o más' : x.n === 1 ? '1 vez' : `${x.n} veces`)),
    datasets: [{ label: 'SKU', data: r.frec.map((x) => x.skus), backgroundColor: css('--blue'), borderRadius: 4, borderSkipped: false, maxBarThickness: 44 }]
  };
  const kpi = (k, v, n, title) => <div className="kpi" title={title}><dt>{k}</dt><dd>{v}</dd>{n && <small className="muted" style={{ display: 'block', fontSize: 12 }}>{n}</small>}</div>;

  return (
    <>
      <PageHead title="Movimientos de SKU" sub={r.fotos >= 2 ? `Cambios de ubicación comparando la Base de stock de cada día con la del día anterior. Hay ${N(r.fotos)} fotos de stock, del ${dmy(r.primera)} al ${dmy(r.ultima)}.` : 'Se necesitan al menos dos Bases de stock (inicio de la jornada) cargadas.'} />
      {r.fotos >= 2 && <>
        <div className="filters" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 'auto' }}><span>Desde</span><input type="date" value={filtro.desde || r.desde || ''} onChange={set('desde')} /></label>
          <label className="field" style={{ width: 'auto' }}><span>Hasta</span><input type="date" value={filtro.hasta || r.hasta || ''} onChange={set('hasta')} /></label>
          <label className="field" style={{ width: 'auto' }}><span>CD</span><select value={filtro.cd} onChange={set('cd')}><option value="">Todos</option>{r.cds.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field" style={{ width: 'auto' }}><span>Zona</span><select value={filtro.zona} onChange={set('zona')} title="Las 3 primeras letras de la ubicación"><option value="">Todas</option>{r.zonas.map((z) => <option key={z}>{z}</option>)}</select></label>
          <label className="field" style={{ width: 'auto' }}><span>Depto</span><select value={filtro.depto} onChange={set('depto')} style={{ maxWidth: 240 }}><option value="">Todos</option>{r.deptos.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="field" style={{ width: 'auto' }}><span>SKU o descripción</span>
            <input type="search" placeholder="Enter para buscar" value={busca} style={{ width: 190 }}
              onChange={(e) => { setBusca(e.target.value); if (!e.target.value) setFiltro({ ...filtro, buscar: '' }); }}
              onKeyDown={(e) => e.key === 'Enter' && setFiltro({ ...filtro, buscar: busca.trim() })} /></label>
          {(filtro.desde || filtro.cd || filtro.zona || filtro.depto || filtro.buscar) && <button type="button" className="ghost" onClick={() => { setBusca(''); setFiltro({ desde: '', hasta: '', cd: '', zona: '', depto: '', buscar: '' }); }}>Quitar filtros</button>}
        </div>
        {r.saltos.length > 0 && <p className="hint">Días sin foto de stock: {r.saltos.map((s) => `${dm(s.desde)} → ${dm(s.hasta)}`).join(' · ')}. Los cambios de esos días se ven juntos en la foto siguiente.</p>}

        {!T || !(T.traslado + T.almacenamiento + T.vaciada) ? <p className="empty">Sin movimientos entre el {dmy(r.desde)} y el {dmy(r.hasta)} con estos filtros.</p> : <>
          <dl className="kpis">
            {kpi('Cambios de ubicación', N(T.traslado), `${N(r.pares)} ${r.pares === 1 ? 'día comparado' : 'días comparados'} · ${N(div(T.traslado, r.pares))} por día`, CLASE.traslado[2])}
            {kpi('SKU que cambiaron', N(T.skusCambio), `${(div(T.traslado, T.skusCambio) || 0).toFixed(1).replace('.', ',')} cambios por SKU`)}
            {kpi('Entre CD', N(T.entreCd), 'el SKU pasa de un CD a otro')}
            {kpi('Almacenamientos', N(T.almacenamiento), 'ubicación nueva con stock nuevo', CLASE.almacenamiento[2])}
            {kpi('Ubicaciones vaciadas', N(T.vaciada), 'venta o picking', CLASE.vaciada[2])}
            {kpi('Ubicaciones con movimiento', N(T.ubicaciones))}
          </dl>

          <div className="grid" style={{ marginTop: 12 }}>
            <Card className="s8" title="Movimientos por día" hint="Por día de la foto: lo que cambió desde la foto anterior.">
              <Grafico apilado alto={270} label="Movimientos por día" datos={porDia} />
            </Card>
            <Card className="s4" title="SKU por cantidad de cambios" hint="Cuántas veces cambió de ubicación cada SKU en el período.">
              <Grafico alto={270} leyenda={false} label="SKU por cantidad de cambios de ubicación" datos={frec} />
            </Card>
          </div>

          <Card title="Por CD">
            <TablaOrden filas={r.porCd} inicial={['traslado', -1]} clave={(x) => x.cd} cols={[
              ['cd', 'CD'], ['traslado', 'Cambios de ubicación', true, N], ['skus', 'SKU que cambiaron', true, N], ['entreCd', 'Entre CD', true, N],
              ['almacenamiento', 'Almacenamientos', true, N], ['vaciada', 'Ubicaciones vaciadas', true, N]]} />
          </Card>

          <Card title="SKU con más cambios de ubicación" hint={`${N(r.totalSkus)} SKU cambiaron de ubicación${r.totalSkus > r.skus.length ? ` (se muestran los ${N(r.skus.length)} con más cambios)` : ''}. Clic en el SKU para ver su historia.`}
            actions={<button type="button" className="ghost" onClick={() => descargar([['SKU', 'Descripción', 'Depto', 'ABC / XYZ', 'CD', 'Cambios de ubicación', 'Días con cambios', 'Entre CD', 'Ubicaciones distintas', 'Almacenamientos', 'Vaciadas', 'Último cambio'],
              ...r.skus.map((x) => [x.sku, x.desc, x.depto, x.abc || '', x.cds, x.cambios, x.dias, x.entreCd, x.ubicaciones, x.almacenamiento, x.vaciada, x.ultimo])], `movimientos_sku_${r.desde}_${r.hasta}.csv`)}>Descargar CSV</button>}>
            <TablaOrden filas={r.skus} inicial={['cambios', -1]} max={100} clave={(x) => x.sku} cols={[
              ['sku', 'SKU', false, linkSku], ['desc', 'Descripción', false, (v) => <span style={{ fontSize: 12.5 }}>{v || '—'}</span>], ['depto', 'Depto', false, (v) => <span style={{ fontSize: 12.5 }}>{v || '—'}</span>], ['abc', 'ABC / XYZ', false, (v) => <Abc m={v} />], ['cds', 'CD'],
              ['cambios', 'Cambios', true, (v) => <b>{N(v)}</b>], ['dias', 'Días con cambios', true, N], ['entreCd', 'Entre CD', true, N], ['ubicaciones', 'Ubic. distintas', true, N],
              ['almacenamiento', 'Almac.', true, N], ['vaciada', 'Vaciadas', true, N], ['ultimo', 'Último cambio', false, (v) => (v ? dm(v) : '—')]]} />
          </Card>

          <div id="mov-historia">{sku && <Historia sku={sku} desde={r.desde} hasta={r.hasta} cerrar={() => setSku('')} />}</div>

          <Card title="Ubicaciones con más rotación" hint={`Por cuántos SKU distintos pasó cada ubicación (entraron) y cuántos movimientos tuvo. ${N(r.totalUbic)} ubicaciones con movimiento${r.totalUbic > r.ubic.length ? ` (se muestran ${N(r.ubic.length)})` : ''}.`}
            actions={<button type="button" className="ghost" onClick={() => descargar([['CD', 'Ubicación', 'Zona', 'SKU distintos', 'Entradas', 'Salidas', 'Movimientos', 'Por traslado'],
              ...r.ubic.map((x) => [x.cd, x.ubicacion, x.zona, x.skus, x.entradas, x.salidas, x.mov, x.traslados])], `ubicaciones_rotacion_${r.desde}_${r.hasta}.csv`)}>Descargar CSV</button>}>
            <TablaOrden filas={r.ubic} inicial={['skus', -1]} max={50} clave={(x) => `${x.cd}|${x.ubicacion}`} cols={[
              ['cd', 'CD'], ['ubicacion', 'Ubicación'], ['zona', 'Zona'], ['skus', 'SKU distintos', true, (v) => <b>{N(v)}</b>], ['entradas', 'Entradas', true, N],
              ['salidas', 'Salidas', true, N], ['mov', 'Movimientos', true, N], ['traslados', 'Por traslado', true, N]]} />
          </Card>
          <p className="hint">Resolución diaria: si un SKU se movió dos veces en el mismo día, se ve solo dónde quedó. La clase (cambio de ubicación, almacenamiento o vaciada) se deduce del stock total del SKU en todos los CD: {Object.values(CLASE).map(([t, , a]) => `${t}: ${a.charAt(0).toLowerCase()}${a.slice(1)}`).join(' ')}</p>
        </>}
      </>}
    </>
  );
}
