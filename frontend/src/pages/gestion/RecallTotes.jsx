// Abastecimiento OSR → Optimización de totes → Ocupación y recall: con la foto diaria de KiSoft (una fila por compartimento),
// el uso de cada tote según su segmento (111 Full, 121 Half, 141 Quarter) en los tramos de TRAMO_USO_TOTE, su evolución por
// día y el recall de totes para consolidar o cambiar de tipo los SKU que usan más tote del que necesitan.
import React, { useEffect, useState } from 'react';
import { api, qs, urlApi, fmt, fFecha } from './api.js';
import { IrACarga, toast } from './ui.jsx';

const COLOR_TRAMO = { '0-25': '--red', '25-50': '--yellow', '50-75': '--teal', '75-100': '--green', '100+': '--violet', sin: '--empty' };
const NOM_TRAMO = { sin: 'Sin capacidad' };
const QUE_HACER = {
  CONSOLIDAR: 'Juntar en menos compartimentos del mismo tipo.',
  REEMPACAR: 'Pasar a un tipo más chico (o combinar tipos) según su capacidad.',
  REVISAR: 'Hay compartimentos sobre el 100% o sin capacidad: revisar la capacidad del SKU en el maestro.',
  SIN_MENOR: 'Tote Full con poco uso, pero el SKU no tiene capacidad en Half ni Quarter: revisar el maestro.',
  OK: 'Ya usa el mínimo de tote (o libera menos que el mínimo pedido).',
  SIN_CAP: 'Sin capacidad en ningún tipo.',
};
const ORDEN_ACC = ['CONSOLIDAR', 'REEMPACAR', 'REVISAR', 'SIN_MENOR', 'OK', 'SIN_CAP'];
const pct1 = (v) => `${fmt(v * 100, 1)}%`;

function usar(url, cuerpo, deps) {
  const [r, setR] = useState(null);
  const [cargando, setCargando] = useState(false);
  useEffect(() => {
    setCargando(true);
    const t = setTimeout(() => api.post(url, cuerpo).then(setR).catch((e) => toast(e.message, true)).finally(() => setCargando(false)), 250);
    return () => clearTimeout(t);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [r, cargando];
}

/** Barra 100% con el reparto de los totes en los tramos de uso. */
function BarraTramos({ p, tramos }) {
  const ks = [...tramos.map((t) => t.k), 'sin'];
  return (
    <div className="rt-barra" role="img" aria-label={ks.filter((k) => p.tramos[k]).map((k) => `${NOM_TRAMO[k] || tramos.find((t) => t.k === k).n}: ${fmt(p.tramos[k])} totes`).join(', ')}>
      {ks.map((k) => p.tramos[k] > 0 && <i key={k} style={{ width: `${(p.tramos[k] / p.totes) * 100}%`, background: `var(${COLOR_TRAMO[k]})` }} />)}
    </div>
  );
}

function Ocupacion({ r }) {
  const filas = [...r.ocup.porTipo, r.ocup.tot];
  const hayS = r.ocup.tot.tramos.sin > 0;
  return (
    <>
      <h3 style={{ margin: '4px 0 6px' }}>Uso de los totes por segmento</h3>
      <div className="legend" style={{ margin: '0 0 6px' }}>{r.tramos.map((t) => <span key={t.k} style={{ '--c': `var(${COLOR_TRAMO[t.k]})` }}>{t.n}</span>)}
        {hayS && <span style={{ '--c': 'var(--empty)' }}>Sin capacidad</span>}</div>
      <div className="tbl">
        <table className="rt-ocup">
          <thead>
            <tr><th>Tipo de tote</th><th className="num">Totes</th><th className="num">Compart. con stock</th><th className="num">Compart. vacíos</th><th className="num">Unidades</th>
              <th className="num" title="Promedio del uso de cada tote (los que pasan el 100% cuentan como 100%)">Uso promedio</th><th style={{ minWidth: 200 }}>Reparto de los totes</th>
              {r.tramos.map((t) => <th key={t.k} className="num">{t.n}</th>)}{hayS && <th className="num">Sin capacidad</th>}</tr>
          </thead>
          <tbody>{filas.map((p) => (
            <tr key={p.tipo} className={p.tipo === 'TOTAL' ? 'tot' : ''}>
              <td>{p.tipo === 'TOTAL' ? 'Total' : <><b>{p.nom}</b> <span className="muted">{p.tipo}</span></>}</td>
              <td className="num">{fmt(p.totes)}</td><td className="num">{fmt(p.slots)}</td><td className="num">{fmt(p.slotsVacios)}</td><td className="num">{fmt(p.qty)}</td>
              <td className="num"><b>{pct1(p.usoProm)}</b></td><td><BarraTramos p={p} tramos={r.tramos} /></td>
              {r.tramos.map((t) => <td key={t.k} className="num">{pct1(p.totes ? p.tramos[t.k] / p.totes : 0)}<div className="note" style={{ margin: 0 }}>{fmt(p.tramos[t.k])}</div></td>)}
              {hayS && <td className="num">{fmt(p.tramos.sin)}</td>}
            </tr>))}</tbody>
        </table>
      </div>
      <p className="note">Uso del compartimento = unidades ÷ capacidad del SKU en ese tipo (CAPACITY_111 / 121 / 141). Uso del tote = suma de sus compartimentos ponderados por su tamaño (Half = ½, Quarter = ¼), igual que USO_REL y TRAMO_USO_TOTE: un Half con un solo compartimento ocupado llega como máximo al 50%. Sobre 100% = el SKU tiene más unidades que su capacidad registrada (capacidad del maestro baja). Sin capacidad = el SKU no tiene capacidad registrada para el tipo de tote en que está.</p>
    </>
  );
}

/** Resumen gerencial: cómo están hoy los totes y cómo quedarían aplicando cada criterio del recall. */
function Gerencial({ r }) {
  const l = r.esc.lista, osr = r.esc.osr, hoy = l[0], rc = l.find((e) => e.k === 'recall');
  const delta = (v, base, pts) => {
    const d = v - base;
    if (Math.abs(d) < (pts ? 0.0005 : 0.5)) return null;
    return <span className={'rt-d ' + (pts ? (d > 0 ? 'up' : 'dn') : (d < 0 ? 'up' : 'dn'))}>{d > 0 ? '+' : '−'}{pts ? `${fmt(Math.abs(d) * 100, 1)} pts` : fmt(Math.abs(d))}</span>;
  };
  const barra = (v, meta) => (
    <div className="rt-util"><div><i style={{ width: `${Math.min(100, v * 100)}%` }} />{meta ? <b style={{ left: `${meta * 100}%` }} /> : null}</div><span>{pct1(v)}</span></div>
  );
  return (
    <div className="rt-ger">
      <h3 style={{ margin: '0 0 2px' }}>Hoy y aplicando el recall</h3>
      <p className="rt-titular">Hoy los totes se usan al <b>{pct1(hoy.util)}</b> de su capacidad. Con el recall completo pasarían al <b>{pct1(rc.util)}</b>,
        con <b>{fmt(rc.libera)}</b> totes menos{osr ? <> y el OSR bajaría de <b>{pct1(hoy.ocupOsr)}</b> a <b>{pct1(rc.ocupOsr)}</b> de ocupación (target {fmt(osr.target * 100)}%)</> : ''}.
        Para eso hay que llamar {fmt(rc.llamar)} totes de {fmt(rc.skus)} SKU.</p>
      <div className="tbl">
        <table className="rt-esc">
          <thead><tr><th />{l.map((e) => <th key={e.k} className={'num' + (e.k === 'hoy' ? ' rt-hoy' : '')}>{e.nom}</th>)}</tr></thead>
          <tbody>
            <tr><td>Utilización de los totes</td>{l.map((e) => <td key={e.k} className={e.k === 'hoy' ? 'rt-hoy' : ''}>{barra(e.util)}{delta(e.util, hoy.util, true)}</td>)}</tr>
            {osr && <tr><td>Ocupación del OSR<div className="note" style={{ margin: 0 }}>{fmt(osr.positions)} posiciones · target {fmt(osr.target * 100)}%</div></td>
              {l.map((e) => <td key={e.k} className={e.k === 'hoy' ? 'rt-hoy' : ''}>{barra(e.ocupOsr, osr.target)}<span className="note">{fmt(e.ocupadas)} ocupadas</span></td>)}</tr>}
            <tr><td>Totes ocupados</td>{l.map((e) => <td key={e.k} className={'num' + (e.k === 'hoy' ? ' rt-hoy' : '')}><b>{fmt(e.totes)}</b> {delta(e.totes, hoy.totes)}</td>)}</tr>
            {hoy.porTipo.map((p, i) => (
              <tr key={p.tipo} className="rt-sub"><td>{p.nom} <span className="muted">{p.tipo}</span>: totes · utilización</td>
                {l.map((e) => <td key={e.k} className={'num' + (e.k === 'hoy' ? ' rt-hoy' : '')}>{fmt(e.porTipo[i].totes)} · {pct1(e.porTipo[i].util)}</td>)}</tr>))}
            <tr><td>Totes que se liberan</td>{l.map((e) => <td key={e.k} className={'num' + (e.k === 'hoy' ? ' rt-hoy' : '')}>{e.k === 'hoy' ? '—' : <b>{fmt(e.libera)}</b>}</td>)}</tr>
            <tr><td>Totes a llamar · SKU a reempacar</td>{l.map((e) => <td key={e.k} className={'num' + (e.k === 'hoy' ? ' rt-hoy' : '')}>{e.k === 'hoy' ? '—' : `${fmt(e.llamar)} · ${fmt(e.skus)}`}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="note">Utilización = capacidad usada ÷ capacidad de los totes ocupados (un compartimento sobre el 100% cuenta como lleno; por eso puede diferir un poco del uso promedio del cuadro de abajo). En cada criterio, los SKU se reempacan con la propuesta y los compartimentos que quedan en los totes llamados se juntan con los nuevos del mismo tipo (2 por Half, 4 por Quarter).{osr ? ` Ocupación del OSR = posiciones ocupadas de la capacidad cargada (${osr.archivo}) menos los totes que se liberan.` : ''} Indica "Totes a llamar en el día" para ver también el plan del día.</p>
    </div>
  );
}

/** Foto elegida contra la anterior: cómo cambió el uso de los totes y si se aplicó el recall. */
function Comparacion({ c }) {
  const A = c.a, B = c.b;
  // bueno = 1 si subir es bueno, -1 si bajar es bueno, 0 neutro
  const fila = (nom, va, vb, { pct, bueno = 0, sub, d = 0 } = {}) => {
    const dif = vb - va;
    const cero = Math.abs(dif) < (pct ? 0.0005 : 0.5);
    const cls = cero || !bueno ? '' : (dif > 0) === (bueno > 0) ? 'up' : 'dn';
    return (
      <tr key={nom} className={sub ? 'rt-sub' : ''}><td>{nom}</td>
        <td className="num">{pct ? pct1(va) : fmt(va, d)}</td><td className="num"><b>{pct ? pct1(vb) : fmt(vb, d)}</b></td>
        <td className="num">{cero ? <span className="muted">sin cambio</span> : <span className={'rt-d ' + cls}>{dif > 0 ? '+' : '−'}{pct ? `${fmt(Math.abs(dif) * 100, 1)} pts` : fmt(Math.abs(dif), d)}</span>}</td></tr>
    );
  };
  const tp = (f, t) => f.porTipo.find((p) => p.tipo === t) || { totes: 0, util: 0, bajo25: 0, sobre100: 0 };
  const tipos = A.porTipo.map((p) => [p.tipo, p.nom]);
  const r = c.rec;
  return (
    <div className="rt-ger">
      <h3 style={{ margin: '0 0 2px' }}>Comparación con el día anterior</h3>
      <p className="rt-titular">Del {fFecha(c.fa)} al {fFecha(c.fb)} la utilización de los totes {Math.abs(B.util - A.util) < 0.0005 ? 'se mantuvo' : B.util > A.util ? 'subió' : 'bajó'} ({pct1(A.util)} → <b>{pct1(B.util)}</b>)
        y los totes ocupados {B.totes >= A.totes ? 'aumentaron' : 'bajaron'} en <b>{fmt(Math.abs(B.totes - A.totes))}</b>.
        De los {fmt(r.skus)} SKU que estaban en el recall, <b>{fmt(r.mejoraron)}</b> usan menos tote ({fmt(r.liberado, 0)} totes liberados) y {fmt(r.siguen)} siguen igual.</p>
      <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', alignItems: 'start' }}>
        <div className="tbl">
          <table className="rt-esc">
            <thead><tr><th /><th className="num">{fFecha(c.fa)}</th><th className="num">{fFecha(c.fb)}</th><th className="num">Variación</th></tr></thead>
            <tbody>
              {fila('Utilización de los totes', A.util, B.util, { pct: true, bueno: 1 })}
              {fila('Totes ocupados', A.totes, B.totes, { bueno: -1 })}
              {tipos.map(([t, nom]) => fila(`${nom}: totes`, tp(A, t).totes, tp(B, t).totes, { sub: true }))}
              {tipos.map(([t, nom]) => fila(`${nom}: utilización`, tp(A, t).util, tp(B, t).util, { pct: true, bueno: 1, sub: true }))}
              {fila('Totes con uso hasta 25%', A.tramos['0-25'], B.tramos['0-25'], { bueno: -1 })}
              {fila('Totes sobre 100% (revisar capacidad)', A.tramos['100+'], B.tramos['100+'], { bueno: -1 })}
              {fila('Unidades', A.qty, B.qty)}
              {fila('SKU', A.skus, B.skus)}
              {fila('Compartimentos', A.slots, B.slots)}
              {fila('Recall: totes a llamar', A.recall.totesLlamar, B.recall.totesLlamar, { bueno: -1 })}
              {fila('Recall: totes que libera', A.recall.ahorro, B.recall.ahorro, { bueno: -1 })}
            </tbody>
          </table>
        </div>
        <div>
          <table className="rt-esc">
            <thead><tr><th>Movimientos</th><th className="num">Cantidad</th><th className="num">Unidades</th></tr></thead>
            <tbody>
              <tr><td>Totes nuevos (LOAD_UNIT que no estaba)</td><td className="num">{fmt(c.totes.nuevas)}</td><td /></tr>
              <tr><td>Totes que ya no están</td><td className="num">{fmt(c.totes.salen)}</td><td /></tr>
              {c.totes.cambia > 0 && <tr><td>Totes que cambiaron de tipo</td><td className="num">{fmt(c.totes.cambia)}</td><td /></tr>}
              <tr><td>SKU que entraron al OSR</td><td className="num">{fmt(c.sk.entran)}</td><td className="num">{fmt(c.sk.uEntran)}</td></tr>
              <tr><td>SKU que salieron del OSR</td><td className="num">{fmt(c.sk.salen)}</td><td className="num">{fmt(c.sk.uSalen)}</td></tr>
              <tr className="rt-sub"><td>SKU con más unidades · con menos</td><td className="num">{fmt(c.sk.suben)} · {fmt(c.sk.bajan)}</td><td /></tr>
            </tbody>
          </table>
          <table className="rt-esc" style={{ marginTop: 10 }}>
            <thead><tr><th>Recall del {fFecha(c.fa)}</th><th className="num">SKU</th></tr></thead>
            <tbody>
              <tr><td>Usan menos tote<div className="note" style={{ margin: 0 }}>{fmt(r.liberado, 1)} totes liberados (por el recall o porque se vendió)</div></td><td className="num"><b>{fmt(r.mejoraron)}</b></td></tr>
              <tr><td>Siguen igual (pendientes)</td><td className="num">{fmt(r.siguen)}</td></tr>
              <tr><td>Salieron del OSR</td><td className="num">{fmt(r.salieron)}</td></tr>
              <tr className="rt-sub"><td>Nuevos en el recall del {fFecha(c.fb)}</td><td className="num">{fmt(r.nuevos)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="note">Se compara la foto elegida con la foto anterior cargada. Verde = mejora, rojo = empeora. Un SKU del recall que hoy usa menos tote puede ser porque se reempacó o porque se pickeó y se vació un compartimento.</p>
    </div>
  );
}

function Evolucion({ r }) {
  if (r.evolucion.length < 2) return <p className="note">Evolución diaria: hay una sola foto cargada ({fFecha(r.fecha)}). Carga el archivo de KiSoft cada día para ver cómo cambia el uso de los totes.</p>;
  const ult = [...r.evolucion].reverse().slice(0, 31);
  const tp = (e, t) => e.porTipo.find((p) => p.tipo === t);
  const bajo = (p) => (p && p.totes ? p.tramos['0-25'] / p.totes : null);
  return (
    <>
      <h3 style={{ margin: '18px 0 6px' }}>Evolución diaria</h3>
      <div className="tbl" style={{ maxHeight: 360 }}>
        <table>
          <thead><tr><th>Foto</th><th className="num">Totes</th><th className="num">Uso promedio</th>
            {['111', '121', '141'].map((t) => <th key={t} className="num">{r.tipos[t].nom}: totes · uso · hasta 25%</th>)}
            <th className="num">Más de 100%</th><th className="num">Recall: totes a llamar</th><th className="num">Recall: totes que libera</th></tr></thead>
          <tbody>{ult.map((e) => (
            <tr key={e.fecha} className={e.fecha === r.fecha ? 'sel' : ''}>
              <td>{fFecha(e.fecha)}</td><td className="num">{fmt(e.tot?.totes)}</td><td className="num"><b>{e.tot ? pct1(e.tot.usoProm) : '—'}</b></td>
              {['111', '121', '141'].map((t) => { const p = tp(e, t); return <td key={t} className="num">{p ? `${fmt(p.totes)} · ${pct1(p.usoProm)} · ${pct1(bajo(p))}` : '—'}</td>; })}
              <td className="num">{e.tot ? pct1(e.tot.tramos['100+'] / e.tot.totes) : '—'}</td>
              <td className="num">{fmt(e.recall?.totesLlamar)}</td><td className="num">{fmt(e.recall?.ahorro, 0)}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <p className="note">El recall de cada día se calcula con los criterios por defecto (llenado 100%, ahorro mínimo ½ tote por SKU) para que los días se puedan comparar.</p>
    </>
  );
}

export default function RecallTotes() {
  const [f, setF] = useState({ fecha: '', llenado: '', minAhorro: '', minTotes: '', maxTotes: '', tipo: '', depto: '', buscar: '', accion: 'RECALL' });
  const [r, cargando] = usar('/api/optimizacion/osr/recall', f, [JSON.stringify(f)]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  if (!r) return <div className="sec"><p className="note">{cargando ? 'Calculando…' : ''}</p></div>;
  if (!r.cargada) return (
    <div className="sec"><h2 style={{ marginTop: 0 }}>Ocupación de totes y recall</h2>
      <div className="alert warn">Falta el stock del OSR por compartimento (extracción de KiSoft con PRODUCT_CODE, LOAD_UNIT, SLOT_INT, STOCK_LOCATION_TYPE, QUANTITY_TOTAL_INT y CAPACITY_111 / 121 / 141). <IrACarga id="osrslots" etiqueta="Cargar archivo (en Datos)" /></div></div>
  );
  const ra = r.resumen.porAccion, o = r.opciones;
  const excel = urlApi('/api/optimizacion/osr/recall/excel' + qs({ ...f, fecha: r.fecha }));
  const recall = { skus: ra.CONSOLIDAR.skus + ra.REEMPACAR.skus, ahorro: r.resumen.ahorro, totes: r.resumen.totesLlamar, qty: ra.CONSOLIDAR.qty + ra.REEMPACAR.qty };
  return (
    <div className="sec">
      <div className="row spread" style={{ alignItems: 'flex-end', marginBottom: 6, gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Ocupación de totes y recall</h2>
          <p className="note" style={{ margin: '2px 0 0' }}>{r.archivo} · foto del {fFecha(r.fecha)}</p>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          {r.fechas.length > 1 && <div><label className="lbl" htmlFor="rt-f">Foto</label>
            <select id="rt-f" value={r.fecha} onChange={(e) => set('fecha')(e.target.value)}>{[...r.fechas].reverse().map((x) => <option key={x} value={x}>{fFecha(x)}</option>)}</select></div>}
          {cargando && <span className="note">Calculando…</span>}
          <a className="btn primary" href={excel}>Exportar recall a Excel</a>
        </div>
      </div>

      {r.esc && <Gerencial r={r} />}
      {r.comp && <Comparacion c={r.comp} />}

      <Ocupacion r={r} />

      <h3 style={{ margin: '18px 0 6px' }}>Recall para optimizar los totes</h3>
      <p className="note" style={{ marginTop: 0 }}>Por SKU se calcula el empaque que usa menos tote para sus unidades: compartimentos Full, Half y Quarter con la capacidad del SKU en cada tipo, llenados hasta el {fmt(o.llenado * 100)}%, sin dejar el SKU en menos de {o.minTotes} {o.minTotes === 1 ? 'tote' : 'totes distintos'} (o los que tiene hoy si son menos): si la máquina falla en un tote, el SKU se puede pickear desde otro. Las unidades se reparten entre esos totes según su capacidad. Si libera al menos {fmt(o.minAhorro, 2)} tote, sus totes se llaman a la puerta (recall) para consolidar o cambiar de tipo. Totes que libera = totes equivalentes (Half = ½, Quarter = ¼): los Half y Quarter de distintos SKU comparten tote.</p>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}>
        <div><label className="lbl" htmlFor="rt-ll">Llenado máximo al reempacar %</label>
          <input id="rt-ll" type="number" className="w90" min="50" max="100" placeholder="100" value={f.llenado} onChange={(e) => set('llenado')(e.target.value)} /></div>
        <div><label className="lbl" htmlFor="rt-ma">Liberar al menos (totes por SKU)</label>
          <select id="rt-ma" value={f.minAhorro} onChange={(e) => set('minAhorro')(e.target.value)}>
            <option value="">½ tote</option><option value="0.25">¼ tote</option><option value="0.75">¾ tote</option><option value="1">1 tote</option><option value="2">2 totes</option></select></div>
        <div><label className="lbl" htmlFor="rt-mn" title="Para no depender de un solo tote si la máquina falla">Mínimo de totes por SKU</label>
          <select id="rt-mn" value={f.minTotes} onChange={(e) => set('minTotes')(e.target.value)}>
            <option value="">2 totes</option><option value="1">1 tote</option><option value="3">3 totes</option><option value="4">4 totes</option></select></div>
        <div><label className="lbl" htmlFor="rt-mt">Totes a llamar en el día</label>
          <input id="rt-mt" type="number" className="w90" min="1" placeholder="todos" value={f.maxTotes} onChange={(e) => set('maxTotes')(e.target.value)} /></div>
        <div><span className="lbl">Tipo de tote de hoy</span>
          <div className="chips">{[['', 'Todos'], ['111', 'Full'], ['121', 'Half'], ['141', 'Quarter']].map(([k, t]) => <button key={k} className="chip" aria-pressed={f.tipo === k} onClick={() => set('tipo')(k)}>{t}</button>)}</div></div>
        <div><label className="lbl" htmlFor="rt-dep">Depto</label>
          <select id="rt-dep" value={f.depto} style={{ maxWidth: 230 }} onChange={(e) => set('depto')(e.target.value)}><option value="">Todos</option>{r.deptos.map((d) => <option key={d}>{d}</option>)}</select></div>
        <div><label className="lbl" htmlFor="rt-b">Buscar SKU o descripción</label>
          <input id="rt-b" type="search" value={f.buscar} onChange={(e) => set('buscar')(e.target.value)} /></div>
      </div>

      <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', alignItems: 'start' }}>
        <div className="tbl">
          <table className="rt-acc">
            <thead><tr><th>Resultado por SKU</th><th className="num">SKU</th><th className="num">Totes a llamar</th><th className="num">Totes que libera</th><th className="num">Unidades</th><th>Qué hacer</th></tr></thead>
            <tbody>
              {ORDEN_ACC.filter((k) => ra[k].skus || k === 'CONSOLIDAR' || k === 'REEMPACAR').map((k) => (
                <React.Fragment key={k}>
                  <tr className={f.accion === k ? 'sel' : ''}>
                    <td><a href="#" onClick={(e) => { e.preventDefault(); set('accion')(k); }}>{r.acciones[k]}</a></td>
                    <td className="num">{fmt(ra[k].skus)}</td><td className="num">{fmt(ra[k].totes)}</td><td className="num">{k === 'CONSOLIDAR' || k === 'REEMPACAR' ? <b>{fmt(ra[k].ahorro, 0)}</b> : <span className="muted">—</span>}</td>
                    <td className="num">{fmt(ra[k].qty)}</td><td className="note wrap" style={{ margin: 0 }}>{QUE_HACER[k]}</td>
                  </tr>
                  {k === 'REEMPACAR' && (
                    <tr className={'tot' + (f.accion === 'RECALL' ? ' sel' : '')}>
                      <td><a href="#" onClick={(e) => { e.preventDefault(); set('accion')('RECALL'); }}>Recall (las dos)</a></td>
                      <td className="num">{fmt(recall.skus)}</td><td className="num">{fmt(recall.totes)}</td><td className="num">{fmt(recall.ahorro, 0)}</td><td className="num">{fmt(recall.qty)}</td>
                      <td className="note wrap" style={{ margin: 0 }}>Totes distintos a llamar (un Half o Quarter con dos SKU se llama una vez).</td>
                    </tr>)}
                </React.Fragment>))}
            </tbody>
          </table>
        </div>
        <div className="tbl" style={{ maxHeight: 300 }}>
          <table>
            <thead><tr><th>Depto (recall)</th><th className="num">SKU</th><th className="num">Totes a llamar</th><th className="num">Libera</th></tr></thead>
            <tbody>{r.porDepto.slice(0, 40).map((d) => (
              <tr key={d.depto} className={f.depto === d.depto ? 'sel' : ''}>
                <td className="wrap"><a href="#" onClick={(e) => { e.preventDefault(); set('depto')(f.depto === d.depto ? '' : d.depto); }}>{d.depto}</a></td>
                <td className="num">{fmt(d.skus)}</td><td className="num">{fmt(d.totes)}</td><td className="num">{fmt(d.ahorro, 0)}</td></tr>))}</tbody>
          </table>
        </div>
      </div>

      <div className="row spread" style={{ alignItems: 'center', margin: '12px 0 6px' }}>
        <h4 style={{ margin: 0 }}>{f.accion === 'RECALL' ? 'Recall' : r.acciones[f.accion]}: {fmt(r.n)} SKU{r.maxTotes ? ` · en el plan del día ${fmt(r.enPlan)} SKU (hasta ${fmt(r.maxTotes)} totes)` : ''}</h4>
        {r.n > r.lista.length && <span className="note">Se muestran los primeros {fmt(r.lista.length)}; el Excel trae todos.</span>}
      </div>
      <div className="tbl">
        <table className="rt-lista">
          <thead><tr><th className="num">#</th><th>SKU</th><th>Descripción</th><th className="num">Unidades</th><th>Hoy</th><th>Propuesta</th><th className="num">Libera</th><th className="num">Totes a llamar</th>
            <th className="num" title="Totes distintos llamados sumando los SKU en este orden">Acum. totes</th><th className="num">Acum. libera</th><th className="num" title="Capacidad del SKU por compartimento en Full / Half / Quarter">Cap. F / H / Q</th><th>LOAD_UNIT</th></tr></thead>
          <tbody>{r.lista.map((s, i) => (
            <tr key={s.sku} className={s.enPlan ? '' : 'muted'}>
              <td className="num">{i + 1}</td>
              <td><b>{s.sku}</b></td>
              <td className="wrap">{s.nombre}{s.sobre ? <div className="note" style={{ margin: 0 }}>{s.sobre} compart. sobre 100%</div> : null}</td>
              <td className="num">{fmt(s.qty)}</td><td>{s.hoy}</td><td><b>{s.prop}</b></td>
              <td className="num"><b>{fmt(s.ahorro, 2)}</b></td><td className="num">{fmt(s.totes)}</td><td className="num">{fmt(s.acTotes)}</td><td className="num">{fmt(s.acAhorro, 1)}</td>
              <td className="num">{s.cap.map((c) => (c ? fmt(c) : '–')).join(' / ')}</td>
              <td className="note" style={{ margin: 0 }}>{s.lus.join(', ')}{s.totes > s.lus.length ? ` +${s.totes - s.lus.length}` : ''}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <p className="note">Orden: primero los SKU que liberan más tote por cada tote que hay que llamar (menos viajes a la puerta por tote ganado). Con “Totes a llamar en el día” se marca hasta dónde llega el plan del día; el resto queda atenuado. El Excel trae una fila por compartimento a llamar (LOAD_UNIT, SLOT, unidades, uso) en este orden, el resumen por SKU y la ocupación por tipo.</p>

      <Evolucion r={r} />
    </div>
  );
}
